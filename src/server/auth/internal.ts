/* ── Temporary guard for console-facing endpoints ──────────────────────
 * Real staff authentication (Auth.js + the RBAC tables) lands with the
 * CRM API. Until then anything that can spend money or message a customer
 * requires a bearer token from the environment — NOT left open.
 * ────────────────────────────────────────────────────────────────── */
import { timingSafeEqual } from "node:crypto";

export type GuardResult = { ok: true } | { ok: false; status: 401 | 503; message: string };

export function requireInternalToken(req: Request): GuardResult {
  const expected = process.env.INTERNAL_API_TOKEN;
  if (!expected) {
    // Fail closed. An unset token must not mean "allow everyone".
    return { ok: false, status: 503, message: "INTERNAL_API_TOKEN is not configured" };
  }

  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  return { ok: true };
}
