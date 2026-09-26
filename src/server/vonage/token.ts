import { canRun, reportFailure, reportSuccess } from "@/server/integrations/health";
import { vonageEndpoints } from "./endpoints";
import { redis } from "@/server/redis";

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

/* ── One token for the whole installation ──────────────────────────────
 * Three processes authenticate as the same VBC user — the web app, the
 * realtime gateway and the worker — and each held its own token. That is
 * three logins where one would do, and one gateway log showed 46 of them.
 *
 * Minting does NOT invalidate a peer's token; that was measured rather than
 * assumed. But logins are the thing that locks the account, the lockout
 * counts them per USER and not per process, and a token nobody shares is a
 * token every process has to replace separately.
 *
 * So the token lives in Redis, which all three already share, and one
 * process at a time is allowed to mint it. The in-memory copy stays as a
 * cache in front of that, brief enough that a peer's refresh is picked up
 * within seconds.
 * ────────────────────────────────────────────────────────────────── */
const REDIS_KEY = "vonage:token";
const LOCK_KEY = "vonage:token:lock";
/** How long a mint may take before another process may try. */
const LOCK_MS = 20_000;
/** How long this process trusts its own copy without re-reading Redis. */
const MEMO_MS = 5_000;

let memoUntil = 0;

interface Shared {
  value: string;
  expiresAt: number;
}

async function readShared(): Promise<Shared | null> {
  try {
    const raw = await redis.get(REDIS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Shared;
    return parsed.value && parsed.expiresAt > Date.now() ? parsed : null;
  } catch {
    /* Redis being unreachable must not stop us talking to Vonage — it only
       costs us the sharing, which is what the old code did anyway. */
    return null;
  }
}

async function writeShared(next: Shared): Promise<void> {
  try {
    const ttlSeconds = Math.max(1, Math.floor((next.expiresAt - Date.now()) / 1000));
    await redis.set(REDIS_KEY, JSON.stringify(next), "EX", ttlSeconds);
  } catch {
    /* Ignored on purpose: see readShared. */
  }
}

/**
 * A VBC access token, or null.
 *
 * Returns null without touching the network while the brake is on.
 */
export async function vonageAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (token && now < token.expiresAt && now < memoUntil) return token.value;

  /* Several callers at once share one grant; without this the poller and a
     job starting together would each open their own. */
  if (inFlight) return inFlight;

  inFlight = resolveToken().finally(() => { inFlight = null; });
  return inFlight;
}

/**
 * Mints a token now, whatever is cached, and shares it.
 *
 * For the caller that has just been told its token is too old. See
 * vonage/fetch.ts — some VBC APIs expire a token in minutes while others
 * accept the same one for a day, so "expired" is a per-API answer and only
 * the API that refused it can say so.
 */
export async function refreshVonageToken(): Promise<string | null> {
  token = null;
  memoUntil = 0;
  try {
    await redis.del(REDIS_KEY);
  } catch {
    /* The mint below still happens; we just lose the sharing. */
  }
  if (inFlight) return inFlight;
  inFlight = resolveToken().finally(() => { inFlight = null; });
  return inFlight;
}

async function resolveToken(): Promise<string | null> {
  const shared = await readShared();
  if (shared) {
    token = shared;
    memoUntil = Date.now() + MEMO_MS;
    return shared.value;
  }

  /* Only one process mints. The losers wait for the winner's write rather
     than opening their own login, because a burst of logins is what locks
     the account. */
  let held = false;
  try {
    held = (await redis.set(LOCK_KEY, String(process.pid), "PX", LOCK_MS, "NX")) === "OK";
  } catch {
    /* No Redis, no coordination — mint anyway rather than stop working. */
    held = true;
  }

  if (!held) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((r) => setTimeout(r, 500));
      const fresh = await readShared();
      if (fresh) {
        token = fresh;
        memoUntil = Date.now() + MEMO_MS;
        return fresh.value;
      }
    }
    /* The holder died or was refused. Falling through to our own attempt is
       the right call: one extra login beats a service that never recovers. */
  }

  try {
    const minted = await requestToken();
    if (minted && token) await writeShared(token);
    if (minted) memoUntil = Date.now() + MEMO_MS;
    return minted;
  } finally {
    if (held) await redis.del(LOCK_KEY).catch(() => undefined);
  }
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
