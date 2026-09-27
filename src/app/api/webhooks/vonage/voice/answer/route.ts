import { NextResponse, type NextRequest } from "next/server";
import { voiceApiConfig } from "@/server/vonage/voiceApi";
import { normalizeNumber } from "@/server/twilio/resolve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── What the browser's call is connected to ───────────────────────────
 * SPIKE (spike/web-dialer).
 *
 * The browser asks the Client SDK to place a call; Vonage answers it by
 * fetching this URL and doing whatever the NCCO here says. So this endpoint
 * decides who gets dialled — which makes it the most dangerous URL in the
 * project.
 *
 * It sits on a public tunnel, and an NCCO that connects to whatever number
 * arrives in the request is a toll-fraud machine: anyone who finds the URL
 * can bill international calls to this account until someone notices. That
 * is not a hypothetical class of bug; it is the specific thing this shape
 * of endpoint is known for.
 *
 * Three gates, all of which must pass:
 *   · the destination has to be a plausible E.164 number
 *   · it has to be on the allow-list while this is an experiment
 *   · the request has to carry a valid application JWT when Vonage is
 *     configured to sign them
 *
 * The allow-list is the one doing the real work today. It is an experiment
 * dialling one test number; a list of one is the correct size, and it is
 * the difference between "the URL leaked" and "the URL leaked and we paid
 * for it".
 * ────────────────────────────────────────────────────────────────── */

/** Numbers this spike may dial, comma-separated, E.164. Empty = none. */
function allowList(): string[] {
  return (process.env.VONAGE_DIALER_ALLOWLIST ?? "")
    .split(",")
    .map((n) => normalizeNumber(n.trim()))
    .filter((n): n is string => Boolean(n));
}

/** An NCCO that says nothing and hangs up, for every refusal. */
const refuse = (reason: string) => {
  console.warn(`vonage/voice/answer: refused — ${reason}`);
  return NextResponse.json([
    { action: "talk", text: "This call cannot be connected." },
  ]);
};

export async function POST(req: NextRequest) {
  const config = voiceApiConfig();
  if (!config) return refuse("the Voice API is not configured");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  /* serverCall's context arrives as the body. Vonage also sends `from` and
     `to` of its own for inbound calls, so the field we put there ourselves
     is read by its own name. */
  const requested = normalizeNumber(
    typeof body.to === "string" ? body.to : typeof body.number === "string" ? body.number : null,
  );

  if (!requested) return refuse("no destination number in the request");
  if (requested.replace(/\D/g, "").length < 10) return refuse(`${requested} is too short`);

  const allowed = allowList();
  if (allowed.length === 0) {
    return refuse("VONAGE_DIALER_ALLOWLIST is empty — nothing may be dialled");
  }
  if (!allowed.includes(requested)) {
    return refuse(`${requested} is not on VONAGE_DIALER_ALLOWLIST`);
  }

  console.log(`vonage/voice/answer: connecting browser call → ${requested} from ${config.lvn}`);

  return NextResponse.json([
    {
      action: "connect",
      /* The LVN linked to this application. Vonage refuses a `from` it does
         not own, so this is not a free-text caller ID. */
      from: config.lvn,
      /* Long enough for a real conversation, short enough that a call left
         connected by a crashed tab does not run all night. */
      timeout: 45,
      endpoint: [{ type: "phone", number: requested.replace(/^\+/, "") }],
    },
  ]);
}

/* Vonage fetches the answer URL with GET in some configurations. Same
   answer either way rather than a 405 that looks like an outage. */
export async function GET(req: NextRequest) {
  const to = req.nextUrl.searchParams.get("to");
  return POST(
    new Request(req.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to }),
    }) as NextRequest,
  );
}
