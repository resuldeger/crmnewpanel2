import { lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { realtimeEvents, webhookDeliveries } from "@/db/schema";
import { cleanupOrphanUploads } from "@/server/booking/uploads";
import type { Job, JobResult } from "./types";

/* ── Keeping the append-only tables and unlinked files from swallowing the disk ──
 * Tables and storage cleaned up periodically:
 *
 *   realtime_events    — socket broadcast log.
 *   webhook_deliveries — processed carrier webhooks.
 *   uploads            — unlinked draft reference uploads older than 7 days.
 *
 * activity_log is deliberately NOT touched. It is the immutable audit trail.
 * ────────────────────────────────────────────────────────────────── */

const days = (n: number) => new Date(Date.now() - n * 86_400_000);

const EVENT_RETENTION_DAYS = Number(process.env.REALTIME_RETENTION_DAYS ?? 7);
const DELIVERY_RETENTION_DAYS = Number(process.env.WEBHOOK_RETENTION_DAYS ?? 90);
const UPLOAD_RETENTION_DAYS = Number(process.env.UPLOAD_RETENTION_DAYS ?? 7);

export const retention: Job = {
  name: "retention",
  everyMs: 6 * 60 * 60_000,

  async run(): Promise<JobResult> {
    const events = await db
      .delete(realtimeEvents)
      .where(lt(realtimeEvents.createdAt, days(EVENT_RETENTION_DAYS)))
      .returning({ id: realtimeEvents.id });

    /* An unprocessed delivery is evidence of something that went wrong, so
       it is kept regardless of age — the point of the inbox is that a
       failure does not disappear quietly. */
    const deliveries = await db
      .delete(webhookDeliveries)
      .where(
        sql`${webhookDeliveries.receivedAt} < ${days(DELIVERY_RETENTION_DAYS)}
            and ${webhookDeliveries.processed} = true`,
      )
      .returning({ id: webhookDeliveries.id });

    // Clean up unreferenced reference images that did not result in a booking or lead
    const uploadClean = await cleanupOrphanUploads(UPLOAD_RETENTION_DAYS);

    const totalCleaned = events.length + deliveries.length + uploadClean.deletedCount;

    return {
      summary: `${totalCleaned} items cleaned (${uploadClean.deletedCount} orphan uploads / ${Math.round(uploadClean.deletedBytes / 1024 / 1024)}MB freed)`,
      counts: {
        realtimeEvents: events.length,
        webhookDeliveries: deliveries.length,
        orphanUploads: uploadClean.deletedCount,
      },
    };
  },
};
