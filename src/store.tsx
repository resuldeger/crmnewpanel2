import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  LEADS, APPOINTMENTS, CALLS, CONVERSATIONS, NOTES, STUDIOS, ARTISTS, EXTENSIONS, STAFF, NUMBERS, DEFAULT_MATRIX,
  nextId, type Lead, type Appointment, type CallLog, type Conversation, type SmsMessage, type Note,
  type Studio, type Artist, type StaffMember, type StudioNumber, type CallStatus, type ApptStatus,
} from "./data/crm";

export type Route =
  | { view: "dashboard" } | { view: "leads" } | { view: "lead"; id: string }
  | { view: "appointments" } | { view: "appointment"; id: number }
  | { view: "sms"; id?: number } | { view: "calls" } | { view: "reports" }
  | { view: "studios" } | { view: "staff" } | { view: "settings" };

export type DateRange = "today" | "7" | "30" | "all";
export interface Toast { id: number; msg: string; kind: "success" | "info" | "error" }

export interface LiveCall {
  id: number; name: string; phone: string; direction: "inbound" | "outbound";
  ext: string; agent: string; startedAt: number; ringing: boolean;
  leadId: string | null; locationId: number;
}
export interface LiveEvent {
  id: number; kind: "answer" | "queue" | "end" | "voicemail" | "miss"; text: string; at: string;
}

interface Store {
  route: Route; navigate: (r: Route) => void;
  globalLocation: number | "all"; setGlobalLocation: (v: number | "all") => void;
  dateRange: DateRange; setDateRange: (v: DateRange) => void;
  inRange: (isoStr: string) => boolean;
  leads: Lead[]; appointments: Appointment[]; calls: CallLog[];
  conversations: Conversation[]; notes: Note[]; studios: Studio[]; artists: Artist[];
  extensions: typeof EXTENSIONS; liveCalls: number;
  liveCallsArr: LiveCall[]; liveEvents: LiveEvent[];
  staff: StaffMember[]; matrix: Record<string, string[]>; numbers: StudioNumber[];
  lastVonageSync: number; lastTwilioSync: number;
  unreadTotal: number; notCalledCount: number; pendingCount: number;
  toasts: Toast[]; toast: (msg: string, kind?: Toast["kind"]) => void; dismissToast: (id: number) => void;
  updateLeadStatus: (id: string, s: CallStatus) => void;
  addNote: (type: "lead" | "appointment", id: string, content: string) => void;
  sendSms: (convId: number, body: string) => void;
  sendLeadSms: (leadId: string, body: string) => number;
  sendSmsTo: (phone: string, name: string, locationId: number, body: string) => number;
  markRead: (convId: number) => void;
  simulateReply: (convId: number) => void;
  convertLead: (id: string) => number | null;
  updateApptStatus: (id: number, s: ApptStatus) => void;
  toggleBooking: (locId: number) => void;
  toggleArtist: (id: number) => void;
  saveStudio: (s: Studio) => number;
  saveStaff: (m: StaffMember) => void;
  toggleStaffActive: (id: number) => void;
  setMatrixGrant: (roleId: string, permId: string, on: boolean) => void;
  saveNumber: (n: StudioNumber) => void;
  removeNumber: (id: number) => void;
  endLiveCall: (id: number) => number | null;
  logCallback: (p: { name: string; phone: string; customerId: string | null; locationId: number }) => "Answered" | "Attempted";
  callsFor: (customerId: string) => CallLog[];
  notesFor: (type: "lead" | "appointment", id: string) => Note[];
  convFor: (customerId: string | null) => Conversation | undefined;
}

const Ctx = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(Ctx);

