import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LEADS, APPOINTMENTS, CALLS, CONVERSATIONS, NOTES, STUDIOS, ARTISTS, EXTENSIONS, STAFF, DEFAULT_MATRIX,
  nextId, type Lead, type Appointment, type CallLog, type Conversation, type Note,
  type Studio, type Artist, type CallStatus, type ApptStatus, type StaffMember,
} from "./data/crm";

export interface LiveEvent { id: number; at: string; kind: "answer" | "queue" | "end" | "voicemail" | "miss"; text: string }

export type Route =
  | { view: "dashboard" } | { view: "leads" } | { view: "lead"; id: string }
  | { view: "appointments" } | { view: "appointment"; id: number }
  | { view: "sms"; id?: number } | { view: "calls" } | { view: "reports" }
  | { view: "studios" } | { view: "staff" } | { view: "settings" };

export type DateRange = "today" | "7" | "30" | "all";
export interface Toast { id: number; msg: string; kind: "success" | "info" | "error" }

interface Store {
  route: Route; navigate: (r: Route) => void;
  globalLocation: number | "all"; setGlobalLocation: (v: number | "all") => void;
  dateRange: DateRange; setDateRange: (v: DateRange) => void;
  inRange: (isoStr: string) => boolean;
  leads: Lead[]; appointments: Appointment[]; calls: CallLog[];
  conversations: Conversation[]; notes: Note[]; studios: Studio[]; artists: Artist[];
  extensions: typeof EXTENSIONS; liveCalls: number;
  unreadTotal: number; notCalledCount: number; pendingCount: number;
  toasts: Toast[]; toast: (msg: string, kind?: Toast["kind"]) => void; dismissToast: (id: number) => void;
  updateLeadStatus: (id: string, s: CallStatus) => void;
  addNote: (type: "lead" | "appointment", id: string, content: string) => void;
  sendSms: (convId: number, body: string) => void;
  markRead: (convId: number) => void;
  simulateReply: (convId: number) => void;
  convertLead: (id: string) => number | null;
  updateApptStatus: (id: number, s: ApptStatus) => void;
  toggleBooking: (locId: number) => void;
  toggleArtist: (id: number) => void;
  callsFor: (customerId: string) => CallLog[];
  callsForPhone: (phone: string, customerId: string | null) => CallLog[];
  notesFor: (type: "lead" | "appointment", id: string) => Note[];
  convFor: (customerId: string | null) => Conversation | undefined;
  sendLeadSms: (leadId: string, body: string) => number;
  sendSmsTo: (phone: string, name: string, locationId: number, body: string) => number;
  saveStudio: (s: Studio) => void;
  staff: StaffMember[]; saveStaff: (m: StaffMember) => void; toggleStaffActive: (id: number) => void;
  matrix: Record<string, string[]>; togglePerm: (roleId: string, permId: string) => void;
  liveEvents: LiveEvent[];
}

