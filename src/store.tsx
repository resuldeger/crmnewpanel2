import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LEADS, APPOINTMENTS, CALLS, CONVERSATIONS, NOTES, STUDIOS, ARTISTS, EXTENSIONS,
  nextId, type Lead, type Appointment, type CallLog, type Conversation, type Note,
  type Studio, type Artist, type CallStatus, type ApptStatus,
} from "./data/crm";

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
  convertLead: (id: string) => number | null;
  updateApptStatus: (id: number, s: ApptStatus) => void;
  toggleBooking: (locId: number) => void;
  toggleArtist: (id: number) => void;
  callsFor: (customerId: string) => CallLog[];
  notesFor: (type: "lead" | "appointment", id: string) => Note[];
  convFor: (customerId: string | null) => Conversation | undefined;
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

  useEffect(() => {
    const t = setInterval(() => setLiveCalls(1 + Math.floor(Math.random() * 5)), 7000);
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
    updateLeadStatus, addNote, sendSms, markRead, convertLead, updateApptStatus,
    toggleBooking, toggleArtist, callsFor, notesFor, convFor,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
