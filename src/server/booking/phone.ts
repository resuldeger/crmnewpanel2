import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/* ── Is this a number that can actually ring ───────────────────────────
 * The booking API only checked that the string was eight characters long,
 * so "+15548207901" went straight into the database: a Turkish number
 * (+90 554 820 7901) typed into a field defaulting to the United States,
 * which turned it into US area code 554 — a code that has never been
 * assigned to anyone.
 *
 * What follows from accepting it: the confirmation SMS is queued and
 * billed against a number that cannot exist, the recovery chase keeps
 * texting it, and the desk rings a customer who is unreachable while the
 * record looks complete. The browser already validates with this library;
 * the server has to as well, because the browser is not the only caller.
 * ────────────────────────────────────────────────────────────────── */

export interface PhoneVerdict {
  ok: boolean;
  /** Normalised E.164, present only when ok. */
  e164?: string;
  country?: string;
  reason?: string;
}

/**
 * @param raw          whatever the caller sent
 * @param fallbackCountry the studio's country, used when there is no "+"
 */
export function checkPhone(raw: string, fallbackCountry?: string | null): PhoneVerdict {
  const value = (raw ?? "").trim();
  if (!value) return { ok: false, reason: "A phone number is required" };

  const country = (fallbackCountry ?? "").trim().toUpperCase();
  /* Only an ISO-3166 alpha-2 code resolves a national number typed without
     a country code. Anything else was silently ignored, which turns a
     studio's misconfigured country into a booking form that rejects its
     own local numbers — and says "that does not look like a phone number"
     while doing it. Saying so in the log is how that gets found. */
  const usable = country.length === 2;
  if (country && !usable) {
    console.warn(`checkPhone: "${fallbackCountry}" is not an ISO country code — national numbers will not parse`);
  }
  const parsed = parsePhoneNumberFromString(
    value,
    usable ? (country as CountryCode) : undefined,
  );

  if (!parsed) {
    return { ok: false, reason: "That does not look like a phone number" };
  }
  /* isValid() checks the number against the country's actual numbering
     plan — length AND allocated prefix — which is what catches 554. A
     plain length check passes it. */
  if (!parsed.isValid()) {
    return { ok: false, reason: "That phone number does not exist — check the country code" };
  }

  return { ok: true, e164: parsed.format("E.164"), country: parsed.country };
}
