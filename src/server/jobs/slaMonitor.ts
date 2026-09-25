import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { leads, tasks, notifications, staff, locationScopes, workspaceSettings, realtimeEvents } from "@/db/schema";
import type { Job, JobResult } from "./types";

/**
 * Speed-to-lead watchdog.
 *
 * A lead that nobody has called within the SLA window is the single most
 * expensive thing in this business: the console shows a badge counting up,
 * but a badge only helps someone already looking at the screen. This turns
 * the breach into a task with an owner and tells the branch manager.
 */
export const slaMonitor: Job = {
  name: "sla-monitor",
  everyMs: 5 * 60_000,

  async run(): Promise<JobResult> {
    const [prefs] = await db.select().from(workspaceSettings).where(eq(workspaceSettings.id, 1)).limit(1);
    const targetMinutes = prefs?.slaTargetMinutes ?? 15;
    const escalateMinutes = prefs?.slaEscalateMinutes ?? 60;

    const cutoff = new Date(Date.now() - targetMinutes * 60_000);

    const breached = await db
      .select({
        id: leads.id,
        name: leads.name,
        phone: leads.phoneE164,
        locationId: leads.locationId,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .where(
        and(
          eq(leads.callStatus, "not_called"),
          isNull(leads.mergedInto),
          isNull(leads.convertedAt),
          isNull(leads.firstCalledAt),
          lt(leads.createdAt, cutoff),
          // Somebody with no number cannot be called; that is a data
          // problem, not an SLA breach, and it has its own status.
          sql`${leads.phoneE164} is not null`,
        ),
      )
      .limit(200);

    if (breached.length === 0) return { summary: "no breaches", counts: { breached: 0 } };

    let tasksCreated = 0;
    let escalated = 0;

    for (const lead of breached) {
      const ageMinutes = Math.floor((Date.now() - lead.createdAt.getTime()) / 60_000);

      // The partial unique index on (lead_id, source) makes this idempotent:
      // one follow-up task per lead, however many times this job runs.
      const inserted = await db
        .insert(tasks)
        .values({
          title: `Uncalled for ${ageMinutes} min — call now`,
          leadId: lead.id,
          leadName: lead.name,
          phoneE164: lead.phone,
          locationId: lead.locationId,
          dueAt: new Date(),
          source: "sla_breach",
        })
        .onConflictDoNothing()
        .returning({ id: tasks.id });

      if (inserted.length === 0) {
        // Already flagged. Escalate once it crosses the second threshold.
        if (ageMinutes >= escalateMinutes) escalated += await notifyManagers(lead, ageMinutes);
        continue;
      }

      tasksCreated += 1;
      await db.insert(realtimeEvents).values({
        channel: "leads:live",
        topic: "lead.sla_breach",
        locationId: lead.locationId,
        requiredPermission: "leads.view",
        payload: { leadId: lead.id, name: lead.name, ageMinutes },
      });
    }

    return {
      summary: `${breached.length} lead(s) past ${targetMinutes}m`,
      counts: { breached: breached.length, tasks: tasksCreated, escalated },
    };
  },
};

/** Tells whoever can act on this studio, once per escalation. */
async function notifyManagers(
  lead: { id: string; name: string; locationId: number },
  ageMinutes: number,
): Promise<number> {
  const recipients = await db
    .select({ id: staff.id })
    .from(staff)
    .leftJoin(locationScopes, eq(locationScopes.staffId, staff.id))
    .where(
      and(
        eq(staff.active, true),
        sql`(${staff.scopeAll} = true or ${locationScopes.locationId} = ${lead.locationId})`,
        sql`${staff.roleId} in ('super_admin','hq_admin','branch_manager','studio_admin')`,
      ),
    );

  const unique = [...new Set(recipients.map((r) => r.id))];
  if (unique.length === 0) return 0;

  const inserted = await db
    .insert(notifications)
    .values(
      unique.map((staffId) => ({
        staffId,
        kind: "sla_escalation",
        title: `${lead.name} has waited ${ageMinutes} minutes`,
        body: "Nobody has called this lead yet.",
        href: `/admin/lead/${lead.id}`,
        severity: "warning",
      })),
    )
    .onConflictDoNothing()
    .returning({ id: notifications.id });

  return inserted.length;
}
