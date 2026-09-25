/* ── Postgres connection · one pool per process ───────────────────────── */
import { Pool, types } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/** Return NUMERIC as string (never lose precision), DATE as a plain string. */
types.setTypeParser(1082, (v) => v);          // date → "2026-09-22"
types.setTypeParser(1700, (v) => v);          // numeric → string

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env.local");
}

declare global {
  // eslint-disable-next-line no-var
  var __cleoPool: Pool | undefined;
}

export const pool =
  global.__cleoPool ??
  new Pool({
    connectionString,
    max: Number(process.env.PGPOOL_MAX ?? 20),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 15_000),
  });

if (process.env.NODE_ENV !== "production") global.__cleoPool = pool;

export const db = drizzle(pool, { schema, logger: process.env.DB_LOG === "1" });
export { schema };
export type Db = typeof db;

/** Run a set of statements in one transaction. */
export async function tx<T>(fn: (trx: Db) => Promise<T>): Promise<T> {
  return db.transaction(fn as never) as Promise<T>;
}
