/* ── Cleopatra Ink CRM · data model + seed ─────────────────────────────── */
let _id = 90_000;
export const nextId = () => ++_id;

export type Platform = "instagram" | "facebook" | "tiktok" | "google" | "webform" | "direct";
export type CallStatus =
  | "not_called" | "no_answer" | "busy" | "interested" | "not_interested"
  | "callback_requested" | "appointment_made" | "already_scheduled" | "didnt_pick_up"
  | "wrong_number" | "double_lead" | "no_pn" | "spam" | "not_trusted";
export type ApptStatus = "pending" | "confirmed" | "deposit_paid" | "completed" | "cancelled" | "no_show" | "rescheduled" | "spam";
export type CallResult = "Answered" | "Missed" | "Voicemail" | "Attempted";
export type NumberKind = "vonage" | "twilio" | "branch";

export interface LeadMeta {
  purpose: string; style: string; storyType: string; story: string; size: string;
  bodyAreas: string[]; referenceImages: string[]; language: string; consent: boolean;
}
export interface LeadAttr {
  platform: Platform; utmSource: string; utmMedium: string; utmCampaign: string | null;
  gclid: string | null; fbclid: string | null; ttclid: string | null; landingPage: string;
  matchMethod?: string;
}
export interface Lead {
  id: string; customerId: string; name: string; email: string; formattedPhone: string; locationId: number;
  status: "new" | "contacted" | "done"; callStatus: CallStatus;
  lastCalledAt: string | null; createdAt: string; unsubscribedAt: string | null; isDuplicate: boolean;
  /** How many calls this lead has had, counted in the database with the row. */
  voiceCalls: number;
  meta: LeadMeta; attr: LeadAttr;
}
export interface Appointment {
  id: number; uuid: string; customerId: string; leadId?: string | null; name: string; email: string; formattedPhone: string;
  locationId: number; purpose: string; style: string; storyType: string; story: string; size: string;
  bodyAreas: string[]; referenceImage: string | null; preferredDate: string; preferredTime: string;
  status: ApptStatus; isFreePick: boolean; language: string; createdAt: string;
  platform: Platform; campaign: string | null; consent: boolean;
  /* BookNow export extras */
  cancelReason?: string | null; userTimezone?: string; voiceCalls?: number; streetAddress?: string;
  /** UTC instant of the slot — the only unambiguous reading. */
  startsAt?: string;
  /** IANA zone the studio runs on, for labelling its own clock. */
  displayTimezone?: string;
}
export interface CallLog {
  id: number; direction: "inbound" | "outbound"; fromNumber: string; toNumber: string;
  fromName: string; toName: string; customerId: string | null; appointmentId: number | null;
  locationId: number; startTime: string; duration: number; result: CallResult;
  hasRecording: boolean; agent: string; ext: string;
}
export interface SmsMessage {
  id: number; direction: "inbound" | "outbound"; body: string; at: string;
  /* "queued" is where an outbound message sits until the carrier's status
     webhook confirms it. Handing Twilio a message is not delivery, and the
     console used to skip straight to "delivered" without sending at all. */
  status: "queued" | "sent" | "delivered" | "received" | "failed";
  senderType?: "system" | "agent";
  senderName?: string;
  fromNumber?: string;
  toNumber?: string;
  mediaUrl?: string;
}
export interface Conversation {
  id: number; phone: string; customerId: string | null; customerName: string; locationId: number;
  unreadCount: number; unsubscribed: boolean; messages: SmsMessage[];
}
export interface Note { id: number; author: string; notableType: "lead" | "appointment" | "customer"; notableId: string; content: string; createdAt: string; }

export interface AuditLog {
  id: number;
  targetType: "lead" | "appointment" | "customer" | "task" | "call" | "campaign";
  targetId: string;
  action: "status_change" | "created" | "converted" | "merged" | "updated" | "note_added" | "sms_sent" | "call_logged";
  fromStatus?: string;
  toStatus?: string;
  actor: string;
  actorRole?: string;
  details?: string;
  at: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  locationId: number;
  language: string;
  firstTouchAt: string;
  lastActiveAt: string;
  leadCount: number;
  apptCount: number;
  completedApptCount: number;
  totalCalls: number;
  totalSms: number;
  stage: "lead" | "booked" | "completed" | "vip" | "churned";
  leadIds: string[];
  apptIds: number[];
  primaryAttr?: LeadAttr;
}

