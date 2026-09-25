/* What the Reports API actually says about a recorded call, and where the
 * audio might be fetched from. Read-only probe.
 *   npx tsx scripts/dev/probe-recordings.ts
 */
import "../env";
import { vonageAccessToken } from "../../src/server/vonage/token";
import { vonageEndpoints } from "../../src/server/vonage/endpoints";
import { toVonageWindow } from "../../src/server/vonage/time";

const ACCOUNT = process.env.VONAGE_ACCOUNT_ID ?? "";

async function main() {
  const token = await vonageAccessToken();
  if (!token) throw new Error("no token");
  const auth = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  const to = new Date();
  const from = new Date(to.getTime() - 3 * 86_400_000);
  const qs = new URLSearchParams({
    "start:gte": toVonageWindow(from),
    "start:lte": toVonageWindow(to),
    page_size: "50",
    page: "1",
  });

  const res = await fetch(`${vonageEndpoints.callLogs(ACCOUNT)}?${qs}`, { headers: auth });
  console.log(`call-logs → HTTP ${res.status}`);
  if (!res.ok) { console.log((await res.text()).slice(0, 400)); return; }

  const body = (await res.json()) as { _embedded?: { call_logs?: Record<string, unknown>[] } };
  const rows = body._embedded?.call_logs ?? [];
  console.log(`  ${rows.length} kayit\n`);

  const recorded = rows.filter((r) => r.recorded === true);
  console.log(`  recorded=true olan: ${recorded.length}`);

  const sample = recorded[0] ?? rows[0];
  if (!sample) return;
  console.log("\n── bir kaydin TUM alanlari ──");
  console.log(JSON.stringify(sample, null, 2).slice(0, 2500));

  // Any field that smells like a recording handle?
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
  console.log("\n── tum kayitlarda gorulen alan adlari ──");
  console.log([...keys].sort().join(", "));
}

main().catch((e) => { console.error(e); process.exit(1); });
