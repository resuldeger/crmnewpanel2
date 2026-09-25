import { parsePhoneNumberFromString } from "libphonenumber-js";

/* ── Which number the studio's handset shows ───────────────────────────
 * Twilio accepts three things as the caller ID on a forwarded leg: the
 * inbound To, the inbound From, or a number the account owns or has
 * verified. The caller's own number is therefore legitimate here, and it
 * is what the studio wants to see, so it stays.
 *
 * What it does not survive is a carrier handing us a caller ID that is not
 * a real number. Twilio's note on error 13214 is explicit: an invalid
 * inbound caller ID is passed straight through to the party we dial, and
 * their carrier may refuse the call. A withheld number arrives as
 * "anonymous" — which normalises to nothing, leaving callerId unset and
 * Twilio falling back to that same unusable value — or as 266696687,
 * ANONYMOUS spelled on a keypad, which normalises to a plausible-looking
 * +266696687. Either way the far end drops the call and the studio never
 * learns someone rang.
 *
 * So the caller is shown only when the number could actually ring. The
 * fallback is the studio's own DID, which is always valid because we own
 * it, and tells the handset which branch line rang. The caller's real
 * number is on the call row and the live board regardless.
 * ────────────────────────────────────────────────────────────────── */
export function callerIdFor(caller: string | null, studioDid: string | null): string | undefined {
  if (caller) {
    // isValid() checks the country's real numbering plan, not just length.
    const parsed = parsePhoneNumberFromString(caller);
    if (parsed?.isValid()) return caller;
    console.warn(`twilio/voice: caller id ${caller} is not dialable — forwarding as the studio DID`);
  }
  return studioDid ?? undefined;
}
