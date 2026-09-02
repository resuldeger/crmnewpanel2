import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore, type Route, type DateRange } from "../store";
import { Avatar, I, type IconName } from "./ui";
import { prettyPhone, studioById } from "../data/crm";

const NAV: { icon: IconName; label: string; route: Route; badge?: "notCalled" | "pending" | "unread" | "live" }[] = [
  { icon: "dashboard", label: "Dashboard", route: { view: "dashboard" } },
  { icon: "leads", label: "Leads Pipeline", route: { view: "leads" }, badge: "notCalled" },
  { icon: "calendar", label: "Appointments", route: { view: "appointments" }, badge: "pending" },
  { icon: "chat", label: "SMS Messenger", route: { view: "sms" }, badge: "unread" },
  { icon: "phone", label: "Call Center Hub", route: { view: "calls" }, badge: "live" },
  { icon: "chart", label: "Reports & Funnel", route: { view: "reports" } },
  { icon: "building", label: "Studios & Branches", route: { view: "studios" } },
  { icon: "artist", label: "Staff & Artists", route: { view: "staff" } },
  { icon: "gear", label: "Settings & Keys", route: { view: "settings" } },
];

const TITLES: Record<string, string> = {
  dashboard: "Dashboard", leads: "Leads Pipeline", lead: "Lead 360°",
  appointments: "Appointments", appointment: "Appointment Detail",
  sms: "SMS Messenger", calls: "Call Center Hub", reports: "Reports & Funnel",
  studios: "Studios & Branches", staff: "Staff & Artists", settings: "Settings & API Keys",
};

function Brand() {
  return (
    <div className="flex items-center gap-3 px-5 pb-6 pt-6">
      <div className="grid h-10 w-10 place-items-center rounded-xl border border-gold-500/40 bg-gradient-to-br from-gold-500/25 to-gold-500/5 shadow-[0_0_24px_-6px_rgba(212,175,55,0.6)]">
        <svg width="20" height="20" viewBox="0 0 32 32"><path d="M16 4 L28 27 H4 Z" fill="none" stroke="#e2c567" strokeWidth="2.6" /><circle cx="16" cy="20" r="3" fill="#e2c567" /></svg>
      </div>
      <div>
        <div className="font-display text-[16px] font-extrabold tracking-[0.18em] text-ink-50">CLEOPATRA</div>
        <div className="text-[10px] font-bold tracking-[0.3em] text-gold-500">INK · CRM CONSOLE</div>
      </div>
    </div>
  );
}

