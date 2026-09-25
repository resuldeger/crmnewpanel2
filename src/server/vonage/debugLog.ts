import { appendFileSync } from "node:fs";
import { join } from "node:path";

/* ── Vonage webhook tracing ────────────────────────────────────────────
 * Three handlers each carried their own copy of this, and every copy ran
 * on every request in every environment. Two things were wrong with that:
 *
 *   · The headers include Vonage's `Authorization` JWT — the very token
 *     the signature check verifies. Written to a file in the project root
 *     it becomes a replay credential sitting on disk.
 *   · The body carries the caller's phone number, so a production run
 *     accumulates an unbounded plaintext log of who rang which studio.
 *
 * It stays because tracing is exactly what is needed while the Vonage
 * numbering is still being worked out — but only outside production, with
 * the credentials masked, and behind a flag so it can be turned off
 * without editing code.
 * ────────────────────────────────────────────────────────────────── */

/** Headers whose value is a credential, never written out in full. */
const SECRET_HEADERS = new Set(["authorization", "cookie", "x-vonage-signature"]);

const enabled = (): boolean =>
  process.env.NODE_ENV !== "production" && process.env.VONAGE_DEBUG_LOG !== "0";

/** Keeps enough of a token to match it against a log line, not enough to use it. */
function maskHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = SECRET_HEADERS.has(key.toLowerCase())
      ? `«redacted ${value.length} chars, …${value.slice(-6)}»`
      : value;
  });
  return out;
}

/**
 * Traces one webhook hit to stdout and to `vonage_webhook.log`.
 *
 * `payload` is the raw body for POST, the query string for GET, or the
 * parsed params where the handler has them — whatever the caller holds.
 */
export function logVonageWebhook(
  source: string,
  method: string,
  headers: Headers,
  payload: unknown,
): void {
  if (!enabled()) return;

  try {
    const time = new Date().toISOString();
    const body = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);

    console.log(`\n🔔 [VONAGE ${source}] (${method}) at ${time}`);
    if (body) console.log("Payload:", body.slice(0, 500));

    appendFileSync(
      join(process.cwd(), "vonage_webhook.log"),
      `\n=======================================================\n` +
        `[${time}] ${source} - ${method}\n` +
        `HEADERS: ${JSON.stringify(maskHeaders(headers), null, 2)}\n` +
        `BODY: ${body || "(empty)"}\n` +
        `=======================================================\n`,
      "utf8",
    );
  } catch (err) {
    // Tracing must never be the reason a webhook fails.
    console.error("vonage debug log failed:", err);
  }
}
