/* ── Redis · cache · rate limits · socket fan-out ─────────────────────
 * What lives here (and only here):
 *   · booking config + translation dictionary  (hot path, 5 min TTL)
 *   · availability per studio/month            (60 s TTL, busted on booking)
 *   · public API rate limits                   (sliding window)
 *   · Socket.IO adapter when we run >1 node
 * Durable state never lives in Redis — Postgres owns it.
 * ────────────────────────────────────────────────────────────────── */
import Redis from "ioredis";

const url = process.env.REDIS_URL ?? "redis://localhost:6380";

declare global {
  // eslint-disable-next-line no-var
  var __cleoRedis: Redis | undefined;
}

export const redis =
  global.__cleoRedis ??
  new Redis(url, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 3_000),
  });

if (process.env.NODE_ENV !== "production") global.__cleoRedis = redis;

/** Namespaced keys so RedisInsight stays readable. */
export const key = {
  bookingConfig: (slug: string, locale: string) => `cfg:booking:${slug}:${locale}`,
  dictionary: (app: string, locale: string, locationId: number | null) =>
    `i18n:${app}:${locale}:${locationId ?? "global"}`,
  availability: (slug: string, month: string, tz: string) => `avail:${slug}:${month}:${tz}`,
  rate: (bucket: string, id: string) => `rate:${bucket}:${id}`,
  presence: (staffId: number) => `presence:${staffId}`,
};

export const TTL = { config: 300, dictionary: 300, availability: 60 } as const;

/**
 * Read-through cache. A Redis outage must never take the booking form down,
 * so every failure falls through to the loader.
 */
export async function cached<T>(cacheKey: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  try {
    const hit = await redis.get(cacheKey);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    /* cache miss by failure — fall through to the source of truth */
  }
  const value = await load();
  try {
    await redis.set(cacheKey, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    /* ignore: the response is already correct without the cache */
  }
  return value;
}

/** Drop every key under a prefix — used when an admin edits a translation. */
export async function bust(prefix: string): Promise<number> {
  let cursor = "0";
  let removed = 0;
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 250);
    cursor = next;
    if (keys.length) removed += await redis.del(...keys);
  } while (cursor !== "0");
  return removed;
}

/**
 * Fixed-window rate limit. Returns false when the caller is over budget.
 * Used on the public booking endpoints (FINDING #8).
 */
export async function allow(bucket: string, id: string, limit: number, windowSeconds: number): Promise<boolean> {
  const k = key.rate(bucket, id);
  try {
    const count = await redis.incr(k);
    if (count === 1) await redis.expire(k, windowSeconds);
    return count <= limit;
  } catch {
    return true; // never block real customers because the cache is down
  }
}
