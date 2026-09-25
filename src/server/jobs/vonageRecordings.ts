/* ── Attaching recordings to calls ─────────────────────────────────────
 * 9,297 of 9,303 calls in the log say they were recorded and carry no way
 * to reach the audio. That is not a bug in our sync: the Reports API
 * returns `recorded: true` and no handle at all. The console offered a
 * Listen button on every one of them, which is how "the sound is broken"
 * became a support question.
 *
 * The recordings are served by their own API, keyed independently of the
 * call log, so this job walks a window of recordings and matches each one
 * back to the call it belongs to.
 *
 * Matching is done twice over, best first:
 *   1. the entry's own call id, when it carries one — exact, no guessing;
 *   2. extension + start time within a tolerance, which is how a human
 *      would do it from two lists and is good enough when the ids do not
 *      line up. A tie is left alone rather than attached to the wrong
 *      call: a recording on the wrong customer's timeline is worse than
 *      no recording.
 * ────────────────────────────────────────────────────────────────── */
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { calls } from "@/db/schema";
import { listCompanyRecordings } from "@/server/vonage/recordings";
import { reportFailure, reportSuccess } from "@/server/integrations/health";
import type { Job, JobResult } from "./types";

/** How far apart a recording and its call may start and still be the pair. */
const MATCH_TOLERANCE_MS = Number(process.env.VONAGE_RECORDING_MATCH_MS ?? 90_000);

const configured = (): boolean => Boolean(process.env.VONAGE_ACCOUNT_ID);

export async function runVonageRecordings(days = 7): Promise<{
  summary: string;
  counts: Record<string, number>;
}> {
  if (!configured()) {
    return { summary: "VONAGE_ACCOUNT_ID is not set — nothing to do", counts: {} };
  }

  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);

  let scanned = 0;
  let attached = 0;
  let already = 0;
  let unmatched = 0;
  let ambiguous = 0;

  for (let page = 1; ; page += 1) {
    const result = await listCompanyRecordings(from, to, page);

    if (!result.ok) {
      /* A permission that has not been granted is a standing condition, not
         a blip — the halt mechanism should say so on the panel rather than
         retry it every five minutes forever. */
      await reportFailure("vonage-recordings", { reason: result.reason, fatal: result.unauthorized === true });
      return {
        summary: result.reason,
        counts: { scanned, attached, already, unmatched, ambiguous },
      };
    }

    if (result.entries.length === 0) break;

    for (const entry of result.entries) {
      scanned += 1;

      /* 1. The entry names its call outright — `call_id` is the same uuid
            the call log calls `id`, so this is an exact join and the
            fallback below almost never runs.

            The row is looked up before it is written, so "we already have
            this one" and "we have no such call" stay separate. Writing
            first and reading the row count conflated them: on a second
            run over the same window every recording already attached was
            reported as unmatched, which reads like a broken job. */
      const callId = entry.callId;
      if (callId) {
        const [existing] = await db
          .select({ id: calls.id, url: calls.recordingUrl })
          .from(calls)
          .where(and(eq(calls.provider, "vonage"), eq(calls.externalCallId, callId)))
          .limit(1);

        if (existing) {
          if (existing.url) { already += 1; continue; }
          await db
            .update(calls)
            .set({ recordingUrl: entry.url, hasRecording: true })
            .where(eq(calls.id, existing.id));
          attached += 1;
          continue;
        }
      }

      // 2. Same extension, started at about the same moment.
      if (!entry.startedAt || !entry.extension) { unmatched += 1; continue; }
      const low = new Date(entry.startedAt.getTime() - MATCH_TOLERANCE_MS);
      const high = new Date(entry.startedAt.getTime() + MATCH_TOLERANCE_MS);

      const candidates = await db
        .select({ id: calls.id })
        .from(calls)
        .where(
          and(
            eq(calls.provider, "vonage"),
            eq(calls.extension, entry.extension),
            gte(calls.startTime, low),
            lte(calls.startTime, high),
            isNull(calls.recordingUrl),
          ),
        )
        .limit(2);

      if (candidates.length === 0) { unmatched += 1; continue; }
      /* Two calls on one extension inside the window: which recording
         belongs to which is a guess, and a guess here puts a stranger's
         conversation on a customer's timeline. */
      if (candidates.length > 1) { ambiguous += 1; continue; }

      await db
        .update(calls)
        .set({ recordingUrl: entry.url, hasRecording: true })
        .where(eq(calls.id, candidates[0].id));
      attached += 1;
    }

    if (page >= result.totalPages) break;
  }

  await reportSuccess("vonage-recordings");

  /* Said out loud every run, because "2,037 attached" on its own does not
     answer the question anyone actually has — how much of the log can be
     listened to. */
  const backlog = await recordingBacklog();

  return {
    summary:
      `${attached} attached, ${already} already had one, ${unmatched} with no matching call` +
      (ambiguous ? `, ${ambiguous} ambiguous` : "") +
      ` — ${backlog.reachable}/${backlog.claimed} answered calls now have audio`,
    counts: { scanned, attached, already, unmatched, ambiguous, ...backlog },
  };
}

/** How much of the log can actually be listened to. */
export async function recordingBacklog(): Promise<{ claimed: number; reachable: number }> {
  const [row] = await db
    .select({
      claimed: sql<number>`count(*) filter (where ${calls.hasRecording})::int`,
      reachable: sql<number>`count(*) filter (where ${calls.recordingUrl} is not null)::int`,
    })
    .from(calls);
  return row ?? { claimed: 0, reachable: 0 };
}

/* Hourly, not every five minutes: a recording is written some time after
   the call ends, and nothing downstream needs it in the same minute. */
export const vonageRecordings: Job = {
  name: "vonage-recordings",
  integration: "vonage-recordings",
  everyMs: 60 * 60_000,
  requires: configured,
  run: (): Promise<JobResult> =>
    runVonageRecordings(Number(process.env.VONAGE_RECORDING_WINDOW_DAYS ?? 7)),
};
