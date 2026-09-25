/* ── Sending the booking ───────────────────────────────────────────────
 * Every failure used to collapse into one sentence: "Submission failed.
 * Please check your information." A customer whose details were perfectly
 * fine was told to check them, with nothing to actually fix — the real
 * cause was the connection, or a proxy returning HTML the page could not
 * parse, or a slot taken in the meantime.
 *
 * The API is idempotent per booking session, so a request that may or may
 * not have arrived is safe to send again: the server returns the existing
 * booking instead of making a second one.
 * ────────────────────────────────────────────────────────────────── */

export type FailureKind =
  /** No connection at all — the device is offline or the host is gone. */
  | "offline"
  /** Reached something, but it could not answer for us right now. */
  | "unavailable"
  /** The studio answered and refused: bad data, slot taken, rate limit. */
  | "rejected";

export class SubmitError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SubmitError";
  }
}

/** Statuses worth sending again — the request never got a real answer. */
const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SubmitResult {
  booking_uuid?: string;
  [key: string]: unknown;
}

export async function postBooking(
  url: string,
  payload: unknown,
  opts: { attempts?: number; signal?: AbortSignal } = {},
): Promise<SubmitResult> {
  const attempts = opts.attempts ?? 3;
  let lastError: SubmitError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new SubmitError("offline", "no_connection");
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        signal: opts.signal,
      });
    } catch (err) {
      // fetch only throws for transport failures: DNS, TLS, no route, abort.
      if ((err as Error).name === "AbortError") throw err;
      lastError = new SubmitError("offline", "no_connection");
      if (attempt < attempts) { await sleep(attempt * 1200); continue; }
      throw lastError;
    }

    if (res.ok) {
      /* A 200 that is not JSON means something in front of the app answered
         for it — a login wall, a captive portal, a tunnel's own page. */
      try {
        return (await res.json()) as SubmitResult;
      } catch {
        lastError = new SubmitError("unavailable", "unexpected_response", res.status);
        if (attempt < attempts) { await sleep(attempt * 1200); continue; }
        throw lastError;
      }
    }

    /* A proxy, tunnel or load balancer answers with HTML, not JSON. Parsing
       that as an API error is what produced "check your information" for a
       dead host — the body had no message, so the generic one showed. */
    const body = (await res.json().catch(() => null)) as { message?: string } | null;

    if (TRANSIENT.has(res.status) || body === null) {
      const kind: FailureKind = res.status === 429 ? "rejected" : "unavailable";
      lastError = new SubmitError(
        kind,
        res.status === 429 ? "too_many_attempts" : "studio_unreachable",
        res.status,
      );
      if (kind === "unavailable" && attempt < attempts) {
        await sleep(attempt * 1200);
        continue;
      }
      throw lastError;
    }

    // The server answered in our own language: show exactly what it said.
    throw new SubmitError("rejected", body.message ?? "submit_failed", res.status);
  }

  throw lastError ?? new SubmitError("unavailable", "studio_unreachable");
}
