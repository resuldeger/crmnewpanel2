import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { integrations, realtimeEvents } from "@/db/schema";

/* ── Stopping a broken integration, and keeping it stopped ─────────────
 * Retrying a refused credential on a timer is not a harmless no-op. With
 * Vonage each attempt is a failed login, and the lockout counts from the
 * LAST one — so a five-minute poller keeps a locked account locked
 * indefinitely, which is exactly what happened here: a worker left running
 * for eight hours made about ninety-five failed logins while nobody could
 * work out why the password did not work.
 *
 * So a credential failure halts the integration, the halt is written to
 * the database rather than held in memory (a restart must not quietly
 * resume the hammering), and only a person clearing it in the panel starts
 * it again. Transient faults — a timeout, a 502 — are counted instead, and
 * only halt once they stop looking like a blip.
 * ────────────────────────────────────────────────────────────────── */

export type Provider = "vonage" | "twilio" | "timely" | "smtp";

/** How many consecutive transient faults before we stop trying. */
const TRANSIENT_LIMIT = 5;

export interface IntegrationHealth {
  provider: string;
  label: string;
  enabled: boolean;
  halted: boolean;
  haltReason: string | null;
  haltDetail: string | null;
  haltedAt: Date | null;
  failureCount: number;
  firstFailedAt: Date | null;
  lastFailedAt: Date | null;
  clearedAt: Date | null;
  clearedByName: string | null;
}

/* The banner asks on nearly every page load, and the answer changes rarely.
   A few seconds of caching keeps that off the hot path without letting a
   halt go unnoticed for long. */
const CACHE_MS = 5_000;
let cache: { at: number; halted: Set<string> } | null = null;

function invalidate(): void {
  cache = null;
  lastKnownFailures.clear();
}

/** The global (not per-studio) row for a provider. */
const globalRow = (provider: string) =>
  and(eq(integrations.provider, provider), isNull(integrations.locationId));

/**
 * Whether this integration may run right now.
 *
 * Callers must check this BEFORE reaching for a credential — the point is
 * to make no request at all, not to handle the failure more gracefully.
 */
export async function canRun(provider: Provider): Promise<boolean> {
  if (cache && Date.now() - cache.at < CACHE_MS) return !cache.halted.has(provider);

  const rows = await db
    .select({ provider: integrations.provider })
    .from(integrations)
    .where(and(isNotNull(integrations.haltedAt), isNull(integrations.locationId)));

  cache = { at: Date.now(), halted: new Set(rows.map((r) => r.provider)) };
  return !cache.halted.has(provider);
}

/**
 * Records a failure.
 *
 * `fatal` means the credentials or the account are the problem, so trying
 * again changes nothing and may make it worse — that halts immediately.
 * Anything else is counted and halts only once it is clearly not a blip.
 */
export async function reportFailure(
  provider: Provider,
  opts: { reason: string; detail?: string; fatal?: boolean },
): Promise<void> {
  const now = new Date();
  const [row] = await db
    .update(integrations)
    .set({
      failureCount: sql`${integrations.failureCount} + 1`,
      firstFailedAt: sql`coalesce(${integrations.firstFailedAt}, ${now})`,
      lastFailedAt: now,
      lastStatus: opts.reason,
      updatedAt: now,
    })
    .where(globalRow(provider))
    .returning({ count: integrations.failureCount, halted: integrations.haltedAt });

  if (!row) {
    console.error(`integration health: no row for ${provider} — cannot record failure`);
    return;
  }
  lastKnownFailures.set(provider, row.count);
  if (row.halted) return; // already stopped; nothing to escalate

  const shouldHalt = opts.fatal || row.count >= TRANSIENT_LIMIT;
  if (!shouldHalt) {
    console.warn(`integration ${provider}: failure ${row.count}/${TRANSIENT_LIMIT} — ${opts.reason}`);
    return;
  }

  await db
    .update(integrations)
    .set({
      haltedAt: now,
      haltReason: opts.reason,
      // Bounded: this is shown in the panel, not an archive of the response.
      haltDetail: opts.detail?.slice(0, 1000) ?? null,
      /* Wipe the previous clearance. Left behind it reads, in the panel, as
         though this halt had already been dealt with. */
      clearedAt: null,
      clearedBy: null,
      clearedByName: null,
      updatedAt: now,
    })
    .where(globalRow(provider));

  invalidate();
  console.error(`integration ${provider}: HALTED — ${opts.reason}`);

  /* Surfaced live, because the whole point is that nobody should have to
     read a log to find out why the phones stopped appearing. */
  await db
    .insert(realtimeEvents)
    .values({
      channel: "system:live",
      topic: "integration.halted",
      requiredPermission: "settings.manage",
      payload: { provider, reason: opts.reason, at: now.toISOString() },
    })
    .catch(() => null);
}

/* What each provider's failure counter was last seen to be. The call
   poller reports success every two seconds; without this that is a
   database round trip thirty times a minute to discover, almost always,
   that there is nothing to reset. */
const lastKnownFailures = new Map<string, number>();

/** A working call resets the counters. It never lifts a halt — only a person does. */
export async function reportSuccess(provider: Provider): Promise<void> {
  /* Nothing to clear and nothing has failed since we last looked, so the
     statement would match no rows anyway. */
  if (lastKnownFailures.get(provider) === 0) return;
  lastKnownFailures.set(provider, 0);

  await db
    .update(integrations)
    .set({
      failureCount: 0,
      firstFailedAt: null,
      lastStatus: "ok",
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(globalRow(provider), sql`${integrations.failureCount} <> 0`));
}

/** Lifts a halt. Named, because someone is asserting the cause is fixed. */
export async function clearHalt(
  provider: string,
  by: { id: number; name: string },
): Promise<boolean> {
  const now = new Date();
  const [row] = await db
    .update(integrations)
    .set({
      haltedAt: null,
      haltReason: null,
      haltDetail: null,
      failureCount: 0,
      firstFailedAt: null,
      clearedAt: now,
      clearedBy: by.id,
      clearedByName: by.name,
      lastStatus: "cleared",
      updatedAt: now,
    })
    .where(globalRow(provider))
    .returning({ id: integrations.id });

  invalidate();
  return Boolean(row);
}

/** Everything the panel draws. */
export async function healthReport(): Promise<IntegrationHealth[]> {
  const rows = await db
    .select()
    .from(integrations)
    .where(isNull(integrations.locationId))
    .orderBy(integrations.provider);

  return rows.map((r) => ({
    provider: r.provider,
    label: r.label,
    enabled: r.enabled,
    halted: r.haltedAt !== null,
    haltReason: r.haltReason,
    haltDetail: r.haltDetail,
    haltedAt: r.haltedAt,
    failureCount: r.failureCount,
    firstFailedAt: r.firstFailedAt,
    lastFailedAt: r.lastFailedAt,
    clearedAt: r.clearedAt,
    clearedByName: r.clearedByName,
  }));
}
