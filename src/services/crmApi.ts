/* ── Console ⇄ API ─────────────────────────────────────────────────────
 * The database speaks one shape and the console's views speak another
 * (src/data.ts). Rather than rewrite every view, translation happens once,
 * here. This is also the only place that knows a URL.
 * ────────────────────────────────────────────────────────────────── */
import type {
  Lead, Appointment, CallLog, Conversation, SmsMessage, TaskItem,
  Studio, StaffMember, StudioNumber, Note, Campaign, Artist, CallStatus, ApptStatus, Platform, AuditLog,
} from "../data";

/** Everything the reports screen draws, aggregated in the database. */
export interface ReportSummary {
  window: { days: number | null; from: string; comparable: boolean };
  current: {
    leads: number; appointments: number; calls: number; answered: number;
    answerRate: number; avgTalkSeconds: number; conversion: number;
  };
  previous: {
    leads: number; appointments: number; calls: number; answered: number;
    answerRate: number; avgTalkSeconds: number; conversion: number;
  } | null;
  sla: {
    u5: number; u15: number; u60: number; over: number; never: number;
    medianResponseSeconds: number; called: number; withinSla: number;
  };
  heat: number[][];
  platforms: [Platform, number][];
  campaigns: [string, { leads: number; appts: number }][];
  studios: { id: number; name: string; leads: number; appts: number }[];
  ops: { noShowCancel: number; noShowRate: number; callsPerBooking: number; avgTalkSeconds: number };
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(res.status, body.message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/* ── List queries ──────────────────────────────────────────────────────
 * Every list endpoint takes the same shape of question: which slice, in
 * what order, narrowed how. The console used to ask for `page_size=100`
 * and answer the rest of it in the browser, over those hundred rows — so
 * with 9,000 calls on file the search box, the status tabs and the CSV
 * export all described 1% of the data, and nothing on screen said so.
 * ────────────────────────────────────────────────────────────────── */
export interface ListQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  /** Status / result tab. "all" and undefined both mean unfiltered. */
  status?: string;
  platform?: string;
  direction?: string;
  /** Calls only: "callcenter" or "branch" — which desk answered. */
  desk?: string;
  location?: number | "all";
  /** Explicit window as ISO instants — the console resolves its own days. */
  from?: string;
  to?: string;
  sort?: string;
  dir?: "asc" | "desc";
  /** Appointments only: filter on the booking date rather than created. */
  on?: "starts" | "created";
  /** Appointments only: a window on the slot itself, e.g. "due from today". */
  startsFrom?: string;
  startsTo?: string;
  includeConverted?: boolean;
}

/** Someone a task can be handed to. */
export interface AssignableStaff {
  id: number;
  name: string;
  roleId: string;
  online: boolean;
}

/** One thing that happened on the call floor, as recorded. */
export interface CallFloorEvent {
  id: number;
  callUuid: string | null;
  eventType: string;
  locationId: number | null;
  staffId: number | null;
  payload: {
    direction?: string; extension?: string | null; agent?: string | null;
    remote?: string | null; did?: string | null; status?: string;
    from?: string; to?: string; category?: string;
  };
  occurredAt: string;
  studio: string | null;
}

/** One of this caller's other calls, for the list beside a recording. */
export interface RelatedCall {
  id: number;
  startTime: string;
  direction: "inbound" | "outbound";
  result: CallLog["result"];
  duration: number;
  agentName: string | null;
  extension: string | null;
  hasAudio: boolean;
  studio: string | null;
}

/** Who is on the other end of a call, and their history with us. */
export interface CallContext {
  number: string | null;
  person: { kind: "customer"; id: string; name: string }
        | { kind: "lead"; id: string; name: string; status: string }
        | null;
  totalCalls: number;
  answeredCalls: number;
  isFirstCall: boolean;
  firstCallAt: string;
  others: RelatedCall[];
}

/** One person's note about a recording. A series, never overwritten. */
export interface CallNote {
  id: number;
  body: string;
  author: string;
  authorId: number | null;
  /** Seconds into the recording, when the note is about a moment in it. */
  atSeconds: number | null;
  createdAt: string;
  edited: boolean;
}

/** Two or more leads that look like the same person. */
export interface DuplicateGroup {
  /** What matched them — "phone" or "email". */
  kind: string;
  key: string;
  leads: Lead[];
}

/** One page, plus what the whole filtered set looks like. */
export interface Page<T> {
  rows: T[];
  total: number;
  /** Per-status totals across the filtered set, for the tab badges. */
  counts: Record<string, number>;
}

function listParams(query: ListQuery): URLSearchParams {
  const p = new URLSearchParams();
  const put = (key: string, value: string | number | undefined) => {
    if (value !== undefined && value !== "" && value !== "all") p.set(key, String(value));
  };
  put("page", query.page);
  put("page_size", query.pageSize);
  put("q", query.q?.trim() || undefined);
  put("status", query.status);
  put("result", query.status);
  put("platform", query.platform);
  put("direction", query.direction);
  put("desk", query.desk);
  put("location", query.location);
  put("from", query.from);
  put("to", query.to);
  put("sort", query.sort);
  put("dir", query.dir);
  put("on", query.on);
  put("starts_from", query.startsFrom);
  put("starts_to", query.startsTo);
  if (query.includeConverted) p.set("include_converted", "1");
  return p;
}

/** Where the browser should point to download this exact list as CSV. */
export function exportUrl(resource: "leads" | "appointments" | "calls", query: ListQuery): string {
  const p = listParams({ ...query, page: undefined, pageSize: undefined });
  p.set("format", "csv");
  return `/api/crm/${resource}?${p.toString()}`;
}

/* ── shapes the API actually returns ─────────────────────────────────── */
interface ApiStudio {
  slotCapacity?: number;
  id: number; slug: string; name: string; manager: string | null;
  branchPhone: string | null; email: string | null; address: string | null;
  city: string; state: string | null; country: string; countryCode: string;
  accent: string | null; imageUrl: string | null;
  gtmCountry: string | null; gtmCityState: string | null; mapsUrl: string | null;
  lat: string | null; lng: string | null;
  timezone: string; timezoneFriendly: string | null;
  displayOrder: number; bookingIntervalMin: number; bookingActive: boolean;
  social: Record<string, string>;
  twilio: { accountSid: string | null; authToken: string | null; messagingSid: string | null; specificPhone: string | null; smsAutomation: boolean; configured: boolean };
  smtp: { enabled: boolean; senderName: string | null; senderEmail: string | null; host: string | null; port: number | null; username: string | null; password: string | null; configured: boolean };
  vonage: { did?: string; extension?: string };
  hours: Record<string, { enabled: boolean; open: string; close: string }>;
}

interface ApiLead {
  id: string; customerId: string | null; locationId: number;
  name: string; email: string | null; phoneE164: string | null;
  platform: Platform; lifecycleStatus: string; callStatus: CallStatus;
  locale: string; convertedAt: string | null; lastCalledAt: string | null;
  unsubscribedAt: string | null; isDuplicate: boolean; createdAt: string;
  utm: Record<string, string | null>; meta: Record<string, unknown>;
  studio: { id: number; name: string; city: string; slug: string };
  callCount: number;
}

interface ApiAppointment {
  id: number; bkUuid: string; leadId: string | null; customerId: string | null;
  locationId: number; name: string; email: string | null; phoneE164: string | null;
  purpose: string | null; style: string | null; size: string | null;
  storyType: string | null; story: string | null; bodyAreas: string[];
  referenceImageUrl: string | null; preferredDate: string; preferredTime: string;
  displayTimezone: string; userTimezone: string | null; startsAt: string; status: ApptStatus;
  cancelReason: string | null; isFreePick: boolean; addressStreet: string | null;
  locale: string; platform: Platform; campaign: string | null; consent: boolean;
  createdAt: string; callCount: number;
}

interface ApiCall {
  id: number; direction: "inbound" | "outbound"; fromNumber: string; toNumber: string;
  fromName: string | null; toName: string | null; customerId: string | null;
  leadId: string | null; appointmentId: number | null; locationId: number | null;
  startTime: string; duration: number; result: CallLog["result"];
  hasRecording: boolean; recordingUrl: string | null; recordingPath: string | null;
  /** Our own name for the other party, when we have one. */
  knownName: string | null;
  agentName: string | null; extension: string | null;
  agent: { id: number; name: string } | null;
}

interface ApiConversation {
  id: number; phoneE164: string; customerId: string | null; leadId: string | null;
  locationId: number | null; customerName: string | null;
  unreadCount: number; unsubscribed: boolean; lastMessageAt: string | null;
}

interface ApiMessage {
  id: number; direction: "inbound" | "outbound"; body: string; createdAt: string;
  status: string; senderName: string | null; fromNumber: string | null;
  toNumber: string | null; mediaUrls: string[];
}

interface ApiTask {
  id: number; title: string; leadId: string | null; leadName: string | null;
  phoneE164: string | null; locationId: number | null; dueAt: string;
  createdAt: string; status: "open" | "done"; doneAt: string | null;
  source: TaskItem["source"]; assignee: { id: number; name: string } | null;
}

interface ApiStaff {
  id: number; name: string; email: string; roleId: string;
  scopeAll: boolean; active: boolean; lastActiveAt: string | null;
  locationIds: number[] | "all";
}

/* ── mappers ─────────────────────────────────────────────────────────── */

/** "10:00 – 20:00" for the studio card, from the weekly hours object. */
function hoursLabel(hours: ApiStudio["hours"]): string {
  const open = Object.values(hours ?? {}).find((d) => d?.enabled);
  return open ? `${open.open} – ${open.close}` : "Closed";
}

export function toStudio(s: ApiStudio): Studio {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    phone: s.branchPhone ?? "",
    email: s.email ?? "",
    address: s.address ?? "",
    city: s.city,
    state: s.state ?? "",
    country: s.country,
    gtmCountry: s.gtmCountry ?? s.countryCode,
    timezone: s.timezoneFriendly ?? s.timezone,
    bookingActive: s.bookingActive,
    manager: s.manager ?? "",
    hours: hoursLabel(s.hours),
    image: s.imageUrl ?? undefined,
    accent: s.accent ?? "#fba200",
    config: {
      bookingSlug: s.slug,
      publicPhone: s.branchPhone ?? "",
      latitude: Number(s.lat ?? 0),
      longitude: Number(s.lng ?? 0),
      gtmCountry: s.gtmCountry ?? "",
      gtmCityState: s.gtmCityState ?? "",
      mapsUrl: s.mapsUrl ?? "",
      timezone: s.timezoneFriendly ?? s.timezone,
      ianaTimezone: s.timezone,
      displayOrder: s.displayOrder,
      bookingInterval: s.bookingIntervalMin,
      slotCapacity: s.slotCapacity ?? 2,
      enableOnlineBooking: s.bookingActive,
      socials: {
        instagram: s.social?.instagram ?? "",
        facebook: s.social?.facebook ?? "",
        tiktok: s.social?.tiktok ?? "",
        twitter: s.social?.twitter ?? "",
        youtube: s.social?.youtube ?? "",
      },
      // Already masked by the server; the console only shows they exist.
      twilio: {
        accountSid: s.twilio?.accountSid ?? "",
        authToken: s.twilio?.authToken ?? "",
        messagingSid: s.twilio?.messagingSid ?? "",
        specificPhone: s.twilio?.specificPhone ?? "",
        smsAutomation: s.twilio?.smsAutomation ?? false,
      },
      vonage: { did: s.vonage?.did ?? "", extension: s.vonage?.extension ?? "" },
      mail: {
        enabled: s.smtp?.enabled ?? false,
        senderName: s.smtp?.senderName ?? "",
        senderEmail: s.smtp?.senderEmail ?? "",
        smtpHost: s.smtp?.host ?? "",
        smtpPort: s.smtp?.port ?? 587,
        smtpUser: s.smtp?.username ?? "",
        smtpPass: s.smtp?.password ?? "",
      },
      businessHours: toConsoleHours(s.hours),
    },
  };
}

