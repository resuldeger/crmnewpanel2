/* Caller ID selection on the forwarded leg.
 *
 * Twilio passes an unusable inbound caller ID straight through to the
 * studio's carrier, which may refuse the call (error 13214). These are the
 * shapes carriers actually deliver for a withheld number.
 *
 *   npx tsx scripts/dev/test-twilio-callerid.ts
 */
import "../env";
import { normalizeNumber } from "../../src/server/twilio/resolve";
import { callerIdFor } from "../../src/server/twilio/callerId";

const DID = "+14703440356";

const cases: { raw: string; want: string; why: string }[] = [
  { raw: "+15043390333", want: "+15043390333", why: "gercek arayan gosterilir" },
  { raw: "5043390333", want: "+15043390333", why: "10 haneli US kisaltmasi" },
  { raw: "anonymous", want: DID, why: "gizli numara -> DID" },
  { raw: "266696687", want: DID, why: "ANONYMOUS tus karsiligi -> DID" },
  { raw: "unavailable", want: DID, why: "tasiyici bilinmiyor dedi -> DID" },
  { raw: "1234", want: DID, why: "dahili/kisa numara -> DID" },
  { raw: "+15548207901", want: DID, why: "atanmamis alan kodu 554 -> DID" },
  { raw: "", want: DID, why: "bos -> DID" },
];

let failures = 0;
for (const c of cases) {
  const got = callerIdFor(normalizeNumber(c.raw), DID);
  const ok = got === c.want;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${JSON.stringify(c.raw).padEnd(16)} -> ${String(got).padEnd(14)} ${c.why}`);
}

console.log(`\n${failures === 0 ? "TUM TESTLER GECTI" : `${failures} TEST BASARISIZ`}\n`);
process.exit(failures === 0 ? 0 : 1);
