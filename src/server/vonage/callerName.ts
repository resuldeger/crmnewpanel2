/* ── Whose name to show for a number ───────────────────────────────────
 * The live board and the call log both label the other party with the
 * carrier's caller-name lookup — the CNAM database the US networks keep.
 * That is better than nothing and worse than what we already know: it
 * returns "WIRELESS CALLER" when the network has no entry, it is often
 * an ALL-CAPS surname-first record like "WARREN,BRANDY", and it does not
 * know that this number belongs to a customer we booked last month.
 *
 * So our own record wins when we have one, and the carrier's is the
 * fallback rather than the answer.
 *
 * Cached, because the poller asks about every live call every two seconds
 * and the answer changes about as often as a customer is renamed.
 * ────────────────────────────────────────────────────────────────── */
import { and, desc, isNull, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { customers, leads } from "@/db/schema";

export interface KnownCaller {
  name: string;
  kind: "customer" | "lead";
  id: string;
}

const TTL_MS = Math.max(30_000, Number(process.env.CALLER_NAME_TTL_MS ?? 300_000));

/** digits → who we think it is, or null for "we have no record". */
const cache = new Map<string, { at: number; value: KnownCaller | null }>();

const digitsOf = (raw: string | null | undefined): string => (raw ?? "").replace(/\D/g, "");

/** Forgets one number, for when a customer is renamed or merged. */
export function forgetCallerName(number: string): void {
  cache.delete(digitsOf(number));
}

export async function knownCaller(number: string | null | undefined): Promise<KnownCaller | null> {
  const digits = digitsOf(number);
  // Below seven digits it is an extension or a short code, not a person.
  if (digits.length < 7) return null;

  const hit = cache.get(digits);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  /* Matched on the digits so a number stored "+1 (404) 555-0101" anywhere
     finds the same person. A customer outranks a lead: the lead is the
     enquiry, the customer is who they turned out to be. */
  const same = (column: PgColumn) =>
    sql`regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g') = ${digits}`;

  let value: KnownCaller | null = null;
  try {
    const [customer] = await db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(same(customers.phoneE164), isNull(customers.mergedInto)))
      .limit(1);

    if (customer?.name) {
      value = { name: customer.name, kind: "customer", id: customer.id };
    } else {
      const [lead] = await db
        .select({ id: leads.id, name: leads.name })
        .from(leads)
        .where(and(same(leads.phoneE164), isNull(leads.mergedInto)))
        .orderBy(desc(leads.createdAt))
        .limit(1);
      if (lead?.name) value = { name: lead.name, kind: "lead", id: lead.id };
    }
  } catch {
    /* A board that cannot reach the database should still show the call.
       Not caching the miss means it is retried rather than remembered. */
    return null;
  }

  cache.set(digits, { at: Date.now(), value });
  return value;
}

/** Resolves many numbers at once, for a whole snapshot of live calls. */
export async function knownCallers(numbers: (string | null | undefined)[]): Promise<Map<string, KnownCaller>> {
  const out = new Map<string, KnownCaller>();
  const unique = [...new Set(numbers.map(digitsOf).filter((d) => d.length >= 7))];
  await Promise.all(
    unique.map(async (d) => {
      const found = await knownCaller(d);
      if (found) out.set(d, found);
    }),
  );
  return out;
}