function OmniSearch() {
  const { leads, appointments, studios, navigate } = useStore();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const query = q.trim().toLowerCase();
  const hitLeads = query.length >= 2 ? leads.filter(l =>
    l.name.toLowerCase().includes(query) || l.email.toLowerCase().includes(query) ||
    l.formattedPhone.includes(query.replace(/[^0-9+]/g, "")) || l.id.toLowerCase().includes(query)).slice(0, 5) : [];
  const hitAppts = query.length >= 2 ? appointments.filter(a =>
    a.name.toLowerCase().includes(query) || a.uuid.toLowerCase().includes(query)).slice(0, 3) : [];
  const hitStudios = query.length >= 2 ? studios.filter(s =>
    s.name.toLowerCase().includes(query) || s.city.toLowerCase().includes(query)).slice(0, 2) : [];
  const go = (r: Route) => { navigate(r); setOpen(false); setQ(""); };
  const none = query.length >= 2 && hitLeads.length + hitAppts.length + hitStudios.length === 0;
  return (
    <div className="relative w-full max-w-md" ref={ref}>
      <div className="flex items-center gap-2.5 rounded-xl border border-ink-600 bg-ink-900/80 px-3.5 py-2 transition-colors focus-within:border-gold-500/60">
        <I name="search" size={15} className="text-ink-400" />
        <input value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          placeholder="Search name, email, phone, booking UUID…"
          className="w-full bg-transparent text-[13px] font-semibold text-ink-100 outline-none placeholder:font-medium placeholder:text-ink-500" />
        <kbd className="num hidden rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400 md:block">⌘K</kbd>
      </div>
      {open && query.length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-ink-600 bg-ink-800 shadow-pop animate-pop">
          {none && <div className="px-4 py-5 text-center text-[12px] text-ink-400">No matches across leads, bookings or studios.</div>}
          {hitLeads.length > 0 && <div className="px-3 pt-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-400">Leads</div>}
          {hitLeads.map(l => (
            <button key={l.id} onClick={() => go({ view: "lead", id: l.id })} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-ink-750">
              <Avatar name={l.name} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-ink-100">{l.name}</span>
                <span className="num block truncate text-[11px] text-ink-400">{l.email} · {prettyPhone(l.formattedPhone) || "no phone"}</span>
              </span>
              <I name="chevR" size={13} className="text-ink-500" />
            </button>
          ))}
          {hitAppts.length > 0 && <div className="px-3 pt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-400">Appointments</div>}
          {hitAppts.map(a => (
            <button key={a.id} onClick={() => go({ view: "appointment", id: a.id })} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-ink-750">
              <span className="grid h-7 w-7 place-items-center rounded-lg border border-ink-600 bg-ink-750 text-gold-400"><I name="calendar" size={13} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-ink-100">{a.name}</span>
                <span className="num block text-[11px] text-ink-400">{a.uuid} · {studioById(a.locationId)?.name}</span>
              </span>
            </button>
          ))}
          {hitStudios.length > 0 && <div className="px-3 pt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-400">Studios</div>}
          {hitStudios.map(s => (
            <button key={s.id} onClick={() => go({ view: "studios" })} className="flex w-full items-center gap-3 px-3.5 py-2.5 pb-3 text-left transition-colors hover:bg-ink-750">
              <span className="grid h-7 w-7 place-items-center rounded-lg border border-ink-600 bg-ink-750 text-gold-400"><I name="building" size={13} /></span>
              <span className="text-[13px] font-bold text-ink-100">{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Topbar() {
  const { route, globalLocation, setGlobalLocation, dateRange, setDateRange, studios, liveCalls, navigate } = useStore();
  const [locOpen, setLocOpen] = useState(false);
  const [drOpen, setDrOpen] = useState(false);
  const locRef = useRef<HTMLDivElement>(null);
  const drRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (locRef.current && !locRef.current.contains(e.target as Node)) setLocOpen(false);
      if (drRef.current && !drRef.current.contains(e.target as Node)) setDrOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const locName = globalLocation === "all" ? "All Studios" : studioById(globalLocation)?.name ?? "All Studios";
  const DR: { v: DateRange; label: string }[] = [
    { v: "today", label: "Today" }, { v: "7", label: "Last 7 Days" }, { v: "30", label: "Last 30 Days" }, { v: "all", label: "All Time" },
  ];
  return (
    <header className="sticky top-0 z-50 border-b border-ink-700/80 bg-ink-950/85 backdrop-blur-md">
      <div className="flex items-center gap-3 px-6 py-3">
        <div className="mr-1 hidden lg:block">
          <h1 className="font-display text-[20px] font-bold tracking-wide text-ink-50">{TITLES[route.view]}</h1>
        </div>
        <div className="hidden h-8 w-px bg-ink-700 lg:block" />
        <OmniSearch />
        <div className="ml-auto flex items-center gap-2.5">
          {/* location selector */}
          <div className="relative hidden md:block" ref={locRef}>
            <button onClick={() => setLocOpen(o => !o)}
              className="flex items-center gap-2 rounded-xl border border-ink-600 bg-ink-875 px-3 py-2 text-[12.5px] font-bold text-ink-200 transition-colors hover:border-gold-500/50 hover:text-gold-300">
              <I name="pin" size={14} className="text-gold-400" />
              <span className="max-w-[130px] truncate">{locName}</span>
              <I name="chevD" size={13} className="text-ink-400" />
            </button>
            {locOpen && (
              <div className="absolute right-0 top-full z-50 mt-1.5 max-h-80 w-64 overflow-y-auto rounded-xl border border-ink-600 bg-ink-800 py-1.5 shadow-pop animate-pop">
                <button onClick={() => { setGlobalLocation("all"); setLocOpen(false); }}
                  className={`flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] font-semibold hover:bg-ink-750 ${globalLocation === "all" ? "text-gold-300" : "text-ink-200"}`}>
                  <I name="globe" size={14} /> All Studios
                  {globalLocation === "all" && <I name="check" size={13} className="ml-auto text-gold-400" />}
                </button>
                <div className="my-1 border-t border-ink-700" />
                {studios.map(s => (
                  <button key={s.id} onClick={() => { setGlobalLocation(s.id); setLocOpen(false); }}
                    className={`flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] font-semibold hover:bg-ink-750 ${globalLocation === s.id ? "text-gold-300" : "text-ink-200"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${s.bookingActive ? "bg-jade-500" : "bg-ink-500"}`} />
                    <span className="truncate">{s.name}</span>
                    {globalLocation === s.id && <I name="check" size={13} className="ml-auto text-gold-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* date range */}
          <div className="relative hidden sm:block" ref={drRef}>
            <button onClick={() => setDrOpen(o => !o)}
              className="flex items-center gap-2 rounded-xl border border-ink-600 bg-ink-875 px-3 py-2 text-[12.5px] font-bold text-ink-200 transition-colors hover:border-gold-500/50 hover:text-gold-300">
              <I name="clock" size={14} className="text-gold-400" />
              {DR.find(d => d.v === dateRange)?.label}
              <I name="chevD" size={13} className="text-ink-400" />
            </button>
            {drOpen && (
              <div className="absolute right-0 top-full z-50 mt-1.5 w-44 rounded-xl border border-ink-600 bg-ink-800 py-1.5 shadow-pop animate-pop">
                {DR.map(d => (
                  <button key={d.v} onClick={() => { setDateRange(d.v); setDrOpen(false); }}
                    className={`flex w-full items-center justify-between px-3.5 py-2 text-left text-[13px] font-semibold hover:bg-ink-750 ${dateRange === d.v ? "text-gold-300" : "text-ink-200"}`}>
                    {d.label}{dateRange === d.v && <I name="check" size={13} className="text-gold-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* live calls */}
          <button onClick={() => navigate({ view: "calls" })} title="Live active calls — open Call Center"
            className="group flex items-center gap-2 rounded-xl border border-jade-500/35 bg-jade-500/10 px-3 py-2 text-[12.5px] font-bold text-jade-400 transition-all hover:border-jade-500/60 hover:bg-jade-500/15">
            <span className="relative flex h-2 w-2">
              <span className="absolute h-2 w-2 animate-ping rounded-full bg-jade-400 opacity-60" />
              <span className="h-2 w-2 rounded-full bg-jade-400" />
            </span>
            <span className="num">{liveCalls}</span> live
          </button>
          <div className="flex items-center gap-2.5 rounded-xl border border-ink-600 bg-ink-875 py-1.5 pl-1.5 pr-3">
            <Avatar name="Cleo Rivera" size={28} ring />
            <div className="hidden text-left leading-tight xl:block">
              <div className="text-[12px] font-extrabold text-ink-100">Cleo Rivera</div>
              <div className="text-[10px] font-bold tracking-wide text-gold-500">SUPER ADMIN</div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const { route, navigate, notCalledCount, pendingCount, unreadTotal, liveCalls } = useStore();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [route]);
  const badge = (b?: typeof NAV[number]["badge"]) => {
    if (b === "notCalled") return notCalledCount;
    if (b === "pending") return pendingCount;
    if (b === "unread") return unreadTotal;
    if (b === "live") return liveCalls;
    return 0;
  };
  return (
    <div className="ambient-bg ambient-grain ambient-lines min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-[60] hidden w-[232px] flex-col border-r border-ink-700/80 bg-ink-900/90 backdrop-blur md:flex">
        <Brand />
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {NAV.map(item => {
            const active = route.view === item.route.view ||
              (item.route.view === "leads" && route.view === "lead") ||
              (item.route.view === "appointments" && route.view === "appointment");
            const n = badge(item.badge);
            return (
              <button key={item.label} onClick={() => navigate(item.route)}
                className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-[9px] text-left text-[13px] font-bold transition-all duration-150 ${active ? "bg-gold-500/12 text-gold-300" : "text-ink-300 hover:bg-ink-800 hover:text-ink-100"}`}>
                <span className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-gold-500 transition-all duration-200 ${active ? "opacity-100" : "opacity-0 group-hover:opacity-40"}`} />
                <I name={item.icon} size={17} className={active ? "text-gold-400" : "text-ink-400 group-hover:text-ink-200"} />
                <span className="flex-1">{item.label}</span>
                {n > 0 && (
                  <span className={`num rounded-md px-1.5 py-0.5 text-[10.5px] font-bold ${item.badge === "live" ? "bg-jade-500/15 text-jade-400 border border-jade-500/30" : item.badge === "unread" ? "bg-ember-500/15 text-ember-400 border border-ember-500/30" : "bg-gold-500/15 text-gold-300 border border-gold-500/30"}`}>
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-ink-700/80 p-4">
          <SyncStrips />
          <div className="flex items-center gap-2.5">
            <Avatar name="Cleo Rivera" size={34} />
            <div className="leading-tight">
              <div className="text-[12.5px] font-extrabold text-ink-100">Cleo Rivera</div>
              <div className="text-[10.5px] font-semibold text-ink-400">Headquarters · All Access</div>
            </div>
          </div>
        </div>
      </aside>
      <div className="relative z-10 md:pl-[232px]">
        <Topbar />
        <main className="mx-auto max-w-[1480px] px-4 py-6 md:px-6">{children}</main>
        <footer className="border-t border-ink-800 px-6 py-5 text-center text-[11px] font-semibold tracking-wide text-ink-500">
          CLEOPATRA INK · CRM CONSOLE v4.2 — {new Date().getFullYear()} · Vonage VBC + Twilio + Timely integrated
        </footer>
      </div>
    </div>
  );
}

function agoLabel(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function SyncStrips() {
  const { lastVonageSync, lastTwilioSync, liveCalls } = useStore();
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force(x => x + 1), 10_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="mb-3 space-y-1.5">
      <div className="flex items-center gap-2 rounded-lg border border-jade-500/25 bg-jade-500/8 px-3 py-1.5" title={liveCalls > 0 ? `${liveCalls} live call(s) on the floor` : "Vonage Events API connected"}>
        <span className="relative flex h-1.5 w-1.5"><span className="absolute h-1.5 w-1.5 animate-ping rounded-full bg-jade-400 opacity-70" /><span className="h-1.5 w-1.5 rounded-full bg-jade-400" /></span>
        <span className="num text-[10.5px] font-bold text-jade-400">Vonage VBC · Synced {agoLabel(lastVonageSync)}</span>
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-ember-500/25 bg-ember-500/8 px-3 py-1.5" title="Twilio Programmable SMS connected">
        <span className="relative flex h-1.5 w-1.5"><span className="absolute h-1.5 w-1.5 animate-ping rounded-full bg-ember-400 opacity-70" /><span className="h-1.5 w-1.5 rounded-full bg-ember-400" /></span>
        <span className="num text-[10.5px] font-bold text-ember-400">Twilio SMS · Synced {agoLabel(lastTwilioSync)}</span>
      </div>
    </div>
  );
}

export function ToastHost() {
  const { toasts, dismissToast } = useStore();
  const meta = {
    success: { icon: "check" as IconName, cls: "border-jade-500/40 text-jade-400", bar: "#2fbf71" },
    info: { icon: "spark" as IconName, cls: "border-lapis-500/40 text-lapis-400", bar: "#4c8dff" },
    error: { icon: "alert" as IconName, cls: "border-ember-500/40 text-ember-400", bar: "#e5484d" },
  };
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[90] flex w-[340px] flex-col gap-2">
      {toasts.map(t => {
        const m = meta[t.kind];
        return (
          <div key={t.id} className={`pointer-events-auto flex items-center gap-3 overflow-hidden rounded-xl border bg-ink-800/95 py-3 pl-3 pr-2 shadow-pop backdrop-blur animate-toast ${m.cls}`}>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-current/30 bg-ink-900"><I name={m.icon} size={14} /></span>
            <span className="flex-1 text-[12.5px] font-bold leading-snug text-ink-100">{t.msg}</span>
            <button onClick={() => dismissToast(t.id)} className="rounded-md p-1 text-ink-400 hover:bg-ink-700 hover:text-ink-100"><I name="x" size={13} /></button>
            <span className="absolute bottom-0 left-0 h-[2px] w-full" style={{ background: m.bar, opacity: 0.5 }} />
          </div>
        );
      })}
    </div>
  );
}
