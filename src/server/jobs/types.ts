import type { Provider } from "@/server/integrations/health";

/* ── Background jobs ───────────────────────────────────────────────────
 * One module per job. The runner owns scheduling, overlap protection and
 * bookkeeping so a job only has to describe the work.
 * ────────────────────────────────────────────────────────────────── */

export interface JobResult {
  /** Short line for the log — what actually happened this run. */
  summary: string;
  /** Anything worth counting; surfaced in the worker log. */
  counts?: Record<string, number>;
}

export interface Job {
  /** Stable id — also the key in rollup_checkpoints. */
  name: string;
  /** How often to run, in milliseconds. */
  everyMs: number;
  /** Skip the run at startup; useful for nightly work. */
  skipOnBoot?: boolean;
  /** Requires credentials that may not be configured. */
  requires?: () => boolean;
  /**
   * The outside service this job talks to.
   *
   * When that integration has been halted the runner skips the job
   * entirely. Retrying a refused credential on a timer is not free — with
   * Vonage each attempt is a failed login that extends an account lockout
   * — so the gate belongs here, before any work starts, rather than in
   * each job's error handling.
   */
  integration?: Provider;
  run: () => Promise<JobResult>;
}
