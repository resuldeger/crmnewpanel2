import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog } from "@/db/schema";
import { withAuth } from "@/server/auth/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ── Who may read which part of the trail ──────────────────────────────
 * The audit trail spans far more than leads: it records staff accounts,
 * role changes and settings edits. Guarding the whole route with
 * `leads.view` therefore handed the staff and settings history to anyone
 * who could open the leads list. Each target type now names the permission
 * that governs the thing it describes, and a caller sees only the types
 * they already hold. Unlisted types fall back to `leads.view`, which the
 * route guard has already established.
 * ────────────────────────────────────────────────────────────────── */
const TARGET_PERMISSION: Record<string, string> = {
  lead: "leads.view",
  appointment: "appts.view",
  customer: "customers.view",
  task: "calls.view",
  call: "calls.view",
  campaign: "sms.view",
  message: "sms.view",
  session: "leads.view",
  location: "studios.view",
  step_option: "studios.view",
  translation: "settings.manage",
  staff: "staff.view",
  role: "staff.view",
  setting: "settings.manage",
};

/* Straight from the query string into a Postgres enum comparison, an
   unknown value is not an empty result but `invalid input value for enum
   audit_target_t`, i.e. a 500 any visitor can trigger with ?targetType=x. */
const TARGET_TYPES = Object.keys(TARGET_PERMISSION) as AuditTarget[];
type AuditTarget = (typeof activityLog.targetType)["_"]["data"];

/**
 * Fetch audit logs filtered by targetType, targetId, customerId, or location.
 */
export const GET = withAuth("leads.view", async (user, req: NextRequest) => {
  const url = req.nextUrl;
  const targetType = url.searchParams.get("targetType") ?? url.searchParams.get("target_type");
  const targetId = url.searchParams.get("targetId") ?? url.searchParams.get("target_id");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));

  const conditions = [];

  const visible = TARGET_TYPES.filter((t) => user.permissions.includes(TARGET_PERMISSION[t]));

  if (targetType) {
    if (!TARGET_TYPES.includes(targetType as AuditTarget)) {
      return NextResponse.json({ message: "Unknown target type" }, { status: 400 });
    }
    if (!visible.includes(targetType as AuditTarget)) {
      return NextResponse.json({ message: "Not allowed to read this part of the trail" }, { status: 403 });
    }
    conditions.push(eq(activityLog.targetType, targetType as AuditTarget));
  } else {
    // No filter asked for: return every type the caller is entitled to.
    if (visible.length === 0) return NextResponse.json({ logs: [] });
    conditions.push(inArray(activityLog.targetType, visible));
  }

  if (targetId) {
    // If targetId contains multiple comma-separated IDs (e.g. for customer leadIds/apptIds)
    const ids = targetId.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 1) {
      conditions.push(eq(activityLog.targetId, ids[0]));
    } else if (ids.length > 1) {
      conditions.push(inArray(activityLog.targetId, ids));
    }
  }

  // Branch scope check: if user is not scopeAll, limit to user's locationIds
  if (!user.scopeAll) {
    if (user.locationIds.length === 0) {
      return NextResponse.json({ logs: [] });
    }
    /* A null location means the event is not tied to a branch — a settings
       or role change. Those stay visible because the target-type check
       above already decided whether this caller may see that kind at all. */
    conditions.push(
      or(
        inArray(activityLog.locationId, user.locationIds),
        sql`${activityLog.locationId} is null`,
      ),
    );
  }

  const rows = await db
    .select({
      id: activityLog.id,
      targetType: activityLog.targetType,
      targetId: activityLog.targetId,
      action: activityLog.action,
      fromStatus: activityLog.fromValue,
      toStatus: activityLog.toValue,
      actor: activityLog.actorName,
      actorRole: activityLog.actorRoleId,
      details: activityLog.summary,
      at: activityLog.at,
    })
    .from(activityLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(activityLog.id))
    .limit(limit);

  return NextResponse.json(
    { logs: rows },
    { headers: { "Cache-Control": "no-store" } },
  );
});
