import { vonageAccessToken, forgetVonageToken } from "./token";
import { reportFailure, reportSuccess } from "@/server/integrations/health";
import { parseVonageTime } from "./time";
import { vonageEndpoints } from "./endpoints";

/* ── VBC Telephony v3: calls in progress ───────────────────────────────
 * The account-wide view of what is ringing or connected right now. VIS
 * webhooks were the obvious candidate for this and turned out to be scoped
 * to the authenticated user — measured, not assumed: over five minutes the
 * call log recorded twenty-five calls and not one webhook arrived. This
 * endpoint answers for the whole account in a single request, so one
 * central poller serves every open browser.
 *
 * It reports only live calls. A finished call drops out of the list; its
 * permanent record comes from the Reports API, which the sync job already
 * collects.
 * ────────────────────────────────────────────────────────────────── */


/** One leg of a call — either our extension's or the PSTN side's. */
interface TelephonyLeg {
  leg_id?: string;
  call_id?: string;
  device_id?: string;
  direction?: string;
  /** Our extension number — but on the PSTN leg this is a phone number. */
  extension?: string;
  from_name?: string;
  from_number?: string;
  to_name?: string;
  to_number?: string;
  status?: string;
  /** Microseconds since the epoch, as a string. "0" means not yet/never. */
  start_time?: string;
  answer_time?: string;
  end_time?: string;
}

interface TelephonyCall {
  account_id?: string;
  call_id?: string;
  direction?: string;
  status?: string;
  from_name?: string;
  from_number?: string;
  to_name?: string;
  to_number?: string;
  start_time?: string;
  end_time?: string;
  flags?: string[];
  /** Keyed by leg id — an object, not an array. */
  leg_map?: Record<string, TelephonyLeg>;
}

/** What the console and the socket see. */
export interface LiveCallState {
  callId: string;
  direction: "inbound" | "outbound";
  /** Set from the directory: a branch line or a call-centre agent. */
  category: "branch" | "callcenter" | "unknown";
  extension: string | null;
  /** The extension's display name, e.g. "Cleopatra Ink Columbus". */
  name: string | null;
  /** Our studio, when the extension maps to one. */
  locationId: number | null;
  staffId: number | null;
  /** The number we present or answer on. */
  did: string | null;
  /** The other party. */
  remoteNumber: string | null;
  remoteName: string | null;
  status: string;
  startedAt: string | null;
  answeredAt: string | null;
  deviceId: string | null;
}


/** True for the leg that is the outside world rather than one of our phones. */
const isPstnLeg = (leg: TelephonyLeg): boolean =>
  leg.device_id === "pstn" || /^\+?\d{7,}$/.test(leg.extension ?? "");

export interface DirectoryEntry {
  extension: string;
  name: string | null;
  locationId: number | null;
  staffId: number | null;
  dids: string[];
  category: "branch" | "callcenter";
}

/**
 * Flattens one call into the shape the console draws.
 *
 * `directory` maps an extension to a studio; an unknown extension still
 * produces a row, because a call nobody can attribute is exactly the one
 * worth seeing.
 */
export function normaliseCall(
  call: TelephonyCall,
  directory: Map<string, DirectoryEntry>,
): LiveCallState | null {
  const callId = call.call_id;
  if (!callId) return null;

  const legs = Object.values(call.leg_map ?? {});
  const ourLeg = legs.find((l) => !isPstnLeg(l)) ?? null;
  const pstnLeg = legs.find((l) => isPstnLeg(l)) ?? null;

  const inbound = (call.direction ?? "").toLowerCase().startsWith("in");

  /* The extension is on our own leg. Reading it off the PSTN leg would
     yield a phone number, which then matches no directory entry and files
     the call against no studio. */
  const extension = ourLeg?.extension ?? (inbound ? call.to_number : call.from_number) ?? null;
  const entry = extension ? directory.get(extension) ?? null : null;

  /* Top level carries the customer's number directly: for an outbound call
     it is the destination, for an inbound one the origin. */
  const remoteNumber = (inbound ? call.from_number : call.to_number) ?? null;
  const remoteName = (inbound ? call.from_name : call.to_name) ?? null;

  /* The line the customer dialled or sees — one of OUR numbers, never
     theirs. Which end of the PSTN leg that is depends on the direction:
     on an outbound call it is the caller ID we presented, on an inbound
     one it is the number they rang. Reading from_number either way put
     the customer's own number here, so the live board showed it twice and
     called one of them the studio's line. */
  const legDid = (inbound ? pstnLeg?.to_number : pstnLeg?.from_number) ?? null;
  /* Whatever the legs say, our line is never the other party's number. The
     board printed the same number twice and labelled one of them the
     studio's, and a recorded event still shows it: did and remote both
     +1 951 490 7094 on a Riverside call whose own line is +1 951 521 0923.
     When the leg gives us something that is plainly the customer, the
     directory's DID is the answer. */
  const did = (legDid && legDid !== remoteNumber ? legDid : null) ?? entry?.dids[0] ?? null;

  const status = ourLeg?.status ?? call.status ?? "unknown";

  return {
    callId,
    direction: inbound ? "inbound" : "outbound",
    category: entry?.category ?? "unknown",
    extension,
    name: entry?.name ?? ourLeg?.from_name ?? call.from_name ?? null,
    locationId: entry?.locationId ?? null,
    staffId: entry?.staffId ?? null,
    did,
    remoteNumber,
    remoteName: remoteName && remoteName !== "Outbound Call" ? remoteName : null,
    status,
    startedAt: (parseVonageTime(ourLeg?.start_time ?? call.start_time) ?? null)?.toISOString() ?? null,
    answeredAt: (parseVonageTime(ourLeg?.answer_time) ?? null)?.toISOString() ?? null,
    deviceId: ourLeg?.device_id ?? null,
  };
}

