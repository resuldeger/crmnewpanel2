/* Shared helpers so every CRM list narrows the same way. */
import { and, asc, count, desc, gte, inArray, lte, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import type { SessionUser } from "@/server/auth/session";
import { scopeFilter } from "@/server/auth/guard";

/**
 * Branch-scope predicate for a table's location column.
 * Returns undefined for unrestricted users — NOT an empty IN (), which
 * would silently hide everything.
 */
export function scopeWhere(user: SessionUser, column: PgColumn): SQL | undefined {
  const scope = scopeFilter(user);
  return scope ? inArray(column, scope) : undefined;
}

/** Drops the undefined entries drizzle's and() would otherwise choke on. */
export function compact(filters: (SQL | undefined)[]): SQL[] {
  return filters.filter((f): f is SQL => f !== undefined);
}

export function pageParams(params: URLSearchParams, defaultSize = 25) {
  const page = Math.max(1, Number(params.get("page") ?? 1));
  const size = Math.min(100, Math.max(1, Number(params.get("page_size") ?? defaultSize)));
  return { page, size, offset: (page - 1) * size };
}

/** Optional "last N days" window. */
export function daysAgo(params: URLSearchParams): Date | null {
  const days = Number(params.get("days") ?? 0);
  return days > 0 ? new Date(Date.now() - days * 86_400_000) : null;
}


/**
 * Reads a `days` query parameter.
 *
 * `Math.max(1, Number("abc"))` is NaN, not 1 — NaN loses every comparison —
 * so an unparseable value became an Invalid Date and a 500 any caller could
 * trigger. Anything that is not a number falls back to the default.
 */
export function parseDays(raw: string | null, fallback = 30, max = 365): number {
  const n = Number(raw);
  if (raw === null || raw.trim() === "" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(n)));
}

/* ── Time window ───────────────────────────────────────────────────────
 * `days` counts back from the server's clock, which cannot express what
 * the console's date filter actually means. "Today" there is the viewer's
 * calendar day, and the viewer is not in the server's timezone — a desk in
 * Istanbul asking for today at 09:00 would get everything since 06:00 UTC
 * yesterday under a `days=1` reading.
 *
 * So the client resolves its own window and sends the two instants. `days`
 * stays for callers that only want a rolling window.
 * ────────────────────────────────────────────────────────────────── */
export function rangeWhere(params: URLSearchParams, column: PgColumn): SQL | undefined {
  const at = (key: string): Date | null => {
    const raw = params.get(key);
    if (!raw) return null;
    const d = new Date(raw);
    // An unparseable instant must not become a window nobody asked for.
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const from = at("from");
  const to = at("to");
  const bounds = compact([
    from ? gte(column, from) : undefined,
    to ? lte(column, to) : undefined,
  ]);
  if (bounds.length > 0) return and(...bounds);

  const since = daysAgo(params);
  return since ? gte(column, since) : undefined;
}

/* ── Sorting ───────────────────────────────────────────────────────────
 * The column is chosen from a map the route owns, never from the query
 * string, so `sort=` cannot name a column the caller was not offered.
 * ────────────────────────────────────────────────────────────────── */
export function sortOrder<K extends string>(
  params: URLSearchParams,
  columns: Record<K, PgColumn | SQL>,
  fallback: K,
): SQL {
  const asked = (params.get("sort") ?? "") as K;
  const key = asked in columns ? asked : fallback;
  const dir = params.get("dir") === "asc" ? asc : desc;
  return dir(columns[key]);
}

/* ── Tab counts ────────────────────────────────────────────────────────
 * The status tabs carry a count each, and that count has to describe the
 * whole filtered set — not the page in front of the operator. It is also
 * counted WITHOUT the status filter itself, or every tab but the active
 * one would read zero.
 * ────────────────────────────────────────────────────────────────── */
export async function countsByColumn(
  table: PgTable,
  column: PgColumn,
  where: SQL | undefined,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ key: column, n: count() })
    .from(table)
    .where(where)
    .groupBy(column);

  const out: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const key = r.key === null ? "unknown" : String(r.key);
    out[key] = r.n;
    total += r.n;
  }
  out.all = total;
  return out;
}
