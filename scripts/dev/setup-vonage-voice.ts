/**
 * One-time setup for the browser dialer (spike/web-dialer).
 *
 *   npm run vonage:voice:setup -- https://<your-ngrok>.ngrok-free.app
 *
 * Creates a Vonage Voice APPLICATION on the developer account, saves its
 * private key, and links a number to it. Prints the lines to add to
 * .env.local. It never writes .env.local itself — a script that edits the
 * file holding every credential is a script that can destroy them.
 *
 * Needs VONAGE_API_KEY and VONAGE_API_SECRET in .env.local first. Those are
 * the DEVELOPER account's (dashboard.vonage.com), not VBC's: the VBC
 * consumer key answers 401 here, which is the whole reason this is separate.
 *
 * Safe to inspect before it changes anything: with --dry-run it lists what
 * exists and creates nothing.
 */
import "../env";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const API = "https://api.nexmo.com";
const KEY = process.env.VONAGE_API_KEY?.trim();
const SECRET = process.env.VONAGE_API_SECRET?.trim();
const APP_NAME = "Cleopatra Console — browser dialer (dev)";
const KEY_PATH = "storage/vonage/voice-private.key";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const baseUrl = args.find((a) => a.startsWith("http"))?.replace(/\/+$/, "");

if (!KEY || !SECRET) {
  console.error(
    "VONAGE_API_KEY and VONAGE_API_SECRET are not set.\n" +
      "They are on the developer dashboard (dashboard.vonage.com), NOT in VBC.\n" +
      "Add them to .env.local and run this again.",
  );
  process.exit(1);
}
if (!dryRun && !baseUrl) {
  console.error(
    "Pass the public base URL Vonage should call back on, e.g.\n" +
      "  npm run vonage:voice:setup -- https://abc123.ngrok-free.app\n" +
      "Start the tunnel first with `npm run tunnel`. localhost will not do:\n" +
      "Vonage has to reach it from the internet.",
  );
  process.exit(1);
}
if (baseUrl && /localhost|127\.0\.0\.1/.test(baseUrl)) {
  console.error(`${baseUrl} is not reachable from the internet. Use the tunnel URL.`);
  process.exit(1);
}

const auth = "Basic " + Buffer.from(`${KEY}:${SECRET}`).toString("base64");

async function api(method: string, p: string, body?: unknown) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: auth, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { parsed = { raw: text.slice(0, 300) }; }
  return { status: res.status, body: parsed };
}

/* ── 1. Does the account answer at all? ─────────────────────────────── */
const apps = await api("GET", "/v2/applications?page_size=100");
if (apps.status === 401) {
  console.error("Vonage refused these credentials (401). Check VONAGE_API_KEY / VONAGE_API_SECRET.");
  process.exit(1);
}
if (apps.status !== 200) {
  console.error(`Vonage answered ${apps.status}: ${JSON.stringify(apps.body).slice(0, 300)}`);
  process.exit(1);
}

const embedded = (apps.body._embedded as { applications?: Record<string, unknown>[] } | undefined);
const existing = (embedded?.applications ?? []).find((a) => a.name === APP_NAME);
console.log(`Vonage developer account: ${(apps.body.total_items ?? 0) as number} application(s)`);

/* ── 2. Numbers, which is where this usually stops ───────────────────── */
const nums = await api("GET", "/v1/numbers?size=100" as string);
const numbers = ((nums.body.numbers ?? []) as Record<string, string>[]) ?? [];
console.log(`\nNumbers on the account: ${numbers.length}`);
for (const n of numbers.slice(0, 10)) {
  console.log(`  +${n.msisdn}  ${n.country}  ${String(n.features ?? "")}  app=${n.app_id ?? "(none)"}`);
}
if (numbers.length === 0) {
  console.log(
    "\n  None. A browser call needs a number for the person being called to see —\n" +
      "  Vonage refuses a `from` the account does not own. Buy one in the dashboard\n" +
      "  (Numbers → Buy numbers, a US number is about $1/month) and run this again.",
  );
}

if (dryRun) {
  console.log("\n--dry-run: nothing was created.");
  process.exit(0);
}

/* ── 3. The application ──────────────────────────────────────────────── */
const capabilities = {
  voice: {
    webhooks: {
      answer_url: { address: `${baseUrl}/api/webhooks/vonage/voice/answer`, http_method: "POST" },
      event_url: { address: `${baseUrl}/api/webhooks/vonage/voice/events`, http_method: "POST" },
    },
  },
};

let applicationId: string;
let privateKey: string | null = null;

if (existing) {
  applicationId = existing.id as string;
  console.log(`\nApplication already exists: ${applicationId}`);
  const updated = await api("PUT", `/v2/applications/${applicationId}`, { name: APP_NAME, capabilities });
  console.log(`  webhooks pointed at ${baseUrl} → ${updated.status === 200 ? "ok" : `HTTP ${updated.status}`}`);
  console.log(
    "  The private key is shown ONLY when an application is created. If you do\n" +
      `  not have ${KEY_PATH}, delete the application in the dashboard and re-run.`,
  );
} else {
  const created = await api("POST", "/v2/applications", { name: APP_NAME, capabilities });
  if (created.status !== 201) {
    console.error(`\nCould not create the application (${created.status}): ${JSON.stringify(created.body).slice(0, 300)}`);
    process.exit(1);
  }
  applicationId = created.body.id as string;
  privateKey = ((created.body.keys as Record<string, string> | undefined)?.private_key) ?? null;
  console.log(`\nCreated application ${applicationId}`);
}

if (privateKey) {
  const dir = path.dirname(KEY_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // 0600: it signs tokens that can place calls on this account.
  writeFileSync(KEY_PATH, privateKey, { mode: 0o600 });
  console.log(`  private key written to ${KEY_PATH} (chmod 600)`);
}

/* ── 4. Link a number, so the call has a caller ID ───────────────────── */
const free = numbers.find((n) => !n.app_id) ?? numbers[0];
if (free) {
  const linked = await api(
    "POST",
    `/number/update?api_key=${encodeURIComponent(KEY)}&api_secret=${encodeURIComponent(SECRET)}` +
      `&country=${free.country}&msisdn=${free.msisdn}&app_id=${applicationId}`,
  );
  console.log(`\nLinked +${free.msisdn} to the application → ${linked.status === 200 ? "ok" : `HTTP ${linked.status}`}`);
}

console.log(`
Add these to .env.local:

VONAGE_APPLICATION_ID=${applicationId}
VONAGE_PRIVATE_KEY_PATH=${KEY_PATH}
VONAGE_LVN=${free ? `+${free.msisdn}` : "<buy a number first>"}
# Only these numbers may be dialled. An answer webhook on a public tunnel
# that connects to anything is a toll-fraud machine; keep this short.
VONAGE_DIALER_ALLOWLIST=+19548361461
`);
process.exit(0);
