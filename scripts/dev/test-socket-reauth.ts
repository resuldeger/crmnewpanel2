/* A socket outlives the reason it was opened.
 *
 * The gateway resolved the user once, in the handshake, and never again.
 * A console left open on a desk kept its feed through a sign-out, a
 * deactivation, a role change and even the session expiring — while
 * auth.ts claimed in its own header that it did not.
 *
 * Run with a short interval so the test does not wait a minute:
 *   REALTIME_REAUTH_MS=3000 npx tsx scripts/realtime.ts   (in one shell)
 *   npx tsx scripts/dev/test-socket-reauth.ts             (in another)
 */
import "../env";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { io as connect, type Socket } from "socket.io-client";
import { db } from "../../src/db/client";
import { sessions, staff } from "../../src/db/schema";

const URL = process.env.TEST_REALTIME_URL ?? "http://localhost:4001";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function makeSession(): Promise<{ token: string; id: string }> {
  const [who] = await db.select({ id: staff.id }).from(staff).where(eq(staff.roleId, "super_admin")).limit(1);
  if (!who) throw new Error("no super_admin on file");
  const token = randomBytes(32).toString("hex");
  const id = createHash("sha256").update(token).digest("hex");
  await db.insert(sessions).values({
    id, staffId: who.id, expiresAt: new Date(Date.now() + 60 * 60_000), userAgent: "reauth-test",
  });
  return { token, id };
}

const open = (token: string): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = connect(URL, {
      path: "/realtime",
      transports: ["websocket"],
      extraHeaders: { cookie: `cleo_session=${token}`, origin: "http://localhost:3000" },
      reconnection: false,
    });
    socket.on("ready", () => resolve(socket));
    socket.on("connect_error", reject);
    setTimeout(() => reject(new Error("no ready within 5s")), 5000);
  });

async function main() {
  const { token, id } = await makeSession();

  console.log("\n1. oturum acik — socket baglaniyor ve abone oluyor");
  const socket = await open(token);
  const sub = await new Promise<{ ok: boolean }>((r) => socket.emit("subscribe", "calls:live", r));
  check("baglandi", socket.connected);
  check("calls:live aboneligi kabul edildi", sub.ok === true, JSON.stringify(sub));

  console.log("\n2. oturum veritabanindan siliniyor (cikis yapildi)");
  let signedOutReason: string | null = null;
  socket.on("signed_out", (p: { reason?: string }) => { signedOutReason = p?.reason ?? "?"; });
  await db.delete(sessions).where(eq(sessions.id, id));

  // Give the gateway's re-auth timer a couple of turns.
  const waitMs = Number(process.env.REALTIME_REAUTH_MS ?? 60_000) * 2 + 2000;
  console.log(`   ${Math.round(waitMs / 1000)} sn bekleniyor…`);
  for (let i = 0; i < waitMs / 250 && socket.connected; i += 1) await sleep(250);

  check("socket koparildi", !socket.connected, socket.connected ? "hala bagli" : "kapandi");
  check("sebebi bildirildi", signedOutReason !== null, String(signedOutReason));

  socket.close();
  await db.delete(sessions).where(eq(sessions.id, id));

  console.log(`\n${failures === 0 ? "TUM TESTLER GECTI" : `${failures} TEST BASARISIZ`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