const Ctx = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(Ctx);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>({ view: "dashboard" });
  const [globalLocation, setGlobalLocation] = useState<number | "all">("all");
  const [dateRange, setDateRange] = useState<DateRange>("30");
  const [leads, setLeads] = useState(LEADS);
  const [appointments, setAppointments] = useState(APPOINTMENTS);
  const [calls] = useState(CALLS);
  const [conversations, setConversations] = useState(CONVERSATIONS);
  const [notes, setNotes] = useState(NOTES);
  const [studios, setStudios] = useState(STUDIOS);
  const [artists, setArtists] = useState(ARTISTS);
  const [liveCalls, setLiveCalls] = useState(3);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>(STAFF);
  const [matrix, setMatrix] = useState<Record<string, string[]>>(DEFAULT_MATRIX);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);

  useEffect(() => {
    const t = setInterval(() => setLiveCalls(1 + Math.floor(Math.random() * 5)), 7000);
    return () => clearInterval(t);
  }, []);

  // simulated Vonage VBC event stream (swap for wss://ws.vonage.com in prod)
  useEffect(() => {
    const names = ["Emma J.", "Liam W.", "Zeynep K.", "Noah P.", "Elif D.", "Mason R.", "Selin A.", "Jonas M.", "Chloe B.", "Mateo V."];
    const exts = ["401", "403", "405", "432", "462"];
    const mk = (): LiveEvent => {
      const r = Math.random();
      const who = names[Math.floor(Math.random() * names.length)];
      const ext = exts[Math.floor(Math.random() * exts.length)];
      const kind: LiveEvent["kind"] = r < 0.3 ? "answer" : r < 0.5 ? "queue" : r < 0.7 ? "end" : r < 0.86 ? "voicemail" : "miss";
      const text =
        kind === "answer" ? `#${ext} answered ${who} — bridged to agent` :
        kind === "queue" ? `${who} entered queue → routing to #${ext}` :
        kind === "end" ? `Call with ${who} ended · ${1 + Math.floor(Math.random() * 6)}m ${Math.floor(Math.random() * 59)}s talk` :
        kind === "voicemail" ? `Voicemail left by ${who} on #${ext} — recording saved` :
        `${who} rang #${ext} — missed, callback queued`;
      return { id: nextId(), at: new Date().toISOString(), kind, text };
    };
    setLiveEvents(Array.from({ length: 5 }, mk).reverse());
    const t = setInterval(() => setLiveEvents(ev => [mk(), ...ev].slice(0, 8)), 4200);
    return () => clearInterval(t);
  }, []);

  const navigate = useCallback((r: Route) => setRoute(r), []);

  const dismissToast = useCallback((id: number) => setToasts(ts => ts.filter(t => t.id !== id)), []);
  const toast = useCallback((msg: string, kind: Toast["kind"] = "success") => {
    const id = nextId();
    setToasts(ts => [...ts.slice(-3), { id, msg, kind }]);
    setTimeout(() => dismissToast(id), 3400);
  }, [dismissToast]);

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

  const sendSms = useCallback((convId: number, body: string) => {
    const msgId = nextId();
    setConversations(cs => cs.map(c => c.id === convId ? {
      ...c,
      messages: [...c.messages, { id: msgId, direction: "outbound" as const, body, at: new Date().toISOString(), status: "sent" as const }],
    } : c));
    setTimeout(() => {
      setConversations(cs => cs.map(c => c.id === convId ? {
        ...c,
        messages: c.messages.map(m => m.id === msgId ? { ...m, status: "delivered" as const } : m),
      } : c));
    }, 1100);
  }, []);

  const markRead = useCallback((convId: number) => {
    setConversations(cs => cs.map(c => c.id === convId ? { ...c, unreadCount: 0 } : c));
  }, []);

  const SIM_REPLIES = [
    "Sounds good, thank you!",
    "Perfect — I'll send the deposit tonight 🖤",
    "Great, see you then!",
    "Could we do 15:00 instead?",
    "Amazing, I love that direction!",
    "Got it — replying from work, will call later!",
  ];
  const simulateReply = useCallback((convId: number) => {
    setTimeout(() => {
      setConversations(cs => cs.map(c => c.id === convId ? {
        ...c,
        messages: [...c.messages, {
          id: nextId(), direction: "inbound" as const,
          body: SIM_REPLIES[Math.floor(Math.random() * SIM_REPLIES.length)],
          at: new Date().toISOString(), status: "received" as const,
        }],
      } : c));
    }, 2600);
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

  const callsFor = useCallback((customerId: string) => calls.filter(c => c.customerId === customerId), [calls]);
  const callsForPhone = useCallback((phone: string, customerId: string | null) =>
    calls.filter(c => (customerId && c.customerId === customerId) || (phone && (c.fromNumber === phone || c.toNumber === phone)))
      .sort((a, b) => +new Date(b.startTime) - +new Date(a.startTime)), [calls]);

  const saveStudio = useCallback((s: Studio) => {
    setStudios(ss => ss.some(x => x.id === s.id) ? ss.map(x => x.id === s.id ? s : x) : [...ss, { ...s }]);
  }, []);
  const saveStaff = useCallback((m: StaffMember) => {
    setStaff(sf => sf.some(x => x.id === m.id) ? sf.map(x => x.id === m.id ? m : x) : [...sf, { ...m, lastActiveAt: new Date().toISOString() }]);
  }, []);
  const toggleStaffActive = useCallback((id: number) =>
    setStaff(sf => sf.map(m => m.id === id ? { ...m, active: !m.active } : m)), []);
  const togglePerm = useCallback((roleId: string, permId: string) => {
    setMatrix(mx => {
      const cur = mx[roleId] ?? [];
      return { ...mx, [roleId]: cur.includes(permId) ? cur.filter(p => p !== permId) : [...cur, permId] };
    });
  }, []);

  const pushOutbound = useCallback((convId: number, body: string) => {
    const msgId = nextId();
    setConversations(cs => cs.map(c => c.id === convId ? {
      ...c,
      messages: [...c.messages, { id: msgId, direction: "outbound" as const, body, at: new Date().toISOString(), status: "sent" as const }],
    } : c));
    setTimeout(() => {
      setConversations(cs => cs.map(c => c.id === convId ? {
        ...c, messages: c.messages.map(m => m.id === msgId ? { ...m, status: "delivered" as const } : m),
      } : c));
    }, 1100);
  }, []);

  const sendSmsTo = useCallback((phone: string, name: string, locationId: number, body: string): number => {
    if (!phone) return -1;
    const existing = conversations.find(c => c.phone === phone);
    let convId = existing?.id ?? -1;
    if (!existing) {
      convId = nextId();
      const conv: Conversation = {
        id: convId, phone, customerId: null, customerName: name,
        locationId, unreadCount: 0, unsubscribed: false, messages: [],
      };
      setConversations(cs => [conv, ...cs]);
    }
    pushOutbound(convId, body);
    return convId;
  }, [conversations, pushOutbound]);

  const sendLeadSms = useCallback((leadId: string, body: string): number => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return -1;
    const existing = conversations.find(c => c.customerId === leadId);
    let convId = existing?.id ?? -1;
    if (!existing) {
      convId = nextId();
      const conv: Conversation = {
        id: convId, phone: lead.formattedPhone, customerId: lead.id, customerName: lead.name,
        locationId: lead.locationId, unreadCount: 0, unsubscribed: !!lead.unsubscribedAt, messages: [],
      };
      setConversations(cs => [conv, ...cs]);
    }
    pushOutbound(convId, body);
    return convId;
  }, [leads, conversations, pushOutbound]);
  const notesFor = useCallback((type: "lead" | "appointment", id: string) =>
    notes.filter(n => n.notableType === type && n.notableId === id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)), [notes]);
  const convFor = useCallback((customerId: string | null) => conversations.find(c => c.customerId === customerId), [conversations]);

  const unreadTotal = useMemo(() => conversations.reduce((s, c) => s + c.unreadCount, 0), [conversations]);
  const notCalledCount = useMemo(() => leads.filter(l => l.callStatus === "not_called").length, [leads]);
  const pendingCount = useMemo(() => appointments.filter(a => a.status === "pending").length, [appointments]);

  const value: Store = {
    route, navigate, globalLocation, setGlobalLocation, dateRange, setDateRange, inRange,
    leads, appointments, calls, conversations, notes, studios, artists, extensions: EXTENSIONS, liveCalls,
    unreadTotal, notCalledCount, pendingCount, toasts, toast, dismissToast,
    updateLeadStatus, addNote, sendSms, markRead, simulateReply, convertLead, updateApptStatus,
    toggleBooking, toggleArtist, callsFor, callsForPhone, notesFor, convFor,
    sendLeadSms, sendSmsTo, saveStudio, staff, saveStaff, toggleStaffActive, matrix, togglePerm, liveEvents,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
