/* ── Password hashing ──────────────────────────────────────────────────
 * scrypt with a per-password salt. Chosen over bcrypt because it needs no
 * native dependency and is memory-hard.
 * Format: scrypt:<N>:<r>:<p>:<salt-hex>:<hash-hex>
 * ────────────────────────────────────────────────────────────────── */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEYLEN = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(plain, salt, KEYLEN, PARAMS);
  return `scrypt:${PARAMS.N}:${PARAMS.r}:${PARAMS.p}:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(plain: string, stored: string | null): Promise<boolean> {
  // Always do the work, even with no stored hash, so a missing account and a
  // wrong password take the same time and cannot be told apart.
  const parts = (stored ?? "").split(":");
  const usable = parts.length === 6 && parts[0] === "scrypt";

  const N = usable ? Number(parts[1]) : PARAMS.N;
  const r = usable ? Number(parts[2]) : PARAMS.r;
  const p = usable ? Number(parts[3]) : PARAMS.p;
  const salt = Buffer.from(usable ? parts[4] : randomBytes(16).toString("hex"), "hex");
  const expected = Buffer.from(usable ? parts[5] : randomBytes(KEYLEN).toString("hex"), "hex");

  let actual: Buffer;
  try {
    actual = await scrypt(plain, salt, expected.length || KEYLEN, { N, r, p });
  } catch {
    return false;
  }

  if (!usable) return false;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Password policy for staff accounts. */
export function passwordProblems(plain: string): string[] {
  const problems: string[] = [];
  if (plain.length < 12) problems.push("at least 12 characters");
  if (!/[a-z]/.test(plain)) problems.push("a lowercase letter");
  if (!/[A-Z]/.test(plain)) problems.push("an uppercase letter");
  if (!/\d/.test(plain)) problems.push("a digit");
  return problems;
}