export interface DayHours { enabled: boolean; open: string; close: string; }
export interface StudioConfig {
  bookingSlug: string; publicPhone: string; latitude: number; longitude: number;
  gtmCountry: string; gtmCityState: string; mapsUrl: string; timezone: string; ianaTimezone: string;
  displayOrder: number; bookingInterval: number;
  /** Concurrent appointments per slot. See StudioEdit for the trade-off. */
  slotCapacity: number; enableOnlineBooking: boolean;
  socials: { instagram: string; facebook: string; tiktok: string; twitter: string; youtube: string };
  twilio: { accountSid: string; authToken: string; messagingSid: string; specificPhone: string; smsAutomation: boolean };
  vonage: { did: string; extension: string };
  mail: { enabled: boolean; senderName: string; senderEmail: string; smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string };
  businessHours: Record<string, DayHours>;
}
export interface Studio {
  id: number; name: string; slug: string; phone: string; email: string; address: string;
  city: string; state: string; country: string; gtmCountry: string; timezone: string;
  bookingActive: boolean; manager: string; hours: string; config: StudioConfig;
  image?: string; accent: string;
}
export interface Artist { id: number; name: string; instagram: string; specialties: string[]; locationIds: number[]; active: boolean; bio: string; }
export interface Extension { id: number; extension: string; displayName: string; username: string; phoneNumber: string; locationId: number | null; }
export interface Role { id: string; name: string; desc: string; color: string; system?: boolean; }
export interface Permission { id: string; label: string; group: string; }
export interface StaffMember { id: number; name: string; email: string; roleId: string; locationIds: number[] | "all"; active: boolean; lastActiveAt: string; }
export interface StudioNumber { id: number; studioId: number; kind: NumberKind; label: string; number: string; smsCapable: boolean; }
export interface Campaign {
  id: number; name: string;
  segment: { locationId: number | "all"; status: CallStatus | "all"; platform: Platform | "all" };
  body: string; scheduledAt: string;
  status: "draft" | "scheduled" | "sending" | "sent";
  total: number; delivered: number; failed: number; replied: number; createdAt: string;
}
export interface TaskItem {
  id: number; title: string; leadId: string | null; leadName: string; phone: string;
  locationId: number; assignee: string; dueAt: string; createdAt: string;
  status: "open" | "done"; doneAt: string | null; source: "callback" | "voicemail" | "manual";
}

/* ── display metadata ──────────────────────────────────────────────────── */
export const PLATFORM_META: Record<Platform, { label: string; color: string }> = {
  instagram: { label: "Instagram", color: "#e1589a" },
  facebook: { label: "Facebook", color: "#4c8dff" },
  tiktok: { label: "TikTok", color: "#5fd6c9" },
  google: { label: "Google Ads", color: "#e8a33d" },
  webform: { label: "Web Form", color: "#9b6bff" },
  direct: { label: "Direct / Organic", color: "#948d7d" },
};
export const CALL_STATUS_META: Record<CallStatus, { label: string; color: string }> = {
  not_called: { label: "Not Called", color: "#948d7d" },
  no_answer: { label: "No Answer", color: "#e8a33d" },
  busy: { label: "Busy", color: "#e8a33d" },
  interested: { label: "Interested", color: "#2fbf71" },
  not_interested: { label: "Not Interested", color: "#e5484d" },
  callback_requested: { label: "Callback Requested", color: "#4c8dff" },
  appointment_made: { label: "Appointment Made", color: "#1e9e5c" },
  already_scheduled: { label: "Already Scheduled", color: "#7c4fe0" },
  didnt_pick_up: { label: "Didn't Pick Up", color: "#e5484d" },
  wrong_number: { label: "Wrong Number", color: "#948d7d" },
  double_lead: { label: "Double Lead", color: "#e8a33d" },
  no_pn: { label: "No Phone Number", color: "#948d7d" },
  spam: { label: "Spam", color: "#e5484d" },
  not_trusted: { label: "Not Trusted", color: "#e5484d" },
};
export const APPT_STATUS_META: Record<ApptStatus, { label: string; color: string }> = {
  pending: { label: "Pending", color: "#e8a33d" },
  confirmed: { label: "Confirmed", color: "#2fbf71" },
  deposit_paid: { label: "Deposit Paid", color: "#1e9e5c" },
  completed: { label: "Completed", color: "#77715f" },
  cancelled: { label: "Cancelled", color: "#e5484d" },
  no_show: { label: "No-Show", color: "#d93a40" },
  rescheduled: { label: "Rescheduled", color: "#4c8dff" },
  spam: { label: "Spam", color: "#e5484d" },
};
export const RESULT_META: Record<CallResult, { color: string }> = {
  Answered: { color: "#2fbf71" },
  Voicemail: { color: "#e8a33d" },
  Missed: { color: "#e5484d" },
  Attempted: { color: "#948d7d" },
};
export const NUMBER_KIND_META: Record<NumberKind, { label: string; color: string }> = {
  vonage: { label: "Vonage VBC", color: "#2fbf71" },
  twilio: { label: "Twilio SMS", color: "#4c8dff" },
  branch: { label: "Branch Line", color: "#e8a33d" },
};

