/* ── Twilio request signature ──────────────────────────────────────────
 * https://www.twilio.com/docs/usage/security#validating-requests
 *
 * Signature = base64( HMAC-SHA1( authToken, fullUrl + concat(sorted k+v) ) )
 * An unsigned webhook is an open door: anyone who learns the URL could
 * forge inbound SMS, opt people out, or make us dial a premium number.
 * ────────────────────────────────────────────────────────────────── */
import { createHmac, timingSafeEqual } from "node:crypto";

export function expectedSignature(authToken: string, url: string, params: Record<string, string>): string {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(Buffer.from(payload, "utf8")).digest("base64");
}

export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  if (!authToken || !signature) return false;
  const expected = expectedSignature(authToken, url, params);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  // Constant-time compare, and never let a length mismatch throw.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The URL Twilio signed is the one it was configured with. Behind a proxy
 * the request object reports the internal host, so rebuild it from the
 * forwarded headers — otherwise every signature fails in production.
 */
export function publicUrl(req: Request): string {
  const url = new URL(req.url);
  const headers = req.headers;
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? url.host;
  const proto = headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}${url.pathname}${url.search}`;
}

/** Twilio posts application/x-www-form-urlencoded. */
export function formToRecord(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
