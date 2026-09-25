import { fetchActiveCalls, TelephonyError, type LiveCallState } from "@/server/vonage/telephony";
import { getDirectory, refreshDirectory } from "@/server/vonage/directory";

/* ── The one poller ────────────────────────────────────────────────────
 * Telephony reports the calls in progress; nobody pushes them to us. This
 * asks once every couple of seconds and broadcasts what changed.
 *
 * It lives in the realtime gateway because that process already owns the
 * sockets and there is exactly one of it. A poller per browser would
 * multiply the same request by however many consoles happen to be open,
 * for identical data.
 *
 * Nothing here is written to the database. These rows are ephemeral — the
 * permanent record of a call arrives later from the Reports API, which the
 * sync job already collects — and a diff on a two-second tick would add
 * some twenty thousand rows a day to say what the socket already said.
 * ────────────────────────────────────────────────────────────────── */

const INTERVAL_MS = Math.max(1000, Number(process.env.VONAGE_POLL_MS ?? 2000));
const REQUEST_TIMEOUT_MS = 10_000;
const DIRECTORY_TTL_MS = Math.max(60_000, Number(process.env.VONAGE_DIRECTORY_TTL_MS ?? 15 * 60_000));

/* Vonage publishes no rate limit for this endpoint, so the ceiling is
   unknown and the only safe assumption is that there is one. A refusal
   backs off geometrically, with jitter so that several deployments do not
   synchronise and hammer in step. */
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;

export type CallEvent =
  | { type: "call.started"; call: LiveCallState }
  | { type: "call.updated"; call: LiveCallState; from: string; to: string }
  | { type: "call.ended"; callId: string; call: LiveCallState };

export interface PollerHandle {
  stop: () => void;
  /** Everything currently in progress, for a console that has just opened. */
  snapshot: () => LiveCallState[];
}

/** The fields whose change is worth telling anyone about. */
const changed = (a: LiveCallState, b: LiveCallState): boolean =>
  a.status !== b.status || a.answeredAt !== b.answeredAt || a.remoteNumber !== b.remoteNumber;

export function startCallPoller(emit: (event: CallEvent) => void): PollerHandle {
  let active = new Map<string, LiveCallState>();
  let stopped = false;
  let inFlight = false;
  let failures = 0;
  let nextAllowedAt = 0;
  let directoryAt = 0;
  let timer: NodeJS.Timeout | null = null;

  const backoffFor = (n: number): number => {
    const flat = Math.min(BACKOFF_BASE_MS * 2 ** (n - 1), BACKOFF_MAX_MS);
    return flat / 2 + Math.random() * (flat / 2); // jitter
  };

  async function tick(): Promise<void> {
    if (stopped || inFlight) return;          // never overlap a request
    if (Date.now() < nextAllowedAt) return;   // backing off

    inFlight = true;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      /* The directory only decides which studio a call is filed under.
         Letting a Provisioning hiccup take the whole board down would trade
         a wrong label for no phones at all, so a stale map is used and the
         refresh is retried on the next tick. */
      if (Date.now() - directoryAt > DIRECTORY_TTL_MS) {
        try {
          await refreshDirectory();
          directoryAt = Date.now();
        } catch (err) {
          console.warn(`[vonage-telephony] directory refresh failed, using the cached one: ${(err as Error).message}`);
          // Back off the retry so a persistent failure is not asked every tick.
          directoryAt = Date.now() - DIRECTORY_TTL_MS + 60_000;
        }
      }
      const directory = (await getDirectory()).byExtension;
      const calls = await fetchActiveCalls(directory, controller.signal);

      const next = new Map(calls.map((c) => [c.callId, c]));

      /* Only when the set changes. A line every two seconds saying the same
         four calls are still up would bury the transitions that matter. */
      if (next.size !== active.size) {
        console.log(`[vonage-telephony] poll ok calls=${next.size} ${Date.now() - startedAt}ms`);
      }

      for (const [id, call] of next) {
        const before = active.get(id);
        if (!before) {
          console.log(
            `[vonage-telephony] CALL_STARTED callId=${id} ext=${call.extension ?? "-"} ` +
              `${call.direction} ${call.category} remote=${call.remoteNumber ?? "-"} status=${call.status}`,
          );
          emit({ type: "call.started", call });
        } else if (changed(before, call)) {
          console.log(
            `[vonage-telephony] CALL_UPDATED callId=${id} status=${before.status}->${call.status}`,
          );
          emit({ type: "call.updated", call, from: before.status, to: call.status });
        }
      }

      /* A call absent from a SUCCESSFUL response has ended. This is only
         reached when the request came back — a failed one leaves the
         snapshot alone, because treating an outage as an empty list would
         end every call on every screen at once. */
      for (const [id, call] of active) {
        if (!next.has(id)) {
          console.log(`[vonage-telephony] CALL_ENDED callId=${id} ext=${call.extension ?? "-"}`);
          emit({ type: "call.ended", callId: id, call });
        }
      }

      active = next;
      failures = 0;
    } catch (err) {
      const status = err instanceof TelephonyError ? err.status : 0;
      failures += 1;
      const wait = backoffFor(failures);
      nextAllowedAt = Date.now() + wait;
      console.warn(
        `[vonage-telephony] poll failed (${failures}) status=${status} — ` +
          `retrying in ${Math.round(wait / 1000)}s: ${(err as Error).message.slice(0, 160)}`,
      );
    } finally {
      clearTimeout(timeout);
      inFlight = false;
    }
  }

  timer = setInterval(() => void tick(), INTERVAL_MS);
  void tick();

  console.log(`[vonage-telephony] polling every ${INTERVAL_MS}ms`);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
    },
    snapshot: () => [...active.values()],
  };
}
