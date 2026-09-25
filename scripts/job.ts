/**
 * Runs one job immediately, for testing:
 *   npx tsx scripts/job.ts rollups
 *   npx tsx scripts/job.ts            # lists the jobs
 */
import "./env";
import { pool } from "../src/db/client";
import { JOBS } from "../src/server/jobs";

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.log("jobs:");
    for (const j of JOBS) {
      const ok = !j.requires || j.requires();
      console.log(`  ${j.name.padEnd(22)} every ${Math.round(j.everyMs / 1000)}s${ok ? "" : "  (not configured)"}`);
    }
    return;
  }

  const job = JOBS.find((j) => j.name === name);
  if (!job) throw new Error(`unknown job "${name}"`);
  if (job.requires && !job.requires()) throw new Error(`${name} is not configured`);

  const started = Date.now();
  const result = await job.run();
  console.log(`${job.name}: ${result.summary}`, result.counts ?? {}, `(${Date.now() - started}ms)`);
}

main().then(() => pool.end()).catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await pool.end();
  process.exit(1);
});
