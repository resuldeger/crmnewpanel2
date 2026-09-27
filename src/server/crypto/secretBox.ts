import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/* ── Secrets we must be able to read back ──────────────────────────────
 * Almost every credential in this project is write-only: a password is
 * hashed, an API key lives in the environment. A Timely account is the
 * exception — we have to replay the password at their login form, so it
 * has to be reversible, and reversible means encrypted rather than hashed.
 *
 * The Laravel system did the same thing with AES-256-CBC and APP_KEY. This
 * uses GCM instead, which authenticates the ciphertext: a row somebody has
 * edited in the database fails to decrypt rather than decrypting to
 * rubbish that we then post at a login form.
 *
 * The key is derived from SECRET_KEY, so losing that means re-entering the
 * Timely passwords — which is the right failure. Nothing here is a
 * substitute for the database itself being private.
 * ────────────────────────────────────────────────────────────────── */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const PREFIX = "v1";

let cached: Buffer | null = null;

function key(): Buffer {
  if (cached) return cached;
  const raw = process.env.SECRET_KEY?.trim();
  if (!raw || raw.length < 16) {
    throw new Error(
      "SECRET_KEY is missing or too short — set a long random value in .env.local before storing a Timely password",
    );
  }
  /* Hashed to 32 bytes so any passphrase length works, and so the key in
     the environment is never the key on the wire. */
  cached = createHash("sha256").update(raw).digest();
  return cached;
}

export function secretsConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/** `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function seal(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

/**
 * Returns null rather than throwing on anything malformed.
 *
 * A password that cannot be decrypted is a password we do not have, and
 * the caller's job is to say so and ask for it again — not to crash a
 * background sweep over one bad row.
 */
export function open(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  try {
    const decipher = createDecipheriv(ALGO, key(), Buffer.from(parts[1], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
