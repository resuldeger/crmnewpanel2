import { NextResponse, type NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { activityLog, integrations, webhookDeliveries, workspaceSettings } from "@/db/schema";
import { withAuth } from "@/server/auth/guard";
import { maskSecret } from "@/server/crm/mask";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Providers the console knows how to display, in order. */
const KNOWN = [
  { provider: "vonage", name: "Vonage VBC", keyLabel: "API Secret" },
  { provider: "twilio", name: "Twilio Programmable SMS", keyLabel: "Auth Token" },
  { provider: "timely", name: "Timely Booking Sync", keyLabel: "Partner Key" },
  { provider: "meta", name: "Meta Conversions API", keyLabel: "Access Token" },
  { provider: "google", name: "Google Ads Offline Conversions", keyLabel: "Developer Token" },
  { provider: "tiktok", name: "TikTok Events API", keyLabel: "Access Token" },
  { provider: "turnstile", name: "Cloudflare Turnstile", keyLabel: "Secret Key" },
];

/**
 * Integration status and the real webhook inbox.
 *
 * The Settings screen used to GENERATE plausible-looking API keys in the
 * browser ("TW-K7F2…") and invent a webhook event every six seconds. An
 * operator had no way to tell a configured integration from an empty one.
 * Secrets are never returned — only whether one exists.
 */
export const GET = withAuth("settings.manage", async () => {
  const [rows, deliveries, prefsRow] = await Promise.all([
    db.select().from(integrations),
    db.select({
      id: webhookDeliveries.id,
      provider: webhookDeliveries.provider,
      eventType: webhookDeliveries.eventType,
      signatureValid: webhookDeliveries.signatureValid,
      processed: webhookDeliveries.processed,
      error: webhookDeliveries.error,
      receivedAt: webhookDeliveries.receivedAt,
    }).from(webhookDeliveries).orderBy(desc(webhookDeliveries.id)).limit(20),
    db.select().from(workspaceSettings).where(eq(workspaceSettings.id, 1)).limit(1),
  ]);

  const byProvider = new Map(rows.map((r) => [r.provider, r]));

  return NextResponse.json(
    {
      integrations: KNOWN.map((k) => {
        const row = byProvider.get(k.provider);
        return {
          ...k,
          configured: Boolean(row?.secretEnc || row?.publicKey),
          enabled: row?.enabled ?? false,
          // Enough to recognise which credential is in place, never enough to use.
          secretPreview: maskSecret(row?.secretEnc) ?? null,
          publicKey: row?.publicKey ?? null,
          lastCheckedAt: row?.lastCheckedAt ?? null,
          lastStatus: row?.lastStatus ?? null,
          rotatedAt: row?.rotatedAt ?? null,
        };
      }),
      webhooks: deliveries,
      preferences: prefsRow[0] ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});

/* ── Writes ────────────────────────────────────────────────────────────
 * The Settings screen has always rendered toggles and inputs, but this
 * route was GET only, so every switch on it was decorative: flipping
 * "SMS automation" or changing the SLA target changed nothing and reverted
 * on reload.
 *
 * Secrets are deliberately NOT settable here. An API key belongs in the
 * environment or a secret store, not in a JSON body that ends up in logs
 * and browser history; this route only toggles an integration on or off.
 * ────────────────────────────────────────────────────────────────── */

interface SettingsPatch {
  default_date_range?: string;
  auto_assign?: boolean;
  auto_assign_strategy?: string;
  sms_sound?: boolean;
  daily_digest?: boolean;
  sla_target_minutes?: number;
  sla_escalate_minutes?: number;
  default_locale?: string;
  /** provider → enabled */
  integrations?: Record<string, boolean>;
}

const DATE_RANGES = ["today", "7d", "30d", "90d", "all"] as const;
const ASSIGN_STRATEGIES = ["round_robin", "least_busy", "manual"] as const;

export const PATCH = withAuth("settings.manage", async (user, req: NextRequest) => {
  const body = (await req.json().catch(() => ({}))) as SettingsPatch;

  const patch: Record<string, unknown> = {};
  const diff: Record<string, [unknown, unknown]> = {};

  const [existing] = await db.select().from(workspaceSettings).limit(1);

  const setIf = (column: string, next: unknown) => {
    if (next === undefined) return;
    const before = (existing as Record<string, unknown> | undefined)?.[column];
    if (before === next) return;
    patch[column] = next;
    diff[column] = [before, next];
  };

  if (body.default_date_range !== undefined) {
    if (!(DATE_RANGES as readonly string[]).includes(body.default_date_range)) {
      return NextResponse.json({ message: "Unknown date range" }, { status: 422 });
    }
    setIf("defaultDateRange", body.default_date_range);
  }

  if (body.auto_assign_strategy !== undefined) {
    if (!(ASSIGN_STRATEGIES as readonly string[]).includes(body.auto_assign_strategy)) {
      return NextResponse.json({ message: "Unknown assignment strategy" }, { status: 422 });
    }
    setIf("autoAssignStrategy", body.auto_assign_strategy);
  }

  /* The SLA target drives the breach alarm and the task the desk gets. A
     zero would fire on every lead the moment it lands; an hour would make
     the alarm useless. */
  for (const [value, column, label] of [
    [body.sla_target_minutes, "slaTargetMinutes", "SLA target"],
    [body.sla_escalate_minutes, "slaEscalateMinutes", "SLA escalation"],
  ] as const) {
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 1 || value > 1440) {
      return NextResponse.json({ message: `${label} must be 1–1440 minutes` }, { status: 422 });
    }
    setIf(column, value);
  }

  if (body.sla_target_minutes !== undefined && body.sla_escalate_minutes !== undefined
      && body.sla_escalate_minutes < body.sla_target_minutes) {
    return NextResponse.json(
      { message: "Escalation cannot come before the target it escalates" },
      { status: 422 },
    );
  }

  setIf("autoAssign", body.auto_assign);
  setIf("smsSound", body.sms_sound);
  setIf("dailyDigest", body.daily_digest);
  if (body.default_locale !== undefined) setIf("defaultLocale", body.default_locale.slice(0, 5));

  if (Object.keys(patch).length > 0) {
    patch.updatedAt = new Date();
    if (existing) {
      await db.update(workspaceSettings).set(patch).where(eq(workspaceSettings.id, existing.id));
    } else {
      await db.insert(workspaceSettings).values(patch as typeof workspaceSettings.$inferInsert);
    }
  }

  /* Enabling an integration that has no credentials would look configured
     and silently do nothing, so it is refused with the reason. */
  const toggled: string[] = [];
  for (const [provider, enabled] of Object.entries(body.integrations ?? {})) {
    const [row] = await db.select().from(integrations).where(eq(integrations.provider, provider)).limit(1);
    if (!row) {
      return NextResponse.json({ message: `Unknown integration: ${provider}` }, { status: 422 });
    }
    if (enabled && !row.secretEnc) {
      return NextResponse.json(
        { message: `${provider} has no credentials yet — add them to the environment first` },
        { status: 409 },
      );
    }
    if (row.enabled === enabled) continue;
    await db.update(integrations).set({ enabled, updatedAt: new Date() }).where(eq(integrations.id, row.id));
    toggled.push(`${provider}=${enabled ? "on" : "off"}`);
  }

  if (Object.keys(diff).length === 0 && toggled.length === 0) {
    return NextResponse.json({ changed: false });
  }

  await db.insert(activityLog).values({
    actorKind: "user",
    actorStaffId: user.id,
    actorName: user.name,
    actorRoleId: user.roleId,
    targetType: "setting",
    targetId: "workspace",
    targetLabel: "Workspace settings",
    action: "updated",
    diff,
    summary: [Object.keys(diff).join(", "), toggled.join(", ")].filter(Boolean).join(" · "),
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ changed: true, toggled });
});
