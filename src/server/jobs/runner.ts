import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { Job, JobResult } from "./types";
import { canRun } from "@/server/integrations/health";

/** How often the worker says it is still here. */
const HEARTBEAT_MS = 30_000;

/**
 * Runs jobs on their own intervals.
 *
 * Two guarantees: a job never overlaps itself, and a crash in one job
 * never stops the others. Every run is recorded in rollup_checkpoints so
 * a restart can tell what last succeeded.
 */
export class JobRunner {
  private timers: NodeJS.Timeout[] = [];
  private running = new Set<string>();
  private stopping = false;

  constructor(private readonly jobs: Job[]) {}

  private async record(name: string, ok: boolean, error?: string) {
    await db.execute(sql`
      insert into rollup_checkpoints (name, last_run_at, last_success_at, running, last_error)
      values (${name}, now(), ${ok ? sql`now()` : sql`null`}, false, ${error ?? null})
      on conflict (name) do update set
        last_run_at     = now(),
        last_success_at = ${ok ? sql`now()` : sql`rollup_checkpoints.last_success_at`},
        running         = false,
        last_error      = ${error ?? null}
    `);
  }

  private async runOne(job: Job) {
    if (this.stopping || this.running.has(job.name)) return;
    if (job.requires && !job.requires()) return; // credentials absent — stay quiet

    /* Halted upstream: someone has to clear it in the panel. Skipping here
       means no request is made at all, which is the point — a retry can be
       what keeps the far side broken. */
    if (job.integration && !(await canRun(job.integration))) return;

    this.running.add(job.name);
    const started = Date.now();
    try {
      const result: JobResult = await job.run();
      const ms = Date.now() - started;
      const counts = result.counts
        ? " · " + Object.entries(result.counts).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(" ")
        : "";
      // Silence is golden: only speak when something happened.
      const interesting = !result.counts || Object.values(result.counts).some((v) => v > 0);
      if (interesting || result.error) {
        console.log(`[${new Date().toISOString()}] ${job.name}: ${result.summary}${counts} (${ms}ms)`);
      }
      /* A returned error is still a failure. The checkpoint is what the
         status panel reads, and a job that reports "the API refused us" must
         not leave a fresh success behind it. */
      await this.record(job.name, !result.error, result.error ?? undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${new Date().toISOString()}] ${job.name} FAILED: ${message}`);
      await this.record(job.name, false, message).catch(() => undefined);
    } finally {
      this.running.delete(job.name);
    }
  }

  /* ── The heartbeat ────────────────────────────────────────────────
   * Every "last success" this runner writes is silent about the one thing
   * that matters most: whether the process writing them is still alive. A
   * stopped worker leaves a set of perfectly plausible timestamps that
   * simply never move again, which is how a day of calls went missing with
   * nothing on screen to say why.
   *
   * So the runner itself checks in. `last_run_at` is the beat; and
   * `last_success_at` holds the moment this process STARTED, which is what
   * lets a reader tell "this twelve-hourly job is overdue" from "the worker
   * came up four minutes ago and has not reached it yet".
   */
  private async beat(boot: boolean) {
    await db
      .execute(
        sql`
          insert into rollup_checkpoints (name, last_run_at, last_success_at, last_processed_id, running)
          values ('worker', now(), now(), ${String(process.pid)}, true)
          on conflict (name) do update set
            last_run_at = now(),
            ${boot ? sql`last_success_at = now(), last_processed_id = ${String(process.pid)},` : sql``}
            running = true
        `,
      )
      .catch((err: unknown) => {
        // A missed beat must never take the worker down with it.
        console.warn(`worker heartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  start() {
    void this.beat(true);
    this.timers.push(setInterval(() => void this.beat(false), HEARTBEAT_MS));

    for (const job of this.jobs) {
      if (job.requires && !job.requires()) {
        console.log(`  · ${job.name} — skipped (not configured)`);
        continue;
      }
      console.log(`  · ${job.name} — every ${Math.round(job.everyMs / 1000)}s`);
      if (!job.skipOnBoot) void this.runOne(job);
      this.timers.push(setInterval(() => void this.runOne(job), job.everyMs));
    }
  }

  /** Lets in-flight work finish so nothing is left half-done. */
  async stop() {
    this.stopping = true;
    this.timers.forEach(clearInterval);
    this.timers = [];
    while (this.running.size > 0) await new Promise((r) => setTimeout(r, 100));
    /* A clean shutdown says so, so the panel can tell "stopped on purpose"
       from "died". A crash leaves `running` true and a beat that stops
       moving, which is exactly the shape of the thing worth alarming on. */
    await db
      .execute(sql`update rollup_checkpoints set running = false where name = 'worker'`)
      .catch(() => undefined);
  }
}
