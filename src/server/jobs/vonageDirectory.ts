import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { calls } from "@/db/schema";
import { refreshDirectory, syncExtensionsTable } from "@/server/vonage/directory";
import type { Job, JobResult } from "./types";

/* ── Extension directory ───────────────────────────────────────────────
 * Provisioning is the source of truth for extension → user → branch → DID,
 * and our own table had drifted well behind it: 34 rows against 84 live
 * extensions, which is why call-centre agents showed up in the call log
 * attached to no studio.
 *
 * Hourly is generous. The list changes when someone joins or leaves.
 * ────────────────────────────────────────────────────────────────── */

const configured = () =>
  process.env.VONAGE_SYNC_ENABLED !== "0" &&
  Boolean(
    process.env.VONAGE_CONSUMER_KEY &&
    process.env.VONAGE_CONSUMER_SECRET &&
    process.env.VONAGE_USERNAME &&
    process.env.VONAGE_PASSWORD &&
    process.env.VONAGE_ACCOUNT_ID,
  );

export const vonageDirectory: Job = {
  name: "vonage-directory",
  integration: "vonage",
  everyMs: 60 * 60_000,
  requires: configured,

  async run(): Promise<JobResult> {
    const dir = await refreshDirectory();
    const { added, updated } = await syncExtensionsTable(dir);

    /* Calls collected before an extension was known kept a null studio, and
       nothing would ever revisit them — so a branch's own history stayed
       hidden from it. The extension was recorded at the time, so the studio
       can be recovered now that the directory knows who owns it. */
    const backfilled = await db
      .update(calls)
      .set({
        locationId: sql`(select e.location_id from extensions e where e.extension = ${calls.extension})`,
      })
      .where(sql`
        ${calls.locationId} is null
        and ${calls.extension} is not null
        and exists (
          select 1 from extensions e
          where e.extension = ${calls.extension} and e.location_id is not null
        )
      `)
      .returning({ id: calls.id });

    return {
      summary: `${dir.total} extension(s)`,
      counts: { added, updated, backfilled: backfilled.length },
    };
  },
};
