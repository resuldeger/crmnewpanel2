import { createHmac, timingSafeEqual, createHash } from "node:crypto";

/* ── Vonage webhook authenticity ───────────────────────────────────────
 * Vonage signs a webhook two ways depending on the product:
 *
 *   · Voice API      — a JWT in `Authorization: Bearer`, signed HS256 with
 *                      the account's signature secret. Its `payload_hash`
 *                      claim binds the JWT to the body, so a captured
 *                      header cannot be replayed onto a different call.
 *   · Older products — a `sig` query parameter over the sorted params.
 *
 * Both are accepted, because a webhook that cannot be verified must be
 * refused rather than trusted: these handlers dial real phone numbers and
 * write to the call log the studios are measured on.
 * ────────────────────────────────────────────────────────────────── */

const b64urlToBuf = (s: string): Buffer =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Constant-time compare that never throws on a length mismatch. */
function sameBytes(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface JwtVerdict {
  valid: boolean;
  reason?: string;
  claims?: Record<string, unknown>;
}

/**
 * Verifies the JWT Vonage puts in the Authorization header.
 *
 * `rawBody` is the exact bytes received. Re-serialising the parsed JSON
 * would change key order and whitespace, and the hash would never match.
 */
export function verifyVonageJwt(
  authorization: string | null,
  rawBody: string,
  secret: string,
): JwtVerdict {
  if (!secret) return { valid: false, reason: "no signature secret configured" };

  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { valid: false, reason: "missing Authorization header" };

  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "malformed token" };

  const [header, payload, signature] = parts;

  let head: { alg?: string };
  try {
    head = JSON.parse(b64urlToBuf(header).toString("utf8")) as { alg?: string };
  } catch {
    return { valid: false, reason: "malformed header" };
  }
  /* "none" and any asymmetric algorithm are refused outright: accepting
     whatever the token names is how a signature check becomes decorative. */
  if (head.alg !== "HS256") return { valid: false, reason: `unexpected alg: ${head.alg}` };

  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
  if (!sameBytes(expected, b64urlToBuf(signature))) {
    return { valid: false, reason: "signature mismatch" };
  }

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(b64urlToBuf(payload).toString("utf8")) as Record<string, unknown>;
  } catch {
    return { valid: false, reason: "malformed claims" };
  }

  // A valid signature on a stale token is still a replay.
  const now = Math.floor(Date.now() / 1000);
  const exp = typeof claims.exp === "number" ? claims.exp : null;
  const iat = typeof claims.iat === "number" ? claims.iat : null;
  if (exp !== null && exp < now - 60) return { valid: false, reason: "token expired" };
  if (iat !== null && iat > now + 300) return { valid: false, reason: "token from the future" };

  /* Without this the signature only proves the header is genuine, not that
     it belongs to THIS body — the same header could be replayed over a
     forged call event. */
  const bound = claims.payload_hash;
  if (typeof bound === "string") {
    const actual = createHash("sha256").update(rawBody, "utf8").digest("hex");
    if (!sameBytes(Buffer.from(actual, "hex"), Buffer.from(bound, "hex"))) {
      return { valid: false, reason: "body does not match payload_hash" };
    }
  }

  return { valid: true, claims };
}

/**
 * The older query-parameter scheme: every parameter except `sig`, sorted,
 * joined as &key=value, then hashed with the secret.
 */
export function verifyVonageQuerySignature(
  params: Record<string, string>,
  secret: string,
  method: "md5hash" | "sha256" = "sha256",
): boolean {
  if (!secret) return false;
  const provided = params.sig;
  if (!provided) return false;

  const body = Object.keys(params)
    .filter((k) => k !== "sig")
    .sort()
    .map((k) => `&${k}=${(params[k] ?? "").replace(/[&=]/g, "_")}`)
    .join("");

  const digest =
    method === "md5hash"
      ? createHash("md5").update(`${body}${secret}`, "utf8").digest("hex")
      : createHmac("sha256", secret).update(body, "utf8").digest("hex");

  return sameBytes(
    Buffer.from(digest.toLowerCase(), "utf8"),
    Buffer.from(provided.toLowerCase(), "utf8"),
  );
}

/** Whether signature checking may be skipped. Local development only. */
export const signatureCheckDisabled = (): boolean =>
  (process.env.VONAGE_SKIP_SIGNATURE === "1" || !process.env.VONAGE_SIGNATURE_SECRET) && process.env.NODE_ENV !== "production";

/* ── VIS (Vonage Integration Suite) signing ────────────────────────────
 * VBC's VIS webhooks are signed differently from the Voice API's: we
 * register with `signingAlgo: HMAC_SHA256` and Vonage returns a hex digest
 * — but it travels inside the JSON body, at `metadata.signature`, as well
 * as (on some accounts) in an `x-vonage-signature` header.
 *
 * That placement creates a genuine ambiguity nobody can resolve by reading
 * our own code: a digest carried inside the very document it signs must be
 * computed over some body OTHER than the one finally sent. The two
 * conventions in the wild are to hash the body with the signature field
 * emptied, or to hash it with the field absent. A third possibility is
 * that the header carries a digest over the raw bytes as received.
 *
 * Guessing one and shipping it means every delivery is refused in
 * production for a reason no log would explain. So all three are tried,
 * the winner is reported, and a failure reports what each candidate would
 * have produced — one real delivery from Vonage then settles it for good.
 * ────────────────────────────────────────────────────────────────── */

export type VisScheme = "raw-body" | "blanked-signature" | "omitted-signature";

export interface VisVerdict {
  valid: boolean;
  scheme?: VisScheme;
  reason?: string;
  /** Development only: what each convention would have produced. */
  candidates?: Record<VisScheme, string>;
}

const hmacHex = (secret: string, data: string): string =>
  createHmac("sha256", secret).update(data, "utf8").digest("hex");

/** Re-serialises the body with `metadata.signature` emptied or removed. */
function bodyWithoutSignature(rawBody: string, omit: boolean): string | null {
  try {
    const parsed = JSON.parse(rawBody) as { metadata?: Record<string, unknown> };
    if (!parsed?.metadata || typeof parsed.metadata !== "object") return null;
    if (omit) delete parsed.metadata.signature;
    else parsed.metadata.signature = "";
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

/**
 * Verifies a VIS webhook against every signing convention we might have
 * been registered under.
 *
 * `signature` is whichever digest arrived — from the body's metadata or
 * from the header.
 */
export function verifyVisSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string | undefined,
): VisVerdict {
  if (!secret) return { valid: false, reason: "no signature secret configured" };
  if (!signature) return { valid: false, reason: "no signature on the delivery" };

  const provided = signature.trim().toLowerCase();

  const candidates: Record<VisScheme, string> = {
    "raw-body": hmacHex(secret, rawBody),
    "blanked-signature": hmacHex(secret, bodyWithoutSignature(rawBody, false) ?? rawBody),
    "omitted-signature": hmacHex(secret, bodyWithoutSignature(rawBody, true) ?? rawBody),
  };

  for (const [scheme, expected] of Object.entries(candidates) as [VisScheme, string][]) {
    if (sameBytes(Buffer.from(expected, "utf8"), Buffer.from(provided, "utf8"))) {
      return { valid: true, scheme };
    }
  }

  return {
    valid: false,
    reason: "signature matched none of the known conventions",
    // Only useful while the convention is still unknown, and it is derived
    // from the secret, so it never leaves a development machine.
    candidates: process.env.NODE_ENV !== "production" ? candidates : undefined,
  };
}