const CC_EXTS = EXTENSIONS.filter(e => e.locationId === null);
const seedFeed = (): LiveCall[] => {
  const cands = LEADS.filter(l => l.formattedPhone);
  const mk = (i: number, ago: number, ringing: boolean): LiveCall => {
    const lead = cands[(i * 7 + 3) % cands.length];
    const ext = CC_EXTS[i % CC_EXTS.length];
    return {
      id: 91000 + i, name: lead.name, phone: lead.formattedPhone,
      direction: i % 2 ? "outbound" : "inbound", ext: ext.extension,
      agent: ext.username.replace("Cleo.", "Agent · "),
      startedAt: Date.now() - ago, ringing, leadId: lead.id, locationId: lead.locationId,
    };
  };
  return [mk(0, 46_000, false), mk(1, 12_000, false), mk(2, 900, true)];
};
const seedEvents = (): LiveEvent[] => {
  const t = Date.now();
  const mk = (i: number, kind: LiveEvent["kind"], text: string, ago: number): LiveEvent =>
    ({ id: 88000 + i, kind, text, at: new Date(t - ago).toISOString() });
  return [
    mk(0, "answer", "Agent · Callcenter9 answered Sofia Kaya", 40_000),
    mk(1, "queue", "Emma Johnson queued on #401", 62_000),
    mk(2, "voicemail", "Mert Demir left a voicemail on #405", 95_000),
    mk(3, "end", "Call with Lena Hoffmann wrapped · 2m 41s", 130_000),
    mk(4, "miss", "Missed call from Noah Williams · rerouted", 170_000),
    mk(5, "answer", "Agent · Callcenter1 answered Ava Thompson", 210_000),
  ];
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>({ view: "dashboard" });
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
  const [matrix, setMatrix] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(Object.entries(DEFAULT_MATRIX).map(([k, v]) => [k, [...v]])));
  const [numbers, setNumbers] = useState(NUMBERS);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastVonageSync, setLastVonageSync] = useState(() => Date.now() - 4 * 60_000);
  const [lastTwilioSync, setLastTwilioSync] = useState(() => Date.now() - 90_000);
  const [liveFeed, setLiveFeed] = useState<LiveCall[]>(seedFeed);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>(seedEvents);
  const feedRef = useRef<LiveCall[]>(liveFeed);

  const navigate = useCallback((r: Route) => setRoute(r), []);

  const dismissToast = useCallback((id: number) => setToasts(ts => ts.filter(t => t.id !== id)), []);
  const toast = useCallback((msg: string, kind: Toast["kind"] = "success") => {
    const id = nextId();
    setToasts(ts => [...ts.slice(-3), { id, msg, kind }]);
    setTimeout(() => dismissToast(id), 3400);
  }, [dismissToast]);

  const pushEvent = useCallback((kind: LiveEvent["kind"], text: string) => {
    setLiveEvents(es => [{ id: nextId() + 88_500, kind, text, at: new Date().toISOString() }, ...es].slice(0, 12));
  }, []);

  /* ── live call floor simulation (Vonage Events API) ── */
  const logFromLive = useCallback((c: LiveCall, durSec: number, result: CallLog["result"]) => {
    const ext = EXTENSIONS.find(e => e.extension === c.ext);
    const lineName = `${ext?.displayName ?? "Callcenter"} (#${c.ext})`;
    const log: CallLog = {
      id: 80_000 + nextId(), direction: c.direction,
      fromNumber: c.direction === "inbound" ? c.phone : ext?.phoneNumber ?? c.phone,
      toNumber: c.direction === "inbound" ? ext?.phoneNumber ?? c.phone : c.phone,
      fromName: c.direction === "inbound" ? c.name : lineName,
      toName: c.direction === "inbound" ? lineName : c.name,
      customerId: c.leadId, appointmentId: null, locationId: c.locationId,
      startTime: new Date(c.startedAt).toISOString(),
      duration: result === "Answered" ? Math.max(1, durSec) : 0,
      result, hasRecording: result === "Answered" || result === "Voicemail",
      agent: c.agent, ext: c.ext,
    };
    setCalls(cs => [log, ...cs]);
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
      pushEvent("queue", `${lead.name} queued on #${ext.extension}`);
      toast(`${lead.name} · ${c.direction === "inbound" ? "incoming" : "dialing out"} on line #${ext.extension}`, "info");
    }, 13_000);
    const promote = setInterval(() => {
      let changed = false;
      const next = feedRef.current.map(c => {
        if (c.ringing && Date.now() - c.startedAt > 3800) {
          changed = true;
          pushEvent("answer", `${c.agent} answered ${c.name}`);
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
        pushEvent("end", `Call with ${c.name} wrapped`);
      });
    }, 3000);
    const ambient = setInterval(() => {
      const cands = LEADS.filter(l => l.formattedPhone);
      const lead = cands[Math.floor(Math.random() * cands.length)];
      const ext = CC_EXTS[Math.floor(Math.random() * CC_EXTS.length)];
      const vm = Math.random() < 0.5;
      pushEvent(vm ? "voicemail" : "miss",
        vm ? `${lead.name} left a voicemail on #${ext.extension}` : `Missed call from ${lead.name} · rerouted to next agent`);
      setLastVonageSync(Date.now());
    }, 9000);
    return () => { clearInterval(spawn); clearInterval(promote); clearInterval(autoEnd); clearInterval(ambient); };
  }, [toast, logFromLive, pushEvent]);

  const endLiveCall = useCallback((id: number): number | null => {
    const c = feedRef.current.find(x => x.id === id);
    if (!c) return null;
    const dur = Math.max(1, Math.floor((Date.now() - c.startedAt) / 1000));
    feedRef.current = feedRef.current.filter(x => x.id !== id);
    setLiveFeed(feedRef.current);
    logFromLive(c, dur, c.ringing ? "Missed" : "Answered");
    pushEvent("end", `Call with ${c.name} wrapped by you`);
    return c.ringing ? 0 : dur;
  }, [logFromLive, pushEvent]);

  const logCallback = useCallback((p: { name: string; phone: string; customerId: string | null; locationId: number }): "Answered" | "Attempted" => {
    const ext = CC_EXTS[Math.floor(Math.random() * CC_EXTS.length)];
    const answered = Math.random() < 0.6;
    const dur = answered ? 30 + Math.floor(Math.random() * 240) : 0;
    const lineName = `${ext.displayName} (#${ext.extension})`;
    const log: CallLog = {
      id: 81_000 + nextId(), direction: "outbound", fromNumber: ext.phoneNumber, toNumber: p.phone,
      fromName: lineName, toName: p.name, customerId: p.customerId, appointmentId: null,
      locationId: p.locationId, startTime: new Date().toISOString(), duration: dur,
      result: answered ? "Answered" : "Attempted", hasRecording: answered,
      agent: ext.username.replace("Cleo.", "Agent · "), ext: ext.extension,
    };
    setCalls(cs => [log, ...cs]);
    setLastVonageSync(Date.now());
    pushEvent(answered ? "answer" : "miss", `Callback to ${p.name} ${answered ? "answered" : "· no answer"}`);
    return answered ? "Answered" : "Attempted";
  }, [pushEvent]);

  const inRange = useCallback((isoStr: string) => {
    if (dateRange === "all") return true;
    const t = new Date(isoStr).getTime();
    const now = Date.now();
    if (dateRange === "today") return new Date(t).toDateString() === new Date().toDateString();
    return now - t <= (dateRange === "7" ? 7 : 30) * 86_400_000;
  }, [dateRange]);

  const updateLeadStatus = useCallback((id: string, s: CallStatus) => {
    setLeads(ls => ls.map(l => l.id === id ? { ...l, callStatus: s, lastCalledAt: s === "not_called" ? l.lastCalledAt : new Date().toISOString() } : l));
  }, []);

  const addNote = useCallback((type: "lead" | "appointment", id: string, content: string) => {
    setNotes(ns => [{ id: nextId(), author: "You · Super Admin", notableType: type, notableId: id, content, createdAt: new Date().toISOString() }, ...ns]);
  }, []);

  const deliverLater = useCallback((match: (c: Conversation) => boolean, msgId: number) => {
    setTimeout(() => {
      setConversations(cs => cs.map(c => match(c) ? {
        ...c, messages: c.messages.map(m => m.id === msgId ? { ...m, status: "delivered" as const } : m),
      } : c));
    }, 1100);
  }, []);

  const sendSms = useCallback((convId: number, body: string) => {
    const msgId = nextId();
    setConversations(cs => cs.map(c => c.id === convId ? {
      ...c,
      messages: [...c.messages, { id: msgId, direction: "outbound" as const, body, at: new Date().toISOString(), status: "sent" as const }],
    } : c));
    deliverLater(c => c.id === convId, msgId);
    setLastTwilioSync(Date.now());
  }, [deliverLater]);

  const sendLeadSms = useCallback((leadId: string, body: string): number => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return -1;
    const existing = conversations.find(c => c.customerId === leadId);
    const convId = existing?.id ?? 70_000 + nextId();
    const msgId = 60_000 + nextId();
    setConversations(cs => {
      const msg: SmsMessage = { id: msgId, direction: "outbound", body, at: new Date().toISOString(), status: "sent" };
      const ex = cs.find(c => c.customerId === leadId);
      if (ex) return cs.map(c => c.id === ex.id ? { ...c, messages: [...c.messages, msg] } : c);
      const conv: Conversation = {
        id: convId, phone: lead.formattedPhone, customerId: lead.id,
        customerName: lead.name, locationId: lead.locationId, unreadCount: 0,
        unsubscribed: !!lead.unsubscribedAt, messages: [msg],
      };
      return [conv, ...cs];
    });
    deliverLater(c => c.id === convId, msgId);
    setLastTwilioSync(Date.now());
    return convId;
  }, [leads, conversations, deliverLater]);

  const sendSmsTo = useCallback((phone: string, name: string, locationId: number, body: string): number => {
    const existing = conversations.find(c => c.phone === phone);
    const convId = existing?.id ?? 70_500 + nextId();
    const msgId = 60_500 + nextId();
    setConversations(cs => {
      const msg: SmsMessage = { id: msgId, direction: "outbound", body, at: new Date().toISOString(), status: "sent" };
      const ex = cs.find(c => c.phone === phone);
      if (ex) return cs.map(c => c.id === ex.id ? { ...c, messages: [...c.messages, msg] } : c);
      const conv: Conversation = {
        id: convId, phone, customerId: null, customerName: name, locationId,
        unreadCount: 0, unsubscribed: false, messages: [msg],
      };
      return [conv, ...cs];
    });
    deliverLater(c => c.id === convId, msgId);
    setLastTwilioSync(Date.now());
    return convId;
  }, [conversations, deliverLater]);

  const markRead = useCallback((convId: number) => {
    setConversations(cs => cs.map(c => c.id === convId ? { ...c, unreadCount: 0 } : c));
  }, []);

  const simulateReply = useCallback((convId: number) => {
    setTimeout(() => {
      const REPLIES = [
        "Sounds good, thank you!", "Perfect — see you then 🖤", "Can you send the deposit link?",
        "Great, I'll be there on time!", "Thanks for the quick reply!",
      ];
      setConversations(cs => cs.map(c => c.id === convId ? {
        ...c,
        unreadCount: c.unreadCount + 1,
        messages: [...c.messages, { id: nextId(), direction: "inbound" as const, body: REPLIES[Math.floor(Math.random() * REPLIES.length)], at: new Date().toISOString(), status: "received" as const }],
      } : c));
      setLastTwilioSync(Date.now());
    }, 2600 + Math.random() * 1400);
  }, []);

  const convertLead = useCallback((id: string): number | null => {
    const lead = leads.find(l => l.id === id);
    if (!lead) return null;
    const apptId = nextId();
    const appt: Appointment = {
      id: apptId, uuid: `BK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      customerId: lead.id, name: lead.name, email: lead.email, formattedPhone: lead.formattedPhone,
      locationId: lead.locationId, purpose: lead.meta.purpose, style: lead.meta.style,
      storyType: lead.meta.storyType, story: lead.meta.story, size: lead.meta.size,
      bodyAreas: lead.meta.bodyAreas, referenceImage: lead.meta.referenceImages[0] ?? null,
      preferredDate: new Date(Date.now() + 5 * 86_400_000).toISOString(), preferredTime: "14:00",
      status: "pending", isFreePick: false, language: lead.meta.language, createdAt: new Date().toISOString(),
      platform: lead.attr.platform, campaign: lead.attr.utmCampaign, consent: lead.meta.consent,
    };
    setAppointments(as => [appt, ...as]);
    setLeads(ls => ls.map(l => l.id === id ? { ...l, callStatus: "appointment_made" as CallStatus, status: "done" as const } : l));
    return apptId;
  }, [leads]);

  const updateApptStatus = useCallback((id: number, s: ApptStatus) => {
    setAppointments(as => as.map(a => a.id === id ? { ...a, status: s } : a));
  }, []);

  const toggleBooking = useCallback((locId: number) => {
    setStudios(ss => ss.map(s => s.id === locId ? { ...s, bookingActive: !s.bookingActive } : s));
  }, []);
  const toggleArtist = useCallback((id: number) => {
    setArtists(as => as.map(a => a.id === id ? { ...a, active: !a.active } : a));
  }, []);

  const saveStudio = useCallback((s: Studio): number => {
    const exists = s.id > 0;
    const newId = studios.length ? Math.max(...studios.map(x => x.id)) + 1 : 1;
    const id = exists ? s.id : newId;
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

  const saveNumber = useCallback((n: StudioNumber) => {
    setNumbers(ns => ns.some(x => x.id === n.id)
      ? ns.map(x => x.id === n.id ? n : x)
      : [...ns, { ...n, id: ns.length ? Math.max(...ns.map(x => x.id)) + 1 : 1 }]);
  }, []);
  const removeNumber = useCallback((id: number) => {
    setNumbers(ns => ns.filter(x => x.id !== id));
  }, []);

  const callsFor = useCallback((customerId: string) => calls.filter(c => c.customerId === customerId), [calls]);
  const notesFor = useCallback((type: "lead" | "appointment", id: string) =>
    notes.filter(n => n.notableType === type && n.notableId === id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)), [notes]);
  const convFor = useCallback((customerId: string | null) => conversations.find(c => c.customerId === customerId), [conversations]);

  const unreadTotal = useMemo(() => conversations.reduce((s, c) => s + c.unreadCount, 0), [conversations]);
  const notCalledCount = useMemo(() => leads.filter(l => l.callStatus === "not_called").length, [leads]);
  const pendingCount = useMemo(() => appointments.filter(a => a.status === "pending").length, [appointments]);

  const value: Store = {
    route, navigate, globalLocation, setGlobalLocation, dateRange, setDateRange, inRange,
    leads, appointments, calls, conversations, notes, studios, artists, extensions: EXTENSIONS,
    liveCalls: liveFeed.length, liveCallsArr: liveFeed, liveEvents,
    staff, matrix, numbers, lastVonageSync, lastTwilioSync,
    unreadTotal, notCalledCount, pendingCount, toasts, toast, dismissToast,
    updateLeadStatus, addNote, sendSms, sendLeadSms, sendSmsTo, markRead, simulateReply,
    convertLead, updateApptStatus, toggleBooking, toggleArtist, saveStudio, saveStaff,
    toggleStaffActive, setMatrixGrant, saveNumber, removeNumber, endLiveCall, logCallback,
    callsFor, notesFor, convFor,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
