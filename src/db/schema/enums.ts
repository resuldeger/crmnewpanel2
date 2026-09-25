/* ── Postgres enums · mirror src/data.ts union types exactly ───────────── */
import { pgEnum } from "drizzle-orm/pg-core";

export const platformEnum = pgEnum("platform_t", [
  "instagram", "facebook", "tiktok", "google", "webform", "direct",
]);

/** Lead.status — lifecycle */
export const lifecycleEnum = pgEnum("lifecycle_t", ["new", "contacted", "qualified", "done"]);

/** Lead.callStatus — 14 values, the call-centre pipeline */
export const callStatusEnum = pgEnum("call_status_t", [
  "not_called", "no_answer", "busy", "interested", "not_interested",
  "callback_requested", "appointment_made", "already_scheduled", "didnt_pick_up",
  "wrong_number", "double_lead", "no_pn", "spam", "not_trusted",
]);

export const apptStatusEnum = pgEnum("appt_status_t", [
  "pending", "confirmed", "deposit_paid", "completed",
  "cancelled", "no_show", "rescheduled", "spam",
]);

export const callDirEnum = pgEnum("call_dir_t", ["inbound", "outbound"]);
export const callResultEnum = pgEnum("call_result_t", ["Answered", "Missed", "Voicemail", "Attempted"]);
export const numberKindEnum = pgEnum("number_kind_t", ["vonage", "twilio", "branch"]);

export const smsStatusEnum = pgEnum("sms_status_t", [
  "scheduled", "queued", "processing", "sent", "delivered",
  "received", "undelivered", "failed", "cancelled",
]);
export const channelEnum = pgEnum("channel_t", ["sms", "mms", "whatsapp", "email"]);

/** Outbound automation kinds — lead recovery + reminders (§F3) */
export const messageKindEnum = pgEnum("message_kind_t", [
  "lead_recovery_5m", "lead_recovery_2h", "lead_recovery_24h",
  "appointment_reminder_24h", "appointment_reminder_3h",
  "booking_confirmation", "winback", "campaign", "manual",
]);

export const campaignStatusEnum = pgEnum("campaign_status_t", ["draft", "scheduled", "sending", "sent", "failed"]);
export const taskStatusEnum = pgEnum("task_status_t", ["open", "done"]);
export const taskSourceEnum = pgEnum("task_source_t", ["callback", "voicemail", "manual", "follow_up", "sla_breach"]);
export const notableEnum = pgEnum("notable_t", ["lead", "appointment", "customer"]);

/** Who performed a side effect — staff member vs automation */
export const actorKindEnum = pgEnum("actor_kind_t", ["user", "system", "webhook", "worker", "import", "customer"]);

export const auditTargetEnum = pgEnum("audit_target_t", [
  "lead", "appointment", "customer", "task", "call", "campaign",
  "location", "staff", "role", "translation", "step_option", "session", "message",
  "setting",
]);

export const auditActionEnum = pgEnum("audit_action_t", [
  "created", "updated", "deleted", "status_change", "converted", "merged",
  "note_added", "sms_sent", "call_logged", "login", "logout",
  "exported", "permission_change", "assigned", "viewed_pii",
]);

/** Booking wizard steps — mirrors FormStep in the booking SPA */
export const bookingStepEnum = pgEnum("booking_step_t", [
  "welcome", "purpose", "style", "story", "body_area",
  "size", "timing", "contact", "address", "success",
]);

export const stepKeyEnum = pgEnum("step_key_t", ["purpose", "style", "story", "body_area", "size", "timing"]);

export const availabilitySourceEnum = pgEnum("availability_source_t", ["timely", "manual", "appointment", "holiday"]);

/** How a lead came into existence — the pipeline reads this to explain itself. */
export const leadSourceEnum = pgEnum("lead_source_t", [
  "abandoned_form",   // started the booking wizard, left contact info, never finished
  "completed_form",   // finished the wizard in one go — becomes an appointment immediately
  "meta_lead_ad",     // Meta/TikTok lead-ad webhook
  "inbound_call",     // rang the studio, no web form
  "manual",           // typed in by an agent
  "import",           // CSV / legacy migration
]);
