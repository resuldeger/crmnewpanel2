import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth/guard";
import { clientToken, ensureVonageUser, voiceApiConfig } from "@/server/vonage/voiceApi";
import { normalizeNumber } from "@/server/twilio/resolve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── The browser's credential ──────────────────────────────────────────
 * SPIKE (spike/web-dialer).
 *
 * Minted per person, per session, and short-lived, because it leaves this
 * machine: whoever holds it can open a session and place a call on the
 * application. It is not stored anywhere and it is not in the page source.
 *
 * The Vonage user is created on demand and named after the staff id, so a
 * call in the Vonage logs says who made it instead of every agent sharing
 * one identity.
 * ────────────────────────────────────────────────────────────────── */
export const GET = withAuth("calls.manage", async (user) => {
  const config = voiceApiConfig();
  if (!config) {
    /* 200 with a reason, not an error: the screen has something useful to
       say in this state and a 500 would just make it look broken. */
    return NextResponse.json(
      {
        configured: false,
        reason:
          "The Vonage Voice API is not set up yet — VONAGE_APPLICATION_ID, VONAGE_PRIVATE_KEY_PATH and VONAGE_LVN are needed.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const name = `cleo-staff-${user.id}`;
  const ensured = await ensureVonageUser(name, user.name);
  if (!ensured.ok) {
    return NextResponse.json({ configured: true, error: ensured.detail }, { status: 502 });
  }

  const token = clientToken(name);
  if (!token) {
    return NextResponse.json({ configured: true, error: "could not sign the token" }, { status: 500 });
  }

  const allowed = (process.env.VONAGE_DIALER_ALLOWLIST ?? "")
    .split(",")
    .map((n) => normalizeNumber(n.trim()))
    .filter((n): n is string => Boolean(n));

  return NextResponse.json(
    {
      configured: true,
      token,
      user: name,
      /* The caller ID and the allow-list are shown on the screen. Finding
         out a number is barred only after the call fails is a poor way to
         learn it, and the list is short enough to print. */
      from: config.lvn,
      allowed,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
