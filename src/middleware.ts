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
function allowedHosts(): string[] {
  const configured = (process.env.ADMIN_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return [...LOOPBACK, ...configured];
}

/** Paths that must never be served to an untrusted host. */
const PROTECTED = [/^\/admin(?:\/|$)/, /^\/api\/crm(?:\/|$)/, /^\/api\/auth(?:\/|$)/];

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (!PROTECTED.some((re) => re.test(path))) return NextResponse.next();

  // Host header minus the port; x-forwarded-host wins behind a proxy.
  const raw = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").toLowerCase();
  const host = raw.split(",")[0].trim().replace(/:\d+$/, "");

  if (allowedHosts().includes(host)) return NextResponse.next();

  // 404, not 403: a probe learns nothing about what is here.
  return new NextResponse(null, { status: 404 });
}

export const config = {
  matcher: ["/admin/:path*", "/api/crm/:path*", "/api/auth/:path*"],
};
