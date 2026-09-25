import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { Job, JobResult } from "./types";
import { canRun } from "@/server/integrations/health";

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
      if (interesting) {
        console.log(`[${new Date().toISOString()}] ${job.name}: ${result.summary}${counts} (${ms}ms)`);
      }
      await this.record(job.name, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${new Date().toISOString()}] ${job.name} FAILED: ${message}`);
      await this.record(job.name, false, message).catch(() => undefined);
    } finally {
      this.running.delete(job.name);
    }
  }

  start() {
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
  }
}
