/* Shared helpers so every CRM list narrows the same way. */
import { inArray, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
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
