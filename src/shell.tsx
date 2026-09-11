"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStore, type Route, type DateRange } from "./store";
import { Avatar, I, type IconName } from "./ui";
import { ROLES, studioById, type PermId, type StaffMember } from "./data";
import { t, tf, useI18n, setLang, type Lang } from "./i18n";

const NAV: { icon: IconName; label: string; route: Route; badge?: "notCalled" | "pending" | "unread" | "live" | "tasks" | "dup"; perm?: PermId }[] = [
  { icon: "dashboard", label: "Dashboard", route: { view: "dashboard" } },
  { icon: "users", label: "Customers", route: { view: "customers" }, perm: "customers.view" },
  { icon: "leads", label: "Leads Pipeline", route: { view: "leads" }, badge: "notCalled", perm: "leads.view" },
  { icon: "calendar", label: "Appointments", route: { view: "appointments" }, badge: "pending", perm: "appts.view" },
  { icon: "chat", label: "SMS Messenger", route: { view: "sms" }, badge: "unread", perm: "sms.view" },
  { icon: "send", label: "SMS Campaigns", route: { view: "campaigns" }, perm: "sms.campaign" },
  { icon: "phone", label: "Call Center Hub", route: { view: "calls" }, badge: "live", perm: "calls.view" },
  { icon: "checks", label: "Tasks", route: { view: "tasks" }, badge: "tasks", perm: "calls.view" },
  { icon: "chart", label: "Reports & Funnel", route: { view: "reports" }, perm: "reports.view" },
  { icon: "building", label: "Studios & Branches", route: { view: "studios" }, perm: "studios.view" },
  { icon: "artist", label: "Staff & Artists", route: { view: "staff" }, perm: "staff.view" },
  { icon: "gear", label: "Settings & API Keys", route: { view: "settings" }, perm: "settings.manage" },
  { icon: "download", label: "CSV Import", route: { view: "import" }, perm: "leads.edit" },
];

export const TITLES: Record<string, string> = {
  dashboard: "Dashboard", customers: "Customers Directory", customer: "Customer 360° Profile",
  leads: "Leads Pipeline", lead: "Lead 360°",
  appointments: "Appointments", appointment: "Appointment Detail",
  sms: "SMS Messenger", campaigns: "SMS Campaigns", calls: "Call Center Hub", tasks: "Tasks",
  reports: "Reports & Funnel", studios: "Studios & Branches", studio: "Edit Booking Location",
  staff: "Staff & Artists", settings: "Settings & API Keys", duplicates: "Duplicate Merge", import: "CSV Import", notfound: "Not Found",
};

function Brand() {
  return (
    <div className="flex items-center justify-center gap-3 px-3 pb-5 pt-6 xl:justify-start xl:px-5">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-gold-500/50 bg-ink-50 shadow-[0_0_24px_-6px_rgba(251,162,0,0.7)]">
        <svg width="20" height="20" viewBox="0 0 32 32"><path d="M16 4 L28 27 H4 Z" fill="none" stroke="#fba200" strokeWidth="2.6" /><circle cx="16" cy="20" r="3" fill="#fba200" /></svg>
      </div>
      <div className="hidden xl:block">
        <div className="font-display text-[15px] font-extrabold tracking-[0.18em] text-ink-50">CLEOPATRA</div>
        <div className="text-[10px] font-bold tracking-[0.3em] text-gold-500">INK · {t("CRM Console").toUpperCase()}</div>
      </div>
    </div>
  );
}

