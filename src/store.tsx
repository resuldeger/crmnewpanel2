"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  EXTENSIONS, CALL_STATUS_META, nextId, setStudioRegistry, prettyPhone,
  type Lead, type Appointment, type CallLog, type Conversation, type SmsMessage, type Note,
  type Studio, type Artist, type StaffMember, type StudioNumber, type Campaign, type TaskItem, type CallStatus, type ApptStatus,
  type PermId, type AuditLog, type Customer,
} from "./data";
import { t, tf } from "./i18n";
import { pathToRoute, routeToPath } from "./router";
import { crmApi, toDbHours, toCampaign, type DashboardData, type SmsTemplate, type CallFloorEvent } from "./services/crmApi";
import { useRealtimeChannels } from "./hooks/useRealtime";

export type Route =
  | { view: "live" }
  | { view: "dashboard" } | { view: "customers" } | { view: "customer"; id: string }
  | { view: "customer_subview"; id: string; sub: "calls" | "audit" | "notes" | "briefs" }
  | { view: "leads" } | { view: "lead"; id: string }
  | { view: "lead_subview"; id: string; sub: "calls" | "audit" | "notes" }
  | { view: "appointments" } | { view: "appointment"; id: number }
  | { view: "appointment_subview"; id: number; sub: "calls" | "notes" }
  | { view: "sms"; id?: number } | { view: "campaigns" } | { view: "calls" } | { view: "tasks" }
  | { view: "reports" } | { view: "studios" } | { view: "studio"; id?: number }
  | { view: "staff" } | { view: "settings" } | { view: "duplicates" } | { view: "import" } | { view: "notfound" };

export type DateRange = "today" | "7" | "30" | "all";
export interface Toast { id: number; msg: string; kind: "success" | "info" | "error" }

export interface LiveCall {
  id: number; name: string; phone: string; direction: "inbound" | "outbound";
  ext: string; agent: string; startedAt: number; ringing: boolean;
  leadId: string | null; locationId: number;
  /** Vonage's call id — the only stable identity across polls. */
  callId: string;
  /** The line the customer sees — the branch DID, or the seat's caller id. */
  did: string | null;
}

/** What the gateway sends on calls:live. */
export interface TelephonyCall {
  callId: string;
  direction: "inbound" | "outbound";
  category: "branch" | "callcenter" | "unknown";
  extension: string | null;
  name: string | null;
  locationId: number | null;
  did: string | null;
  remoteNumber: string | null;
  remoteName: string | null;
  status: string;
  startedAt: string | null;
  answeredAt: string | null;
}

let liveKey = 0;
const liveIds = new Map<string, number>();

/** Maps a gateway call onto the board's row shape. */
function toLiveCall(c: TelephonyCall): LiveCall {
  let id = liveIds.get(c.callId);
  if (id === undefined) { id = ++liveKey; liveIds.set(c.callId, id); }
  return {
    id,
    callId: c.callId,
    /* The other party ONLY. It used to fall back to `c.name`, which is our
       own extension's display name, so a call with no caller-name lookup
       showed "Cleopatra Ink Callcenter8" in the place the customer's name
       goes — the board looked like we were calling ourselves. The agent
       has its own field below. */
    name: c.remoteName ?? "",
    phone: c.remoteNumber ?? "",
    direction: c.direction,
    ext: c.extension ?? "",
    agent: c.name ?? "",
    startedAt: c.startedAt ? +new Date(c.startedAt) : Date.now(),
    /* Vonage walks a call through initializing → ringing → on-call →
       disconnected. Only "on-call" is actually connected — and note that
       matching /connected/ would also match "disconnected", which is the
       opposite state. */
    ringing: !/^(on-call|active)$/i.test(c.status.trim()),
    leadId: null,
    locationId: c.locationId ?? 0,
    did: c.did,
  };
}
export interface LiveEvent {
  id: number;
  kind: "answer" | "queue" | "end" | "voicemail" | "miss";
  text: string;
  at: string;
  /** Which call this belongs to, so the stream can group by it. One call
   *  produces a line for ringing, one for answering and one for hanging
   *  up, and read as a flat list those three look like three calls. */
  callId?: string;
  /** The other party and the desk, kept apart so a row can label them. */
  who?: string;
  ext?: string;
}

/** One recorded floor event, as a line someone can read. */
function describeFloorEvent(e: CallFloorEvent): string {
  const who = e.payload.agent ?? (e.payload.extension ? `#${e.payload.extension}` : "—");
  const other = e.payload.remote ?? "";
  if (e.eventType === "call.started") return tf("{who} · {dir} {other}", {
    who, other, dir: e.payload.direction === "inbound" ? t("Incoming") : t("Outgoing"),
  });
  if (e.eventType === "call.ended") return tf("{who} · call ended", { who });
  return tf("{who} · {from} → {to}", { who, from: e.payload.from ?? "?", to: e.payload.to ?? "?" });
}

interface Store {
  route: Route; navigate: (r: Route, opts?: { replace?: boolean }) => void;
  globalLocation: number | "all"; setGlobalLocation: (v: number | "all") => void;
  dateRange: DateRange; setDateRange: (v: DateRange) => void;
  inRange: (isoStr: string) => boolean;
  /** Aggregates and series for the reporting screens, computed server-side. */
  dashboard: DashboardData | null;
  templates: SmsTemplate[];
  /** A template's wording in the RECIPIENT's language, never the operator's. */
  templateFor: (key: string, recipientLocale: string | null | undefined, locationId?: number | null) => string;
  inviteLink: { name: string; url: string } | null;
  dismissInvite: () => void;
  leads: Lead[]; appointments: Appointment[]; calls: CallLog[];
  conversations: Conversation[]; notes: Note[]; studios: Studio[]; artists: Artist[];
  extensions: typeof EXTENSIONS; liveCalls: number; liveCallsArr: LiveCall[]; liveEvents: LiveEvent[];
  staff: StaffMember[]; matrix: Record<string, string[]>; numbers: { id: number; studioId: number; kind: "vonage" | "twilio" | "branch"; label: string; number: string; smsCapable: boolean }[];
  campaigns: Campaign[]; tasks: TaskItem[];
  auditLogs: AuditLog[]; logAudit: (log: Omit<AuditLog, "id" | "at">) => void;
  fetchAuditLogs: (params: { targetType?: string; targetId?: string }) => Promise<AuditLog[]>;
  dataLoading: boolean;
  customers: Customer[]; customerById: (id: string) => Customer | undefined;
  session: StaffMember | null;
  authLoading: boolean;
  authError: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  can: (perm: PermId) => boolean; guard: (perm: PermId) => boolean;
  inScope: (locId: number) => boolean;
  locOk: (locId: number | null | undefined) => boolean;
  scopedStudios: Studio[];
  /** Re-reads the task list, after something outside this tab changed it. */
  refreshTasks: () => Promise<void>;
  lastVonageSync: number; lastTwilioSync: number;
  unreadTotal: number; notCalledCount: number; pendingCount: number; openTaskCount: number; dupGroupCount: number;
  toasts: Toast[]; toast: (msg: string, kind?: Toast["kind"]) => void; dismissToast: (id: number) => void;
  updateLeadStatus: (id: string, s: CallStatus) => Promise<void>;
  addNote: (type: "lead" | "appointment" | "customer", id: string, content: string) => void;
  sendSms: (convId: number, body: string) => void;
  sendLeadSms: (leadId: string, body: string) => number;
  sendSmsTo: (phone: string, name: string, locationId: number, body: string) => number;
  ensureLead: (id: string) => void;
  markRead: (convId: number) => void;
  loadThread: (convId: number) => void; simulateReply: (convId: number) => void;
  convertLead: (id: string, when?: { date: string; time: string }) => Promise<number | null>;
  updateApptStatus: (id: number, s: ApptStatus) => void;
  toggleBooking: (locId: number) => void; toggleArtist: (id: number) => void;
  saveStudio: (s: Studio) => number; saveStaff: (m: StaffMember) => void; toggleStaffActive: (id: number) => void;
  setMatrixGrant: (roleId: string, permId: string, on: boolean) => void;
  saveNumber: (n: { id: number; studioId: number; kind: "vonage" | "twilio" | "branch"; label: string; number: string; smsCapable: boolean }) => void;
  removeNumber: (id: number) => void;
  createCampaign: (c: Omit<Campaign, "id" | "createdAt" | "delivered" | "failed" | "replied" | "status"> & { status?: Campaign["status"] }) => number;
  sendCampaign: (id: number) => void;
  addTask: (task: Omit<TaskItem, "id" | "createdAt" | "status" | "doneAt">) => void;
  completeTask: (id: number) => void; deleteTask: (id: number) => void;
  mergeLeads: (primaryId: string, otherIds: string[], take: Partial<Lead>) => void;
  importCsvData: (p: { studios: Studio[]; leads: Lead[]; appointments: Appointment[]; calls: CallLog[] }) => void;
  endLiveCall: (id: number) => number | null;
  logCallback: (p: { name: string; phone: string; customerId: string | null; locationId: number | null; leadId?: string | null }) => Promise<"Attempted" | null>;
  callsFor: (customerId: string) => CallLog[];
  notesFor: (type: "lead" | "appointment" | "customer", id: string) => Note[];
  convFor: (customerId: string | null) => Conversation | undefined;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
};