/* The booking engine keys opening hours by the three-letter weekday that
 * Intl produces ("mon", "tue"…), which is what the locations row holds. The
 * console screens spell them out. Handed the raw row, StudioEdit looked up
 * businessHours["monday"], got undefined and crashed on .enabled — taking
 * the whole edit screen with it. Normalise here, in one place, and fill any
 * missing day so the form always has something to render. */
const CONSOLE_DAYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;

interface DayHoursShape { enabled: boolean; open: string; close: string }

export function toConsoleHours(raw: unknown): Record<string, DayHoursShape> {
  const source = (raw ?? {}) as Record<string, Partial<DayHoursShape> | undefined>;
  const out: Record<string, DayHoursShape> = {};
  for (const long of CONSOLE_DAYS) {
    const entry = source[long] ?? source[long.slice(0, 3)];
    out[long] = {
      enabled: entry?.enabled ?? false,
      open: entry?.open ?? "10:00",
      close: entry?.close ?? "19:00",
    };
  }
  return out;
}

/** The inverse, for writing back to locations.hours. */
export function toDbHours(hours: Record<string, DayHoursShape>): Record<string, DayHoursShape> {
  const out: Record<string, DayHoursShape> = {};
  for (const long of CONSOLE_DAYS) {
    const entry = hours[long];
    if (entry) out[long.slice(0, 3)] = { enabled: entry.enabled, open: entry.open, close: entry.close };
  }
  return out;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function toLead(l: ApiLead): Lead {
  const m = l.meta ?? {};
  return {
    id: l.id,
    customerId: l.customerId ?? l.id,
    name: l.name,
    email: l.email ?? "",
    formattedPhone: l.phoneE164 ?? "",
    locationId: l.locationId,
    // The console's three-state lifecycle, derived from the richer one.
    status: l.convertedAt ? "done" : l.lastCalledAt ? "contacted" : "new",
    callStatus: l.callStatus,
    lastCalledAt: l.lastCalledAt,
    createdAt: l.createdAt,
    unsubscribedAt: l.unsubscribedAt,
    isDuplicate: l.isDuplicate,
    /* Counted in the database alongside the row. The list used to derive
       this from the calls the store held, so a lead whose calls were older
       than that slice showed zero. */
    voiceCalls: l.callCount,
    meta: {
      purpose: str(m.purpose), style: str(m.style), storyType: str(m.story_type ?? m.storyType),
      story: str(m.story ?? m.story_description), size: str(m.size),
      bodyAreas: strArr(m.body_areas ?? m.bodyAreas),
      referenceImages: strArr(m.reference_images ?? m.referenceImages),
      language: l.locale,
      consent: m.sms_consent === true || m.consent === true,
    },
    attr: {
      platform: l.platform,
      utmSource: l.utm?.utmSource ?? "",
      utmMedium: l.utm?.utmMedium ?? "",
      utmCampaign: l.utm?.utmCampaign ?? null,
      gclid: l.utm?.gclid ?? null,
      fbclid: l.utm?.fbclid ?? null,
      ttclid: l.utm?.ttclid ?? null,
      landingPage: l.utm?.landingPage ?? "",
    },
  };
}

export function toAppointment(a: ApiAppointment): Appointment {
  return {
    id: a.id,
    uuid: a.bkUuid,
    customerId: a.customerId ?? a.leadId ?? String(a.id),
    leadId: a.leadId,
    name: a.name,
    email: a.email ?? "",
    formattedPhone: a.phoneE164 ?? "",
    locationId: a.locationId,
    purpose: a.purpose ?? "",
    style: a.style ?? "",
    storyType: a.storyType ?? "",
    story: a.story ?? "",
    size: a.size ?? "",
    bodyAreas: a.bodyAreas ?? [],
    referenceImage: a.referenceImageUrl,
    preferredDate: a.preferredDate,
    preferredTime: String(a.preferredTime).slice(0, 5),
    status: a.status,
    isFreePick: a.isFreePick,
    language: a.locale,
    createdAt: a.createdAt,
    platform: a.platform,
    campaign: a.campaign,
    consent: a.consent,
    cancelReason: a.cancelReason,
    userTimezone: a.userTimezone ?? a.displayTimezone,
    startsAt: a.startsAt,
    displayTimezone: a.displayTimezone,
    voiceCalls: a.callCount,
    streetAddress: a.addressStreet ?? undefined,
  };
}

export function toCall(c: ApiCall): CallLog {
  return {
    id: c.id,
    direction: c.direction,
    fromNumber: c.fromNumber,
    toNumber: c.toNumber,
    /* Ours first, the carrier's second. The carrier's is a CNAM lookup —
       "WIRELESS CALLER" when the network has nothing, surname-first caps
       when it does — and it cannot know this number is a customer. */
    fromName: (c.direction === "inbound" ? c.knownName : null) ?? c.fromName ?? "",
    toName: (c.direction === "outbound" ? c.knownName : null) ?? c.toName ?? "",
    customerId: c.customerId ?? c.leadId,
    appointmentId: c.appointmentId,
    locationId: c.locationId ?? 0,
    startTime: c.startTime,
    duration: c.duration,
    result: c.result,
    hasRecording: c.hasRecording,
    // The URL itself stays on the server; the console only needs to know
    // whether there is one, and plays it through the proxy by call id.
    recordingAvailable: Boolean(c.recordingUrl || c.recordingPath),
    agent: c.agent?.name ?? c.agentName ?? "—",
    ext: c.extension ?? "",
  };
}

export function toConversation(c: ApiConversation, messages: SmsMessage[] = []): Conversation {
  return {
    id: c.id,
    phone: c.phoneE164,
    customerId: c.customerId ?? c.leadId,
    customerName: c.customerName ?? c.phoneE164,
    locationId: c.locationId ?? 0,
    unreadCount: c.unreadCount,
    unsubscribed: c.unsubscribed,
    messages,
  };
}

export function toMessage(m: ApiMessage): SmsMessage {
  return {
    id: m.id,
    direction: m.direction,
    body: m.body,
    at: m.createdAt,
    status: m.direction === "inbound" ? "received" : m.status === "delivered" ? "delivered" : m.status === "failed" ? "failed" : "sent",
    senderType: m.senderName && m.senderName !== "Automation" ? "agent" : "system",
    senderName: m.senderName ?? undefined,
    fromNumber: m.fromNumber ?? undefined,
    toNumber: m.toNumber ?? undefined,
    mediaUrl: m.mediaUrls?.[0],
  };
}

export function toTask(t: ApiTask): TaskItem {
  return {
    id: t.id,
    title: t.title,
    leadId: t.leadId,
    leadName: t.leadName ?? "",
    phone: t.phoneE164 ?? "",
    locationId: t.locationId ?? 0,
    /* Was the literal "Unassigned", which the console then printed as a
       name. Null says the same thing and lets the picker show its own
       wording, translated. */
    assignee: t.assignee?.name ?? null,
    assigneeStaffId: t.assignee?.id ?? null,
    dueAt: t.dueAt,
    createdAt: t.createdAt,
    status: t.status,
    doneAt: t.doneAt,
    source: t.source,
  };
}

export function toStaff(s: ApiStaff): StaffMember {
  return {
    id: s.id,
    name: s.name,
    email: s.email,
    roleId: s.roleId,
    locationIds: s.scopeAll ? "all" : (s.locationIds as number[]),
    active: s.active,
    lastActiveAt: s.lastActiveAt ?? new Date().toISOString(),
  };
}

/* ── calls ───────────────────────────────────────────────────────────── */

export interface SmsTemplate {
  id: number;
  key: string;
  channel: string;
  locationId: number | null;
  /** Every language the template has, keyed by locale. */
  bodies: Record<string, string>;
  mergeFields: string[];
}

export interface DashboardSeriesPoint { day: string; leads: number; appointments: number; calls: number }
export interface DashboardFunnelStage { key: string; count: number; color: string }
export interface DashboardData {
  days: number;
  series: DashboardSeriesPoint[];
  funnel: DashboardFunnelStage[];
  byPlatform: { platform: string; n: number }[];
  byStudio: { locationId: number; city: string; n: number }[];
}

export interface BootstrapResult {
  studios: Studio[];
  staff: StaffMember[];
  matrix: Record<string, string[]>;
  numbers: StudioNumber[];
  artists: Artist[];
  counters: { notCalledLeads: number; pendingAppointments: number; unreadSms: number; openTasks: number; duplicateGroups: number };
}


interface ApiArtist {
  id: number;
  name: string;
  locationIds: number[];
  active: boolean;
  instagram: string | null;
  specialties: string[] | null;
  bio: string | null;
}

interface ApiCampaign {
  id: number;
  name: string;
  body: string;
  segment: Campaign["segment"];
  scheduledAt: string;
  status: Campaign["status"];
  total: number;
  sent: number;
  delivered: number;
  failed: number;
  replied: number;
  createdAt: string;
}

export const toCampaign = (c: ApiCampaign): Campaign => ({
  id: c.id,
  name: c.name,
  body: c.body,
  segment: c.segment ?? { locationId: "all", status: "all", platform: "all" },
  scheduledAt: c.scheduledAt,
  status: c.status,
  total: c.total ?? 0,
  delivered: c.delivered ?? 0,
  failed: c.failed ?? 0,
  replied: c.replied ?? 0,
  createdAt: c.createdAt,
});

interface ApiNumber {
  id: number;
  locationId: number;
  kind: "vonage" | "twilio" | "branch";
  label: string;
  numberE164: string;
  smsCapable: boolean;
}

const toNumber = (n: ApiNumber): StudioNumber => ({
  id: n.id,
  studioId: n.locationId,
  kind: n.kind,
  label: n.label,
  number: n.numberE164,
  smsCapable: n.smsCapable,
});

interface ApiNote {
  id: number;
  notableType: "lead" | "appointment" | "customer";
  notableId: string;
  authorName: string | null;
  content: string;
  createdAt: string;
}

const toNote = (n: ApiNote): Note => ({
  id: n.id,
  author: n.authorName ?? "—",
  notableType: n.notableType,
  notableId: n.notableId,
  content: n.content,
  createdAt: n.createdAt,
});

export const crmApi = {
  async bootstrap(): Promise<BootstrapResult> {
    const d = await request<{
      studios: ApiStudio[]; staff: ApiStaff[]; matrix: Record<string, string[]>;
      numbers: ApiNumber[]; artists: ApiArtist[];
      counters: BootstrapResult["counters"];
    }>("/api/crm/bootstrap");
    return {
      studios: d.studios.map(toStudio),
      staff: d.staff.map(toStaff),
      matrix: d.matrix,
      // The console used to seed these from demo constants, so the console
      // showed numbers no webhook had ever heard of.
      numbers: (d.numbers ?? []).map(toNumber),
      artists: (d.artists ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        locationIds: a.locationIds ?? [],
        active: a.active,
        instagram: a.instagram ?? "",
        specialties: a.specialties ?? [],
        bio: a.bio ?? "",
      })),
      counters: d.counters,
    };
  },

  async leads(query: ListQuery = {}): Promise<Page<Lead>> {
    const d = await request<{ leads: ApiLead[]; total: number; counts: Record<string, number> }>(
      `/api/crm/leads?${listParams(query).toString()}`,
    );
    return { rows: d.leads.map(toLead), total: d.total, counts: d.counts ?? {} };
  },

  /* Grouped in the database over every lead the caller may see. The merge
     screen used to group the store's array — the most recent hundred —
     and two records for one person are usually weeks apart, so it could
     not find what it exists to find. */
  async duplicates(page = 1, pageSize = 25): Promise<{ groups: DuplicateGroup[]; total: number }> {
    const d = await request<{ groups: { kind: string; key: string; leads: ApiLead[] }[]; total: number }>(
      `/api/crm/leads/duplicates?page=${page}&page_size=${pageSize}`,
    );
    return {
      groups: d.groups.map((g) => ({ kind: g.kind, key: g.key, leads: g.leads.map(toLead) })),
      total: d.total,
    };
  },

  /* ── Handing work to someone ────────────────────────────────────── */

  /** Whoever is at their desk right now, or everyone when nobody is. */
  async assignableStaff(locationId?: number | null): Promise<{ anyoneOnline: boolean; staff: AssignableStaff[] }> {
    const q = locationId ? `?location=${locationId}` : "";
    return request(`/api/crm/staff/assignable${q}`);
  },

  async assignTask(taskId: number, staffId: number | null): Promise<{ assigneeName: string | null }> {
    return request(`/api/crm/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ assignee_staff_id: staffId }),
    });
  },

  /* ── One call ───────────────────────────────────────────────────── */

  /** What happened on the floor, from the database rather than this tab. */
  async callEvents(limit = 40, hours = 24): Promise<CallFloorEvent[]> {
    const d = await request<{ events: CallFloorEvent[] }>(`/api/crm/calls/events?limit=${limit}&hours=${hours}`);
    return d.events;
  },

  /** Who was on the other end, and what else they have called about. */
  async callContext(callId: number): Promise<CallContext> {
    return request<CallContext>(`/api/crm/calls/${callId}/context`);
  },

  /** Say what the call actually was. Sticks: the carrier stops writing it. */
  async setCallResult(callId: number, result: CallLog["result"]): Promise<{ result: CallLog["result"]; resultLocked: boolean }> {
    return request(`/api/crm/calls/${callId}`, { method: "PATCH", body: JSON.stringify({ result }) });
  },

  /** Undo a correction and hand the outcome back to the carrier. */
  async clearCallResult(callId: number): Promise<{ result: CallLog["result"]; resultLocked: boolean }> {
    return request(`/api/crm/calls/${callId}`, { method: "PATCH", body: JSON.stringify({ clear: true }) });
  },

  /* ── Notes on a recording ───────────────────────────────────────── */
  async callNotes(callId: number): Promise<CallNote[]> {
    const d = await request<{ notes: CallNote[] }>(`/api/crm/calls/${callId}/notes`);
    return d.notes;
  },

  async addCallNote(callId: number, body: string, atSeconds?: number): Promise<CallNote> {
    const d = await request<{ note: CallNote }>(`/api/crm/calls/${callId}/notes`, {
      method: "POST",
      body: JSON.stringify({ body, atSeconds }),
    });
    return d.note;
  },

  async deleteCallNote(callId: number, noteId: number): Promise<void> {
    await request(`/api/crm/calls/${callId}/notes?note=${noteId}`, { method: "DELETE" });
  },

  async lead(id: string): Promise<Lead> {
    const d = await request<{ lead: ApiLead }>(`/api/crm/leads/${encodeURIComponent(id)}`);
    return toLead(d.lead);
  },

  async appointments(query: ListQuery = {}): Promise<Page<Appointment>> {
    const d = await request<{ appointments: ApiAppointment[]; total: number; counts: Record<string, number> }>(
      `/api/crm/appointments?${listParams(query).toString()}`,
    );
    return { rows: d.appointments.map(toAppointment), total: d.total, counts: d.counts ?? {} };
  },

  async calls(query: ListQuery = {}): Promise<Page<CallLog>> {
    const d = await request<{ calls: ApiCall[]; total: number; counts: Record<string, number> }>(
      `/api/crm/calls?${listParams(query).toString()}`,
    );
    return { rows: d.calls.map(toCall), total: d.total, counts: d.counts ?? {} };
  },

  async conversations(): Promise<Conversation[]> {
    const d = await request<{ conversations: ApiConversation[] }>("/api/crm/conversations");
    return d.conversations.map((c) => toConversation(c));
  },

  async thread(id: number): Promise<{ conversation: Conversation; messages: SmsMessage[] }> {
    const d = await request<{ conversation: ApiConversation; messages: ApiMessage[] }>(`/api/crm/conversations?id=${id}`);
    const messages = d.messages.map(toMessage);
    return { conversation: toConversation(d.conversation, messages), messages };
  },

  async tasks(status = "all"): Promise<TaskItem[]> {
    const d = await request<{ tasks: ApiTask[] }>(`/api/crm/tasks?status=${status}`);
    return d.tasks.map(toTask);
  },

  async logCallAttempt(p: {
    to: string; name: string; leadId: string | null;
    customerId: string | null; locationId: number;
  }): Promise<{ call: CallLog; dialled: boolean; reason: string | null }> {
    const d = await request<{ call: ApiCall; dialled: boolean; reason: string | null }>("/api/crm/calls/log", {
      method: "POST",
      body: JSON.stringify({
        to: p.to, name: p.name, lead_id: p.leadId,
        customer_id: p.customerId, location_id: p.locationId,
      }),
    });
    return { call: toCall({ ...d.call, agent: null }), dialled: d.dialled, reason: d.reason };
  },

  async convertLead(id: string, when: { date: string; time: string }): Promise<{ id: number; bkUuid: string }> {
    const d = await request<{ appointment: { id: number }; bkUuid: string }>(
      `/api/crm/leads/${encodeURIComponent(id)}/convert`,
      { method: "POST", body: JSON.stringify({ preferred_date: when.date, preferred_time: when.time }) },
    );
    return { id: d.appointment.id, bkUuid: d.bkUuid };
  },

  async setLeadStatus(id: string, callStatus: CallStatus): Promise<Lead> {
    // The PATCH returns the bare row; the list joins add studio and counts,
    // so fill those in from what the caller already knows.
    const d = await request<{ lead: Omit<ApiLead, "studio" | "callCount"> }>(
      `/api/crm/leads/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ call_status: callStatus }) },
    );
    return toLead({
      ...d.lead,
      studio: { id: d.lead.locationId, name: "", city: "", slug: "" },
      callCount: 0,
    });
  },

  async createStudio(p: Record<string, unknown>): Promise<ApiStudio> {
    const d = await request<{ studio: ApiStudio }>("/api/crm/studios", {
      method: "POST", body: JSON.stringify(p),
    });
    return d.studio;
  },

  async inviteStaff(p: Record<string, unknown>): Promise<{ inviteUrl: string; expiresAt: string }> {
    return request<{ inviteUrl: string; expiresAt: string }>("/api/crm/staff/invite", {
      method: "POST", body: JSON.stringify(p),
    });
  },

  async saveStudio(id: number, patch: Record<string, unknown>): Promise<ApiStudio> {
    const d = await request<{ studio: ApiStudio }>(`/api/crm/studios/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return d.studio;
  },

  async notes(): Promise<Note[]> {
    const d = await request<{ notes: ApiNote[] }>("/api/crm/notes");
    return d.notes.map(toNote);
  },

  async addNote(p: { type: "lead" | "appointment" | "customer"; id: string; content: string }): Promise<Note> {
    const d = await request<{ note: ApiNote }>("/api/crm/notes", {
      method: "POST",
      body: JSON.stringify({ notable_type: p.type, notable_id: p.id, content: p.content }),
    });
    return toNote(d.note);
  },

  async dashboard(days = 14): Promise<DashboardData> {
    return request<DashboardData>(`/api/crm/dashboard?days=${days}`);
  },

  async templates(): Promise<SmsTemplate[]> {
    const d = await request<{ templates: SmsTemplate[] }>("/api/crm/templates");
    return d.templates;
  },

  async saveTemplate(p: { key: string; locationId?: number | null; bodies: Record<string, string> }): Promise<void> {
    await request("/api/crm/templates", {
      method: "PATCH",
      body: JSON.stringify({ key: p.key, location_id: p.locationId ?? null, bodies: p.bodies }),
    });
  },

  async setArtistActive(id: number, active: boolean): Promise<void> {
    await request("/api/crm/artists", { method: "PATCH", body: JSON.stringify({ id, active }) });
  },

  async setStudioBooking(id: number, active: boolean): Promise<void> {
    await request(`/api/crm/studios/${id}`, {
      method: "PATCH", body: JSON.stringify({ booking_active: active }),
    });
  },

  async markConversationRead(id: number): Promise<void> {
    await request("/api/crm/conversations", {
      method: "PATCH", body: JSON.stringify({ id, unread: false }),
    });
  },

  async sendSms(p: { to: string; locationId: number; body: string; leadId?: string | null }): Promise<void> {
    await request("/api/sms/send", {
      method: "POST",
      body: JSON.stringify({
        to: p.to, location_id: p.locationId, body: p.body, lead_id: p.leadId ?? null,
      }),
    });
  },

  async setApptStatus(id: number, status: string): Promise<void> {
    await request(`/api/crm/appointments/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  },

  async saveNumber(studioId: number, n: { id?: number; kind: string; label: string; number: string; smsCapable: boolean }) {
    await request(`/api/crm/studios/${studioId}/numbers`, {
      method: "POST",
      body: JSON.stringify({
        id: n.id && n.id > 0 ? n.id : undefined,
        kind: n.kind, label: n.label, number: n.number, sms_capable: n.smsCapable,
      }),
    });
  },

  async removeNumber(studioId: number, numberId: number) {
    await request(`/api/crm/studios/${studioId}/numbers?number_id=${numberId}`, { method: "DELETE" });
  },

  async addTask(p: Record<string, unknown>): Promise<{ id: number }> {
    const d = await request<{ task: { id: number } }>("/api/crm/tasks", {
      method: "POST", body: JSON.stringify(p),
    });
    return d.task;
  },

  async setTaskStatus(id: number, status: "open" | "done") {
    await request("/api/crm/tasks", { method: "PATCH", body: JSON.stringify({ id, status }) });
  },

  async deleteTask(id: number) {
    await request(`/api/crm/tasks?id=${id}`, { method: "DELETE" });
  },

  async saveStaff(p: Record<string, unknown>) {
    await request("/api/crm/staff", { method: "PATCH", body: JSON.stringify(p) });
  },

  async setRolePermission(roleId: string, permissionId: string, granted: boolean) {
    await request("/api/crm/roles", {
      method: "PATCH",
      body: JSON.stringify({ role_id: roleId, permission_id: permissionId, granted }),
    });
  },

  async campaigns(): Promise<ApiCampaign[]> {
    const d = await request<{ campaigns: ApiCampaign[] }>("/api/crm/campaigns");
    return d.campaigns;
  },

  async createCampaign(p: Record<string, unknown>): Promise<{ id: number }> {
    const d = await request<{ campaign: { id: number } }>("/api/crm/campaigns", {
      method: "POST", body: JSON.stringify(p),
    });
    return d.campaign;
  },

  async sendCampaign(id: number) {
    await request("/api/crm/campaigns", { method: "PATCH", body: JSON.stringify({ id, action: "send" }) });
  },

  async mergeLeads(primaryId: string, otherIds: string[], take: Record<string, unknown>) {
    await request("/api/crm/leads/merge", {
      method: "POST",
      body: JSON.stringify({ primary_id: primaryId, other_ids: otherIds, take }),
    });
  },

  async uploadFile(file: File): Promise<string> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", {
      method: "POST",
      credentials: "same-origin",
      body: fd,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new ApiError(res.status, body.message ?? "Upload failed");
    }
    const data = (await res.json()) as { url: string };
    return data.url;
  },

  async reports(days: string): Promise<ReportSummary> {
    return request<ReportSummary>(`/api/crm/reports?days=${encodeURIComponent(days)}`);
  },

  async auditLogs(params: { targetType?: string; targetId?: string } = {}): Promise<AuditLog[]> {
    /* URLSearchParams stringifies an undefined value as the literal
       "undefined", which the server then matches as a real target id and
       answers with nothing. Drop empty entries instead. */
    const q = new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
    ).toString();
    const d = await request<{ logs: AuditLog[] }>(`/api/crm/audit?${q}`);
    return d.logs;
  },
};

export type { Note };
