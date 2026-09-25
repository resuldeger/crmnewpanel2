import { and, desc, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { calls, leads, customers, extensions } from "@/db/schema";
import { normalizeNumber } from "@/server/twilio/resolve";
import { vonageAccessToken } from "@/server/vonage/token";
import { parseVonageTime, toVonageWindow } from "@/server/vonage/time";
import { vonageEndpoints } from "@/server/vonage/endpoints";
import type { Job, JobResult } from "./types";

/* ── Vonage Business Cloud call log ────────────────────────────────────
 * Pulls the account-wide call log and matches each call to the lead,
 * customer and agent it belongs to.
 *
 * The field names below are the ones the API actually returns, confirmed
 * against live data. An earlier version guessed at them — `call_id`,
 * `from_number`, `duration`, `start_time` — and every one of those was
 * wrong, so the job would have recorded a run of empty calls rather than
 * failing loudly.
 * ────────────────────────────────────────────────────────────────── */

/** One row of `_embedded.call_logs`. */
interface VonageCall {
  id: string;
  from?: string;
  to?: string;
  /** "Inbound" | "Outbound", capitalised. */
  direction?: string;
  /** Seconds. Named `length`, not `duration`. */
  length?: number;
  /** "YYYY-MM-DD HH:MM:SS" in UTC, with no zone marker — see toUtc. */
  start?: string;
  end?: string;
  result?: string;
  recorded?: boolean;
  source_extension?: string | null;
  destination_extension?: string | null;
  source_user_full_name?: string | null;
  destination_user_full_name?: string | null;
  source_user?: string | null;
  destination_user?: string | null;
}

interface CallLogPage {
  _embedded?: { call_logs?: VonageCall[] };
  page?: number;
  total_pages?: number;
  total_items?: number;
}

/* An explicit off switch, matching TIMELY_SYNC_ENABLED. Without one the
   only way to stop the job hammering a refused credential was to kill the
   worker — which is how an account stayed locked for eight hours. */
const configured = () =>
  process.env.VONAGE_SYNC_ENABLED !== "0" &&
  Boolean(
    process.env.VONAGE_CONSUMER_KEY &&
    process.env.VONAGE_CONSUMER_SECRET &&
    process.env.VONAGE_USERNAME &&
    process.env.VONAGE_PASSWORD &&
    process.env.VONAGE_ACCOUNT_ID,
  );

/** Vonage's own outcome names → our four. */
function mapResult(result: string | undefined): "Answered" | "Missed" | "Voicemail" | "Attempted" {
  const r = (result ?? "").toLowerCase();
  if (r.includes("answer") || r.includes("completed")) return "Answered";
  if (r.includes("voicemail")) return "Voicemail";
  if (r.includes("miss") || r.includes("busy") || r.includes("reject") || r.includes("cancel")) return "Missed";
  return "Attempted";
}



export const vonageSync: Job = {
  name: "vonage-sync",
  integration: "vonage",
  everyMs: 5 * 60_000,
  requires: configured,

  async run(): Promise<JobResult> {
    /* Null here can mean the integration is halted after a refusal.
       Retrying on the next tick is what locked the account in the first
       place, so the job simply reports and waits. */
    const token = await vonageAccessToken();
    if (!token) return { summary: "no access token — see the log", counts: { imported: 0 } };

    const accountId = process.env.VONAGE_ACCOUNT_ID;
    if (!accountId) return { summary: "VONAGE_ACCOUNT_ID is not set", counts: { imported: 0 } };

    /* Overlap the window: a call still ringing at the last run is complete
       now, and the unique key makes the repeat harmless. */
    const from = new Date(Date.now() - 20 * 60_000);
    const to = new Date();

    const records: VonageCall[] = [];
    let fetchError: string | null = null;

    try {
      /* Paged. A busy quarter of an hour across 46 studios can exceed one
         page, and stopping at the first would silently drop the rest. */
      for (let page = 1; page <= 10; page++) {
        const qs = new URLSearchParams({
          "start:gte": toVonageWindow(from),
          "start:lte": toVonageWindow(to),
          order: "desc",
          page_size: "1000",
          page: String(page),
        });

        const res = await fetch(
          `${vonageEndpoints.callLogs(accountId)}?${qs}`,
          { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
        );

        if (!res.ok) {
          fetchError = `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`;
          break;
        }

        const payload = (await res.json()) as CallLogPage;
        const rows = payload._embedded?.call_logs ?? [];
        records.push(...rows);

        if (rows.length === 0 || (payload.total_pages !== undefined && page >= payload.total_pages)) break;
      }
    } catch (err) {
      fetchError = (err as Error).message;
    }

    if (records.length === 0) {
      /* Reporting "no new calls" when the request in fact failed makes an
         outage look like a quiet quarter of an hour, and the job history is
         the only place anyone would notice. */
      return {
        summary: fetchError ? `no calls fetched — ${fetchError}` : "no new calls",
        counts: { imported: 0 },
      };
    }

    // Extension → studio/agent, resolved once per run.
    const directory = await db
      .select({ ext: extensions.extension, locationId: extensions.locationId, staffId: extensions.staffId })
      .from(extensions);
    const byExtension = new Map(directory.map((d) => [d.ext, d]));

    /* ── Resolve everyone at once ──────────────────────────────────
     * This used to run a lead lookup and a customer lookup per record,
     * inside the loop. A busy quarter of an hour across forty-six studios
     * fills a thousand-row page, so that was two thousand round trips to
     * answer a question about at most a few hundred distinct numbers.
     * Two queries now, and the loop only reads from a map. */
    interface Prepared {
      record: VonageCall;
      inbound: boolean;
      extension: string | null;
      agentName: string | null;
      customerNumber: string | null;
    }

    const prepared: Prepared[] = [];
    let unknownExtension = 0;

    for (const record of records) {
      if (!record.id) continue;

      const inbound = (record.direction ?? "").toLowerCase().startsWith("in");

      /* Whichever leg is ours. On an outbound call the extension dials out,
         so it is the source; on an inbound one it answers. */
      const extension = inbound
        ? record.destination_extension ?? null
        : record.source_extension ?? null;
      if (extension && !byExtension.has(extension)) unknownExtension += 1;

      prepared.push({
        record,
        inbound,
        extension,
        agentName: inbound
          ? record.destination_user_full_name ?? null
          : record.source_user_full_name ?? null,
        /* The customer is the other leg. An extension is not a phone
           number, so normalising it would produce nonsense — only the
           outside leg is a real number. */
        customerNumber: normalizeNumber(inbound ? record.from ?? "" : record.to ?? ""),
      });
    }

    const numbers = [...new Set(prepared.map((p) => p.customerNumber).filter((n): n is string => Boolean(n)))];

    const leadByPhone = new Map<string, { id: string; customerId: string | null }>();
    const customerByPhone = new Map<string, string>();

    if (numbers.length > 0) {
      const [leadRows, customerRows] = await Promise.all([
        db
          .select({ id: leads.id, phone: leads.phoneE164, customerId: leads.customerId })
          .from(leads)
          .where(and(inArray(leads.phoneE164, numbers), isNull(leads.mergedInto)))
          .orderBy(desc(leads.createdAt)),
        db
          .select({ id: customers.id, phone: customers.phoneE164 })
          .from(customers)
          .where(and(inArray(customers.phoneE164, numbers), isNull(customers.mergedInto))),
      ]);

      /* Newest first from the query, and the first writer wins, so a
         number with several leads resolves to the most recent — the same
         answer the per-row query gave. */
      for (const r of leadRows) {
        if (r.phone && !leadByPhone.has(r.phone)) {
          leadByPhone.set(r.phone, { id: r.id, customerId: r.customerId });
        }
      }
      for (const r of customerRows) {
        if (r.phone && !customerByPhone.has(r.phone)) customerByPhone.set(r.phone, r.id);
      }
    }

    const rows = prepared.map(({ record, inbound, extension, agentName, customerNumber }) => {
      const dir = extension ? byExtension.get(extension) : undefined;
      const lead = customerNumber ? leadByPhone.get(customerNumber) ?? null : null;
      const customerId = lead?.customerId ?? (customerNumber ? customerByPhone.get(customerNumber) ?? null : null);

      return {
        provider: "vonage" as const,
        externalCallId: record.id,
        direction: (inbound ? "inbound" : "outbound") as "inbound" | "outbound",
        fromNumber: normalizeNumber(record.from) ?? record.from ?? "",
        toNumber: normalizeNumber(record.to) ?? record.to ?? "",
        leadId: lead?.id ?? null,
        customerId,
        locationId: dir?.locationId ?? null,
        staffId: dir?.staffId ?? null,
        agentName,
        extension,
        startTime: parseVonageTime(record.start) ?? new Date(),
        endTime: parseVonageTime(record.end),
        duration: Number.isFinite(record.length) ? Math.max(0, Math.trunc(record.length as number)) : 0,
        result: mapResult(record.result),
        /* The log says a recording exists but never carries its URL; it is
           fetched separately, so claiming a link we do not have would put a
           dead button in the console. */
        /* `recorded` is the rule that was in force, not a file that
           exists: the Reports API returns it true for calls that never
           connected. Measured against the recording store, every Missed
           and every Attempted call claiming a recording had none, while
           99.4% of Answered calls had one. Claiming audio for a call
           nobody answered puts a Listen button on 552 rows with nothing
           behind them, which is the thing this whole exercise started
           from. */
        hasRecording: Boolean(record.recorded) && record.result === "Answered",
        recordingUrl: null,
        raw: record as unknown as Record<string, unknown>,
      };
    });

    const matched = rows.filter((r) => r.leadId !== null || r.customerId !== null).length;

    /* Inserted in batches rather than one statement per call. The unique
       key makes a repeat harmless, so a page that overlaps the last run
       costs nothing. */
    let imported = 0;
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const inserted = await db
        .insert(calls)
        .values(rows.slice(i, i + CHUNK))
        .onConflictDoNothing()
        .returning({ id: calls.id });
      imported += inserted.length;
    }

    return {
      summary: `${records.length} record(s)`,
      counts: { imported, matched, unknownExtension },
    };
  },
};
