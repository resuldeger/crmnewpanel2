/**
 * Background worker.
 *
 *   npm run worker
 *
 * Runs the scheduled-message queue plus every job in src/server/jobs.
 * Jobs whose credentials are absent announce themselves as skipped rather
 * than failing every interval.
 */
import "./env";
import { pool } from "../src/db/client";
import { JobRunner } from "../src/server/jobs/runner";
import { JOBS } from "../src/server/jobs";
import { drainScheduledMessages } from "../src/server/sms/worker";
import { activeTransport } from "../src/server/twilio/transport";
import type { Job } from "../src/server/jobs/types";

const QUEUE_INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 60_000);

/** The SMS queue is just another job, with its own faster tick. */
const scheduledSms: Job = {
  name: "scheduled-sms",
  everyMs: QUEUE_INTERVAL_MS,
  async run() {
    const r = await drainScheduledMessages();
    return {
      summary: `${r.claimed} claimed`,
      counts: { claimed: r.claimed, sent: r.sent, failed: r.failed, skipped: r.skipped },
    };
  },
};

const runner = new JobRunner([scheduledSms, ...JOBS]);

console.log(`worker up · transport=${activeTransport()}`);
runner.start();

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal} — letting running jobs finish`);
  await runner.stop();
  await pool.end();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
