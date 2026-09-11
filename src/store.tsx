"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  LEADS, APPOINTMENTS, CALLS, CONVERSATIONS, NOTES, STUDIOS, ARTISTS, EXTENSIONS, STAFF, DEFAULT_MATRIX,
  CAMPAIGNS, TASKS, AUDIT_LOGS, nextId,
  type Lead, type Appointment, type CallLog, type Conversation, type SmsMessage, type Note,
  type Studio, type Artist, type StaffMember, type Campaign, type TaskItem, type CallStatus, type ApptStatus,
  type PermId, type AuditLog, type Customer,
} from "./data";
import { t, tf } from "./i18n";
import { pathToRoute, routeToPath } from "./router";

export type Route =
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
}
export interface LiveEvent { id: number; kind: "answer" | "queue" | "end" | "voicemail" | "miss"; text: string; at: string; }

interface Store {
  route: Route; navigate: (r: Route, opts?: { replace?: boolean }) => void;
  globalLocation: number | "all"; setGlobalLocation: (v: number | "all") => void;
  dateRange: DateRange; setDateRange: (v: DateRange) => void;
  inRange: (isoStr: string) => boolean;
  leads: Lead[]; appointments: Appointment[]; calls: CallLog[];
  conversations: Conversation[]; notes: Note[]; studios: Studio[]; artists: Artist[];
  extensions: typeof EXTENSIONS; liveCalls: number; liveCallsArr: LiveCall[]; liveEvents: LiveEvent[];
  staff: StaffMember[]; matrix: Record<string, string[]>; numbers: { id: number; studioId: number; kind: "vonage" | "twilio" | "branch"; label: string; number: string; smsCapable: boolean }[];
  campaigns: Campaign[]; tasks: TaskItem[];
  auditLogs: AuditLog[]; logAudit: (log: Omit<AuditLog, "id" | "at">) => void;
  customers: Customer[]; customerById: (id: string) => Customer | undefined;
  session: StaffMember | null; login: (memberId: number) => void; logout: () => void;
  can: (perm: PermId) => boolean; guard: (perm: PermId) => boolean;
  inScope: (locId: number) => boolean; locOk: (locId: number) => boolean; scopedStudios: Studio[];
  lastVonageSync: number; lastTwilioSync: number;
  unreadTotal: number; notCalledCount: number; pendingCount: number; openTaskCount: number; dupGroupCount: number;
  toasts: Toast[]; toast: (msg: string, kind?: Toast["kind"]) => void; dismissToast: (id: number) => void;
  updateLeadStatus: (id: string, s: CallStatus) => void;
  addNote: (type: "lead" | "appointment" | "customer", id: string, content: string) => void;
  sendSms: (convId: number, body: string) => void;
  sendLeadSms: (leadId: string, body: string) => number;
  sendSmsTo: (phone: string, name: string, locationId: number, body: string) => number;
  markRead: (convId: number) => void; simulateReply: (convId: number) => void;
  convertLead: (id: string) => number | null;
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
  logCallback: (p: { name: string; phone: string; customerId: string | null; locationId: number }) => "Answered" | "Attempted";
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
const seedFeed: LiveCall[] = [
  { id: 9101, name: "Selin Yıldız", phone: "+90 532 555 1001", direction: "inbound", ext: "101", agent: "Ahmet Kurt", startedAt: Date.now() - 42_000, ringing: false, leadId: "LEAD-1001", locationId: 1 },
  { id: 9102, name: "Michael Vance", phone: "+1 305 555 0192", direction: "inbound", ext: "102", agent: "Ece Demir", startedAt: Date.now() - 18_000, ringing: false, leadId: "LEAD-1006", locationId: 3 },
  { id: 9103, name: "Clara Dupont", phone: "+33 6 12 34 56 78", direction: "outbound", ext: "103", agent: "Zeynep Arslan", startedAt: Date.now() - 4_000, ringing: true, leadId: "LEAD-1004", locationId: 2 },
];

export function groupDuplicates(leads: Lead[]): Lead[][] {
  const byPhone = new Map<string, Lead[]>();
  leads.forEach(l => {
    const p = l.formattedPhone.replace(/\D/g, "");
    if (!p) return;
    byPhone.set(p, [...(byPhone.get(p) ?? []), l]);
  });
  return [...byPhone.values()].filter(g => g.length > 1);
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => typeof window !== "undefined" ? pathToRoute(window.location.pathname) : { view: "dashboard" });
  const [globalLocation, setGlobalLocation] = useState<number | "all">("all");
  const [dateRange, setDateRange] = useState<DateRange>("30");
  const [leads, setLeads] = useState(LEADS);
  const [appointments, setAppointments] = useState(APPOINTMENTS);
  const [calls, setCalls] = useState(CALLS);
  const [conversations, setConversations] = useState(CONVERSATIONS);
  const [notes, setNotes] = useState(NOTES);
  const [studios, setStudios] = useState(STUDIOS);
  const [artists, setArtists] = useState(ARTISTS);
  const [staff, setStaff] = useState(STAFF);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(AUDIT_LOGS);
  const [matrix, setMatrix] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(Object.entries(DEFAULT_MATRIX).map(([k, v]) => [k, [...v]])));
  /* ── session (persisted; real auth will be Supabase) ── */
  const [session, setSession] = useState<StaffMember | null>(() => {
    if (typeof window === "undefined") return STAFF[0] ?? null;
    try {
      const id = localStorage.getItem("cleo.session");
      return id ? STAFF.find(s => s.id === Number(id) && s.active) ?? STAFF[0] : STAFF[0];
    } catch { return STAFF[0]; }
  });
  const login = useCallback((memberId: number) => {
    const m = STAFF.find(s => s.id === memberId && s.active) ?? null;
    if (!m) return;
    setSession(m);
    try { localStorage.setItem("cleo.session", String(m.id)); } catch { /* private mode */ }
    setRoute({ view: "dashboard" });
    try { window.history.replaceState(null, "", routeToPath({ view: "dashboard" })); } catch { /* sandboxed */ }
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);
  const logout = useCallback(() => {
    setSession(null);
    try { localStorage.removeItem("cleo.session"); } catch { /* private mode */ }
  }, []);
  const [numbers, setNumbers] = useState(() => STUDIOS.slice(0, 4).map((s, i) => ({
    id: i + 1, studioId: s.id, kind: (i % 2 ? "vonage" : "twilio") as "vonage" | "twilio" | "branch",
    label: i % 2 ? "DID Line" : "SMS Sender", number: i % 2 ? s.config.vonage.did : s.config.twilio.specificPhone, smsCapable: i % 2 === 0,
  })));
  const [campaigns, setCampaigns] = useState(CAMPAIGNS);
  const [tasks, setTasks] = useState(TASKS);
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
  const can = useCallback((perm: PermId) => (matrix[sessionRoleId] ?? []).includes(perm), [matrix, sessionRoleId]);
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
  const locOk = useCallback((locId: number) =>
    inScope(locId) && (globalLocation === "all" || globalLocation === locId), [inScope, globalLocation]);
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

  const pushEvent = useCallback((kind: LiveEvent["kind"], text: string) => {
    setLiveEvents(es => [{ id: nextId(), kind, text, at: new Date().toISOString() }, ...es].slice(0, 12));
  }, []);

  /* ── live call floor (Vonage Events API simulation) ── */
  const logFromLive = useCallback((c: LiveCall, durSec: number, result: CallLog["result"]) => {
    const ext = EXTENSIONS.find(e => e.extension === c.ext);
    const lineName = `${ext?.displayName ?? "Callcenter"} (#${c.ext})`;
    setCalls(cs => [{
      id: nextId(), direction: c.direction,
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

  useEffect(() => {
    let n = 0;
    const spawn = setInterval(() => {
      if (feedRef.current.length >= 5) return;
      const cands = LEADS.filter(l => l.formattedPhone);
      const lead = cands[Math.floor(Math.random() * cands.length)];
      const ext = CC_EXTS[Math.floor(Math.random() * CC_EXTS.length)];
      const c: LiveCall = {
        id: 92_000 + (n++), name: lead.name, phone: lead.formattedPhone,
        direction: Math.random() < 0.6 ? "inbound" : "outbound", ext: ext.extension,
        agent: ext.username.replace("Cleo.", "Agent · "),
        startedAt: Date.now(), ringing: true, leadId: lead.id, locationId: lead.locationId,
      };
      feedRef.current = [...feedRef.current, c];
      setLiveFeed(feedRef.current);
      setLastVonageSync(Date.now());
      pushEvent("queue", tf("{name} queued on #{ext}", { name: lead.name, ext: ext.extension }));
      toast(tf("{name} · {dir} on line #{ext}", { name: lead.name, dir: t(c.direction === "inbound" ? "incoming" : "dialing out"), ext: ext.extension }), "info");
    }, 14_000);
    const promote = setInterval(() => {
      let changed = false;
      const next = feedRef.current.map(c => {
        if (c.ringing && Date.now() - c.startedAt > 3800) {
          changed = true;
          pushEvent("answer", tf("{agent} answered {name}", { agent: c.agent, name: c.name }));
          return { ...c, ringing: false, startedAt: Date.now() };
        }
        return c;
      });
      if (changed) { feedRef.current = next; setLiveFeed(next); }
    }, 800);
    const autoEnd = setInterval(() => {
      const ending = feedRef.current.filter(c => !c.ringing && Date.now() - c.startedAt > 55_000);
      if (!ending.length) return;
      feedRef.current = feedRef.current.filter(c => !ending.some(e => e.id === c.id));
      setLiveFeed(feedRef.current);
      ending.forEach(c => {
        logFromLive(c, Math.floor((Date.now() - c.startedAt) / 1000), "Answered");
        pushEvent("end", tf("Call with {name} wrapped", { name: c.name }));
      });
    }, 3000);
    const ambient = setInterval(() => {
      const cands = LEADS.filter(l => l.formattedPhone);
      const lead = cands[Math.floor(Math.random() * cands.length)];
      const ext = CC_EXTS[Math.floor(Math.random() * CC_EXTS.length)];
      const vm = Math.random() < 0.5;
      pushEvent(vm ? "voicemail" : "miss",
        vm ? tf("{name} left a voicemail on #{ext}", { name: lead.name, ext: ext.extension })
          : tf("Missed call from {name} · rerouted to next agent", { name: lead.name }));
      setLastVonageSync(Date.now());
    }, 10_000);
    return () => { clearInterval(spawn); clearInterval(promote); clearInterval(autoEnd); clearInterval(ambient); };
  }, [toast, logFromLive, pushEvent]);

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

  const logCallback = useCallback((p: { name: string; phone: string; customerId: string | null; locationId: number }): "Answered" | "Attempted" => {
    const ext = CC_EXTS[Math.floor(Math.random() * CC_EXTS.length)];
    const answered = Math.random() < 0.6;
    const result: "Answered" | "Attempted" = answered ? "Answered" : "Attempted";
    const dur = answered ? 30 + Math.floor(Math.random() * 240) : 0;
    const callId = nextId();
    setCalls(cs => [{
      id: callId, direction: "outbound", fromNumber: ext.phoneNumber, toNumber: p.phone,
      fromName: `${ext.displayName} (#${ext.extension})`, toName: p.name,
      customerId: p.customerId, appointmentId: null, locationId: p.locationId,
      startTime: new Date().toISOString(), duration: dur,
      result, hasRecording: answered,
      agent: ext.username.replace("Cleo.", "Agent · "), ext: ext.extension,
    }, ...cs]);
    setLastVonageSync(Date.now());
    if (p.customerId) {
      logAudit({
        targetType: "lead",
        targetId: p.customerId,
        action: "call_logged",
        actor: ext.username.replace("Cleo.", "Agent · "),
        actorRole: "sales_rep",
        details: `Outbound callback ${answered ? `connected (${dur}s)` : "unanswered"}`,
      });
    }
    pushEvent(answered ? "answer" : "miss",
      answered ? tf("Callback to {name} answered", { name: p.name }) : tf("Callback to {name} · no answer", { name: p.name }));
    return result;
  }, [pushEvent, logAudit]);

  /* ── campaign delivery simulation (runs only while a send is in flight) ── */
  const hasSending = useMemo(() => campaigns.some(c => c.status === "sending"), [campaigns]);
  useEffect(() => {
    if (!hasSending) return;
    const tick = setInterval(() => {
      setCampaigns(cs => cs.map(c => {
        if (c.status !== "sending") return c;
        const step = Math.max(1, Math.min(c.total - c.delivered - c.failed, 1 + Math.floor(Math.random() * 3)));
        const failed = Math.random() < 0.12 ? 1 : 0;
        const delivered = c.delivered + step - failed;
        const replied = c.replied + (Math.random() < 0.2 ? 1 : 0);
        const done = delivered + failed >= c.total;
        return { ...c, delivered, failed: c.failed + failed, replied: Math.min(replied, delivered), status: done ? "sent" as const : "sending" as const };
      }));
      setLastTwilioSync(Date.now());
    }, 450);
    return () => clearInterval(tick);
  }, [hasSending]);

  const createCampaign: Store["createCampaign"] = useCallback(c => {
    const id = nextId();
    setCampaigns(cs => [{
      ...c, id, status: c.status ?? "draft", delivered: 0, failed: 0, replied: 0, createdAt: new Date().toISOString(),
    }, ...cs]);
    return id;
  }, []);

  const sendCampaign = useCallback((id: number) => {
    setCampaigns(cs => cs.map(c => c.id === id ? { ...c, status: "sending" as const, delivered: 0, failed: 0, replied: 0 } : c));
    setLastTwilioSync(Date.now());
  }, []);

  /* ── tasks ── */
  const addTask: Store["addTask"] = useCallback(task => {
    const id = nextId();
    setTasks(ts => [{ ...task, id, createdAt: new Date().toISOString(), status: "open" as const, doneAt: null }, ...ts]);
    logAudit({
      targetType: "task",
      targetId: String(id),
      action: "created",
      toStatus: "open",
      actor: session?.name ?? "Super Admin",
      actorRole: session?.roleId ?? "super_admin",
      details: `Task created: ${task.title}`,
    });
  }, [logAudit, session]);

  const completeTask = useCallback((id: number) => {
    setTasks(ts => {
      const current = ts.find(x => x.id === id);
      if (current && current.status !== "done") {
        logAudit({
          targetType: "task",
          targetId: String(id),
          action: "status_change",
          fromStatus: "open",
          toStatus: "done",
          actor: session?.name ?? "Super Admin",
          actorRole: session?.roleId ?? "super_admin",
          details: `Task completed: ${current.title}`,
        });
      }
      return ts.map(x => x.id === id ? { ...x, status: "done" as const, doneAt: new Date().toISOString() } : x);
    });
  }, [logAudit, session]);

  const deleteTask = useCallback((id: number) => {
    setTasks(ts => ts.filter(x => x.id !== id));
  }, []);

  /* ── merge duplicates ── */
  const mergeLeads = useCallback((primaryId: string, otherIds: string[], take: Partial<Lead>) => {
    setLeads(ls => ls.filter(l => !otherIds.includes(l.id))
      .map(l => l.id === primaryId ? { ...l, ...take, isDuplicate: false } : l));
    setNotes(ns => [{
      id: nextId(), author: session?.name ?? "You · Super Admin", notableType: "lead" as const, notableId: primaryId,
      content: `Merged duplicates: ${otherIds.join(", ")}`, createdAt: new Date().toISOString(),
    }, ...ns]);
    logAudit({
      targetType: "lead",
      targetId: primaryId,
      action: "updated",
      actor: session?.name ?? "Super Admin",
      actorRole: session?.roleId ?? "super_admin",
      details: `Merged duplicate records: ${otherIds.join(", ")}`,
    });
  }, [logAudit, session]);

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

  const updateLeadStatus = useCallback((id: string, s: CallStatus) => {
    setLeads(ls => {
      const current = ls.find(l => l.id === id);
      if (current && current.callStatus !== s) {
        logAudit({
          targetType: "lead",
          targetId: id,
          action: "status_change",
          fromStatus: current.callStatus,
          toStatus: s,
          actor: session?.name ?? "Super Admin",
          actorRole: session?.roleId ?? "super_admin",
          details: `Lead status changed from ${current.callStatus} to ${s}`,
        });
      }
      return ls.map(l => l.id === id ? { ...l, callStatus: s, lastCalledAt: s === "not_called" ? l.lastCalledAt : new Date().toISOString() } : l);
    });
  }, [logAudit, session]);

  const addNote = useCallback((type: "lead" | "appointment" | "customer", id: string, content: string) => {
    const author = session?.name ?? "You · Super Admin";
    setNotes(ns => [{ id: nextId(), author, notableType: type, notableId: id, content, createdAt: new Date().toISOString() }, ...ns]);
    logAudit({
      targetType: type,
      targetId: id,
      action: "note_added",
      actor: author,
      actorRole: session?.roleId ?? "super_admin",
      details: content.slice(0, 80) + (content.length > 80 ? "…" : ""),
    });
  }, [logAudit, session]);

  const deliverLater = useCallback((match: (c: Conversation) => boolean, msgId: number) => {
    setTimeout(() => {
      setConversations(cs => cs.map(c => match(c) ? {
        ...c, messages: c.messages.map(m => m.id === msgId ? { ...m, status: "delivered" as const } : m),
      } : c));
    }, 1100);
  }, []);

  const sendSms = useCallback((convId: number, body: string) => {
    const msgId = nextId();
    const senderName = session?.name ?? "Super Admin";
    setConversations(cs => cs.map(c => c.id === convId ? {
      ...c, messages: [...c.messages, { id: msgId, direction: "outbound" as const, body, at: new Date().toISOString(), status: "sent" as const, senderType: "agent", senderName }],
    } : c));
    deliverLater(c => c.id === convId, msgId);
    setLastTwilioSync(Date.now());
  }, [deliverLater, session]);

  const sendLeadSms = useCallback((leadId: string, body: string): number => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return -1;
    const existing = conversations.find(c => c.customerId === leadId);
    const convId = existing?.id ?? nextId();
    const msgId = nextId();
    const senderName = session?.name ?? "Super Admin";
    setConversations(cs => {
      const msg: SmsMessage = { id: msgId, direction: "outbound", body, at: new Date().toISOString(), status: "sent", senderType: "agent", senderName };
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
    deliverLater(c => c.id === convId, msgId);
    setLastTwilioSync(Date.now());
    return convId;
  }, [leads, conversations, deliverLater, logAudit, session]);

  const sendSmsTo = useCallback((phone: string, name: string, locationId: number, body: string): number => {
    const existing = conversations.find(c => c.phone === phone);
    const convId = existing?.id ?? nextId();
    const msgId = nextId();
    const senderName = session?.name ?? "Super Admin";
    setConversations(cs => {
      const msg: SmsMessage = { id: msgId, direction: "outbound", body, at: new Date().toISOString(), status: "sent", senderType: "agent", senderName };
      const ex = cs.find(c => c.phone === phone);
      if (ex) return cs.map(c => c.id === ex.id ? { ...c, messages: [...c.messages, msg] } : c);
      return [{ id: convId, phone, customerId: null, customerName: name, locationId, unreadCount: 0, unsubscribed: false, messages: [msg] }, ...cs];
    });
    deliverLater(c => c.id === convId, msgId);
    setLastTwilioSync(Date.now());
    return convId;
  }, [conversations, deliverLater, session]);

  const markRead = useCallback((convId: number) => {
    setConversations(cs => cs.map(c => c.id === convId ? { ...c, unreadCount: 0 } : c));
  }, []);

  const simulateReply = useCallback((convId: number) => {
    setTimeout(() => {
      const REPLIES = ["Sounds good, thank you!", "Perfect — see you then 🖤", "Can you send the deposit link?", "Great, I'll be there on time!"];
      setConversations(cs => cs.map(c => c.id === convId ? {
        ...c, unreadCount: c.unreadCount + 1,
        messages: [...c.messages, { id: nextId(), direction: "inbound" as const, body: REPLIES[Math.floor(Math.random() * REPLIES.length)], at: new Date().toISOString(), status: "received" as const, senderType: "agent", senderName: "Customer" }],
      } : c));
      setLastTwilioSync(Date.now());
    }, 2600 + Math.random() * 1400);
  }, []);

  const convertLead = useCallback((id: string): number | null => {
    const lead = leads.find(l => l.id === id);
    if (!lead) return null;
    const apptId = nextId();
    const uuid = `BK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    setAppointments(as => [{
      id: apptId, uuid,
      customerId: lead.id, name: lead.name, email: lead.email, formattedPhone: lead.formattedPhone,
      locationId: lead.locationId, purpose: lead.meta.purpose, style: lead.meta.style,
      storyType: lead.meta.storyType, story: lead.meta.story, size: lead.meta.size,
      bodyAreas: lead.meta.bodyAreas, referenceImage: null,
      preferredDate: new Date(Date.now() + 5 * 86_400_000).toISOString(), preferredTime: "14:00",
      status: "pending" as ApptStatus, isFreePick: false, language: lead.meta.language,
      createdAt: new Date().toISOString(), platform: lead.attr.platform, campaign: lead.attr.utmCampaign, consent: lead.meta.consent,
    }, ...as]);
    setLeads(ls => ls.map(l => l.id === id ? { ...l, callStatus: "appointment_made" as CallStatus, status: "done" as const } : l));
    logAudit({
      targetType: "lead",
      targetId: id,
      action: "converted",
      fromStatus: lead.callStatus,
      toStatus: "appointment_made",
      actor: session?.name ?? "Super Admin",
      actorRole: session?.roleId ?? "super_admin",
      details: `Converted to booking ${uuid}`,
    });
    logAudit({
      targetType: "appointment",
      targetId: String(apptId),
      action: "created",
      toStatus: "pending",
      actor: session?.name ?? "Super Admin",
      actorRole: session?.roleId ?? "super_admin",
      details: `Created from lead ${id}`,
    });
    return apptId;
  }, [leads, logAudit, session]);

  const updateApptStatus = useCallback((id: number, s: ApptStatus) => {
    setAppointments(as => {
      const current = as.find(a => a.id === id);
      if (current && current.status !== s) {
        logAudit({
          targetType: "appointment",
          targetId: String(id),
          action: "status_change",
          fromStatus: current.status,
          toStatus: s,
          actor: session?.name ?? "Super Admin",
          actorRole: session?.roleId ?? "super_admin",
          details: `Appointment #${current.uuid} updated to ${s}`,
        });
      }
      return as.map(a => a.id === id ? { ...a, status: s } : a);
    });
  }, [logAudit, session]);

  const toggleBooking = useCallback((locId: number) => {
    setStudios(ss => ss.map(s => s.id === locId ? { ...s, bookingActive: !s.bookingActive } : s));
  }, []);
  const toggleArtist = useCallback((id: number) => {
    setArtists(as => as.map(a => a.id === id ? { ...a, active: !a.active } : a));
  }, []);
  const saveStudio = useCallback((s: Studio): number => {
    const exists = s.id > 0 && studios.some(x => x.id === s.id);
    const id = exists ? s.id : (studios.length ? Math.max(...studios.map(x => x.id)) + 1 : 1);
    setStudios(ss => exists ? ss.map(x => x.id === s.id ? s : x) : [...ss, { ...s, id }]);
    return id;
  }, [studios]);
  const saveStaff = useCallback((m: StaffMember) => {
    setStaff(ss => ss.some(x => x.id === m.id)
      ? ss.map(x => x.id === m.id ? m : x)
      : [...ss, { ...m, id: ss.length ? Math.max(...ss.map(x => x.id)) + 1 : 1 }]);
  }, []);
  const toggleStaffActive = useCallback((id: number) => {
    setStaff(ss => ss.map(x => x.id === id ? { ...x, active: !x.active } : x));
  }, []);
  const setMatrixGrant = useCallback((roleId: string, permId: string, on: boolean) => {
    setMatrix(m => ({ ...m, [roleId]: on ? [...(m[roleId] ?? []), permId] : (m[roleId] ?? []).filter(p => p !== permId) }));
  }, []);
  const saveNumber = useCallback((n: { id: number; studioId: number; kind: "vonage" | "twilio" | "branch"; label: string; number: string; smsCapable: boolean }) => {
    setNumbers(ns => ns.some(x => x.id === n.id) ? ns.map(x => x.id === n.id ? n : x)
      : [...ns, { ...n, id: ns.length ? Math.max(...ns.map(x => x.id)) + 1 : 1 }]);
  }, []);
  const removeNumber = useCallback((id: number) => {
    setNumbers(ns => ns.filter(x => x.id !== id));
  }, []);

  const callsFor = useCallback((customerId: string) => calls.filter(c => c.customerId === customerId), [calls]);
  const notesFor = useCallback((type: "lead" | "appointment" | "customer", id: string) =>
    notes.filter(n => n.notableType === type && n.notableId === id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)), [notes]);
  const convFor = useCallback((customerId: string | null) => conversations.find(c => c.customerId === customerId), [conversations]);

  /* ── Derived Customer 360 Records ── */
  const customers = useMemo<Customer[]>(() => {
    const map = new Map<string, Customer>();

    leads.forEach(l => {
      const phoneDigits = l.formattedPhone.replace(/\D/g, "");
      const key = phoneDigits || l.id;
      const existing = map.get(key);
      if (existing) {
        existing.leadCount += 1;
        if (!existing.leadIds.includes(l.id)) existing.leadIds.push(l.id);
        if (+new Date(l.createdAt) < +new Date(existing.firstTouchAt)) existing.firstTouchAt = l.createdAt;
        if (+new Date(l.createdAt) > +new Date(existing.lastActiveAt)) existing.lastActiveAt = l.createdAt;
        if (!existing.primaryAttr && l.attr) existing.primaryAttr = l.attr;
      } else {
        map.set(key, {
          id: l.id,
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
      const key = phoneDigits || (a.customerId ?? String(a.id));
      const existing = map.get(key);
      if (existing) {
        existing.apptCount += 1;
        if (a.status === "completed") existing.completedApptCount += 1;
        if (!existing.apptIds.includes(a.id)) existing.apptIds.push(a.id);
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
          id: a.customerId ?? `CUST-${a.id}`,
          name: a.name,
          phone: a.formattedPhone,
          email: a.email,
          locationId: a.locationId,
          language: a.language,
          firstTouchAt: a.createdAt,
          lastActiveAt: a.createdAt,
          leadCount: a.customerId ? 1 : 0,
          apptCount: 1,
          completedApptCount: a.status === "completed" ? 1 : 0,
          totalCalls: 0,
          totalSms: 0,
          stage: a.status === "completed" ? "completed" : "booked",
          leadIds: a.customerId ? [a.customerId] : [],
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
      c.apptIds.some(aid => `CUST-${aid}` === rawId || `BK-${aid}` === rawId || String(aid) === rawId) ||
      (cleanDigits.length >= 6 && c.phone.replace(/\D/g, "") === cleanDigits) ||
      (rawId.includes("@") && c.email.toLowerCase() === rawId.toLowerCase())
    );
  }, [customers]);

  const unreadTotal = useMemo(() => conversations.reduce((s, c) => s + c.unreadCount, 0), [conversations]);
  const notCalledCount = useMemo(() => leads.filter(l => l.callStatus === "not_called").length, [leads]);
  const pendingCount = useMemo(() => appointments.filter(a => a.status === "pending").length, [appointments]);
  const openTaskCount = useMemo(() => tasks.filter(x => x.status === "open").length, [tasks]);
  const dupGroupCount = useMemo(() => groupDuplicates(leads).length, [leads]);

  const value: Store = {
    route, navigate, globalLocation, setGlobalLocation, dateRange, setDateRange, inRange,
    leads, appointments, calls, conversations, notes, studios, artists, extensions: EXTENSIONS,
    liveCalls: liveFeed.length, liveCallsArr: liveFeed, liveEvents,
    staff, matrix, numbers, campaigns, tasks, auditLogs, logAudit, customers, customerById,
    session, login, logout, can, guard,
    inScope, locOk, scopedStudios, lastVonageSync, lastTwilioSync,
    unreadTotal, notCalledCount, pendingCount, openTaskCount, dupGroupCount,
    toasts, toast, dismissToast, updateLeadStatus, addNote, sendSms, sendLeadSms, sendSmsTo,
    markRead, simulateReply, convertLead, updateApptStatus, toggleBooking, toggleArtist,
    saveStudio, saveStaff, toggleStaffActive, setMatrixGrant, saveNumber, removeNumber,
    createCampaign, sendCampaign, addTask, completeTask, deleteTask, mergeLeads, importCsvData,
    endLiveCall, logCallback, callsFor, notesFor, convFor,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