function LangSwitch() {
  const { lang } = useI18n();
  return (
    <div className="flex items-center rounded-xl border border-ink-600 bg-ink-875 p-0.5" title={t("Console language")}>
      {(["en", "tr"] as Lang[]).map(l => (
        <button key={l} onClick={() => setLang(l)}
          className={`rounded-lg px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-wider transition-all duration-150 ${lang === l ? "bg-gold-500 text-ink-50 shadow-[0_2px_10px_-3px_rgba(251,162,0,0.7)]" : "text-ink-400 hover:text-ink-100"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

function OmniSearch() {
  const { leads, appointments, studios, customers, navigate } = useStore();
  const [q, setQ] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input & lock body scroll when modal opens
  useEffect(() => {
    if (modalOpen) {
      document.body.style.overflow = "hidden";
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [modalOpen]);

  // Global keydown listener for Cmd+K and ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setModalOpen(true);
      }
      if (e.key === "Escape" && modalOpen) {
        e.preventDefault();
        setModalOpen(false);
        setQ("");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen]);

  const query = q.trim().toLowerCase();
  const hitCustomers = query.length >= 2 ? customers.filter(c =>
    c.name.toLowerCase().includes(query) || c.email.toLowerCase().includes(query) ||
    c.phone.replace(/[^0-9+]/g, "").includes(query.replace(/[^0-9+]/g, "")) || c.id.toLowerCase().includes(query)).slice(0, 4) : [];
  const hitLeads = query.length >= 2 ? leads.filter(l =>
    l.name.toLowerCase().includes(query) || l.email.toLowerCase().includes(query) ||
    l.formattedPhone.includes(query.replace(/[^0-9+]/g, "")) || l.id.toLowerCase().includes(query)).slice(0, 5) : [];
  const hitAppts = query.length >= 2 ? appointments.filter(a =>
    a.name.toLowerCase().includes(query) || a.uuid.toLowerCase().includes(query)).slice(0, 4) : [];
  const hitStudios = query.length >= 2 ? studios.filter(s =>
    s.name.toLowerCase().includes(query) || s.city.toLowerCase().includes(query)).slice(0, 3) : [];
  
  const go = (r: Route) => { navigate(r); setModalOpen(false); setQ(""); };
  const none = query.length >= 2 && hitCustomers.length + hitLeads.length + hitAppts.length + hitStudios.length === 0;

  return (
    <>
      {/* Search trigger button: icon-only on mobile, full input pill on tablet/desktop */}
      <button 
        onClick={() => setModalOpen(true)}
        className="flex items-center gap-2.5 rounded-xl border border-ink-600 bg-ink-875/80 p-2 text-left transition-colors hover:border-gold-500/60 sm:min-w-0 sm:max-w-md sm:flex-1 sm:px-3.5 sm:py-2"
      >
        <I name="search" size={16} className="text-gold-400 sm:text-ink-400" />
        <span className="hidden text-[13px] font-medium text-ink-400 sm:inline truncate">
          {t("Search customer, lead, phone, booking UUID…")}
        </span>
        <kbd className="ml-auto hidden rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 text-[10px] font-extrabold text-ink-400 lg:inline-block">⌘K</kbd>
      </button>

      {/* Central Modal Search Overlay */}
      {modalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          {/* Backdrop overlay: blurred, dark, click to close */}
          <div 
            className="fixed inset-0 bg-ink-950/85 backdrop-blur-md transition-opacity duration-200 animate-fade"
            onClick={() => { setModalOpen(false); setQ(""); }}
          />
          <div className="relative my-auto w-full max-w-xl overflow-hidden rounded-2xl border border-ink-600/80 bg-ink-875 shadow-2xl shadow-black/80 transition-all animate-pop z-10">
            <div className="flex items-center gap-3 border-b border-ink-700 px-4 py-3.5">
              <I name="search" size={18} className="text-gold-400 shrink-0" />
              <input 
                ref={inputRef}
                value={q} 
                onChange={e => setQ(e.target.value)}
                placeholder={t("Search customer, lead, phone, booking UUID…")}
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                className="w-full bg-transparent text-[14px] font-semibold text-ink-50 outline-none placeholder:font-medium placeholder:text-ink-500" 
              />
              <div className="flex items-center gap-2 shrink-0">
                {q && (
                  <button 
                    onClick={() => setQ("")} 
                    title={t("Clear text")}
                    aria-label={t("Clear text")}
                    className="rounded-lg p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100 transition-colors"
                  >
                    <I name="x" size={14} />
                  </button>
                )}
                <kbd className="hidden rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 text-[10.5px] font-bold text-ink-400 sm:inline-block">ESC</kbd>
                <button
                  type="button"
                  onClick={() => { setModalOpen(false); setQ(""); }}
                  title={t("Close")}
                  aria-label={t("Close")}
                  className="flex h-8 w-8 items-center justify-center rounded-xl border border-ink-600 bg-ink-850 text-ink-300 transition-colors hover:border-gold-500/50 hover:bg-ink-800 hover:text-gold-300 active:scale-95"
                >
                  <I name="x" size={15} />
                </button>
              </div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              {query.length < 2 && (
                <div className="px-5 py-8 text-center text-[12.5px] font-medium text-ink-400">
                  {t("Type at least 2 characters to search across customers, leads, bookings and studios.")}
                </div>
              )}

              {none && (
                <div className="px-5 py-8 text-center text-[13px] text-ink-400">
                  {t("No matches across customers, leads, bookings or studios.")}
                </div>
              )}

              {hitCustomers.length > 0 && (
                <div>
                  <div className="bg-ink-850/60 px-4 py-1.5 text-[10.5px] font-extrabold uppercase tracking-wider text-gold-400">{t("Customers")}</div>
                  {hitCustomers.map(c => (
                    <button key={c.id} onClick={() => go({ view: "customer", id: c.id })} className="flex w-full items-center gap-3 border-b border-ink-800/50 px-4 py-2.5 text-left transition-colors hover:bg-ink-800">
                      <Avatar name={c.name} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 truncate text-[13px] font-bold text-ink-100">
                          {c.name}
                          <span className="rounded bg-gold-500/15 px-1 text-[9px] font-extrabold text-gold-400">{t("Customer")}</span>
                        </span>
                        <span className="num block truncate text-[11px] text-ink-400">{c.phone} · {c.email}</span>
                      </span>
                      <I name="chevR" size={14} className="text-ink-500" />
                    </button>
                  ))}
                </div>
              )}

              {hitLeads.length > 0 && (
                <div>
                  <div className="bg-ink-850/60 px-4 py-1.5 text-[10.5px] font-extrabold uppercase tracking-wider text-gold-400">{t("Leads Pipeline")}</div>
                  {hitLeads.map(l => (
                    <button key={l.id} onClick={() => go({ view: "lead", id: l.id })} className="flex w-full items-center gap-3 border-b border-ink-800/50 px-4 py-2.5 text-left transition-colors hover:bg-ink-800">
                      <Avatar name={l.name} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold text-ink-100">{l.name}</span>
                        <span className="num block truncate text-[11px] text-ink-400">{l.email}</span>
                      </span>
                      <I name="chevR" size={14} className="text-ink-500" />
                    </button>
                  ))}
                </div>
              )}

              {hitAppts.length > 0 && (
                <div>
                  <div className="bg-ink-850/60 px-4 py-1.5 text-[10.5px] font-extrabold uppercase tracking-wider text-gold-400">{t("Appointments")}</div>
                  {hitAppts.map(a => (
                    <button key={a.id} onClick={() => go({ view: "appointment", id: a.id })} className="flex w-full items-center gap-3 border-b border-ink-800/50 px-4 py-2.5 text-left transition-colors hover:bg-ink-800">
                      <span className="grid h-7 w-7 place-items-center rounded-lg border border-ink-600 bg-ink-800 text-gold-400"><I name="calendar" size={14} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold text-ink-100">{a.name}</span>
                        <span className="num block text-[11px] text-ink-400">{a.uuid}</span>
                      </span>
                      <I name="chevR" size={14} className="text-ink-500" />
                    </button>
                  ))}
                </div>
              )}

              {hitStudios.length > 0 && (
                <div>
                  <div className="bg-ink-850/60 px-4 py-1.5 text-[10.5px] font-extrabold uppercase tracking-wider text-gold-400">{t("Studios & Branches")}</div>
                  {hitStudios.map(s => (
                    <button key={s.id} onClick={() => go({ view: "studio", id: s.id })} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-ink-800">
                      <span className="grid h-7 w-7 place-items-center rounded-lg border border-ink-600 bg-ink-800 text-gold-400"><I name="building" size={14} /></span>
                      <span className="text-[13px] font-bold text-ink-100">{s.name}</span>
                      <I name="chevR" size={14} className="ml-auto text-ink-500" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Topbar() {
  const { route, globalLocation, setGlobalLocation, dateRange, setDateRange, scopedStudios, liveCalls, navigate, session, logout, inScope } = useStore();
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
  const locName = globalLocation === "all" ? t("All Studios") : studioById(globalLocation)?.name ?? t("All Studios");
  const DR: { v: DateRange; label: string }[] = [
    { v: "today", label: "Today" }, { v: "7", label: "Last 7 Days" }, { v: "30", label: "Last 30 Days" }, { v: "all", label: "All Time" },
  ];
  const role = ROLES.find(r => r.id === session?.roleId) ?? ROLES[ROLES.length - 1];
  const scopeLabel = !session ? "" : session.locationIds === "all" ? t("All Studios") : session.locationIds.map(id => studioById(id)?.city ?? `#${id}`).join(", ");
  return (
    <header className="sticky top-0 z-50 border-b border-ink-700/80 bg-ink-950/85 backdrop-blur-md">
      <div className="flex items-center gap-3 px-4 py-3 md:px-6">
        <div className="mr-1 hidden lg:block">
          <h1 className="font-display text-[19px] font-bold tracking-wide text-ink-50">{t(TITLES[route.view])}</h1>
        </div>
        <div className="hidden h-8 w-px bg-ink-700 lg:block" />
        <OmniSearch />
        <div className="ml-auto flex items-center gap-2.5">
          <LangSwitch />
          <div className="relative hidden md:block" ref={locRef}>
            <button onClick={() => setLocOpen(o => !o)}
              className="flex items-center gap-2 rounded-xl border border-ink-600 bg-ink-875 px-3 py-2 text-[12.5px] font-bold text-ink-200 transition-colors hover:border-gold-500/50 hover:text-gold-300">
              <I name="pin" size={14} className="text-gold-400" />
              <span className="max-w-[120px] truncate">{locName}</span>
              <I name="chevD" size={13} className="text-ink-400" />
            </button>
            {locOpen && (
              <div className="absolute right-0 top-full z-50 mt-1.5 max-h-80 w-64 overflow-y-auto rounded-xl border border-ink-600 bg-ink-875 py-1.5 shadow-pop animate-pop">
                <button onClick={() => { setGlobalLocation("all"); setLocOpen(false); }}
                  className={`flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] font-semibold hover:bg-ink-800 ${globalLocation === "all" ? "text-gold-300" : "text-ink-200"}`}>
                  <I name="globe" size={14} /> {t("All Studios")}
                  {globalLocation === "all" && <I name="check" size={13} className="ml-auto text-gold-400" />}
                </button>
                <div className="my-1 border-t border-ink-700" />
                {scopedStudios.map((s: { id: number; name: string; bookingActive: boolean }) => (
                  <button key={s.id} onClick={() => { setGlobalLocation(s.id); setLocOpen(false); }}
                    className={`flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] font-semibold hover:bg-ink-800 ${globalLocation === s.id ? "text-gold-300" : "text-ink-200"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${s.bookingActive ? "bg-jade-500" : "bg-ink-500"}`} />
                    <span className="truncate">{s.name}</span>
                    {globalLocation === s.id && <I name="check" size={13} className="ml-auto text-gold-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative hidden sm:block" ref={drRef}>
            <button onClick={() => setDrOpen(o => !o)}
              className="flex items-center gap-2 rounded-xl border border-ink-600 bg-ink-875 px-3 py-2 text-[12.5px] font-bold text-ink-200 transition-colors hover:border-gold-500/50 hover:text-gold-300">
              <I name="clock" size={14} className="text-gold-400" />
              {t(DR.find(d => d.v === dateRange)?.label ?? "All Time")}
              <I name="chevD" size={13} className="text-ink-400" />
            </button>
            {drOpen && (
              <div className="absolute right-0 top-full z-50 mt-1.5 w-44 rounded-xl border border-ink-600 bg-ink-875 py-1.5 shadow-pop animate-pop">
                {DR.map(d => (
                  <button key={d.v} onClick={() => { setDateRange(d.v); setDrOpen(false); }}
                    className={`flex w-full items-center justify-between px-3.5 py-2 text-left text-[13px] font-semibold hover:bg-ink-800 ${dateRange === d.v ? "text-gold-300" : "text-ink-200"}`}>
                    {t(d.label)}{dateRange === d.v && <I name="check" size={13} className="text-gold-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => navigate({ view: "calls" })} title={t("Live active calls — open Call Center")}
            className="group flex items-center gap-2 rounded-xl border border-jade-500/40 bg-jade-500/10 px-3 py-2 text-[12.5px] font-bold text-jade-400 transition-all hover:border-jade-500/70 hover:bg-jade-500/15">
            <span className="relative flex h-2 w-2">
              <span className="absolute h-2 w-2 animate-ping rounded-full bg-jade-400 opacity-60" />
              <span className="h-2 w-2 rounded-full bg-jade-400" />
            </span>
            <span className="num">{liveCalls}</span> {t("live")}
          </button>
          <UserMenu session={session} role={role} scopeLabel={scopeLabel} onLogout={logout} />
        </div>
      </div>
    </header>
  );
}

function UserMenu({ session, role, scopeLabel, onLogout }: {
  session: StaffMember | null; role: { name: string; color: string; desc: string }; scopeLabel: string; onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useI18n();
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  if (!session) return null;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2.5 rounded-xl border border-ink-600 bg-ink-875 py-1.5 pl-1.5 pr-3 transition-colors hover:border-gold-500/50">
        <Avatar name={session.name} size={28} ring />
        <span className="hidden text-left leading-tight xl:block">
          <span className="block text-[12px] font-extrabold text-ink-100">{session.name}</span>
          <span className="flex items-center gap-1 text-[10px] font-bold tracking-wide" style={{ color: role.color }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: role.color }} />{role.name.toUpperCase()}
          </span>
        </span>
        <I name="chevD" size={13} className={`text-ink-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-72 overflow-hidden rounded-xl border border-ink-600 bg-ink-875 shadow-pop animate-pop">
          <div className="border-b border-ink-700 p-4">
            <div className="flex items-center gap-3">
              <Avatar name={session.name} size={40} ring />
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-extrabold text-ink-50">{session.name}</div>
                <div className="num truncate text-[11px] text-ink-400">{session.email}</div>
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11.5px] font-extrabold" style={{ color: role.color }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: role.color }} />{role.name}
              </div>
              <div className="mt-0.5 text-[10.5px] font-semibold text-ink-400">{role.desc}</div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] font-bold text-gold-300">
                <I name="pin" size={11} /> {scopeLabel}
              </div>
            </div>
          </div>
          <button onClick={onLogout}
            className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-[12.5px] font-bold text-ember-400 transition-colors hover:bg-ember-500/10">
            <I name="logOut" size={15} /> {t("Sign out")}
          </button>
        </div>
      )}
    </div>
  );
}

function agoLabel(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 10) return t("just now");
  if (s < 60) return tf("{s}s ago", { s });
  const m = Math.floor(s / 60);
  if (m < 60) return tf("{m}m ago", { m });
  return tf("{h}h ago", { h: Math.floor(m / 60) });
}

function SyncStrips() {
  const { lastVonageSync, lastTwilioSync, liveCalls } = useStore();
  const { meta } = useI18n();
  const [, force] = useState(0);
  useEffect(() => { const i = setInterval(() => force(x => x + 1), 10_000); return () => clearInterval(i); }, []);
  const srcLabel = meta.source === "remote" ? t("Remote service") : meta.source === "cache" ? t("Cached") : t("Offline snapshot");
  return (
    <div className="hidden space-y-1.5 xl:block">
      <div className="flex items-center gap-2 rounded-lg border border-jade-500/30 bg-jade-500/8 px-3 py-1.5" title={t("Vonage Events API connected")}>
        <span className="relative flex h-1.5 w-1.5"><span className="absolute h-1.5 w-1.5 animate-ping rounded-full bg-jade-400 opacity-70" /><span className="h-1.5 w-1.5 rounded-full bg-jade-400" /></span>
        <span className="num text-[10.5px] font-bold text-jade-400">Vonage VBC · {tf("Synced {ago}", { ago: agoLabel(lastVonageSync) })}</span>
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-lapis-500/30 bg-lapis-500/8 px-3 py-1.5" title={t("Twilio Programmable SMS connected")}>
        <span className="relative flex h-1.5 w-1.5"><span className="absolute h-1.5 w-1.5 animate-ping rounded-full bg-lapis-400 opacity-70" /><span className="h-1.5 w-1.5 rounded-full bg-lapis-400" /></span>
        <span className="num text-[10.5px] font-bold text-lapis-400">Twilio SMS · {tf("Synced {ago}", { ago: agoLabel(lastTwilioSync) })}</span>
      </div>
      <div className={`flex items-center gap-2 rounded-lg border border-iris-500/30 bg-iris-500/8 px-3 py-1.5 ${meta.loading ? "animate-pulse" : ""}`} title={t("Translation dictionary source")}>
        <span className="relative flex h-1.5 w-1.5"><span className="absolute h-1.5 w-1.5 animate-ping rounded-full bg-iris-400 opacity-70" /><span className="h-1.5 w-1.5 rounded-full bg-iris-400" /></span>
        <span className="num truncate text-[10.5px] font-bold text-iris-400">i18n · {meta.entries} {t("keys")} · {srcLabel}{liveCalls > 0 ? ` · ${liveCalls} ${t("live")}` : ""}</span>
      </div>
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const { route, navigate, notCalledCount, pendingCount, unreadTotal, liveCalls, openTaskCount, dupGroupCount, can, session, logout } = useStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useI18n();

  const role = ROLES.find(r => r.id === session?.roleId) ?? ROLES[ROLES.length - 1];
  const scopeLabel = !session ? "" : session.locationIds === "all" ? t("All Studios") : session.locationIds.map(id => studioById(id)?.city ?? `#${id}`).join(", ");
  
  useEffect(() => { 
    window.scrollTo({ top: 0 }); 
    setMobileMenuOpen(false);
  }, [route]);

  const badge = (b?: typeof NAV[number]["badge"]) => {
    if (b === "notCalled") return notCalledCount;
    if (b === "pending") return pendingCount;
    if (b === "unread") return unreadTotal;
    if (b === "live") return liveCalls;
    if (b === "tasks") return openTaskCount;
    if (b === "dup") return dupGroupCount;
    return 0;
  };

  return (
    <div className="ambient-bg ambient-grain ambient-lines min-h-screen">
      {/* Mobile Sidebar Drawer Overlay */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 z-[70] bg-ink-950/80 backdrop-blur-sm md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - Desktop fixed & Mobile Drawer */}
      <aside className={`fixed inset-y-0 left-0 z-[80] flex w-[280px] flex-col border-r border-ink-700/80 bg-ink-900/95 backdrop-blur transition-transform duration-300 md:w-[64px] md:translate-x-0 md:bg-ink-900/90 xl:w-[232px] ${
        mobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      }`}>
        <div className="flex items-center justify-between px-3 md:justify-center xl:justify-start">
          <Brand />
          <button 
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close mobile menu"
            className="rounded-lg p-2 text-ink-400 hover:bg-ink-800 hover:text-ink-100 md:hidden"
          >
            <I name="x" size={20} />
          </button>
        </div>
        
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 md:px-2 xl:px-3">
          {NAV.filter(item => !item.perm || can(item.perm)).map(item => {
            const active = route.view === item.route.view ||
              (item.route.view === "leads" && (route.view === "lead" || route.view === "duplicates")) ||
              (item.route.view === "appointments" && route.view === "appointment") ||
              (item.route.view === "studios" && route.view === "studio");
            const n = badge(item.badge);
            return (
              <button key={item.label} onClick={() => { navigate(item.route); setMobileMenuOpen(false); }} title={t(item.label)}
                className={`group relative flex w-full items-center justify-start gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-bold transition-all duration-150 md:justify-center md:gap-0 md:py-[9px] xl:justify-start xl:gap-3 xl:px-3 ${active ? "bg-gold-500/12 text-gold-300" : "text-ink-300 hover:bg-ink-800 hover:text-ink-100"}`}>
                <span className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-gold-500 transition-all duration-200 ${active ? "opacity-100" : "opacity-0 group-hover:opacity-40"}`} />
                <I name={item.icon} size={18} className={active ? "text-gold-400" : "text-ink-400 group-hover:text-ink-200"} />
                <span className="flex-1 md:hidden xl:block">{t(item.label)}</span>
                {n > 0 && (
                  <>
                    <span className={`num rounded-md px-1.5 py-0.5 text-[10.5px] font-bold md:hidden xl:inline-block ${item.badge === "live" ? "bg-jade-500/15 text-jade-400 border border-jade-500/30" : item.badge === "unread" ? "bg-ember-500/15 text-ember-400 border border-ember-500/30" : "bg-gold-500/15 text-gold-300 border border-gold-500/30"}`}>{n}</span>
                    <span className={`hidden h-1.5 w-1.5 rounded-full md:block xl:hidden ${item.badge === "live" ? "bg-jade-500" : item.badge === "unread" ? "bg-ember-500" : "bg-gold-500"}`} />
                  </>
                )}
              </button>
            );
          })}
        </nav>
        <div className="space-y-2.5 border-t border-ink-700/80 p-3 md:p-2 xl:p-4">
          <SyncStrips />
          {session && (() => {
            const role = ROLES.find(r => r.id === session.roleId) ?? ROLES[ROLES.length - 1];
            return (
              <div className="flex items-center justify-between md:justify-center xl:justify-start">
                <div className="flex items-center gap-2.5">
                  <Avatar name={session.name} size={34} />
                  <div className="min-w-0 leading-tight md:hidden xl:block">
                    <div className="truncate text-[12.5px] font-extrabold text-ink-100">{session.name}</div>
                    <div className="flex items-center gap-1.5 text-[10.5px] font-semibold" style={{ color: role.color }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: role.color }} />{role.name}
                    </div>
                  </div>
                </div>
                <button onClick={logout} title={t("Sign out")} aria-label={t("Sign out")}
                  className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ember-500/10 hover:text-ember-400 md:hidden xl:block">
                  <I name="logOut" size={16} />
                </button>
              </div>
            );
          })()}
        </div>
      </aside>

      <div className="relative z-10 md:pl-[64px] xl:pl-[232px]">
        {/* Responsive Header Topbar */}
        <header className="sticky top-0 z-50 border-b border-ink-700/80 bg-ink-950/85 backdrop-blur-md">
          <div className="flex items-center gap-2 px-3 py-2.5 md:gap-3 md:px-6 md:py-3">
            {/* Hamburger button for mobile */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
              className="mr-1 rounded-xl border border-ink-600 bg-ink-875 p-2 text-ink-200 hover:border-gold-500/50 hover:text-gold-300 md:hidden"
            >
              <I name="menu" size={18} />
            </button>

            <div className="mr-1 hidden lg:block">
              <h1 className="font-display text-[19px] font-bold tracking-wide text-ink-50">{t(TITLES[route.view])}</h1>
            </div>
            <div className="hidden h-8 w-px bg-ink-700 lg:block" />
            
            <OmniSearch />

            <div className="ml-auto flex items-center gap-1.5 md:gap-2.5">
              <LangSwitch />
              <button onClick={() => navigate({ view: "calls" })} title={t("Live active calls — open Call Center")}
                className="group flex items-center gap-1.5 rounded-xl border border-jade-500/40 bg-jade-500/10 px-2 py-1.5 text-[11.5px] font-bold text-jade-400 transition-all hover:border-jade-500/70 hover:bg-jade-500/15 md:px-3 md:py-2 md:text-[12.5px]">
                <span className="relative flex h-2 w-2">
                  <span className="absolute h-2 w-2 animate-ping rounded-full bg-jade-400 opacity-60" />
                  <span className="h-2 w-2 rounded-full bg-jade-400" />
                </span>
                <span className="num">{liveCalls}</span> <span className="hidden sm:inline">{t("live")}</span>
              </button>
              <UserMenu session={session} role={role} scopeLabel={scopeLabel} onLogout={logout} />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1480px] px-3 py-4 md:px-6 md:py-6">{children}</main>
        <footer className="border-t border-ink-750 px-4 py-4 text-center text-[10.5px] font-semibold tracking-wide text-ink-500 md:px-6 md:py-5 md:text-[11px]">
          CLEOPATRA INK · {t("CRM Console").toUpperCase()} v5.0 — {new Date().getFullYear()} · {t("Vonage VBC + Twilio + Timely integrated")}
        </footer>
      </div>
    </div>
  );
}

export function ToastHost() {
  const { toasts, dismissToast } = useStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const meta = {
    success: { icon: "check" as IconName, cls: "border-jade-500/50 text-jade-400", bar: "#2fbf71" },
    info: { icon: "spark" as IconName, cls: "border-lapis-500/50 text-lapis-400", bar: "#4c8dff" },
    error: { icon: "alert" as IconName, cls: "border-ember-500/50 text-ember-400", bar: "#e5484d" },
  };

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed bottom-5 right-5 z-[110] flex w-[340px] flex-col gap-2">
      {toasts.map(ti => {
        const m = meta[ti.kind];
        return (
          <div key={ti.id} className={`pointer-events-auto relative flex items-center gap-3 overflow-hidden rounded-xl border bg-ink-875/95 py-3 pl-3 pr-2 shadow-pop backdrop-blur animate-toast ${m.cls}`}>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-ink-600 bg-ink-850"><I name={m.icon} size={14} /></span>
            <span className="flex-1 text-[12.5px] font-bold leading-snug text-ink-100">{ti.msg}</span>
            <button onClick={() => dismissToast(ti.id)} aria-label="Dismiss" className="rounded-md p-1 text-ink-400 hover:bg-ink-750 hover:text-ink-100"><I name="x" size={13} /></button>
            <span className="absolute bottom-0 left-0 h-[2px] w-full" style={{ background: m.bar, opacity: 0.6 }} />
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
