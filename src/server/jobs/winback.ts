import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { appointments, scheduledMessages, locations } from "@/db/schema";
import type { Job, JobResult } from "./types";

/**
 * Win-back: a cancellation 30 days ago is worth one more approach.
 *
 * Queued rather than sent directly, so it goes through the same opt-out
 * check, throttle and audit trail as everything else outbound.
 */
export const winback: Job = {
  name: "winback",
  everyMs: 12 * 60 * 60_000,
  skipOnBoot: true,

  async run(): Promise<JobResult> {
    const from = new Date(Date.now() - 31 * 86_400_000);
    const to = new Date(Date.now() - 30 * 86_400_000);

    const candidates = await db
      .select({
        id: appointments.id,
        name: appointments.name,
        phone: appointments.phoneE164,
        locale: appointments.locale,
        locationId: appointments.locationId,
        studio: locations.name,
      })
      .from(appointments)
      .innerJoin(locations, eq(locations.id, appointments.locationId))
      .where(
        and(
          eq(appointments.status, "cancelled"),
          gte(appointments.cancelledAt, from),
          lte(appointments.cancelledAt, to),
          sql`${appointments.phoneE164} is not null`,
          // Skip anyone who has booked again since. The row must exclude
          // itself: a cancelled booking is always created before it is
          // cancelled, so without this every candidate matched its own
          // record and the job found nobody.
          sql`not exists (
            select 1 from appointments later
             where later.phone_e164 = ${appointments.phoneE164}
               and later.id <> ${appointments.id}
               and later.created_at > ${appointments.cancelledAt}
          )`,
        ),
      )
      .limit(100);

    if (candidates.length === 0) return { summary: "no candidates", counts: { queued: 0 } };

    const queued = await db
      .insert(scheduledMessages)
      .values(
        candidates.map((c) => ({
          kind: "winback" as const,
          appointmentId: c.id,
          locationId: c.locationId,
          toE164: c.phone!,
          locale: c.locale,
          templateKey: "winback",
          payload: {
            name: c.name.split(" ")[0] ?? "",
            studio: c.studio.replace(/^Cleopatra Ink\s+/i, ""),
          },
          scheduledAt: new Date(),
        })),
      )
      .onConflictDoNothing()
      .returning({ id: scheduledMessages.id });

    return { summary: `${candidates.length} cancelled 30d ago`, counts: { queued: queued.length } };
  },
};
