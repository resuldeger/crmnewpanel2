/* The seal has to survive a round trip and reject tampering — a Timely
   password that decrypts to rubbish gets posted at a login form. */
import "../env";
import { seal, open, secretsConfigured } from "../../src/server/crypto/secretBox";

let failed = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};

check("SECRET_KEY is configured", secretsConfigured());

const secret = "f3BEarj6YX*9X8# — ünlü harfli ve simgeli";
const sealed = seal(secret);
check("round trip", open(sealed) === secret);
check("ciphertext does not contain the plaintext", !sealed.includes(secret));
check("same input seals differently each time (random iv)", seal(secret) !== seal(secret));

/* GCM authenticates, so an edited row fails to open instead of opening to
   something we would then send to Timely. */
const parts = sealed.split(".");
const tampered = [parts[0], parts[1], parts[2], Buffer.from("evil").toString("base64url")].join(".");
check("tampered ciphertext returns null", open(tampered) === null);
check("garbage returns null", open("not-a-sealed-value") === null);
check("null returns null", open(null) === null);

console.log(failed === 0 ? "\nall passed" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
