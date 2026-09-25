import { canRun, reportFailure, reportSuccess } from "@/server/integrations/health";
import { vonageEndpoints } from "./endpoints";

/* ── Vonage access tokens, with a brake ────────────────────────────────
 * The sync job asks for a token every five minutes. When the credentials
 * are refused, that is not a harmless retry: each attempt is a failed
 * login, and Vonage locks an account after a few of them for thirty
 * minutes — counting from the *last* attempt. A job on a five-minute
 * timer therefore resets the lock before it can ever expire, and the
 * account stays locked forever while nobody can see why. That is exactly
 * what happened here: a worker left running for eight hours made roughly
 * ninety-five failed logins and kept the account shut the whole time.
 *
 * So a refusal halts the integration outright and the halt is recorded in
 * the database, where the panel shows it and only a person can lift it.
 * A network blip merely counts against a threshold. See
 * server/integrations/health.ts.
 * ────────────────────────────────────────────────────────────────── */




/**
 * Fetches a VBC access token, or null.
 *
 * Returns null without touching the network while the brake is on.
 */
/* ── Why the token is held ─────────────────────────────────────────────
 * A token lasts twenty-four hours, and this used to fetch a fresh one on
 * every call. The Telephony poller asks every two seconds, so that was a
 * password grant — a LOGIN — thirty times a minute, indefinitely. Vonage
 * locks an account after a handful of failed logins, and a burst like that
 * against the auth endpoint is how a working credential turns into a
 * locked one. It also produced the stray 401 seen in the poller log.
 *
 * So the token is kept until shortly before it expires, and one in-flight
 * request is shared rather than started again per caller.
 * ────────────────────────────────────────────────────────────────── */
let token: { value: string; expiresAt: number } | null = null;
let inFlight: Promise<string | null> | null = null;

/** Renew a little early, so a request never travels with a dying token. */
const EXPIRY_MARGIN_MS = 5 * 60_000;

/** Drops the held token, so the next call fetches a new one. */
export function forgetVonageToken(): void {
  token = null;
}

export async function vonageAccessToken(): Promise<string | null> {
  if (token && Date.now() < token.expiresAt) return token.value;
  /* Several callers at once share one grant; without this the poller and a
     job starting together would each open their own. */
  if (inFlight) return inFlight;

  inFlight = requestToken().finally(() => { inFlight = null; });
  return inFlight;
}

async function requestToken(): Promise<string | null> {
  /* Checked before any credential is touched: the aim is to make no
     request at all. A halt lives in the database, so a worker restart
     cannot quietly resume — that restart is what a brake held in memory
     would have thrown away. */
  if (!(await canRun("vonage"))) {
    console.warn("vonage: halted — clear it in the admin panel once the cause is fixed");
    return null;
  }

  const key = process.env.VONAGE_CONSUMER_KEY;
  const secret = process.env.VONAGE_CONSUMER_SECRET;
  const username = process.env.VONAGE_USERNAME;
  const password = process.env.VONAGE_PASSWORD;

  if (!key || !secret) {
    console.error("vonage: VONAGE_CONSUMER_KEY / VONAGE_CONSUMER_SECRET are not set");
    return null;
  }

  const basic = Buffer.from(`${key}:${secret}`).toString("base64");

  /* VBC needs the password grant. client_credentials returns a token the
     VIS endpoints reject with "Failed to get claims for token", so it is
     not a usable fallback here and is not attempted — an extra failed
     request costs the same lockout as any other. */
  if (!username || !password) {
    console.error("vonage: VONAGE_USERNAME / VONAGE_PASSWORD are not set");
    return null;
  }

  const fullUsername = username.includes("@") ? username : `${username}@vbc.prod`;

  try {
    const res = await fetch(vonageEndpoints.token(), {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      /* `scope` decides what the token may reach, and its absence is not an
         error — the server issues a "default" token that VIS accepts and
         the Reports API rejects with a bare 401. That looked for a while
         like a missing API subscription. It is one word. */
      body: new URLSearchParams({
        grant_type: "password",
        username: fullUsername,
        password,
        scope: "openid",
      }).toString(),
    });

    if (res.ok) {
      const data = (await res.json()) as { access_token?: string; expires_in?: number };
      if (data.access_token) {
        const ttl = Number(data.expires_in);
        token = {
          value: data.access_token,
          expiresAt: Date.now() + (Number.isFinite(ttl) && ttl > 0 ? ttl * 1000 : 3600_000) - EXPIRY_MARGIN_MS,
        };
        console.log(`[vonage-auth] token obtained, valid ${Math.round((token.expiresAt - Date.now()) / 60_000)} min`);
        await reportSuccess("vonage");
        return data.access_token;
      }
      await reportFailure("vonage", {
        reason: "Vonage returned no access token",
        detail: `HTTP ${res.status}`,
        fatal: true,
      });
      return null;
    }

    const body = await res.text();
    console.error(`vonage: token request refused [${res.status}] ${body.slice(0, 300)}`);

    /* Vonage 17003 is the account lockout. Retrying inside the window is
       what prevents it lifting, so it must stop everything until someone
       has actually unlocked the account. */
    const locked = /locked|17003/i.test(body);
    await reportFailure("vonage", {
      reason: locked
        ? "Vonage account is locked — every further attempt extends the lockout"
        : `Credentials refused (HTTP ${res.status})`,
      detail: body,
      fatal: true,
    });
    return null;
  } catch (err) {
    // A network fault says nothing about the credentials, so it only counts.
    await reportFailure("vonage", {
      reason: "Could not reach Vonage",
      detail: (err as Error).message,
    });
    return null;
  }
}