/* ── RBAC ──────────────────────────────────────────────────────────────── */
export type PermId = (typeof PERMISSIONS)[number]["id"];

export const ROLES: Role[] = [
  { id: "super_admin", name: "Super Admin", desc: "Full console access incl. system settings", color: "#d97f00", system: true },
  { id: "hq_admin", name: "HQ Admin", desc: "Operations across every branch", color: "#e1589a" },
  { id: "branch_manager", name: "Branch Manager", desc: "Own branch: leads, bookings, campaigns", color: "#2f6fe4" },
  { id: "studio_admin", name: "Studio Admin", desc: "Studio config + front-desk operations", color: "#2fbf71" },
  { id: "callcenter_agent", name: "Callcenter Agent", desc: "Calling queue, SMS follow-ups, tasks", color: "#7c4fe0" },
  { id: "viewer", name: "Viewer", desc: "Read-only dashboards and reports", color: "#948d7d" },
];
export const PERMISSIONS: Permission[] = [
  { id: "customers.view", label: "View customer directory & 360 profile", group: "Customers" },
  { id: "customers.edit", label: "Manage customer profile & notes", group: "Customers" },
  { id: "leads.view", label: "View leads", group: "Leads" },
  { id: "leads.edit", label: "Update call status & notes", group: "Leads" },
  { id: "leads.convert", label: "Convert lead to appointment", group: "Leads" },
  { id: "leads.export", label: "Export lead data", group: "Leads" },
  { id: "leads.merge", label: "Merge duplicates", group: "Leads" },
  { id: "appts.view", label: "View appointments", group: "Appointments" },
  { id: "appts.edit", label: "Manage appointment status", group: "Appointments" },
  { id: "sms.view", label: "View SMS threads", group: "Messaging" },
  { id: "sms.send", label: "Send SMS messages", group: "Messaging" },
  { id: "sms.campaign", label: "Run bulk campaigns", group: "Messaging" },
  { id: "calls.view", label: "View call history", group: "Call Center" },
  { id: "calls.manage", label: "Manage calls & tasks", group: "Call Center" },
  { id: "reports.view", label: "View reports", group: "Reports" },
  { id: "studios.view", label: "View studios", group: "Studios" },
  { id: "studios.edit", label: "Edit studio configuration", group: "Studios" },
  { id: "staff.view", label: "View staff directory", group: "Staff" },
  { id: "staff.manage", label: "Manage staff & roles", group: "Staff" },
  { id: "settings.manage", label: "Integrations & API keys", group: "Settings" },
];
const ALL = PERMISSIONS.map(p => p.id);
export const DEFAULT_MATRIX: Record<string, string[]> = {
  super_admin: ALL,
  hq_admin: ALL.filter(p => p !== "settings.manage"),
  branch_manager: ["customers.view", "customers.edit", "leads.view", "leads.edit", "leads.convert", "leads.export", "leads.merge", "appts.view", "appts.edit", "sms.view", "sms.send", "sms.campaign", "calls.view", "calls.manage", "reports.view", "studios.view", "staff.view"],
  studio_admin: ["customers.view", "customers.edit", "leads.view", "leads.edit", "leads.convert", "appts.view", "appts.edit", "sms.view", "sms.send", "calls.view", "reports.view", "studios.view", "studios.edit", "staff.view"],
  callcenter_agent: ["customers.view", "customers.edit", "leads.view", "leads.edit", "appts.view", "sms.view", "sms.send", "calls.view", "calls.manage"],
  viewer: ["customers.view", "leads.view", "appts.view", "sms.view", "calls.view", "reports.view", "studios.view", "staff.view"],
};