export class TelephonyError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Fetches every call currently in progress on the account.
 *
 * Throws on failure rather than returning an empty list: to the diffing
 * poller those look identical, and treating a failed request as "no calls"
 * would end every call on screen.
 */
export async function fetchActiveCalls(
  directory: Map<string, DirectoryEntry>,
  signal?: AbortSignal,
): Promise<LiveCallState[]> {
  const accountId = process.env.VONAGE_ACCOUNT_ID;
  if (!accountId) throw new TelephonyError(0, "VONAGE_ACCOUNT_ID is not set");

  const token = await vonageAccessToken();
  if (!token) throw new TelephonyError(401, "no access token");

  const res = await fetch(vonageEndpoints.activeCalls(accountId), {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal,
  });

  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    /* 401 means the token went stale; the next call mints a fresh one, so
       it is not worth halting the integration over. A 403 is a permissions
       problem that will not fix itself. */
    /* The held token has gone stale — drop it so the next attempt mints a
       fresh one instead of replaying the dead one every two seconds. */
    if (res.status === 401) forgetVonageToken();
    if (res.status === 403) {
      await reportFailure("vonage", { reason: "Telephony access denied", detail: body, fatal: true });
    }
    throw new TelephonyError(res.status, body);
  }

  const payload = (await res.json()) as TelephonyCall[] | { calls?: TelephonyCall[] };
  const calls = Array.isArray(payload) ? payload : payload.calls ?? [];

  await reportSuccess("vonage");

  return calls
    .map((c) => normaliseCall(c, directory))
    .filter((c): c is LiveCallState => c !== null);
}


/* ── Hanging up ────────────────────────────────────────────────────────
 * This disconnects a call that is happening right now, between a real
 * customer and a real member of staff. It is the one thing in this module
 * that changes the world rather than reporting on it, so the route that
 * calls it is restricted to super_admin and the console asks first.
 *
 * The exact action payload could not be verified beforehand: GET on the
 * actions endpoint answers 404, and the only way to learn the shape is to
 * POST it — which would cut off someone's call to find out. So the first
 * real use is the test, and any refusal is passed back verbatim rather
 * than reported as success.
 * ────────────────────────────────────────────────────────────────── */

export interface HangUpResult {
  ok: boolean;
  status: number;
  /** Vonage's own words, for the operator who pressed the button. */
  detail: string;
}

export async function hangUpCall(callId: string): Promise<HangUpResult> {
  const accountId = process.env.VONAGE_ACCOUNT_ID;
  if (!accountId) return { ok: false, status: 0, detail: "VONAGE_ACCOUNT_ID is not set" };

  const token = await vonageAccessToken();
  if (!token) return { ok: false, status: 401, detail: "no access token" };

  const res = await fetch(
    vonageEndpoints.callActions(accountId, callId),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ action: "hangup" }),
    },
  );

  const detail = (await res.text()).replace(/\s+/g, " ").slice(0, 400);
  if (res.status === 401) forgetVonageToken();

  return { ok: res.ok, status: res.status, detail: detail || (res.ok ? "hung up" : `HTTP ${res.status}`) };
}

/* ── Placing a call from the console ───────────────────────────────────
 * "Call back" recorded an attempt and dialled nothing — the row said
 * Attempted, the toast said "Calling", and the agent still had to pick up
 * a handset and type the number.
 *
 * The schema is not documented anywhere we could find; it was read off
 * the API's own validation errors, which name the fields and the allowed
 * values for `type`. The agent's own phone rings first and dials the
 * customer when they answer, which is what makes the call appear on the
 * floor and in the recording store like any other.
 * ────────────────────────────────────────────────────────────── */
export type PlaceCallResult =
  | { ok: true; callId: string | null }
  | { ok: false; status: number; detail: string };

export async function placeCall(fromExtension: string, toNumber: string): Promise<PlaceCallResult> {
  const accountId = process.env.VONAGE_ACCOUNT_ID;
  if (!accountId) return { ok: false, status: 0, detail: "VONAGE_ACCOUNT_ID is not set" };

  const token = await vonageAccessToken();
  if (!token) return { ok: false, status: 401, detail: "no access token" };

  const res = await fetch(vonageEndpoints.placeCall(accountId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      from: { type: "extension", destination: fromExtension },
      to: { type: "pstn", destination: toNumber },
    }),
  });

  const text = (await res.text()).replace(/\s+/g, " ").slice(0, 400);
  if (res.status === 401) forgetVonageToken();
  if (!res.ok) return { ok: false, status: res.status, detail: text || `HTTP ${res.status}` };

  let callId: string | null = null;
  try {
    const body = JSON.parse(text) as { call_id?: string; id?: string };
    callId = body.call_id ?? body.id ?? null;
  } catch {
    /* A 2xx that is not JSON still means the phone is ringing. */
  }
  return { ok: true, callId };
}
