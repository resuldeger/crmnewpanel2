import { db } from "@/db/client";
import { webhookDeliveries } from "@/db/schema";
import { logVonageWebhook } from "@/server/vonage/debugLog";
import { normalizeNumber, studioForInboundNumber } from "@/server/twilio/resolve";
import { verifyVonageQuerySignature, signatureCheckDisabled } from "@/server/vonage/signature";

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

async function handle(params: AnswerParams, rawForLog: Record<string, unknown>) {
  const to = normalizeNumber(params.to);
  const from = normalizeNumber(params.from);
  const callId = params.uuid ?? params.conversation_uuid ?? "unknown";

  const studio = await studioForInboundNumber(to);

  await db.insert(webhookDeliveries).values({
    provider: "vonage",
    externalSid: callId,
    eventType: "call.answer",
    // The query scheme is only used when a secret is configured; a missing
    // one is recorded as unverified rather than quietly accepted.
    signatureValid:
      verifyVonageQuerySignature(
        Object.fromEntries(Object.entries(params).filter(([, v]) => typeof v === "string")) as Record<string, string>,
        process.env.VONAGE_SIGNATURE_SECRET ?? "",
      ) || signatureCheckDisabled(),
    payload: rawForLog,
    processed: true,
    processedAt: new Date(),
  }).onConflictDoNothing();

  if (!studio) {
    /* We do not own this number. Saying so and hanging up is the only safe
       answer — connecting the call would forward a stranger somewhere. */
    console.warn(`vonage/answer: no studio owns ${to}`);
    return ncco(talkThenHangUp("This number is not in service.", "en-GB"));
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
  return handle(params, params as Record<string, unknown>);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as AnswerParams;
  logVonageWebhook("ANSWER", "POST", req.headers, body);
  return handle(body, body as Record<string, unknown>);
}