const CC_EXTS = EXTENSIONS.filter(e => e.locationId === null);
/* The floor starts empty; real carrier events fill it. */
const seedFeed: LiveCall[] = [];

/* groupDuplicates() used to live here, grouping the store's leads by
   phone. It is gone rather than kept: it could only ever see the recent
   slice the console holds, and two records for one person are usually
   weeks apart. Duplicates are found by /api/crm/leads/duplicates, over
   every lead the operator may see. */

export function StoreProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => typeof window !== "undefined" ? pathToRoute(window.location.pathname) : { view: "dashboard" });
  const [globalLocation, setGlobalLocation] = useState<number | "all">("all");
  const [dateRange, setDateRange] = useState<DateRange>("30");
  /* ── Live data ────────────────────────────────────────────────────────
   * Everything below used to start from the seed arrays in src/data.ts, so
   * the console showed invented records that looked exactly like real ones.
   * It now starts empty and is filled from the API once a session exists. */
  /* ── Counters ────────────────────────────────────────────────────────
   * Every badge in the sidebar used to be derived from the arrays above,
   * which are now an explicitly bounded recent slice. "3 leads waiting to
   * be called" meant three within the last hundred records, and the number
   * shrank as the pipeline grew — the opposite of what a badge is for.
   * The API counts these over the whole table; the console just has to
   * read them instead of recomputing them. */
  const [counters, setCounters] = useState({
    notCalledLeads: 0, pendingAppointments: 0, unreadSms: 0, openTasks: 0, duplicateGroups: 0,
  });

  const [leads, setLeads] = useState<Lead[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [studios, setStudios] = useState<Studio[]>([]);
  /* Demo artists before; the real roster comes with the bootstrap payload. */
  const [artists, setArtists] = useState<Artist[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  /* The dashboard used to plot a static array from data.ts, so the volume
     chart, the sparklines and the funnel showed the same invented numbers
     whatever the business did. Comes from /api/crm/dashboard now. */
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  /* Templates carry every language. The console used to hold its own
     English-only copies, so picking one for a Turkish customer sent
     English — see templateFor below. */
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  /* Shown once, right after an invite is cut: the raw token is never stored
     and cannot be read back. */
  const [inviteLink, setInviteLink] = useState<{ name: string; url: string } | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  /* Empty until the real matrix loads. Seeding it with the demo grants
     meant the screen showed permissions nobody had been given. */
  const [matrix, setMatrix] = useState<Record<string, string[]>>({});
  /* ── session (persisted; real auth will be Supabase) ── */
  /* ── Authentication ───────────────────────────────────────────────────
   * The session lives in an httpOnly cookie the server sets; the console
   * only learns who it is by asking. Previously this defaulted to
   * STAFF[0] — every visitor was silently signed in as a super admin, and
   * the password check ran in the browser. */
  const [session, setSession] = useState<StaffMember | null>(null);
  const [serverPermissions, setServerPermissions] = useState<string[] | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const adoptUser = useCallback((u: {
    id: number; name: string; email: string; roleId: string;
    scopeAll: boolean; locationIds: number[]; permissions: string[]; active: boolean;
  } | null) => {
    if (!u) { setSession(null); setServerPermissions(null); return; }
    setSession({
      id: u.id, name: u.name, email: u.email, roleId: u.roleId,
      locationIds: u.scopeAll ? "all" : u.locationIds,
      active: u.active, lastActiveAt: new Date().toISOString(),
    });
    setServerPermissions(u.permissions);
  }, []);

  /* ── The working set ─────────────────────────────────────────────────
   * These arrays are NOT the lists the operator browses. Leads,
   * Appointments and Calls each run their own server-side query now, so
   * searching, filtering and exporting see the whole table rather than
   * whatever happened to be loaded.
   *
   * What stays here is a recent slice used for cross-referencing —
   * resolving a lead named on an appointment, counting a customer's calls,
   * finding duplicates — and as the thing realtime events patch. It is
   * bounded on purpose; anything that must be exhaustive asks the server.
   * ────────────────────────────────────────────────────────────────── */
  const WORKING_SET = 100;

  /** Pulls everything the console shows. Runs once a session exists. */
  const refreshData = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      const [boot, leadPage, apptPage, callPage, convRows, taskRows, noteRows, campaignRows, dash, templateRows] = await Promise.all([
        crmApi.bootstrap(),
        crmApi.leads({ pageSize: WORKING_SET }),
        crmApi.appointments({ pageSize: WORKING_SET }),
        crmApi.calls({ pageSize: WORKING_SET }),
        crmApi.conversations(),
        crmApi.tasks(),
        crmApi.notes(),
        crmApi.campaigns(),
        crmApi.dashboard(14),
        crmApi.templates(),
      ]);
      setCounters(boot.counters);
      void loadFloorEvents();
      setStudios(boot.studios);
      // Module-level lookups (studioById) read from here.
      setStudioRegistry(boot.studios);
      setStaff(boot.staff);
      setMatrix(boot.matrix);
      setLeads(leadPage.rows);
      setAppointments(apptPage.rows);
      setCalls(callPage.rows);
      setConversations(convRows);
      setTasks(taskRows);
      setNumbers(boot.numbers);
      setArtists(boot.artists);
      // Notes were written to the database but never read back, so every
      // saved note vanished on the next load anyway.
      setNotes(noteRows);
      setCampaigns(campaignRows.map(toCampaign));
      setDashboard(dash);
      setTemplates(templateRows);
    } catch (err) {
      // Showing stale or invented data would be worse than showing none.
      setDataError(err instanceof Error ? err.message : "Could not load data");
    } finally {
      setDataLoading(false);
    }
  }, []);

  /* One slice at a time. A live event used to have no listener at all; the
     obvious fix — call refreshData() — would pull ten endpoints and flip
     the global loading flag every time a single booking changed. */
  const refreshAppointments = useCallback(async () => {
    try { setAppointments((await crmApi.appointments({ pageSize: WORKING_SET })).rows); } catch { /* keep what we have */ }
  }, []);
  const refreshLeads = useCallback(async () => {
    try { setLeads((await crmApi.leads({ pageSize: WORKING_SET })).rows); } catch { /* keep what we have */ }
  }, []);
  const refreshTasks = useCallback(async () => {
    try { setTasks(await crmApi.tasks()); } catch { /* keep what we have */ }
  }, []);
  const refreshCalls = useCallback(async () => {
    try { setCalls((await crmApi.calls({ pageSize: WORKING_SET })).rows); } catch { /* keep what we have */ }
  }, []);
  const refreshConversations = useCallback(async () => {
    try { setConversations(await crmApi.conversations()); } catch { /* keep what we have */ }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!alive) return;
        adoptUser(d?.user ?? null);
        if (d?.user) void refreshData();
      })
      .catch(() => { /* offline — stay signed out rather than assume access */ })
      .finally(() => { if (alive) setAuthLoading(false); });
    return () => { alive = false; };
  }, [adoptUser, refreshData]);


  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    setAuthError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAuthError(data.message ?? "Sign in failed");
        return false;
      }
      adoptUser(data.user);
      void refreshData();
      setRoute({ view: "dashboard" });
      try { window.history.replaceState(null, "", routeToPath({ view: "dashboard" })); } catch { /* sandboxed */ }
      if (typeof window !== "undefined") window.scrollTo({ top: 0 });
      return true;
    } catch {
      setAuthError("Could not reach the server");
      return false;
    }
  }, [adoptUser, refreshData]);

  const logout = useCallback(async () => {
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); } catch { /* ignore */ }
    adoptUser(null);
    // Nothing from the previous session may linger in memory.
    setLeads([]); setAppointments([]); setCalls([]);
    setConversations([]); setTasks([]); setNotes([]);
    setStudios([]); setStaff([]);
  }, [adoptUser]);
  /* Seeded from demo constants before, so the console listed Twilio and
     Vonage numbers that existed nowhere but the browser. Comes from the
     bootstrap payload now. */
  const [numbers, setNumbers] = useState<StudioNumber[]>([]);
  /* Seeded from demo constants, so the Campaigns screen listed sends that
     never happened. Loaded from the database now. */
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastVonageSync, setLastVonageSync] = useState(() => Date.now() - 4 * 60_000);
  const [lastTwilioSync, setLastTwilioSync] = useState(() => Date.now() - 90_000);
  const [liveFeed, setLiveFeed] = useState<LiveCall[]>(seedFeed);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const feedRef = useRef(liveFeed);

  /* History-API navigation — clean paths, no hash */
  const navigate = useCallback((r: Route, opts?: { replace?: boolean }) => {
    const path = routeToPath(r);
    try {
      if (opts?.replace) window.history.replaceState(null, "", path);
      else if (window.location.pathname !== path) window.history.pushState(null, "", path);
    } catch { /* sandboxed iframe without URL access — state routing still works */ }
    setRoute(r);
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(pathToRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts(ts => ts.filter(x => x.id !== id)), []);
  const toast = useCallback((msg: string, kind: Toast["kind"] = "success") => {
    const id = nextId();
    setToasts(ts => [...ts.slice(-3), { id, msg, kind }]);
    setTimeout(() => dismissToast(id), 3600);
  }, [dismissToast]);

  const sessionRoleId = session?.roleId ?? "";
  /* Permissions come from the server session. The local matrix is only a
   * fallback for the Permission Matrix editor, which shows every role. The
   * server re-checks on every mutation regardless of what this returns. */
  const can = useCallback(
    (perm: PermId) =>
      sessionRoleId === "super_admin" ||
      (serverPermissions ?? matrix[sessionRoleId] ?? []).includes(perm),
    [serverPermissions, matrix, sessionRoleId],
  );
  const guard = useCallback((perm: PermId) => {
    if ((matrix[sessionRoleId] ?? []).includes(perm)) return true;
    toast(tf("Permission required · {perm}", { perm }), "error");
    return false;
  }, [matrix, sessionRoleId, toast]);

  /* ── branch scope enforcement ── */
  const inScope = useCallback((locId: number) => {
    if (!session || session.locationIds === "all") return true;
    return session.locationIds.includes(locId);
  }, [session]);
  /* A row whose studio we could not work out belongs to no branch, so it
     is shown only when no branch filter is on — hiding it entirely would
     lose calls nobody can then see, and showing it under every branch
     would put another studio's call on your screen. */
  const locOk = useCallback((locId: number | null | undefined) =>
    locId == null
      ? globalLocation === "all"
      : inScope(locId) && (globalLocation === "all" || globalLocation === locId),
    [inScope, globalLocation]);
  const scopedStudios = useMemo(() => studios.filter(s => inScope(s.id)), [studios, inScope]);
  useEffect(() => {
    if (globalLocation !== "all" && !inScope(globalLocation)) setGlobalLocation("all");
  }, [globalLocation, inScope]);

  const logAudit: Store["logAudit"] = useCallback((entry) => {
    setAuditLogs(prev => [{
      id: nextId(),
      at: new Date().toISOString(),
      ...entry,
    }, ...prev]);
  }, []);

  const fetchAuditLogs = useCallback(async (params: { targetType?: string; targetId?: string }): Promise<AuditLog[]> => {
    try {
      const logs = await crmApi.auditLogs(params);
      setAuditLogs(prev => {
        const byId = new Map(prev.map(a => [a.id, a]));
        logs.forEach(l => byId.set(l.id, l));
        return [...byId.values()].sort((a, b) => +new Date(b.at) - +new Date(a.at));
      });
      return logs;
    } catch {
      return [];
    }
  }, []);

  const pushEvent = useCallback((kind: LiveEvent["kind"], text: string, call?: { callId: string; who: string; ext: string }) => {
    setLiveEvents(es => [{
      id: nextId(), kind, text, at: new Date().toISOString(),
      callId: call?.callId, who: call?.who, ext: call?.ext,
    }, ...es].slice(0, 80));
  }, []);

  /* ── The floor's own history ──────────────────────────────────────
   * This list used to exist only in this tab: twelve entries, filled
   * while the page was open, emptied by a reload. A shift nobody was
   * watching left nothing behind at all.
   *
   * The gateway records every event now, so the stream starts from what
   * actually happened and the live ones arrive on top. */
  const loadFloorEvents = useCallback(async () => {
    try {
      const rows = await crmApi.callEvents(40, 24);
      setLiveEvents(rows.map(e => ({
        id: e.id,
        kind: e.eventType === "call.ended" ? "end" : e.eventType === "call.started" ? "queue" : "answer",
        text: describeFloorEvent(e),
        at: e.occurredAt,
        callId: e.callUuid ?? undefined,
        who: e.payload.remote ?? undefined,
        ext: e.payload.extension ?? undefined,
      })));
    } catch {
      /* The board still works without its history. */
    }
  }, []);

  /* ── live call floor (Vonage Events API simulation) ── */
  const logFromLive = useCallback((c: LiveCall, durSec: number, result: CallLog["result"]) => {
    const ext = EXTENSIONS.find(e => e.extension === c.ext);
    const lineName = `${ext?.displayName ?? "Callcenter"} (#${c.ext})`;
    setCalls(cs => [{
      id: nextId(), direction: c.direction,
      recordingAvailable: false,
      fromNumber: c.direction === "inbound" ? c.phone : ext?.phoneNumber ?? c.phone,
      toNumber: c.direction === "inbound" ? ext?.phoneNumber ?? c.phone : c.phone,
      fromName: c.direction === "inbound" ? c.name : lineName,
      toName: c.direction === "inbound" ? lineName : c.name,
      customerId: c.leadId, appointmentId: null, locationId: c.locationId,
      startTime: new Date(c.startedAt).toISOString(),
      duration: result === "Answered" ? Math.max(1, durSec) : 0,
      result, hasRecording: result === "Answered" || result === "Voicemail",
      agent: c.agent, ext: c.ext,
    }, ...cs]);
    setLastVonageSync(Date.now());
  }, []);

  /* ── Live call floor ──────────────────────────────────────────────────
   * This used to invent a call every 14 seconds from the seed leads, walk
   * it through ringing → answered → ended, and write the result into the
   * call log — fabricated records indistinguishable from real ones, and
   * the "last synced" badge ticked as though a carrier had answered.
   *
   * The floor is fed by real carrier events instead: the Twilio voice
   * webhook writes a row to realtime_events, and the socket gateway (next
   * on the list) pushes it here. Until that gateway exists the floor is
   * empty, which is the truth — no call is in progress.
   * ────────────────────────────────────────────────────────────────── */

  const endLiveCall = useCallback((id: number): number | null => {
    const c = feedRef.current.find(x => x.id === id);
    if (!c) return null;
    const dur = Math.max(1, Math.floor((Date.now() - c.startedAt) / 1000));
    feedRef.current = feedRef.current.filter(x => x.id !== id);
    setLiveFeed(feedRef.current);
    logFromLive(c, dur, c.ringing ? "Missed" : "Answered");
    pushEvent("end", tf("Call with {name} wrapped", { name: c.name }));
    return c.ringing ? 0 : dur;
  }, [logFromLive, pushEvent]);

  /**
   * Logs an outbound attempt against the lead. It does NOT decide whether
   * the call was answered — that used to be a coin flip here, with a random
   * talk duration, which meant the call log and every report over it were
   * invented. The carrier webhook updates the row with the real outcome.
   */
  const logCallback = useCallback(async (p: { name: string; phone: string; customerId: string | null; locationId: number | null; leadId?: string | null }): Promise<"Attempted" | null> => {
    if (!guard("calls.manage")) return null;
    try {
      const { call, dialled, reason } = await crmApi.logCallAttempt({
        to: p.phone,
        name: p.name,
        leadId: p.leadId ?? null,
        customerId: p.customerId,
        locationId: p.locationId,
      });
      setCalls(cs => [call, ...cs]);
      pushEvent("queue", tf("Dialling {name}", { name: p.name }));
      /* It used to say "Calling…" whether or not anything had been
         dialled. When nothing rings, saying so is the difference between
         a logged note and a customer waiting for a call that never
         comes. */
      if (dialled) {
        toast(tf("Calling {name} · your phone is ringing", { name: p.name }), "info");
      } else {
        toast(tf("Logged — not dialled: {reason}", { reason: reason ?? "unknown" }), "error");
      }
      return "Attempted";
    } catch (err) {
      toast(err instanceof Error ? err.message : t("Could not place the call"), "error");
      return null;
    }
  }, [guard, pushEvent, toast]);

  /* The delivery counters used to climb on their own: every 450ms a timer
   * invented 1–3 more "delivered", failed 12% of the time and replied 20%
   * of the time, until the campaign reported itself sent. None of it had
   * touched a carrier. Real counters come from the Twilio status webhook,
   * which already increments campaigns.delivered / .failed, once the
   * dispatcher worker starts sending. */

  /* A campaign that exists only in the browser is one the dispatcher job
     never sees, so "scheduled" meant nothing was ever sent. */
  const createCampaign: Store["createCampaign"] = useCallback(c => {
    const tempId = nextId();
    setCampaigns(cs => [{
      ...c, id: tempId, status: c.status ?? "draft", delivered: 0, failed: 0, replied: 0, createdAt: new Date().toISOString(),
    }, ...cs]);

    void crmApi.createCampaign({
      name: c.name,
      body: c.body,
      segment: c.segment ?? {},
      scheduled_at: c.scheduledAt ?? null,
    })
      .then(saved => setCampaigns(cs => cs.map(x => (x.id === tempId ? { ...x, id: saved.id } : x))))
      .catch(err => {
        setCampaigns(cs => cs.filter(x => x.id !== tempId));
        toast(err instanceof Error ? err.message : t("Could not save"), "error");
      });

    return tempId;
  }, [toast, t]);

  const sendCampaign = useCallback((id: number) => {
    const before = campaigns.find(c => c.id === id);
    setCampaigns(cs => cs.map(c => c.id === id ? { ...c, status: "sending" as const } : c));
    setLastTwilioSync(Date.now());

    void crmApi.sendCampaign(id).catch(err => {
      if (before) setCampaigns(cs => cs.map(c => (c.id === id ? before : c)));
      toast(err instanceof Error ? err.message : t("Could not save"), "error");
    });
  }, [campaigns, toast, t]);

  /* ── tasks ── */
  /* The task list is the callback queue. All three of these only touched
     React state, so a queued callback vanished on reload and the audit
     entry the console printed never existed server side. Shown optimistically,
     written for real, rolled back when the write fails. */
  const addTask: Store["addTask"] = useCallback(task => {
    const tempId = nextId();
    setTasks(ts => [{ ...task, id: tempId, createdAt: new Date().toISOString(), status: "open" as const, doneAt: null }, ...ts]);

    void crmApi.addTask({
      title: task.title,
      lead_id: task.leadId,
      lead_name: task.leadName,
      phone_e164: task.phone,
      location_id: task.locationId,
      due_at: task.dueAt,
      source: task.source,
      /* Chosen where the task is raised rather than left for the Tasks
         screen: "create it, go there, find it, assign it" is four steps
         for a decision the operator has already made. */
      assignee_staff_id: task.assigneeStaffId ?? undefined,
    })
      .then(saved => setTasks(ts => ts.map(x => (x.id === tempId ? { ...x, id: saved.id } : x))))
      .catch(err => {
        setTasks(ts => ts.filter(x => x.id !== tempId));
        toast(err instanceof Error ? err.message : t("Could not save"), "error");
      });
  }, [toast, t]);

  const completeTask = useCallback((id: number) => {
    const before = tasks.find(x => x.id === id);
    if (!before || before.status === "done") return;

    setTasks(ts => ts.map(x => (x.id === id ? { ...x, status: "done" as const, doneAt: new Date().toISOString() } : x)));

    void crmApi.setTaskStatus(id, "done").catch(err => {
      setTasks(ts => ts.map(x => (x.id === id ? before : x)));
      toast(err instanceof Error ? err.message : t("Could not save"), "error");
    });
  }, [tasks, toast, t]);

  const deleteTask = useCallback((id: number) => {
    const before = tasks.find(x => x.id === id);
    if (!before) return;

    setTasks(ts => ts.filter(x => x.id !== id));

    void crmApi.deleteTask(id).catch(err => {
      setTasks(ts => [before, ...ts]);
      toast(err instanceof Error ? err.message : t("Could not save"), "error");
    });
  }, [tasks, toast, t]);

  /* ── merge duplicates ── */
  /* The duplicates stayed in the database, so they returned on reload and
     the desk rang the same customer twice. The server marks them merged
     into the survivor and moves their calls, tasks and bookings across. */
  const mergeLeads = useCallback((primaryId: string, otherIds: string[], take: Partial<Lead>) => {
    const before = leads;
    setLeads(ls => ls.filter(l => !otherIds.includes(l.id))
      .map(l => l.id === primaryId ? { ...l, ...take, isDuplicate: false } : l));

    void crmApi.mergeLeads(primaryId, otherIds, take as Record<string, unknown>)
      .then(() => crmApi.addNote({
        type: "lead", id: primaryId, content: `Merged duplicates: ${otherIds.join(", ")}`,
      }))
      .then(saved => setNotes(ns => [saved, ...ns]))
      .catch(err => {
        setLeads(before);
        toast(err instanceof Error ? err.message : t("Could not save"), "error");
      });
  }, [leads, toast, t]);

  /* ── CSV import: upsert studios → leads → appointments → call logs ── */
  const importCsvData = useCallback((p: { studios: Studio[]; leads: Lead[]; appointments: Appointment[]; calls: CallLog[] }) => {
    setStudios(ss => {
      const byId = new Map(ss.map(s => [s.id, s]));
      p.studios.forEach(s => byId.set(s.id, s));
      return [...byId.values()].sort((a, b) => a.id - b.id);
    });
    setLeads(ls => {
      const byId = new Map(ls.map(l => [l.id, l]));
      p.leads.forEach(l => byId.set(l.id, l));
      return [...byId.values()];
    });
    setAppointments(as => {
      const byId = new Map(as.map(a => [a.id, a]));
      p.appointments.forEach(a => byId.set(a.id, a));
      return [...byId.values()].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    });
    if (p.calls.length) {
      setCalls(cs => {
        const keys = new Set(cs.map(c => `${c.customerId}|${c.startTime}|${c.result}`));
        return [...p.calls.filter(c => !keys.has(`${c.customerId}|${c.startTime}|${c.result}`)), ...cs];
      });
    }
  }, []);

  const inRange = useCallback((isoStr: string) => {
    if (dateRange === "all") return true;
    const age = Date.now() - +new Date(isoStr);
    if (dateRange === "today") return new Date(isoStr).toDateString() === new Date().toDateString();
    return age <= (dateRange === "7" ? 7 : 30) * 86_400_000;
  }, [dateRange]);

  /** Persists through the API; the server re-checks permission and scope. */
  const updateLeadStatus = useCallback(async (id: string, next: CallStatus) => {
    if (!guard("leads.edit")) return;
    const before = leads.find(l => l.id === id);
    if (!before || before.callStatus === next) return;

    // Optimistic, so the dropdown feels instant — rolled back if the
    // server refuses (wrong branch, missing permission, stale session).
    setLeads(ls => ls.map(l => (l.id === id ? { ...l, callStatus: next } : l)));
    try {
      const saved = await crmApi.setLeadStatus(id, next);
      setLeads(ls => ls.map(l => (l.id === id ? { ...l, ...saved, meta: l.meta, attr: l.attr } : l)));
      toast(tf("{name} → {status}", { name: before.name, status: CALL_STATUS_META[next].label }), "success");
    } catch (err) {
      setLeads(ls => ls.map(l => (l.id === id ? { ...l, callStatus: before.callStatus } : l)));
      toast(err instanceof Error ? err.message : t("Could not save"), "error");
    }
  }, [guard, leads, toast]);

  /* Notes used to live in React state alone: the note appeared, the toast
     said saved, and a reload lost it — so the next person rang the same
     customer again. Shown optimistically, written for real, rolled back if
     the write fails. */
  const addNote = useCallback((type: "lead" | "appointment" | "customer", id: string, content: string) => {
    const author = session?.name ?? "You";
    const tempId = nextId();
    setNotes(ns => [{ id: tempId, author, notableType: type, notableId: id, content, createdAt: new Date().toISOString() }, ...ns]);

    void crmApi.addNote({ type, id, content })
      .then(saved => setNotes(ns => ns.map(n => (n.id === tempId ? saved : n))))
      .catch(err => {
        setNotes(ns => ns.filter(n => n.id !== tempId));
        toast(err instanceof Error ? err.message : t("Could not save"), "error");
      });
  }, [session, toast, t]);

  /* This used to flip a message to "delivered" 1.1 seconds after send, in
     the browser, with nothing having been sent. Every SMS in the console
     was a drawing of an SMS. Real sending goes through /api/sms/send; the
     carrier's status webhook is what moves it past "queued".
     Rolled back on failure so a message that did not go does not sit there
     looking sent. */
  const dispatchSms = useCallback((
    p: { to: string; locationId: number; body: string; leadId?: string | null },
    convMatch: (c: Conversation) => boolean,
    msgId: number,
  ) => {
    void crmApi.sendSms(p)
      .then(() => {
        setConversations(cs => cs.map(c => (convMatch(c)
          ? { ...c, messages: c.messages.map(m => (m.id === msgId ? { ...m, status: "queued" as const } : m)) }
          : c)));
        setLastTwilioSync(Date.now());
      })
      .catch(err => {
        setConversations(cs => cs.map(c => (convMatch(c)
          ? { ...c, messages: c.messages.filter(m => m.id !== msgId) }
          : c)));
        toast(err instanceof Error ? err.message : t("Message could not be sent"), "error");
      });
  }, [toast, t]);

  const sendSms = useCallback((convId: number, body: string) => {
    const msgId = nextId();
    const senderName = session?.name ?? "Super Admin";
    setConversations(cs => cs.map(c => c.id === convId ? {
      ...c, messages: [...c.messages, { id: msgId, direction: "outbound" as const, body, at: new Date().toISOString(), status: "queued" as const, senderType: "agent", senderName }],
    } : c));
    const conv = conversations.find(c => c.id === convId);
    if (conv) dispatchSms({ to: conv.phone, locationId: conv.locationId, body, leadId: conv.customerId }, c => c.id === convId, msgId);
  }, [conversations, dispatchSms, session]);

  const sendLeadSms = useCallback((leadId: string, body: string): number => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return -1;
    const existing = conversations.find(c => c.customerId === leadId);
    const convId = existing?.id ?? nextId();
    const msgId = nextId();
    const senderName = session?.name ?? "Super Admin";
    setConversations(cs => {
      const msg: SmsMessage = { id: msgId, direction: "outbound", body, at: new Date().toISOString(), status: "queued", senderType: "agent", senderName };
      const ex = cs.find(c => c.customerId === leadId);
      if (ex) return cs.map(c => c.id === ex.id ? { ...c, messages: [...c.messages, msg] } : c);
      return [{ id: convId, phone: lead.formattedPhone, customerId: lead.id, customerName: lead.name, locationId: lead.locationId, unreadCount: 0, unsubscribed: !!lead.unsubscribedAt, messages: [msg] }, ...cs];
    });
    logAudit({
      targetType: "lead",
      targetId: leadId,
      action: "sms_sent",
      actor: senderName,
      actorRole: session?.roleId ?? "super_admin",
      details: body.slice(0, 80) + (body.length > 80 ? "…" : ""),
    });
    dispatchSms({ to: lead.formattedPhone, locationId: lead.locationId, body, leadId }, c => c.id === convId, msgId);
    return convId;
  }, [leads, conversations, dispatchSms, logAudit, session]);

  const sendSmsTo = useCallback((phone: string, name: string, locationId: number, body: string): number => {
    const existing = conversations.find(c => c.phone === phone);
    const convId = existing?.id ?? nextId();
    const msgId = nextId();
    const senderName = session?.name ?? "Super Admin";
    setConversations(cs => {
      const msg: SmsMessage = { id: msgId, direction: "outbound", body, at: new Date().toISOString(), status: "queued", senderType: "agent", senderName };
      const ex = cs.find(c => c.phone === phone);
      if (ex) return cs.map(c => c.id === ex.id ? { ...c, messages: [...c.messages, msg] } : c);
      return [{ id: convId, phone, customerId: null, customerName: name, locationId, unreadCount: 0, unsubscribed: false, messages: [msg] }, ...cs];
    });
    dispatchSms({ to: phone, locationId, body }, c => c.id === convId, msgId);
    return convId;
  }, [conversations, dispatchSms, session]);

  /* The pipeline list hides converted and merged leads — they are not work
     any more — so a lead that became a booking was missing from it and the
     detail screen said "Lead not found" for exactly the ones staff follow a
     link to from that booking. Fetched on demand instead. */
  const fetchedLeads = useRef<Set<string>>(new Set());
  const ensureLead = useCallback((id: string) => {
    if (!id || fetchedLeads.current.has(id)) return;
    fetchedLeads.current.add(id);

    void crmApi.lead(id)
      .then(lead => setLeads(ls => (ls.some(l => l.id === lead.id) ? ls : [lead, ...ls])))
      .catch(() => {
        // Genuinely missing, or outside this account's studios. Leaving the
        // marker set stops a render loop retrying it forever.
      });
  }, []);

  /* Which wording a customer gets is decided by THEIR language, not by
     whatever the operator's console happens to be set to. A studio's own
     version of a template wins over the chain-wide one; English is the
     last resort because every other language falls back to it. */
  const templateFor = useCallback((key: string, recipientLocale: string | null | undefined, locationId?: number | null) => {
    const candidates = templates.filter(x => x.key === key);
    const chosen = candidates.find(x => x.locationId === locationId) ?? candidates.find(x => x.locationId === null);
    if (!chosen) return "";

    const locale = (recipientLocale ?? "en").slice(0, 2).toLowerCase();
    return chosen.bodies[locale] ?? chosen.bodies.en ?? Object.values(chosen.bodies)[0] ?? "";
  }, [templates]);

  const dismissInvite = useCallback(() => setInviteLink(null), []);

  /* Persisted so the badge does not return on reload, and so a colleague
     on another device can see the message has been picked up. */
  const markRead = useCallback((convId: number) => {
    setConversations(cs => cs.map(c => (c.id === convId ? { ...c, unreadCount: 0 } : c)));
    void crmApi.markConversationRead(convId).catch(() => {
      /* The badge reappears on the next load, which is the honest outcome
         of a failed write — better than a silent error toast on a read. */
    });
  }, []);

  /* The conversation list carries a preview, not the messages — loading
     every thread for every studio up front would be a large query nobody
     reads. Nothing fetched them either, so opening a thread showed an empty
     pane however many messages it actually had. Fetched on open, once. */
  const loadedThreads = useRef<Set<number>>(new Set());
  const loadThread = useCallback((convId: number) => {
    if (loadedThreads.current.has(convId)) return;
    loadedThreads.current.add(convId);

    void crmApi.thread(convId)
      .then(({ messages }) => {
        setConversations(cs => cs.map(c => (c.id === convId ? { ...c, messages } : c)));
      })
      .catch(err => {
        // Allow a retry on the next open rather than leaving it blank forever.
        loadedThreads.current.delete(convId);
        toast(err instanceof Error ? err.message : t("Could not load"), "error");
      });
  }, [toast, t]);

  /* Kept so the SMS view's signature does not change, but it no longer
   * fabricates an inbound message three seconds after every send. Real
   * replies arrive through POST /api/webhooks/twilio/inbound. */
  const simulateReply = useCallback((_convId: number) => {
    /* intentionally empty — see above */
  }, []);

  /**
   * Books the lead through the API. This used to mint a BK- code in the
   * browser and push the appointment into local state only — the booking
   * never reached the database, so it disappeared on refresh and the
   * studio's calendar never saw it.
   */
  const convertLead = useCallback(async (id: string, when?: { date: string; time: string }): Promise<number | null> => {
    if (!guard("leads.convert")) return null;
    const lead = leads.find(l => l.id === id);
    if (!lead) return null;

    // Default to five days out at 14:00 when the caller has not picked a
    // slot; the API rejects it if that time is already taken.
    const target = when ?? {
      date: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10),
      time: "14:00",
    };

    try {
      const created = await crmApi.convertLead(id, target);
      await refreshData();
      toast(tf("{name} converted to appointment", { name: lead.name }), "success");
      return created.id;
    } catch (err) {
      toast(err instanceof Error ? err.message : t("Could not convert this lead"), "error");
      return null;
    }
  }, [guard, leads, refreshData, toast]);

  /* The desk confirming a booking after the call is the point of the whole
     flow, so it has to reach the database — and carry who confirmed it.
     The server writes confirmed_by/at and the audit row. */
  const updateApptStatus = useCallback((id: number, s: ApptStatus) => {
    const before = appointments.find(a => a.id === id);
    if (!before || before.status === s) return;

    setAppointments(as => as.map(a => (a.id === id ? { ...a, status: s } : a)));

    void crmApi.setApptStatus(id, s).catch(err => {
      setAppointments(as => as.map(a => (a.id === id ? { ...a, status: before.status } : a)));
      toast(err instanceof Error ? err.message : t("Could not save"), "error");
    });
  }, [appointments, toast, t]);

  /* This switch is what publishes a branch on the public booking site, so
     leaving it in React state meant the studio never actually went live —
     or never came down. */
  const toggleBooking = useCallback((locId: number) => {
    const before = studios.find(s => s.id === locId);
    if (!before) return;
    const next = !before.bookingActive;
    setStudios(ss => ss.map(s => (s.id === locId ? { ...s, bookingActive: next } : s)));

    void crmApi.setStudioBooking(locId, next).catch(err => {
      setStudios(ss => ss.map(s => (s.id === locId ? before : s)));
      toast(err instanceof Error ? err.message : t("Could not save"), "error");
    });
  }, [studios, toast, t]);

  /* An artist switched off must stop counting toward the roster and stop
     having their Timely calendar polled — both read artists.active. */
  const toggleArtist = useCallback((id: number) => {
    const before = artists.find(a => a.id === id);
    if (!before) return;
    const next = !before.active;
    setArtists(as => as.map(a => (a.id === id ? { ...a, active: next } : a)));

    void crmApi.setArtistActive(id, next).catch(err => {
      setArtists(as => as.map(a => (a.id === id ? before : a)));
      toast(err instanceof Error ? err.message : t("Could not save"), "error");
    });
  }, [artists, toast, t]);
  /* Studio settings are what the public booking engine reads: slug, hours,
     timezone, the booking rules, the maps link. This only updated React
     state, so every one of those reverted on reload while the screen said
     "saved". Creating a studio still needs its own endpoint — flagged, not
     faked, so nobody believes a new branch was written. */
  const saveStudio = useCallback((s: Studio): number => {
    const exists = s.id > 0 && studios.some(x => x.id === s.id);
    if (!exists) {
      /* A new branch opens CLOSED — the server refuses to publish one that
         has no hours, no sender and no phone. It appears in the list so it
         can be finished, and the Studios screen turns it on. */
      void crmApi.createStudio({
        name: s.name,
        slug: s.config.bookingSlug,
        city: s.city,
        country: s.country,
        country_code: (s.gtmCountry === "Türkiye" ? "TR" : "US"),
        address: s.address,
        timezone: s.config.ianaTimezone,
        branch_phone: s.config.publicPhone || null,
        email: s.email || null,
      })
        .then(created => {
          setStudios(ss => [...ss, { ...s, id: created.id, bookingActive: false }]);
          toast(tf("{name} created — switch it on once it is ready", { name: s.name }));
        })
        .catch(err => toast(err instanceof Error ? err.message : t("Could not save"), "error"));
      return s.id;
    }

    const before = studios.find(x => x.id === s.id);
    setStudios(ss => ss.map(x => (x.id === s.id ? s : x)));

    void crmApi.saveStudio(s.id, {
      name: s.name,
      slug: s.config.bookingSlug,
      address: s.address,
      city: s.city,
      country: s.country,
      image_url: s.image || null,
      branch_phone: s.config.publicPhone || null,
      email: s.email || null,
      maps_url: s.config.mapsUrl || null,
      timezone: s.config.ianaTimezone,
      booking_active: s.config.enableOnlineBooking,
      booking_interval_min: s.config.bookingInterval,
      slot_capacity: s.config.slotCapacity,
      gtm_country: s.config.gtmCountry || null,
      gtm_city_state: s.config.gtmCityState || null,
      lat: s.config.latitude || null,
      lng: s.config.longitude || null,
      display_order: s.config.displayOrder,
      hours: toDbHours(s.config.businessHours),
    }).catch(err => {
      if (before) setStudios(ss => ss.map(x => (x.id === s.id ? before : x)));
      toast(err instanceof Error ? err.message : t("Could not save"), "error");
    });

    return s.id;
  }, [studios, toast, t]);
  /* Role, branch access and the active flag are enforced server side on
     every request, so changing them in React state alone was worse than
     useless: a deactivated account could still sign in while the screen
     showed it disabled. Creating an account needs a password issued out of
     band and is not done here. */
  const saveStaff = useCallback((m: StaffMember) => {
    const before = staff.find(x => x.id === m.id);
    if (!before) {
      /* No password is chosen here by anyone. The account is created unable
         to sign in and the admin gets a one-time link to pass on; the
         colleague sets their own password and nobody else learns it. */
      void crmApi.inviteStaff({
        name: m.name,
        email: m.email,
        role_id: m.roleId,
        scope_all: m.locationIds === "all",
        location_ids: m.locationIds === "all" ? [] : m.locationIds,
      })
        .then(({ inviteUrl }) => {
          void refreshData();
          setInviteLink({ name: m.name, url: inviteUrl });
        })
        .catch(err => toast(err instanceof Error ? err.message : t("Could not save"), "error"));
      return;
    }

    setStaff(ss => ss.map(x => (x.id === m.id ? m : x)));

    void crmApi.saveStaff({
      id: m.id,
      name: m.name,
      email: m.email,
      role_id: m.roleId,
      active: m.active,
      scope_all: m.locationIds === "all",
      location_ids: m.locationIds === "all" ? [] : m.locationIds,
    }).catch(err => {
      setStaff(ss => ss.map(x => (x.id === m.id ? before : x)));
      toast(err instanceof Error ? err.message : t("Could not save"), "error");
    });
  }, [staff, toast, t]);

  const toggleStaffActive = useCallback((id: number) => {
    const before = staff.find(x => x.id === id);
    if (!before) return;
    const next = !before.active;
    setStaff(ss => ss.map(x => (x.id === id ? { ...x, active: next } : x)));

    void crmApi.saveStaff({ id, active: next }).catch(err => {
      setStaff(ss => ss.map(x => (x.id === id ? before : x)));
      toast(err instanceof Error ? err.message : t("Could not save"), "error");
    });
  }, [staff, toast, t]);

  const setMatrixGrant = useCallback((roleId: string, permId: string, on: boolean) => {
    setMatrix(m => ({ ...m, [roleId]: on ? [...(m[roleId] ?? []), permId] : (m[roleId] ?? []).filter(p => p !== permId) }));

    void crmApi.setRolePermission(roleId, permId, on).catch(err => {
      // Put the tick back where it was — a permission that looks revoked
      // but is not is the dangerous direction.
      setMatrix(m => ({ ...m, [roleId]: on ? (m[roleId] ?? []).filter(p => p !== permId) : [...(m[roleId] ?? []), permId] }));
      toast(err instanceof Error ? err.message : t("Could not save"), "error");
    });
  }, [toast, t]);
  /* These numbers drive real routing — the Twilio line whose inbound call
     forwards to the branch, the sender SMS goes out from. Held in React
     state they never reached the webhook that needed them. */
  const saveNumber = useCallback((n: { id: number; studioId: number; kind: "vonage" | "twilio" | "branch"; label: string; number: string; smsCapable: boolean }) => {
    const before = numbers.find(x => x.id === n.id);
    const tempId = n.id > 0 ? n.id : (numbers.length ? Math.max(...numbers.map(x => x.id)) + 1 : 1);
    setNumbers(ns => (before ? ns.map(x => (x.id === n.id ? n : x)) : [...ns, { ...n, id: tempId }]));

    void crmApi.saveNumber(n.studioId, {
      id: n.id, kind: n.kind, label: n.label, number: n.number, smsCapable: n.smsCapable,
    }).catch(err => {
      setNumbers(ns => (before ? ns.map(x => (x.id === n.id ? before : x)) : ns.filter(x => x.id !== tempId)));
      toast(err instanceof Error ? err.message : t("Could not save"), "error");
    });
  }, [numbers, toast, t]);

  const removeNumber = useCallback((id: number) => {
    const before = numbers.find(x => x.id === id);
    if (!before) return;
    setNumbers(ns => ns.filter(x => x.id !== id));

    void crmApi.removeNumber(before.studioId, id).catch(err => {
      setNumbers(ns => [...ns, before]);
      toast(err instanceof Error ? err.message : t("Could not save"), "error");
    });
  }, [numbers, toast, t]);

  const callsFor = useCallback((customerId: string) => calls.filter(c => c.customerId === customerId), [calls]);
  const notesFor = useCallback((type: "lead" | "appointment" | "customer", id: string) =>
    notes.filter(n => n.notableType === type && n.notableId === id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)), [notes]);
  const convFor = useCallback((customerId: string | null) => conversations.find(c => c.customerId === customerId), [conversations]);

  /* ── Derived Customer 360 Records ── */
  const customers = useMemo<Customer[]>(() => {
    const map = new Map<string, Customer>();

    leads.forEach(l => {
      const phoneDigits = l.formattedPhone.replace(/\D/g, "");
      const emailClean = l.email.trim().toLowerCase();
      const key = l.customerId || phoneDigits || emailClean || l.id;
      const existing = map.get(key);
      if (existing) {
        existing.leadCount += 1;
        if (!existing.leadIds.includes(l.id)) existing.leadIds.push(l.id);
        if (+new Date(l.createdAt) < +new Date(existing.firstTouchAt)) existing.firstTouchAt = l.createdAt;
        if (+new Date(l.createdAt) > +new Date(existing.lastActiveAt)) existing.lastActiveAt = l.createdAt;
        if (!existing.primaryAttr && l.attr) existing.primaryAttr = l.attr;
      } else {
        map.set(key, {
          id: l.customerId,
          name: l.name,
          phone: l.formattedPhone,
          email: l.email,
          locationId: l.locationId,
          language: l.meta.language,
          firstTouchAt: l.createdAt,
          lastActiveAt: l.createdAt,
          leadCount: 1,
          apptCount: 0,
          completedApptCount: 0,
          totalCalls: 0,
          totalSms: 0,
          stage: "lead",
          leadIds: [l.id],
          apptIds: [],
          primaryAttr: l.attr,
        });
      }
    });

    appointments.forEach(a => {
      const phoneDigits = a.formattedPhone.replace(/\D/g, "");
      const emailClean = a.email.trim().toLowerCase();
      const key = a.customerId || phoneDigits || emailClean || `CUST-${a.id}`;
      const existing = map.get(key);
      if (existing) {
        existing.apptCount += 1;
        if (a.status === "completed") existing.completedApptCount += 1;
        if (!existing.apptIds.includes(a.id)) existing.apptIds.push(a.id);
        if (a.leadId && !existing.leadIds.includes(a.leadId)) existing.leadIds.push(a.leadId);
        if (+new Date(a.createdAt) < +new Date(existing.firstTouchAt)) existing.firstTouchAt = a.createdAt;
        if (+new Date(a.createdAt) > +new Date(existing.lastActiveAt)) existing.lastActiveAt = a.createdAt;
        if (a.status === "completed") existing.stage = "completed";
        else if (existing.stage !== "completed") existing.stage = "booked";
        if (!existing.primaryAttr && a.platform) {
          existing.primaryAttr = {
            platform: a.platform,
            landingPage: "",
            utmSource: a.platform,
            utmMedium: "direct",
            utmCampaign: a.campaign ?? null,
            gclid: null,
            fbclid: null,
            ttclid: null,
          };
        }
      } else {
        map.set(key, {
          id: a.customerId,
          name: a.name,
          phone: a.formattedPhone,
          email: a.email,
          locationId: a.locationId,
          language: a.language,
          firstTouchAt: a.createdAt,
          lastActiveAt: a.createdAt,
          leadCount: a.leadId ? 1 : 0,
          apptCount: 1,
          completedApptCount: a.status === "completed" ? 1 : 0,
          totalCalls: 0,
          totalSms: 0,
          stage: a.status === "completed" ? "completed" : "booked",
          leadIds: a.leadId ? [a.leadId] : [],
          apptIds: [a.id],
          primaryAttr: a.platform ? {
            platform: a.platform,
            landingPage: "",
            utmSource: a.platform,
            utmMedium: "direct",
            utmCampaign: a.campaign ?? null,
            gclid: null,
            fbclid: null,
            ttclid: null,
          } : undefined,
        });
      }
    });

    // Populate call and SMS touchpoint totals
    map.forEach(cust => {
      cust.totalCalls = calls.filter(c => cust.leadIds.includes(c.customerId ?? "") || cust.apptIds.includes(c.appointmentId ?? -1)).length;
      const conv = conversations.find(c => (c.customerId && cust.leadIds.includes(c.customerId)) || (c.phone && c.phone.replace(/\D/g, "") === cust.phone.replace(/\D/g, "")));
      cust.totalSms = conv ? conv.messages.length : 0;
      if (cust.completedApptCount >= 2) cust.stage = "vip";
    });

    return [...map.values()].sort((a, b) => +new Date(b.lastActiveAt) - +new Date(a.lastActiveAt));
  }, [leads, appointments, calls, conversations]);

  const customerById = useCallback((id: string) => {
    const rawId = decodeURIComponent(id);
    const cleanDigits = rawId.replace(/\D/g, "");
    const numId = Number(rawId);
    return customers.find(c =>
      c.id === rawId ||
      c.leadIds.includes(rawId) ||
      (!isNaN(numId) && c.apptIds.includes(numId)) ||
      c.apptIds.some(aid => `BK-${aid}` === rawId || String(aid) === rawId) ||
      (cleanDigits.length >= 6 && c.phone.replace(/\D/g, "") === cleanDigits) ||
      (rawId.includes("@") && c.email.toLowerCase() === rawId.toLowerCase())
    );
  }, [customers]);

  const unreadTotal = useMemo(() => conversations.reduce((s, c) => s + c.unreadCount, 0), [conversations]);
  const notCalledCount = counters.notCalledLeads;
  const pendingCount = counters.pendingAppointments;
  const openTaskCount = counters.openTasks;
  /* ── Live updates ──────────────────────────────────────────────────
   * The gateway has been publishing these all along and nobody listened.
   * A customer moving their own booking, a lead landing, a call being
   * logged by a colleague — all of it needed a reload to show up.
   *
   * Only channels this account may actually read are subscribed; the
   * gateway refuses the rest anyway, but asking for them would just log a
   * rejection on every connect. */
  const liveChannels = useMemo(() => {
    if (!session) return [];
    const list: string[] = ["notifications"];
    if (can("appts.view")) list.push("appointments:live");
    if (can("calls.view")) list.push("calls:live");
    // One channel, not one per studio: 46 branches meant 46 subscriptions
    // and the gateway refused the lot. Scope is enforced per event.
    if (can("leads.view")) list.push("leads:live");
    return list;
  }, [session, can, scopedStudios]);

  /* Events arrive one per change; a busy studio can fire several in a
     second. Refetching per event would hammer the API, so each slice is
     coalesced into a single call. */
  const pending = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const debouncedRefresh = useCallback((key: string, fn: () => void) => {
    clearTimeout(pending.current[key]);
    pending.current[key] = setTimeout(fn, 600);
  }, []);

  useEffect(() => () => {
    Object.values(pending.current).forEach(clearTimeout);
  }, []);

  useRealtimeChannels(liveChannels, (event) => {
    switch (event.channel) {
      case "appointments:live": {
        debouncedRefresh("appointments", () => void refreshAppointments());
        /* A booking the customer moved or dropped themselves is the one
           thing nobody is watching for, so it gets said out loud. */
        const who = typeof event.payload.name === "string" ? event.payload.name : t("A customer");
        if (event.topic === "appointment.rescheduled") {
          toast(tf("{name} rescheduled their appointment", { name: who }));
        } else if (event.topic === "appointment.cancelled") {
          toast(tf("{name} cancelled their appointment", { name: who }), "error");
        }
        break;
      }
      case "calls:live": {
        /* The live board used to have no source at all: setLiveFeed ran
           once at startup with an empty array and never again, so the
           "calls in progress" panel was permanently blank. These come from
           the Telephony poller in the gateway. */
        const body = event.payload as {
          calls?: TelephonyCall[];
          call?: TelephonyCall;
          callId?: string;
        };

        if (event.topic === "call.snapshot" && body.calls) {
          setLiveFeed(body.calls.map(toLiveCall));
        } else if (event.topic === "call.started" && body.call) {
          const incoming = toLiveCall(body.call);
          setLiveFeed(prev =>
            prev.some(c => c.callId === incoming.callId) ? prev : [incoming, ...prev]);
          pushEvent(
            incoming.direction === "inbound" ? "queue" : "answer",
            incoming.direction === "inbound"
              ? tf("{who} is calling {ext}", { who: prettyPhone(incoming.phone) || "—", ext: incoming.ext })
              : tf("{ext} is dialling {who}", { ext: incoming.ext, who: prettyPhone(incoming.phone) || "—" }),
            { callId: incoming.callId, who: prettyPhone(incoming.phone) || "—", ext: incoming.ext },
          );
        } else if (event.topic === "call.updated" && body.call) {
          const incoming = toLiveCall(body.call);
          setLiveFeed(prev => prev.map(c => (c.callId === incoming.callId ? incoming : c)));
          /* Only the moment of connection is worth a line. Every other
             transition would fill the stream with noise. */
          const to = (body as { to?: string }).to;
          if (to && /^on-call$/i.test(to)) {
            pushEvent("answer", tf("{ext} connected to {who}", {
              ext: incoming.ext, who: prettyPhone(incoming.phone) || "—",
            }), { callId: incoming.callId, who: prettyPhone(incoming.phone) || "—", ext: incoming.ext });
          }
        } else if (event.topic === "call.ended") {
          const ended = body.callId ?? body.call?.callId;
          const wasRinging = body.call ? toLiveCall(body.call).ringing : false;
          setLiveFeed(prev => prev.filter(c => c.callId !== ended));
          if (body.call) {
            const gone = toLiveCall(body.call);
            pushEvent(wasRinging ? "miss" : "end",
              wasRinging
                ? tf("{ext} missed {who}", { ext: gone.ext, who: prettyPhone(gone.phone) || "—" })
                : tf("{ext} ended with {who}", { ext: gone.ext, who: prettyPhone(gone.phone) || "—" }),
              { callId: gone.callId, who: prettyPhone(gone.phone) || "—", ext: gone.ext });
          }
          /* A finished call becomes a row in the call log, but only once
             the Reports sync has collected it — refresh rather than
             inventing the record here. */
          debouncedRefresh("calls", () => void refreshCalls());
        } else {
          debouncedRefresh("calls", () => void refreshCalls());
        }
        break;
      }
      default:
        if (event.channel.startsWith("leads:")) {
          debouncedRefresh("leads", () => void refreshLeads());
        } else if (event.channel.startsWith("sms:")) {
          debouncedRefresh("conversations", () => void refreshConversations());
        }
    }
  }, Boolean(session));

  /* Counted in the database at boot. Deriving it from `leads` counted the
     duplicates inside the working set — a hundred records — which is the
     one place two entries for the same person are least likely to both
     be. */
  const dupGroupCount = counters.duplicateGroups ?? 0;

  const value: Store = {
    refreshTasks,
    route, navigate, globalLocation, setGlobalLocation, dateRange, setDateRange, inRange,
    leads, appointments, calls, conversations, notes, studios, artists, extensions: EXTENSIONS,
    liveCalls: liveFeed.length, liveCallsArr: liveFeed, liveEvents,
    staff, matrix, numbers, campaigns, tasks, auditLogs, logAudit, fetchAuditLogs, dataLoading, customers, customerById,
    dashboard, templates, templateFor, inviteLink, dismissInvite,
    session, authLoading, authError, login, logout, can, guard,
    inScope, locOk, scopedStudios, lastVonageSync, lastTwilioSync,
    unreadTotal, notCalledCount, pendingCount, openTaskCount, dupGroupCount,
    toasts, toast, dismissToast, updateLeadStatus, addNote, sendSms, sendLeadSms, sendSmsTo,
    ensureLead, markRead, loadThread, simulateReply, convertLead, updateApptStatus, toggleBooking, toggleArtist,
    saveStudio, saveStaff, toggleStaffActive, setMatrixGrant, saveNumber, removeNumber,
    createCampaign, sendCampaign, addTask, completeTask, deleteTask, mergeLeads, importCsvData,
    endLiveCall, logCallback, callsFor, notesFor, convFor,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
