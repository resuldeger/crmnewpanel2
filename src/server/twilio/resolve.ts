/* ── Inbound number → studio ───────────────────────────────────────────
 * Every studio has three numbers on file (Twilio, Vonage, the real branch
 * line). An inbound call or SMS arrives addressed to the Twilio one; that
 * is how we know which studio it belongs to, and which branch line to
 * forward the call on to.
 * ────────────────────────────────────────────────────────────────── */
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { locations, numbers } from "@/db/schema";

export interface ResolvedStudio {
  id: number;
  slug: string;
  name: string;
  /** the studio's real phone — where inbound calls are forwarded */
  branchPhone: string | null;
  timezone: string;
  locale: string;
  authToken: string | null;
  accountSid: string | null;
  messagingSid: string | null;
  smsAutomation: boolean;
}

/** E.164-ish normalisation: digits, keep a single leading +. */
export function normalizeNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+")) return `+${digits}`;
  // North American 10-digit shorthand
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export async function studioForInboundNumber(to: string | null): Promise<ResolvedStudio | null> {
  const e164 = normalizeNumber(to);
  if (!e164) return null;
  const digits = e164.replace(/\D/g, "");

  // Primary lookup is the numbers table, which is where every DID is
  // registered. The jsonb fallback covers studios configured before that
  // table existed — matched on digits only, since the stored value may be
  // formatted ("+1 (253) 555-0100").
  const [row] = await db
    .select({ loc: locations })
    .from(locations)
    .leftJoin(numbers, and(eq(numbers.locationId, locations.id), eq(numbers.numberE164, e164)))
    .where(
      or(
        isNotNull(numbers.id),
        eq(sql`regexp_replace(coalesce(${locations.twilio}->>'specificPhone', ''), '[^0-9]', '', 'g')`, digits),
      ),
    )
    .limit(1);

  const studio = row?.loc;
  if (!studio) return null;

  return {
    id: studio.id,
    slug: studio.slug,
    name: studio.name,
    branchPhone: normalizeNumber(studio.branchPhone),
    timezone: studio.timezone,
    locale: studio.defaultLocale,
    // Per-studio credentials win; a shared account token is the fallback.
    authToken: studio.twilio?.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? null,
    accountSid: studio.twilio?.accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? null,
    messagingSid: studio.twilio?.messagingSid ?? null,
    smsAutomation: studio.twilio?.smsAutomation ?? false,
  };
}
