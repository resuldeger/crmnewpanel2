/**
 * What every outside source is doing, in a terminal.
 *
 *   npm run health
 *
 * The same report /admin/health draws, for when the console is not the
 * quickest thing to reach — or is itself the thing that is down.
 */
import "../env";
import { systemHealth } from "../../src/server/integrations/systemHealth";

const h = await systemHealth();
console.log(`overall: ${h.status}`);
console.log(`worker: alive=${h.worker.alive} pid=${h.worker.pid} up=${h.worker.uptimeSeconds}s stale=${h.worker.staleSeconds}s`);
for (const s of h.sources) {
  console.log(`\n[${s.status.toUpperCase()}] ${s.label} — ${s.summary}`);
  if (s.action) console.log(`   ! ${s.action}`);
  for (const c of s.checks) console.log(`   · ${c.status.padEnd(13)} ${c.label} — ${c.detail ?? ""}`.slice(0, 160));
  for (const j of s.jobs) console.log(`   job ${j.name} every ${j.everySeconds}s status=${j.status}${j.lastError ? " err=" + j.lastError.slice(0, 60) : ""}`);
}
process.exit(0);
