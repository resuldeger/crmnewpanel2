import { NextResponse, type NextRequest } from "next/server";

/**
 * Keeps the admin surface off any public tunnel.
 *
 * A tunnel (ngrok, cloudflared) exists so a phone can reach the booking
 * flow. It also hands the whole origin to the internet, including /admin
 * and the CRM API. Those stay reachable only from hosts named in
 * ADMIN_ALLOWED_HOSTS — loopback by default.
 *
 * The public booking flow and its webhooks are unaffected.
 */

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"];

/** Hosts allowed to reach the console, from env, plus loopback. */
function configuredHosts(): string[] {
  return (process.env.ADMIN_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** Paths that must never be served to an untrusted host. */
const PROTECTED = [/^\/admin(?:\/|$)/, /^\/api\/crm(?:\/|$)/, /^\/api\/auth(?:\/|$)/];

/* ── Which header names the host ───────────────────────────────────────
 * x-forwarded-host used to win unconditionally. That header is written by
 * whatever is in front of the app, and when nothing is — the app exposed
 * directly, or a proxy that does not overwrite what the client sent — it
 * is simply a value the caller chose. `X-Forwarded-Host: localhost` then
 * walked straight past this check.
 *
 * So the real Host header decides, unless the deployment says there is a
 * proxy in front that sets x-forwarded-host itself. Vercel, Cloudflare and
 * an nginx with `proxy_set_header` all overwrite it; a bare Node server
 * does not, which is exactly the case that was being trusted.
 * ────────────────────────────────────────────────────────────────── */
const trustProxyHost = (): boolean => process.env.TRUST_PROXY_HOST === "1";

function hostOf(req: NextRequest): string {
  const raw =
    (trustProxyHost() ? req.headers.get("x-forwarded-host") : null) ??
    req.headers.get("host") ??
    "";
  // A forwarded chain lists the original first; the port is not part of
  // the identity we are matching on.
  return raw.toLowerCase().split(",")[0].trim().replace(/:\d+$/, "");
}

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (!PROTECTED.some((re) => re.test(path))) return NextResponse.next();

  const host = hostOf(req);
  const configured = configuredHosts();

  if ([...LOOPBACK, ...configured].includes(host)) return NextResponse.next();

  /* ── A deploy that forgot the variable ─────────────────────────────
   * In production, with nothing configured, every host but loopback is
   * refused — which is the whole console and every /api/crm route
   * answering 404. That is the correct security posture and a terrible
   * thing to debug: nothing in the response says the cause, so it reads
   * as a broken build or a bad route table.
   *
   * The posture stays. The 404 becomes a 503 that names the variable, so
   * the person looking at it finds out in one request instead of an
   * afternoon. Only the operator ever sees it — an actual intruder is on
   * a host that is refused for the ordinary reason below.
   */
  if (process.env.NODE_ENV === "production" && configured.length === 0) {
    console.error(
      `middleware: ADMIN_ALLOWED_HOSTS is not set, so the console is refusing ${host}. ` +
        `Set it to the domain the console is served from.`,
    );
    return new NextResponse(
      "ADMIN_ALLOWED_HOSTS is not configured on this deployment, so the admin console " +
        "is not being served. Set it to this host and redeploy.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  // 404, not 403: a probe learns nothing about what is here.
  return new NextResponse(null, { status: 404 });
}

export const config = {
  matcher: ["/admin/:path*", "/api/crm/:path*", "/api/auth/:path*"],
};
