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
  id: string; name: string; email: string; formattedPhone: string; locationId: number;
  status: "new" | "contacted" | "done"; callStatus: CallStatus;
  lastCalledAt: string | null; createdAt: string; unsubscribedAt: string | null; isDuplicate: boolean;
  meta: LeadMeta; attr: LeadAttr;
}
export interface Appointment {
  id: number; uuid: string; customerId: string | null; name: string; email: string; formattedPhone: string;
  locationId: number; purpose: string; style: string; storyType: string; story: string; size: string;
  bodyAreas: string[]; referenceImage: string | null; preferredDate: string; preferredTime: string;
  status: ApptStatus; isFreePick: boolean; language: string; createdAt: string;
  platform: Platform; campaign: string | null; consent: boolean;
  /* BookNow export extras */
  cancelReason?: string | null; userTimezone?: string; voiceCalls?: number; streetAddress?: string;
}
export interface CallLog {
  id: number; direction: "inbound" | "outbound"; fromNumber: string; toNumber: string;
  fromName: string; toName: string; customerId: string | null; appointmentId: number | null;
  locationId: number; startTime: string; duration: number; result: CallResult;
  hasRecording: boolean; agent: string; ext: string;
}
export interface SmsMessage {
  id: number; direction: "inbound" | "outbound"; body: string; at: string;
  status: "sent" | "delivered" | "received" | "failed"; mediaUrl?: string;
}
export interface Conversation {
  id: number; phone: string; customerId: string | null; customerName: string; locationId: number;
  unreadCount: number; unsubscribed: boolean; messages: SmsMessage[];
}
export interface Note { id: number; author: string; notableType: "lead" | "appointment"; notableId: string; content: string; createdAt: string; }

