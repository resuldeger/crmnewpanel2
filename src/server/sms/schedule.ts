/* ── Automation scheduling ─────────────────────────────────────────────
 * Rows are written into scheduled_messages and drained by the worker.
 * The unique index on (kind, to, session, appointment) means calling any
 * of these twice is harmless — which matters, because the booking client
 * fires step updates on a debounce.
 * ────────────────────────────────────────────────────────────────── */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { scheduledMessages, bookingSessions, appointments, locations } from "@/db/schema";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Lead recovery ladder: 5 minutes, 2 hours, 24 hours after abandonment. */
export const RECOVERY_STEPS = [
  { kind: "lead_recovery_5m" as const, delay: 5 * MINUTE },
  { kind: "lead_recovery_2h" as const, delay: 2 * HOUR },
  { kind: "lead_recovery_24h" as const, delay: 24 * HOUR },
];

export async function scheduleLeadRecovery(sessionUuid: string): Promise<number> {
  const [row] = await db
    .select({ session: bookingSessions, studio: locations })
    .from(bookingSessions)
    .leftJoin(locations, eq(locations.id, bookingSessions.locationId))
    .where(eq(bookingSessions.sessionUuid, sessionUuid))
    .limit(1);

  const session = row?.session;
  if (!session?.phoneE164 || session.isCompleted || !session.locationId) return 0;
  // Don't restart the ladder every time the visitor types.
  if (session.recoveryScheduledAt) return 0;

  const now = Date.now();
  const rows = RECOVERY_STEPS.map((step) => ({
    kind: step.kind,
    sessionId: session.id,
    locationId: session.locationId!,
    toE164: session.phoneE164!,
    locale: session.locale,
    templateKey: step.kind,
    payload: {
      name: (session.fullName ?? "").split(" ")[0] ?? "",
      // Without this the template rendered "it's ." — the studio name is
      // the one thing that makes the message recognisable.
      studio: (row?.studio?.name ?? "Cleopatra Ink").replace(/^Cleopatra Ink\s+/i, ""),
      slug: session.locationSlug ?? row?.studio?.slug ?? "",
    },
    scheduledAt: new Date(now + step.delay),
  }));

  const inserted = await db
    .insert(scheduledMessages)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: scheduledMessages.id });

  await db
    .update(bookingSessions)
    .set({ recoveryScheduledAt: new Date() })
    .where(eq(bookingSessions.id, session.id));

  return inserted.length;
}

/** Reminders at 24h and 3h before the appointment starts. */
export async function scheduleAppointmentReminders(appointmentId: number): Promise<number> {
  const [row] = await db
    .select({ a: appointments, studio: locations })
    .from(appointments)
    .innerJoin(locations, eq(locations.id, appointments.locationId))
    .where(eq(appointments.id, appointmentId))
    .limit(1);

  if (!row?.a.phoneE164) return 0;

  const startsAt = row.a.startsAt.getTime();
  const now = Date.now();
  const shortName = row.studio.name.replace(/^Cleopatra Ink\s+/i, "");

  const candidates = [
    { kind: "appointment_reminder_24h" as const, at: startsAt - 24 * HOUR },
    { kind: "appointment_reminder_3h" as const, at: startsAt - 3 * HOUR },
  ]
    // A booking made for tomorrow morning has already missed its 24h mark;
    // scheduling it in the past would fire it immediately.
    .filter((c) => c.at > now + MINUTE);

  if (candidates.length === 0) return 0;

  const inserted = await db
    .insert(scheduledMessages)
    .values(
      candidates.map((c) => ({
        kind: c.kind,
        appointmentId: row.a.id,
        leadId: row.a.leadId,
        locationId: row.a.locationId,
        toE164: row.a.phoneE164!,
        locale: row.a.locale,
        templateKey: c.kind,
        payload: {
          name: row.a.name.split(" ")[0] ?? "",
          studio: shortName,
          date: row.a.preferredDate,
          time: String(row.a.preferredTime).slice(0, 5),
          uuid: row.a.bkUuid,
        },
        scheduledAt: new Date(c.at),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: scheduledMessages.id });

  return inserted.length;
}

/** Stops chasing someone who already booked, or whose booking is gone. */
export async function cancelScheduled(opts: {
  sessionId?: number;
  appointmentId?: number;
  toE164?: string;
  kinds?: ("lead_recovery_5m" | "lead_recovery_2h" | "lead_recovery_24h" | "appointment_reminder_24h" | "appointment_reminder_3h")[];
  reason: string;
}): Promise<number> {
  const filters = [eq(scheduledMessages.status, "scheduled")];
  if (opts.sessionId) filters.push(eq(scheduledMessages.sessionId, opts.sessionId));
  if (opts.appointmentId) filters.push(eq(scheduledMessages.appointmentId, opts.appointmentId));
  if (opts.toE164) filters.push(eq(scheduledMessages.toE164, opts.toE164));
  if (opts.kinds?.length) filters.push(inArray(scheduledMessages.kind, opts.kinds));

  const cancelled = await db
    .update(scheduledMessages)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: opts.reason })
    .where(and(...filters))
    .returning({ id: scheduledMessages.id });

  return cancelled.length;
}

void isNull;