/* ── helpers ───────────────────────────────────────────────────────────── */
export const iso = (daysAgo: number, h = 12, m = 0) => {
  const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0);
  return d.toISOString();
};
export const prettyPhone = (p: string) => p || "";
export const initials = (name: string) => name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
export const hueFor = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
export const fmtDur = (s: number) => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
export const fmtDT = (isoStr: string) => new Date(isoStr).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
export const fmtD = (isoStr: string) => new Date(isoStr).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
export const timeAgo = (isoStr: string) => {
  const s = Math.max(0, (Date.now() - +new Date(isoStr)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
};

/* ── Studio Registry (Populated dynamically on bootstrap) ───────────────── */
let studioRegistry: Studio[] = [];
export const setStudioRegistry = (studios: Studio[]) => { studioRegistry = studios; };
export const studioById = (id: number) => studioRegistry.find(s => s.id === id);
export const shortId = (id: string) => (id.length > 14 ? `${id.slice(0, 8)}…` : id);

export const EXTENSIONS: Extension[] = [
  { id: 1, extension: "400", displayName: "Callcenter Main", username: "Cleo.Callcenter0", phoneNumber: "+18335550100", locationId: null },
  { id: 2, extension: "401", displayName: "Callcenter Line 2", username: "Cleo.Callcenter1", phoneNumber: "+18335550101", locationId: null },
  { id: 3, extension: "402", displayName: "Callcenter Line 3", username: "Cleo.Callcenter2", phoneNumber: "+18335550102", locationId: null },
  { id: 4, extension: "403", displayName: "Callcenter Line 4", username: "Cleo.Callcenter3", phoneNumber: "+18335550103", locationId: null },
];

/* ── Country Options ────────────────────────────────────────────────────── */
export interface CountryOption { code: string; name: string; flag: string }

export const COUNTRIES: CountryOption[] = [
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "CA", name: "Canada", flag: "🇨🇦" },
  { code: "MX", name: "Mexico", flag: "🇲🇽" },
  { code: "TR", name: "Türkiye", flag: "🇹🇷" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "IE", name: "Ireland", flag: "🇮🇪" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "AT", name: "Austria", flag: "🇦🇹" },
  { code: "CH", name: "Switzerland", flag: "🇨🇭" },
  { code: "NL", name: "Netherlands", flag: "🇳🇱" },
  { code: "BE", name: "Belgium", flag: "🇧🇪" },
  { code: "FR", name: "France", flag: "🇫🇷" },
  { code: "ES", name: "Spain", flag: "🇪🇸" },
  { code: "PT", name: "Portugal", flag: "🇵🇹" },
  { code: "IT", name: "Italy", flag: "🇮🇹" },
  { code: "PL", name: "Poland", flag: "🇵🇱" },
  { code: "CZ", name: "Czechia", flag: "🇨🇿" },
  { code: "SE", name: "Sweden", flag: "🇸🇪" },
  { code: "NO", name: "Norway", flag: "🇳🇴" },
  { code: "DK", name: "Denmark", flag: "🇩🇰" },
  { code: "FI", name: "Finland", flag: "🇫🇮" },
  { code: "GR", name: "Greece", flag: "🇬🇷" },
  { code: "RO", name: "Romania", flag: "🇷🇴" },
  { code: "AE", name: "United Arab Emirates", flag: "🇦🇪" },
  { code: "AU", name: "Australia", flag: "🇦🇺" },
];

/** Accepts "USA", "US", "united states" — returns the canonical entry. */
export const countryByAny = (v: string | null | undefined): CountryOption | undefined => {
  const q = (v ?? "").trim().toLowerCase();
  if (!q) return undefined;
  return COUNTRIES.find(
    c => c.name.toLowerCase() === q || c.code.toLowerCase() === q || (q === "usa" && c.code === "US"),
  );
};