export interface DayHours { enabled: boolean; open: string; close: string; }
export interface StudioConfig {
  bookingSlug: string; publicPhone: string; latitude: number; longitude: number;
  gtmCountry: string; gtmCityState: string; mapsUrl: string; timezone: string; ianaTimezone: string;
  displayOrder: number; bookingInterval: number; enableOnlineBooking: boolean;
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
  branch_manager: ["leads.view", "leads.edit", "leads.convert", "leads.export", "leads.merge", "appts.view", "appts.edit", "sms.view", "sms.send", "sms.campaign", "calls.view", "calls.manage", "reports.view", "studios.view", "staff.view"],
  studio_admin: ["leads.view", "leads.edit", "leads.convert", "appts.view", "appts.edit", "sms.view", "sms.send", "calls.view", "reports.view", "studios.view", "studios.edit", "staff.view"],
  callcenter_agent: ["leads.view", "leads.edit", "appts.view", "sms.view", "sms.send", "calls.view", "calls.manage"],
  viewer: ["leads.view", "appts.view", "sms.view", "calls.view", "reports.view", "studios.view", "staff.view"],
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

const bh = (open = "10:30", close = "19:30", enabled = true): DayHours => ({ enabled, open, close });
const hours7 = (sun = false): Record<string, DayHours> => ({
  monday: bh(), tuesday: bh(), wednesday: bh(), thursday: bh(), friday: bh(), saturday: bh("11:00", "18:00"), sunday: bh("12:00", "17:00", sun),
});

/* ── studios ───────────────────────────────────────────────────────────── */
const mkStudio = (
  id: number, city: string, country: string, tz: string, iana: string, order: number,
  ext: string, did: string, overrides: Partial<Studio> = {},
): Studio => ({
  id, name: `Cleopatra Ink ${city}`, slug: city.toLowerCase(),
  phone: did, email: `${city.toLowerCase()}@cleopatraink.com`,
  address: `${120 + id * 37} Main St, ${city}`, city, state: "", country, gtmCountry: country,
  timezone: tz, bookingActive: true, manager: "", hours: "Mon–Sat · 10:30–19:30", accent: "#fba200",
  config: {
    bookingSlug: city.toLowerCase(), publicPhone: did,
    latitude: 33.7 + id * 0.4, longitude: -84.3 - id * 0.3,
    gtmCountry: country, gtmCityState: `${city}_110${id}`,
    mapsUrl: `https://maps.app.goo.gl/cleo${city.toLowerCase()}`,
    timezone: tz, ianaTimezone: iana, displayOrder: order, bookingInterval: 30, enableOnlineBooking: true,
    socials: {
      instagram: `https://www.instagram.com/cleopatraink${city.toLowerCase()}`,
      facebook: `https://www.facebook.com/cleopatraink${city.toLowerCase()}`,
      tiktok: `https://www.tiktok.com/@cleopatraink${city.toLowerCase()}`,
      twitter: "", youtube: "",
    },
    twilio: {
      accountSid: `AC${"a1b2c3d4e5".repeat(3).slice(0, 32)}`, authToken: `••••••••••••${id}••••`,
      messagingSid: `MG${(7300 + id * 11).toString(36)}k2m4n6p8q0r2s4t6u8v0w2x4y6`.slice(0, 34),
      specificPhone: `+1470276${(4000 + id).toString().slice(-4)}`, smsAutomation: true,
    },
    vonage: { did, extension: ext },
    mail: {
      enabled: true, senderName: `Cleopatra Ink ${city}`, senderEmail: `${city.toLowerCase()}@cleopatraink.com`,
      smtpHost: "smtp.gmail.com", smtpPort: 587, smtpUser: `${city.toLowerCase()}@cleopatraink.com`, smtpPass: `app-pass-${id}`,
    },
    businessHours: hours7(),
  },
  ...overrides,
});

export const STUDIOS: Studio[] = [
  mkStudio(1, "Atlanta", "USA", "Eastern Standard Time", "America/New_York", 10, "404", "+14703440356", { manager: "Dana Whitfield", state: "GA", accent: "#fba200", image: "https://image.qwenlm.ai/generated-images/3ce6e4f5-41d6-4094-9cd2-d5b68a6d8ad2/_result.png" }),
  mkStudio(2, "Miami", "USA", "Eastern Standard Time", "America/New_York", 20, "405", "+17865550192", { manager: "Luis Ortega", state: "FL", accent: "#5fd6c9", image: "https://image.qwenlm.ai/generated-images/08cc75da-93b7-48df-b7e1-cf4fd55bc11f/_result.png" }),
  mkStudio(3, "Dallas", "USA", "Central Standard Time", "America/Chicago", 30, "406", "+12145550138", { manager: "Kayla Brooks", state: "TX", accent: "#e8a33d" }),
  mkStudio(4, "Denver", "USA", "Mountain Standard Time", "America/Denver", 40, "407", "+17205550171", { manager: "Owen Pierce", state: "CO", accent: "#4c8dff" }),
  mkStudio(5, "Istanbul", "Türkiye", "GMT+3", "Europe/Istanbul", 50, "486", "+902125550146", { manager: "Elif Aydın", hours: "Mon–Sat · 11:00–20:00", accent: "#d4af37", image: "https://image.qwenlm.ai/generated-images/8354d58d-cf23-4dcf-82d5-d8911b1dd425/_result.png" }),
  mkStudio(6, "Ankara", "Türkiye", "GMT+3", "Europe/Istanbul", 60, "487", "+903125550163", { manager: "Burak Şahin", accent: "#e5484d" }),
  mkStudio(7, "London", "UK", "Greenwich Mean Time", "Europe/London", 70, "421", "+44205550118", { manager: "Harriet Cole", accent: "#9b6bff", image: "https://image.qwenlm.ai/generated-images/9b19e546-60a5-4a30-91fd-316d11b4e317/_result.png" }),
  mkStudio(8, "Berlin", "Germany", "Central European Time", "Europe/Berlin", 80, "422", "+49305550127", { manager: "Jonas Weber", bookingActive: false, accent: "#948d7d", image: "https://image.qwenlm.ai/generated-images/05d72a5e-67d6-440a-910d-7b02ee4fd352/_result.png" }),
  mkStudio(9, "Toronto", "Canada", "Eastern Standard Time", "America/Toronto", 90, "433", "+14165550154", { manager: "Priya Nair", accent: "#2fbf71" }),
  mkStudio(10, "Dubai", "UAE", "Gulf Standard Time", "Asia/Dubai", 100, "451", "+97145550189", { manager: "Sara Al-Farsi", accent: "#d4af37", image: "https://image.qwenlm.ai/generated-images/875f8c06-42db-4e80-a065-6bb0f9d4e97f/_result.png" }),
];
export const studioById = (id: number) => STUDIOS.find(s => s.id === id);
export const shortId = (id: string) => (id.length > 14 ? `${id.slice(0, 8)}…` : id);

export const EXTENSIONS: Extension[] = [
  { id: 1, extension: "400", displayName: "Callcenter Main", username: "Cleo.Callcenter0", phoneNumber: "+18335550100", locationId: null },
  { id: 2, extension: "401", displayName: "Callcenter Line 2", username: "Cleo.Callcenter1", phoneNumber: "+18335550101", locationId: null },
  { id: 3, extension: "402", displayName: "Callcenter Line 3", username: "Cleo.Callcenter2", phoneNumber: "+18335550102", locationId: null },
  { id: 4, extension: "403", displayName: "Callcenter Line 4", username: "Cleo.Callcenter3", phoneNumber: "+18335550103", locationId: null },
  ...STUDIOS.slice(0, 6).map((s, i) => ({ id: 10 + i, extension: s.config.vonage.extension, displayName: s.name, username: `Cleo.${s.slug}`, phoneNumber: s.phone, locationId: s.id })),
];

/* ── leads ─────────────────────────────────────────────────────────────── */
const mkLead = (
  id: string, name: string, phone: string, loc: number, platform: Platform, callStatus: CallStatus,
  daysAgo: number, extra: Partial<Lead> = {},
): Lead => ({
  id, name, email: `${name.toLowerCase().replace(/[^a-z ]/g, "").replace(/ +/g, ".")}@mail.com`,
  formattedPhone: phone, locationId: loc, status: callStatus === "not_called" ? "new" : "contacted",
  callStatus, lastCalledAt: callStatus === "not_called" ? null : iso(Math.max(daysAgo - 1, 0), 15),
  createdAt: iso(daysAgo, 9 + (daysAgo % 9), (daysAgo * 17) % 60), unsubscribedAt: null,
  isDuplicate: false,
  meta: {
    purpose: extra.meta?.purpose ?? "New Tattoo", style: "Fine Line", storyType: "Aesthetic",
    story: "", size: "Medium", bodyAreas: ["Forearm"], referenceImages: [], language: "EN", consent: true,
  },
  attr: {
    platform, utmSource: platform, utmMedium: platform === "google" ? "cpc" : "social",
    utmCampaign: platform === "instagram" ? "ig-stories-us" : platform === "google" ? "gads-search-core" : null,
    gclid: platform === "google" ? `gclid-${id.toLowerCase()}` : null,
    fbclid: platform === "facebook" ? `fbclid-${id.toLowerCase()}` : null,
    ttclid: platform === "tiktok" ? `ttclid-${id.toLowerCase()}` : null,
    landingPage: `/atlanta/book`,
  },
  ...extra,
});

export const LEADS: Lead[] = [
  mkLead("LEAD-1042", "Sofia Kaya", "+14045550134", 1, "instagram", "interested", 0),
  mkLead("LEAD-1041", "Emma Johnson", "+17865550177", 2, "facebook", "not_called", 0),
  mkLead("LEAD-1040", "Mert Demir", "+905325550148", 5, "instagram", "callback_requested", 0),
  mkLead("LEAD-1039", "Noah Williams", "+12145550129", 3, "google", "no_answer", 1),
  mkLead("LEAD-1038", "Ava Thompson", "+17205550183", 4, "tiktok", "interested", 1),
  mkLead("LEAD-1037", "Liam Garcia", "+14045550118", 1, "webform", "appointment_made", 2),
  mkLead("LEAD-1036", "Zeynep Arslan", "+905425550119", 6, "instagram", "busy", 2),
  mkLead("LEAD-1035", "Oliver Brown", "+442075550142", 7, "google", "not_called", 2),
  mkLead("LEAD-1034", "Emma Johnson", "+17865550177", 2, "instagram", "double_lead", 3, { isDuplicate: true }),
  mkLead("LEAD-1033", "Lucas Silva", "+14705550163", 1, "facebook", "callback_requested", 3),
  mkLead("LEAD-1032", "Mia Chen", "+14165550136", 9, "tiktok", "interested", 4),
  mkLead("LEAD-1031", "Ethan Davis", "+18335550121", 3, "webform", "didnt_pick_up", 4),
  mkLead("LEAD-1030", "Lena Hoffmann", "+49305550175", 8, "instagram", "already_scheduled", 5),
  mkLead("LEAD-1029", "Mert Demir", "+905325550148", 5, "webform", "double_lead", 5, { isDuplicate: true }),
  mkLead("LEAD-1028", "Harper Wilson", "+14045550192", 1, "google", "not_interested", 6),
  mkLead("LEAD-1027", "Yusuf Yılmaz", "+905555550137", 5, "facebook", "not_called", 6),
  mkLead("LEAD-1026", "Amelia Martinez", "+17865550145", 2, "instagram", "wrong_number", 7),
  mkLead("LEAD-1025", "James Anderson", "+19705550158", 4, "google", "spam", 8),
  mkLead("LEAD-1024", "Sofia Kaya", "+14045550134", 1, "webform", "double_lead", 8, { isDuplicate: true }),
  mkLead("LEAD-1023", "Isabella Rossi", "+442085550133", 7, "webform", "interested", 9),
  mkLead("LEAD-1022", "Fatma Kılıç", "+903125550151", 6, "instagram", "not_trusted", 10),
  mkLead("LEAD-1021", "Daniel Kim", "+14375550126", 9, "google", "no_pn", 11, { formattedPhone: "" }),
  mkLead("LEAD-1020", "Grace Taylor", "+97145550172", 10, "instagram", "callback_requested", 12),
  mkLead("LEAD-1019", "Omar Hassan", "+971505550144", 10, "facebook", "not_called", 13),
  mkLead("LEAD-1018", "Chloe Dubois", "+17205550139", 4, "tiktok", "interested", 16),
  mkLead("LEAD-1017", "Jack Robinson", "+12145550181", 3, "instagram", "appointment_made", 21),
  mkLead("LEAD-1016", "Nina Petrova", "+14045550127", 1, "google", "not_called", 26),
];

/* ── appointments ──────────────────────────────────────────────────────── */
const mkAppt = (
  id: number, customerId: string | null, name: string, phone: string, loc: number, status: ApptStatus,
  prefDays: number, createdDays: number, platform: Platform = "instagram",
): Appointment => ({
  id, uuid: `BK-${(7300 + id).toString(36).toUpperCase()}${id * 7 % 97}`, customerId, name,
  email: `${name.toLowerCase().replace(/ +/g, ".")}@mail.com`, formattedPhone: phone, locationId: loc,
  purpose: "New Tattoo", style: "Fine Line", storyType: "Aesthetic", story: "Delicate botanical sleeve idea.",
  size: "Medium", bodyAreas: ["Forearm", "Wrist"], referenceImage: null,
  preferredDate: iso(-prefDays, 14), preferredTime: `${11 + (id % 6)}:00`, status,
  isFreePick: id % 5 === 0, language: "EN", createdAt: iso(createdDays, 10), platform,
  campaign: platform === "instagram" ? "ig-stories-us" : null, consent: true,
});

export const APPOINTMENTS: Appointment[] = [
  mkAppt(501, "LEAD-1042", "Sofia Kaya", "+14045550134", 1, "confirmed", 2, 0),
  mkAppt(502, "LEAD-1037", "Liam Garcia", "+14045550118", 1, "deposit_paid", 3, 2),
  mkAppt(503, "LEAD-1040", "Mert Demir", "+905325550148", 5, "pending", 4, 1),
  mkAppt(504, null, "Nora Bennett", "+17865550129", 2, "pending", 5, 1),
  mkAppt(505, "LEAD-1017", "Jack Robinson", "+12145550181", 3, "confirmed", 6, 21, "google"),
  mkAppt(506, "LEAD-1030", "Lena Hoffmann", "+49305550175", 8, "rescheduled", 7, 5),
  mkAppt(507, null, "Theo Laurent", "+442075550161", 7, "pending", 8, 2),
  mkAppt(508, "LEAD-1032", "Mia Chen", "+14165550136", 9, "confirmed", 9, 4, "tiktok"),
  mkAppt(509, null, "Aisha Khan", "+971505550133", 10, "deposit_paid", 10, 3),
  mkAppt(510, null, "Marco Bianchi", "+14705550187", 1, "no_show", -2, 6),
  mkAppt(511, null, "Ella Foster", "+17205550124", 4, "cancelled", -3, 8),
  mkAppt(512, null, "Ryan O'Brien", "+14045550173", 1, "completed", -5, 12),
  mkAppt(513, null, "Selin Koç", "+905425550128", 6, "completed", -7, 15, "webform"),
  mkAppt(514, null, "Victor Hugo", "+17865550149", 2, "completed", -12, 24),
];

/* ── calls ─────────────────────────────────────────────────────────────── */
const AGENTS = ["Agent · Callcenter0", "Agent · Callcenter1", "Agent · Callcenter2", "Agent · Callcenter3"];
const mkCall = (
  id: number, lead: Lead | null, dir: "inbound" | "outbound", result: CallResult, daysAgo: number,
  dur = 0, loc = 1,
): CallLog => ({
  id, direction: dir,
  fromNumber: dir === "inbound" ? lead?.formattedPhone ?? "+18005550199" : "+18335550100",
  toNumber: dir === "inbound" ? "+18335550100" : lead?.formattedPhone ?? "+18005550199",
  fromName: dir === "inbound" ? lead?.name ?? "Unknown Caller" : "Callcenter Main (#400)",
  toName: dir === "inbound" ? "Callcenter Main (#400)" : lead?.name ?? "Unknown",
  customerId: lead?.id ?? null, appointmentId: null, locationId: lead?.locationId ?? loc,
  startTime: iso(daysAgo, 9 + (id % 9), (id * 13) % 60),
  duration: result === "Answered" ? dur || 45 + (id % 200) : 0,
  result, hasRecording: result === "Answered" || result === "Voicemail",
  agent: AGENTS[id % AGENTS.length], ext: `40${id % 4}`,
});

export const CALLS: CallLog[] = [
  mkCall(9001, LEADS[0], "outbound", "Answered", 0, 184),
  mkCall(9002, LEADS[1], "inbound", "Missed", 0),
  mkCall(9003, LEADS[2], "outbound", "Voicemail", 0),
  mkCall(9004, LEADS[3], "outbound", "Attempted", 1),
  mkCall(9005, LEADS[4], "inbound", "Answered", 1, 262),
  mkCall(9006, LEADS[5], "outbound", "Answered", 2, 141),
  mkCall(9007, LEADS[6], "outbound", "Attempted", 2),
  mkCall(9008, LEADS[7], "inbound", "Missed", 2),
  mkCall(9009, LEADS[9], "outbound", "Answered", 3, 98),
  mkCall(9010, LEADS[9], "outbound", "Attempted", 3),
  mkCall(9011, LEADS[10], "inbound", "Answered", 4, 205),
  mkCall(9012, LEADS[11], "outbound", "Missed", 4),
  mkCall(9013, LEADS[12], "outbound", "Answered", 5, 176),
  mkCall(9014, LEADS[14], "outbound", "Answered", 6, 64),
  mkCall(9015, LEADS[15], "inbound", "Voicemail", 6),
  mkCall(9016, LEADS[17], "outbound", "Answered", 8, 52),
  mkCall(9017, LEADS[19], "inbound", "Answered", 9, 231),
  mkCall(9018, LEADS[22], "outbound", "Answered", 12, 187),
  mkCall(9019, LEADS[24], "outbound", "Answered", 16, 158),
  mkCall(9020, LEADS[25], "inbound", "Answered", 21, 342),
  mkCall(9021, null, "inbound", "Missed", 0, 0, 5),
  mkCall(9022, null, "inbound", "Answered", 1, 119, 2),
  mkCall(9023, null, "outbound", "Voicemail", 2, 0, 3),
  mkCall(9024, null, "inbound", "Answered", 3, 88, 9),
  mkCall(9025, null, "outbound", "Attempted", 5, 0, 7),
  mkCall(9026, null, "inbound", "Missed", 6, 0, 10),
];

/* ── conversations / notes ─────────────────────────────────────────────── */
const mkMsg = (id: number, direction: SmsMessage["direction"], body: string, at: string, status: SmsMessage["status"]): SmsMessage =>
  ({ id, direction, body, at, status });

export const CONVERSATIONS: Conversation[] = [
  {
    id: 7001, phone: "+14045550134", customerId: "LEAD-1042", customerName: "Sofia Kaya", locationId: 1, unreadCount: 2, unsubscribed: false,
    messages: [
      mkMsg(1, "outbound", "Hi Sofia! Thanks for reaching out to Cleopatra Ink Atlanta 💛 Want to grab a slot this week?", iso(0, 10, 12), "delivered"),
      mkMsg(2, "inbound", "Yes! Do you have anything Thursday afternoon?", iso(0, 10, 31), "received"),
      mkMsg(3, "inbound", "Also — is the deposit refundable?", iso(0, 10, 32), "received"),
    ],
  },
  {
    id: 7002, phone: "+905325550148", customerId: "LEAD-1040", customerName: "Mert Demir", locationId: 5, unreadCount: 1, unsubscribed: false,
    messages: [
      mkMsg(4, "outbound", "Merhaba Mert! Cleopatra Ink Istanbul — dövmemiz için bu hafta bir slot ayırtmak ister misiniz?", iso(1, 14, 3), "delivered"),
      mkMsg(5, "inbound", "İstiyorum, cumartesi uygun mu?", iso(1, 15, 40), "received"),
    ],
  },
  {
    id: 7003, phone: "+14045550118", customerId: "LEAD-1037", customerName: "Liam Garcia", locationId: 1, unreadCount: 0, unsubscribed: false,
    messages: [
      mkMsg(6, "outbound", "Liam, your booking BK-K2Q3 is confirmed for this Friday 13:00. Deposit link: cleo.ink/d/4021", iso(2, 11, 20), "delivered"),
      mkMsg(7, "inbound", "Paid! See you Friday 🖤", iso(2, 12, 2), "received"),
      mkMsg(8, "outbound", "Amazing — receipt sent to your email. Aftercare sheet attached.", iso(2, 12, 9), "delivered"),
    ],
  },
  {
    id: 7004, phone: "+14705550163", customerId: "LEAD-1033", customerName: "Lucas Silva", locationId: 1, unreadCount: 0, unsubscribed: false,
    messages: [mkMsg(9, "outbound", "Hi Lucas — we missed you! Best time to call you back about your fine-line piece?", iso(3, 16, 45), "delivered")],
  },
  {
    id: 7005, phone: "+17865550145", customerId: "LEAD-1026", customerName: "Amelia Martinez", locationId: 2, unreadCount: 0, unsubscribed: true,
    messages: [
      mkMsg(10, "inbound", "Please stop messaging me.", iso(7, 9, 15), "received"),
      mkMsg(11, "outbound", "Understood — you've been removed from all marketing messages. Reply HELP anytime.", iso(7, 9, 16), "delivered"),
    ],
  },
  {
    id: 7006, phone: "+14165550136", customerId: "LEAD-1032", customerName: "Mia Chen", locationId: 9, unreadCount: 1, unsubscribed: false,
    messages: [
      mkMsg(12, "outbound", "Mia! Your artist Priya has an opening next Tuesday 15:00 — want it?", iso(4, 13, 30), "delivered"),
      mkMsg(13, "inbound", "Yes please!! Sending the ref photos now", iso(4, 13, 52), "received"),
    ],
  },
  {
    id: 7007, phone: "+97145550172", customerId: "LEAD-1020", customerName: "Grace Taylor", locationId: 10, unreadCount: 0, unsubscribed: false,
    messages: [mkMsg(14, "outbound", "Hi Grace, Cleopatra Ink Dubai here — could we call you tomorrow around 11:00 GST?", iso(12, 10, 5), "delivered")],
  },
];

export const NOTES: Note[] = [
  { id: 1, author: "Agent · Callcenter1", notableType: "lead", notableId: "LEAD-1042", content: "Wants fine-line botanicals, budget ~$600. Prefers Thursdays.", createdAt: iso(0, 11) },
  { id: 2, author: "Agent · Callcenter2", notableType: "lead", notableId: "LEAD-1040", content: "Turkish speaker — route to Istanbul branch. Saturday preferred.", createdAt: iso(1, 15) },
  { id: 3, author: "You · Super Admin", notableType: "lead", notableId: "LEAD-1033", content: "Second attempt tomorrow 10:00. Mention the flash-day discount.", createdAt: iso(3, 17) },
  { id: 4, author: "Dana Whitfield", notableType: "appointment", notableId: "502", content: "Deposit received — artist booked, room 2.", createdAt: iso(2, 13) },
  { id: 5, author: "Agent · Callcenter0", notableType: "lead", notableId: "LEAD-1034", content: "Duplicate of LEAD-1041 (same phone). Merge recommended.", createdAt: iso(3, 12) },
];

/* ── campaigns & tasks ─────────────────────────────────────────────────── */
export const TEMPLATES = [
  { id: "first_touch", name: "First Touch", body: "Hi {customer_name}! Thanks for reaching out to Cleopatra Ink {location_name} 💛 Want to grab a slot this week?" },
  { id: "confirm", name: "Booking Confirmation", body: "{customer_name}, your booking on {appointment_date} is confirmed at Cleopatra Ink {location_name}. Reply C to cancel." },
  { id: "deposit", name: "Deposit Reminder", body: "Hi {customer_name} — your slot on {appointment_date} is reserved! Secure it with a $50 deposit: cleo.ink/d/pay" },
  { id: "winback", name: "Win-Back", body: "We miss you, {customer_name}! Flash week at {location_name}: 15% off all fine-line pieces until Sunday." },
];

export const CAMPAIGNS: Campaign[] = [
  {
    id: 8001, name: "Summer Flash — deposit reminder",
    segment: { locationId: "all", status: "interested", platform: "all" },
    body: "Hi {customer_name} — flash week is live! Secure your slot with a $50 deposit: cleo.ink/d/pay",
    scheduledAt: iso(3, 10), status: "sent", total: 14, delivered: 12, failed: 1, replied: 4, createdAt: iso(4, 9),
  },
  {
    id: 8002, name: "October slots open — Atlanta",
    segment: { locationId: 1, status: "all", platform: "instagram" },
    body: "{customer_name}, October books open Friday 10:00 at Cleopatra Ink Atlanta. First come, first inked 🖤",
    scheduledAt: iso(-2, 10), status: "scheduled", total: 9, delivered: 0, failed: 0, replied: 0, createdAt: iso(1, 11),
  },
  {
    id: 8003, name: "Win-back: cancelled leads",
    segment: { locationId: "all", status: "not_interested", platform: "all" },
    body: TEMPLATES[3].body,
    scheduledAt: iso(-5, 15), status: "draft", total: 0, delivered: 0, failed: 0, replied: 0, createdAt: iso(0, 9),
  },
];

export const TASKS: TaskItem[] = [
  { id: 9101, title: "Return call — asked about deposit refund", leadId: "LEAD-1042", leadName: "Sofia Kaya", phone: "+14045550134", locationId: 1, assignee: "Agent · Callcenter1", dueAt: iso(0, 16), createdAt: iso(0, 11), status: "open", doneAt: null, source: "manual" },
  { id: 9102, title: "Callback — Saturday slot in Istanbul", leadId: "LEAD-1040", leadName: "Mert Demir", phone: "+905325550148", locationId: 5, assignee: "Agent · Callcenter2", dueAt: iso(-1, 12), createdAt: iso(1, 15), status: "open", doneAt: null, source: "voicemail" },
  { id: 9103, title: "Retry — didn't pick up twice", leadId: "LEAD-1031", leadName: "Ethan Davis", phone: "+18335550121", locationId: 3, assignee: "Agent · Callcenter0", dueAt: iso(0, 18), createdAt: iso(4, 10), status: "open", doneAt: null, source: "callback" },
  { id: 9104, title: "Confirm ref photos received", leadId: "LEAD-1032", leadName: "Mia Chen", phone: "+14165550136", locationId: 9, assignee: "Agent · Callcenter3", dueAt: iso(2, 12), createdAt: iso(4, 14), status: "done", doneAt: iso(2, 11), source: "manual" },
  { id: 9105, title: "Callback — missed inbound on #403", leadId: null, leadName: "Unknown Caller", phone: "+18005550199", locationId: 5, assignee: "Agent · Callcenter2", dueAt: iso(-2, 10), createdAt: iso(0, 9), status: "open", doneAt: null, source: "callback" },
];

/* ── artists & staff ───────────────────────────────────────────────────── */
export const ARTISTS: Artist[] = [
  { id: 1, name: "Aria Voss", instagram: "ariavoss.ink", specialties: ["Fine Line", "Botanical"], locationIds: [1], active: true, bio: "Delicate single-needle florals and script. Books out 3 weeks ahead." },
  { id: 2, name: "Kade Moreno", instagram: "kademoreno", specialties: ["Blackwork", "Geometric"], locationIds: [1, 2], active: true, bio: "Heavy blackwork, dotwork mandalas and sacred geometry." },
  { id: 3, name: "Elif Yıldız", instagram: "elifyildiz.tattoo", specialties: ["Realism", "Portraits"], locationIds: [5, 6], active: true, bio: "Black & grey realism — portraits and animals." },
  { id: 4, name: "Theo Brandt", instagram: "theobrandt", specialties: ["Traditional", "Neo-Trad"], locationIds: [7, 8], active: true, bio: "Bold lines, classic flash with a modern twist." },
  { id: 5, name: "Priya Nair", instagram: "priyanair.ink", specialties: ["Fine Line", "Minimal"], locationIds: [9], active: true, bio: "Micro-realism and minimalist constellation work." },
  { id: 6, name: "Zain Qureshi", instagram: "zainq.ink", specialties: ["Blackwork", "Script"], locationIds: [10], active: false, bio: "Arabic calligraphy and ornamental blackwork. On break until next month." },
  { id: 7, name: "Rosa Delgado", instagram: "rosadelgado.ink", specialties: ["Realism", "Color"], locationIds: [2, 3], active: true, bio: "Vivid color realism — flowers, koi, and surreal sleeves." },
  { id: 8, name: "Milo Anders", instagram: "miloanders", specialties: ["Geometric", "Fine Line"], locationIds: [4], active: true, bio: "Precision geometry, linework landscapes and architecture." },
];

export const STAFF: StaffMember[] = [
  { id: 1, name: "Cleo Rivera", email: "cleo@cleopatraink.com", roleId: "super_admin", locationIds: "all", active: true, lastActiveAt: iso(0, 9) },
  { id: 2, name: "Dana Whitfield", email: "dana@cleopatraink.com", roleId: "branch_manager", locationIds: [1], active: true, lastActiveAt: iso(0, 8) },
  { id: 3, name: "Marcus Hale", email: "marcus@cleopatraink.com", roleId: "hq_admin", locationIds: "all", active: true, lastActiveAt: iso(1, 17) },
  { id: 4, name: "Elif Aydın", email: "elif@cleopatraink.com", roleId: "branch_manager", locationIds: [5, 6], active: true, lastActiveAt: iso(0, 7) },
  { id: 5, name: "Jonas Weber", email: "jonas@cleopatraink.com", roleId: "studio_admin", locationIds: [8], active: true, lastActiveAt: iso(2, 14) },
  { id: 6, name: "Tara Singh", email: "tara@cleopatraink.com", roleId: "callcenter_agent", locationIds: "all", active: true, lastActiveAt: iso(0, 10) },
  { id: 7, name: "Owen Pierce", email: "owen@cleopatraink.com", roleId: "callcenter_agent", locationIds: "all", active: true, lastActiveAt: iso(0, 6) },
  { id: 8, name: "Sara Al-Farsi", email: "sara@cleopatraink.com", roleId: "viewer", locationIds: [10], active: false, lastActiveAt: iso(6, 12) },
  { id: 9, name: "Maya Chen", email: "maya@cleopatraink.com", roleId: "studio_admin", locationIds: [2], active: true, lastActiveAt: iso(0, 11) },
  { id: 10, name: "Ravi Patel", email: "ravi@cleopatraink.com", roleId: "viewer", locationIds: [1, 2, 3], active: true, lastActiveAt: iso(0, 5) },
];

/* Static demo credential — same for every seeded member (real auth via Supabase) */
export const DEMO_PASSWORD = "demo";

/* ── reporting seeds ───────────────────────────────────────────────────── */
export const DAILY = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(); d.setDate(d.getDate() - (13 - i));
  return {
    day: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    leads: 6 + ((i * 7 + 3) % 11), calls: 10 + ((i * 5 + 2) % 14), appts: 2 + ((i * 3 + 1) % 6),
  };
});
export const FUNNEL = [
  { key: "Leads", count: 224, color: "#fba200" },
  { key: "Contacted", count: 187, color: "#e8a33d" },
  { key: "Interested", count: 96, color: "#4c8dff" },
  { key: "Booked", count: 61, color: "#2fbf71" },
  { key: "Deposit Paid", count: 44, color: "#1e9e5c" },
];
