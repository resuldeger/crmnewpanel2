/* ── Scheduled message worker ──────────────────────────────────────────
 * Drains scheduled_messages every minute. Claims rows with a single
 * UPDATE ... RETURNING so two workers can run side by side without
 * sending the same message twice.
 * ────────────────────────────────────────────────────────────────── */
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { scheduledMessages } from "@/db/schema";
import { sendSms } from "./send";
import type { TemplateKey } from "./templates";

const MAX_ATTEMPTS = 3;

export interface DrainResult { claimed: number; sent: number; failed: number; skipped: number }

/** The public link the templates point at. */
function buildLink(payload: Record<string, string>, kind: string): string {
  const base = process.env.PUBLIC_BOOKING_URL ?? "http://localhost:5174";
  if (kind.startsWith("appointment_reminder") && payload.uuid) return `${base}/b/${payload.uuid}`;
  if (payload.slug) return `${base}/${payload.slug}/book`;
  return base;
}

export async function drainScheduledMessages(limit = 50): Promise<DrainResult> {
  // Atomic claim: SKIP LOCKED means a second worker takes different rows
  // rather than blocking or duplicating.
  const claimed = await db.execute<{
    id: number; kind: string; to_e164: string; locale: string; location_id: number;
    template_key: string; payload: Record<string, string>; lead_id: string | null; attempts: number;
  }>(sql`
    update scheduled_messages
       set status = 'processing', attempts = attempts + 1
     where id in (
       select id from scheduled_messages
        where status = 'scheduled' and scheduled_at <= now()
        order by scheduled_at
        limit ${limit}
        for update skip locked
     )
    returning id, kind, to_e164, locale, location_id, template_key, payload, lead_id, attempts
  `);

  const result: DrainResult = { claimed: claimed.rows.length, sent: 0, failed: 0, skipped: 0 };

  for (const row of claimed.rows) {
    const outcome = await sendSms({
      to: row.to_e164,
      locationId: row.location_id,
      templateKey: row.template_key as TemplateKey,
      vars: { ...row.payload, link: buildLink(row.payload ?? {}, row.kind) },
      locale: row.locale,
      kind: row.kind as never,
      leadId: row.lead_id,
      senderName: "Automation",
    });

    if (outcome.ok) {
      result.sent += 1;
      await db.execute(sql`
        update scheduled_messages
           set status = 'sent', sent_at = now(), message_id = ${outcome.messageId}, error_message = null
         where id = ${row.id}
      `);
      continue;
    }

    // Opting out is a final answer, not a retryable failure.
    if (outcome.reason === "opted_out") {
      result.skipped += 1;
      await db.execute(sql`
        update scheduled_messages
           set status = 'cancelled', cancelled_at = now(), cancel_reason = 'opted_out'
         where id = ${row.id}
      `);
      continue;
    }

    const exhausted = row.attempts >= MAX_ATTEMPTS;
    result.failed += 1;
    await db.execute(sql`
      update scheduled_messages
         set status = ${exhausted ? "failed" : "scheduled"},
             scheduled_at = ${exhausted ? sql`scheduled_at` : sql`now() + interval '10 minutes'`},
             error_message = ${outcome.message}
       where id = ${row.id}
    `);
  }

  return result;
}
