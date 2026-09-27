import { createSign, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/* ── The OTHER Vonage ──────────────────────────────────────────────────
 * SPIKE (spike/web-dialer).
 *
 * Everything else in server/vonage talks to Vonage Business
 * Communications: the call log, the recordings, the live board, the
 * click-to-call that rings a desk phone. VBC is a hosted phone system and
 * it has no public way to put a call inside a web page.
 *
 * Audio in the browser is a different Vonage product — the Voice API, on
 * the developer side (api.nexmo.com), with its own account, its own
 * credentials and its own numbers. The two do not share a login: the VBC
 * consumer key and secret answer 401 there, which was measured rather than
 * assumed.
 *
 * So this module is deliberately separate from the rest, and nothing here
 * touches the VBC token. Two different accounts, two different auth
 * schemes, no shared state.
 *
 * Auth here is a JWT signed with the application's private key (RS256),
 * not an OAuth token — so there is no login to rate-limit and no account to
 * lock. Node's crypto signs it; a JWT library would earn its place if we
 * ever had to verify third-party tokens, and we do not.
 * ────────────────────────────────────────────────────────────────── */

const API = "https://api.nexmo.com";

export interface VoiceApiConfig {
  applicationId: string;
  privateKey: string;
  /** The number the person being called will see. */
  lvn: string;
}

/** Cached because it is read on every token request and never changes. */
let cached: VoiceApiConfig | null = null;
let cacheFailed = false;

export function voiceApiConfig(): VoiceApiConfig | null {
  if (cached) return cached;
  if (cacheFailed) return null;

  const applicationId = process.env.VONAGE_APPLICATION_ID?.trim();
  const lvn = process.env.VONAGE_LVN?.trim();
  const keyPath = process.env.VONAGE_PRIVATE_KEY_PATH?.trim();

  if (!applicationId || !lvn || !keyPath) {
    cacheFailed = true;
    return null;
  }

  try {
    /* Read from a file rather than an environment variable: a PEM is
       multi-line, and the versions of it that survive a .env round trip
       have bitten enough people that the file is the safer default. */
    const resolved = path.isAbsolute(keyPath) ? keyPath : path.resolve(process.cwd(), keyPath);
    const privateKey = readFileSync(resolved, "utf8");
    if (!privateKey.includes("PRIVATE KEY")) {
      console.error(`vonage-voice: ${resolved} does not look like a PEM private key`);
      cacheFailed = true;
      return null;
    }
    cached = { applicationId, privateKey, lvn };
    return cached;
  } catch (err) {
    console.error(`vonage-voice: cannot read the private key — ${(err as Error).message}`);
    cacheFailed = true;
    return null;
  }
}

export const voiceApiConfigured = (): boolean => voiceApiConfig() !== null;

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Signs a Vonage application JWT.
 *
 * With `subject` it is a Client SDK token — the browser holds it, so it is
 * short-lived and its ACL is the narrowest set of paths that still lets the
 * SDK open a session and place a call. Without one it is a server token for
 * the management APIs.
 */
export function signJwt(claims: Record<string, unknown>, ttlSeconds: number): string | null {
  const config = voiceApiConfig();
  if (!config) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    application_id: config.applicationId,
    iat: now,
    /* Unique per token: Vonage rejects a replayed jti, which is what makes
       a leaked token useless after its first use. */
    jti: randomUUID(),
    exp: now + ttlSeconds,
    ...claims,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  return `${signingInput}.${b64url(signer.sign(config.privateKey))}`;
}

/** A token for the browser. Minutes, not hours — it leaves our control. */
export function clientToken(userName: string, ttlSeconds = 15 * 60): string | null {
  return signJwt(
    {
      sub: userName,
      acl: {
        paths: {
          "/*/rtc/**": {},
          "/*/sessions/**": {},
          "/*/devices/**": {},
          "/*/users/**": {},
          "/*/conversations/**": {},
          "/*/legs/**": {},
          "/*/media/**": {},
          "/*/applications/**": {},
          "/*/push/**": {},
          "/*/knocking/**": {},
        },
      },
    },
    ttlSeconds,
  );
}

async function voiceApi(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = signJwt({}, 60);
  if (!token) return { status: 0, body: { message: "the Voice API is not configured" } };

  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = { raw: text.slice(0, 400) };
  }
  return { status: res.status, body: parsed };
}

/**
 * The Vonage user the browser signs in as.
 *
 * A Client SDK token names a user, and that user has to exist in the
 * application before a session can be opened. One per member of staff, so
 * a call in the Vonage logs says who made it rather than all of them
 * sharing one anonymous identity.
 *
 * Idempotent: an existing user is fetched rather than treated as an error.
 */
export async function ensureVonageUser(
  name: string,
  displayName: string,
): Promise<{ ok: true; name: string } | { ok: false; detail: string }> {
  const created = await voiceApi("POST", "/v1/users", { name, display_name: displayName });
  if (created.status === 201) return { ok: true, name };

  /* 409 is the normal path after the first call — the user is already
     there, which is exactly what we wanted. */
  if (created.status === 409) return { ok: true, name };

  const existing = await voiceApi("GET", `/v1/users/${encodeURIComponent(name)}`);
  if (existing.status === 200) return { ok: true, name };

  return {
    ok: false,
    detail: `could not create the Vonage user (${created.status}): ${JSON.stringify(created.body).slice(0, 200)}`,
  };
}
