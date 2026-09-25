import type { Job } from "./types";
import { slaMonitor } from "./slaMonitor";
import { rollups } from "./rollups";
import { campaignDispatcher } from "./campaignDispatcher";
import { duplicateDetector } from "./duplicateDetector";
import { winback } from "./winback";
import { vonageSync } from "./vonageSync";
import { vonageDirectory } from "./vonageDirectory";
import { timelySync } from "./timelySync";
import { retention } from "./retention";

/** Every background job, in the order they are announced at boot. */
export const JOBS: Job[] = [
  slaMonitor,
  campaignDispatcher,
  rollups,
  winback,
  duplicateDetector,
  vonageSync,
  vonageDirectory,
  timelySync,
  retention,
];

export type { Job, JobResult } from "./types";
