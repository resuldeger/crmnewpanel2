import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { Job, JobResult } from "./types";

/**
 * Flags likely duplicate leads for the merge queue.
 *
 * Matching is deliberately narrow — same normalised phone, or same email —
 * because a false merge destroys someone's history, and the console's
 * merge screen still asks a human to confirm.
 */
export const duplicateDetector: Job = {
  name: "duplicate-detector",
  everyMs: 6 * 60 * 60_000,
  skipOnBoot: true,

  async run(): Promise<JobResult> {
    const groups = await db.execute<{ kind: string; key: string; ids: string[] }>(sql`
      select 'phone' as kind, phone_e164 as key, array_agg(id order by created_at) as ids
        from leads
       where merged_into is null and phone_e164 is not null
       group by phone_e164
      having count(*) > 1
      union all
      select 'email', lower(email), array_agg(id order by created_at)
        from leads
       where merged_into is null and email is not null and email <> ''
       group by lower(email)
      having count(*) > 1
    `);

    return {
      summary: `${groups.rows.length} duplicate group(s)`,
      counts: {
        groups: groups.rows.length,
        leads: groups.rows.reduce((n, g) => n + g.ids.length, 0),
      },
    };
  },
};
