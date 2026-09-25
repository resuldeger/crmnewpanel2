/* ── Fetching the audio ────────────────────────────────────────────────
 * The call log says `recorded: true` for almost every call and carries no
 * link to the recording — the Reports API simply does not return one. So
 * the console showed a Listen button on nine thousand calls with nothing
 * behind any of them.
 *
 * The audio is served by a separate API. This module knows how to list it
 * and how to match an entry back to a call we already have.
 *
 * The shape below is the real one, read off a live response rather than
 * guessed. The two fields that matter most:
 *
 *   call_id       the call's own uuid — the same value the call log calls
 *                 `id` and we store as external_call_id. So a recording
 *                 attaches to exactly one call, with no matching on times
 *                 and extensions and no chance of putting a stranger's
 *                 conversation on a customer's timeline.
 *   download_url  where the audio is, already absolute.
 *
 * One trap: `duration` is in MILLISECONDS here, while the call log's
 * `length` is in seconds. 14000 is a fourteen-second call.
 *
 * Company Call Recording is a permission on the API user, not on the
 * account. A user without it gets 403 "not authorized to search CCR
 * recordings" on a path that is otherwise correct.
 * ────────────────────────────────────────────────────────────────── */
import { vonageAccessToken } from "./token";
import { vonageEndpoints } from "./endpoints";
import { parseVonageTime } from "./time";

const ACCOUNT = () => process.env.VONAGE_ACCOUNT_ID ?? "";

export interface RecordingEntry {
  /** The recording's own numeric id. */
  id: string;
  /** The call it belongs to — matches calls.external_call_id exactly. */
  callId: string | null;
  startedAt: Date | null;
  /** Seconds. The API reports milliseconds; converted here so every
   *  duration in this codebase means the same thing. */
  durationSeconds: number | null;
  extension: string | null;
  direction: "inbound" | "outbound" | null;
  /** Absolute, and needs the account's bearer token. */
  url: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  raw: Record<string, unknown>;
}

export type RecordingsResult =
  | { ok: true; entries: RecordingEntry[]; totalPages: number }
  | { ok: false; reason: string; status?: number; unauthorized?: boolean };

const asString = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null;

function normalise(row: Record<string, unknown>): RecordingEntry | null {
  const id = asString(row.id);
  if (!id) return null;

  const direction = asString(row.call_direction)?.toLowerCase() ?? null;
  const durationMs = typeof row.duration === "number" ? row.duration : Number(row.duration);

  /* `extension` is present and null on every entry seen; the populated one
     is `extensions`, an array. Taking the first is right for the calls
     these studios make — one leg, one extension. */
  const extensions = Array.isArray(row.extensions) ? row.extensions : [];

  return {
    id,
    callId: asString(row.call_id),
    startedAt: parseVonageTime(asString(row.start)),
    durationSeconds: Number.isFinite(durationMs) ? Math.round(durationMs / 1000) : null,
    extension: asString(row.extension) ?? asString(extensions[0]),
    direction: direction === "inbound" || direction === "outbound" ? direction : null,
    url: asString(row.download_url),
    fileName: asString(row.file_name),
    sizeBytes: typeof row.file_size_in_bytes === "number" ? row.file_size_in_bytes : null,
    raw: row,
  };
}

let loggedFirstPage = false;

/** One page of company call recordings in a window. */
export async function listCompanyRecordings(
  from: Date,
  to: Date,
  page = 1,
  pageSize = 100,
): Promise<RecordingsResult> {
  const accountId = ACCOUNT();
  if (!accountId) return { ok: false, reason: "VONAGE_ACCOUNT_ID is not set" };

  const token = await vonageAccessToken();
  if (!token) return { ok: false, reason: "no Vonage access token" };

  /* Reports wants "2026-09-25 09:00:41" and refuses an ISO instant; this
     API wants the ISO instant and refuses the other — "is malformed at
     \" 09:00:41\"". Same tenant, same account, two formats. */
  const qs = new URLSearchParams({
    "start:gte": from.toISOString(),
    "start:lte": to.toISOString(),
    page_size: String(pageSize),
    page: String(page),
    // The API's own links spell it this way; "asc" alone is not a value.
    order: "start:ASC",
  });

  let res: Response;
  try {
    res = await fetch(`${vonageEndpoints.companyRecordings(accountId)}?${qs}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  } catch (err) {
    return { ok: false, reason: `network: ${(err as Error).message}` };
  }

  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    /* The one failure that is a configuration answer rather than a fault:
       the path is correct and the API user has not been given Company Call
       Recording access in VBC. Worth naming, because it looks like a bug
       from every other angle. */
    const unauthorized = res.status === 403 && body.includes("not authorized");
    return {
      ok: false,
      status: res.status,
      unauthorized,
      reason: unauthorized
        ? "the Vonage API user lacks the Company Call Recording permission — grant it in VBC admin"
        : `HTTP ${res.status} ${body}`,
    };
  }

  const payload = (await res.json()) as {
    _embedded?: { recordings?: Record<string, unknown>[] };
    total_pages?: number;
    total_items?: number;
  };

  const rows = payload._embedded?.recordings ?? [];

  /* The field names above are guesses until a real page arrives. Printing
     the first one converts them into something checkable. */
  if (!loggedFirstPage && rows.length > 0) {
    loggedFirstPage = true;
    console.log(`[vonage-recordings] ${payload.total_items ?? "?"} recording(s) in this window`);
  }

  return {
    ok: true,
    entries: rows.map((r) => normalise(r)).filter((e): e is RecordingEntry => e !== null),
    totalPages: payload.total_pages ?? 1,
  };
}

/** The audio itself, as a stream, with the account's credentials attached. */
export async function fetchRecordingAudio(url: string): Promise<Response | null> {
  const token = await vonageAccessToken();
  if (!token) return null;
  return fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "audio/mpeg, audio/wav, */*" },
  }).catch(() => null);
}
