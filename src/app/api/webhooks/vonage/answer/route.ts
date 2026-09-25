import { db } from "@/db/client";
import { webhookDeliveries } from "@/db/schema";
import { logVonageWebhook } from "@/server/vonage/debugLog";
import { normalizeNumber, studioForInboundNumber } from "@/server/twilio/resolve";
import { verifyVonageQuerySignature } from "@/server/vonage/signature";
import { clientIp } from "@/server/booking/attribution";
import { allow } from "@/server/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Inbound call to a Vonage number ───────────────────────────────────
 *   caller ──► Vonage DID ──► (this handler) ──► the studio's own phone
 *
 * The Twilio side has done this since the beginning; Vonage had nothing,
 * so a Vonage DID rang into silence. The answer is an NCCO, Vonage's
 * equivalent of TwiML.
 *
 * Vonage calls this URL with GET (query string) or POST (JSON) depending
 * on how the application is configured, so both are served.
 * ────────────────────────────────────────────────────────────────── */

interface AnswerParams {
  from?: string;
  to?: string;
  uuid?: string;
  conversation_uuid?: string;
  /** Present only when the application is configured to sign. */
  sig?: string;
  [key: string]: string | undefined;
}

/** An NCCO action. Vonage reads this array top to bottom. */
type Ncco = Record<string, unknown>[];

const ncco = (actions: Ncco) =>
  Response.json(actions, { headers: { "Cache-Control": "no-store" } });

const talkThenHangUp = (text: string, language: string): Ncco => [
  { action: "talk", text, language, style: 0 },
];

/** Best-effort language for the spoken fallback. */
function speechLocale(locale: string | null | undefined): string {
  switch ((locale ?? "en").slice(0, 2)) {
    case "tr": return "tr-TR";
    case "es": return "es-ES";
    case "de": return "de-DE";
    default: return "en-GB";
  }
}

/* ── What this endpoint gives away ─────────────────────────────────────
 * The signature was computed, written to webhook_deliveries, and then
 * ignored: the call was connected either way. So anyone who guessed the
 * URL could ask it which studio owns a DID and what that branch's real
 * phone number is, one request at a time, and write a database row with
 * every guess.
 *
 * Enforcement has to be graded, because refusing outright is its own
 * outage. Vonage signs the answer webhook only when the application is
 * configured to, and this account's signing convention is still an open
 * question — turning every unsigned delivery into a refusal would send
 * every inbound call to "this number is not in service".
 *
 * So: a signature that is present and WRONG is refused outright, because
 * nothing legitimate produces one. A delivery with no signature at all is
 * served but rate limited, which removes the enumeration and the write
 * amplification without dropping real calls. An operator who has confirmed
 * their account signs sets VONAGE_ANSWER_REQUIRE_SIGNATURE=1 and gets the
 * strict behaviour.
 * ────────────────────────────────────────────────────────────────── */
const requireSignature = (): boolean => process.env.VONAGE_ANSWER_REQUIRE_SIGNATURE === "1";

type SignatureVerdict = "valid" | "absent" | "mismatch";

function verdictFor(params: AnswerParams): SignatureVerdict {
  const secret = process.env.VONAGE_SIGNATURE_SECRET ?? "";
  if (!secret) return "absent";
  if (!params.sig) return "absent";
  const fields = Object.fromEntries(
    Object.entries(params).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;
  return verifyVonageQuerySignature(fields, secret) ? "valid" : "mismatch";
}

/** Spoken refusal, so a real caller in an edge case still hears something. */
const outOfService = (): Response =>
  ncco(talkThenHangUp("This number is not in service.", "en-GB"));

async function handle(params: AnswerParams, rawForLog: Record<string, unknown>, ip: string) {
  const to = normalizeNumber(params.to);
  const callId = params.uuid ?? params.conversation_uuid ?? "unknown";

  const verdict = verdictFor(params);

  /* A signature that does not match is refused before anything is read or
     written. Nothing legitimate signs incorrectly. */
  if (verdict === "mismatch") {
    console.warn(`vonage/answer: refused ${callId} — signature mismatch from ${ip}`);
    await db.insert(webhookDeliveries).values({
      provider: "vonage",
      externalSid: callId,
      eventType: "call.answer",
      signatureValid: false,
      payload: rawForLog,
      processed: false,
      error: "signature mismatch",
    }).onConflictDoNothing();
    return Response.json({ message: "Invalid signature" }, { status: 403 });
  }

  if (verdict === "absent" && requireSignature()) {
    console.warn(`vonage/answer: refused ${callId} — unsigned and VONAGE_ANSWER_REQUIRE_SIGNATURE is on`);
    return Response.json({ message: "Signature required" }, { status: 403 });
  }

  /* An unsigned delivery is served, but not an unlimited number of them.
     A studio's busiest DID does not ring sixty times a minute from one
     address; an enumeration sweep does. */
  if (verdict === "absent" && !(await allow("vonage:answer", ip, 60, 60))) {
    console.warn(`vonage/answer: rate limited ${ip}`);
    return Response.json({ message: "Too many requests" }, { status: 429 });
  }

  const studio = await studioForInboundNumber(to);

  await db.insert(webhookDeliveries).values({
    provider: "vonage",
    externalSid: callId,
    eventType: "call.answer",
    signatureValid: verdict === "valid",
    payload: rawForLog,
    processed: true,
    processedAt: new Date(),
    error: verdict === "valid" ? null : "unsigned delivery, served under rate limit",
  }).onConflictDoNothing();

  if (!studio) {
    /* We do not own this number. Saying so and hanging up is the only safe
       answer — connecting the call would forward a stranger somewhere. */
    console.warn(`vonage/answer: no studio owns ${to}`);
    return outOfService();
  }

  if (!studio.branchPhone) {
    console.warn(`vonage/answer: ${studio.slug} has no branch line configured`);
    return ncco(
      talkThenHangUp(
        "Sorry, we cannot connect your call right now. Please try again later.",
        speechLocale(studio.locale),
      ),
    );
  }

  /* Connect to the studio's own line. `from` is set to the DID the caller
     dialled, not the caller's own number: the branch phone shows which
     studio line rang, and the caller's number is still on the call record
     in the console. */
  return ncco([
    {
      action: "connect",
      from: (to ?? "").replace(/^\+/, ""),
      timeout: 30,
      // A phone nobody picks up must not ring forever.
      limit: 3600,
      endpoint: [
        {
          type: "phone",
          number: studio.branchPhone.replace(/^\+/, ""),
        },
      ],
    },
    // Reached only if the connect fails or the line is busy.
    {
      action: "talk",
      text: "We could not reach the studio. Please try again shortly.",
      language: speechLocale(studio.locale),
    },
  ]);
}



export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries()) as AnswerParams;
  logVonageWebhook("ANSWER", "GET", req.headers, params);
  return handle(params, params as Record<string, unknown>, clientIp(req.headers) ?? "unknown");
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as AnswerParams;
  logVonageWebhook("ANSWER", "POST", req.headers, body);
  return handle(body, body as Record<string, unknown>, clientIp(req.headers) ?? "unknown");
}
