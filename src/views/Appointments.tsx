import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Avatar, ApptStatusPill, Btn, Dropdown, EmptyState, I, Pagination, Pill, PlatformPill, PlayerModal, SectionTitle } from "../ui";
import { APPT_STATUS_META, fmtD, fmtDT, prettyPhone, studioById, timeAgo, type Appointment, type ApptStatus, type CallLog } from "../data";
import { t, tf, useI18n } from "../i18n";
import { useServerTable } from "../hooks/useServerTable";
import { crmApi } from "../services/crmApi";
import { CallHistoryModal, NotesDrawer, SmsCompose } from "./Leads";

const STATUS_ORDER: ApptStatus[] = ["pending", "confirmed", "deposit_paid", "completed", "cancelled", "no_show", "rescheduled", "spam"];


/** Renders the studio / customer / UTC readings of one slot. */
function SlotClocks({ appt, studioTz }: { appt: Appointment; studioTz?: string }) {
  if (!appt.startsAt) return null;
  const instant = new Date(appt.startsAt);
  const zone = appt.displayTimezone ?? studioTz ?? "UTC";
  const customerZone = appt.userTimezone ?? zone;

  const fmt = (tz: string) => {
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: tz, day: "2-digit", month: "short",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(instant);
    } catch {
      return "—";
    }
  };

  const rows: { label: string; value: string; zone: string }[] = [
    { label: t("Studio"), value: fmt(zone), zone },
    ...(customerZone !== zone ? [{ label: t("Client"), value: fmt(customerZone), zone: customerZone }] : []),
    { label: "UTC", value: fmt("UTC"), zone: "UTC" },
  ];

  return (
    <div className="mt-3 space-y-1 rounded-xl border border-ink-700 bg-ink-900/60 p-2.5">
      {rows.map(r => (
        <div key={r.zone} className="flex items-baseline justify-between gap-2">
          <span className="text-[9.5px] font-bold uppercase tracking-wider text-ink-500">{r.label}</span>
          <span className="num text-[11.5px] font-bold text-ink-200">{r.value}</span>
          <span className="num shrink-0 text-[9.5px] text-ink-500">{r.zone}</span>
        </div>
      ))}
    </div>
  );
}

function AwayChip({ isoStr }: { isoStr: string }) {
  const { lang } = useI18n();
  const days = Math.ceil((+new Date(isoStr) - Date.now()) / 86_400_000);
  if (days < 0) return <span className="num text-[10.5px] font-bold text-ink-500">{lang === "tr" ? "geçmiş" : "past"}</span>;
  if (days === 0) return <Pill color="#fba200" dot={false} className="!text-[9.5px]">{lang === "tr" ? "bugün" : "today"}</Pill>;
  if (days === 1) return <Pill color="#e8a33d" dot={false} className="!text-[9.5px]">{lang === "tr" ? "yarın" : "tomorrow"}</Pill>;
  return <span className="num text-[10.5px] font-bold text-ink-500">{lang === "tr" ? `${days} gün` : `in ${days}d`}</span>;
}

export function AppointmentDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { appointments, calls, notes, updateApptStatus, toast, navigate, addNote, guard, can, dataLoading } = useStore();
  const [smsOpen, setSmsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [play, setPlay] = useState<CallLog | null>(null);
  const [quickNote, setQuickNote] = useState("");

  const appt = appointments.find(a => a.id === id);
  const customerId = appt?.customerId ?? "";
  const apptCalls = useMemo(() => calls.filter(c => c.appointmentId === id || (customerId && c.customerId === customerId)), [calls, id, customerId]);
  const apptNotes = useMemo(() => notes.filter(n => n.notableType === "appointment" && n.notableId === String(id)), [notes, id]);

  if (!appt) {
    if (dataLoading) {
      return (
        <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-ink-700 bg-ink-875 p-8 text-ink-400 animate-pulse">
          <I name="spin" size={24} className="text-gold-400" />
          <span className="text-[13px] font-semibold">{t("Loading booking details...")}</span>
        </div>
      );
    }
    return <div className="animate-rise"><EmptyState title="Booking not found" /><div className="text-center"><Btn variant="gold" onClick={onBack}>{t("Appointments")}</Btn></div></div>;
  }

  const studio = studioById(appt.locationId);

  const act = (s: ApptStatus, msg: string, kind: "success" | "info" | "error" = "success") => {
    if (!guard("appts.edit")) return;
    updateApptStatus(id, s);
    toast(msg, kind);
  };

  const submitQuickNote = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!guard("appts.edit")) return;
    const txt = quickNote.trim();
    if (!txt) return;
    addNote("appointment", String(id), txt);
    setQuickNote("");
    toast(t("Note added"), "success");
  };

  return (
    <div className="space-y-4 animate-rise">
      <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <button onClick={onBack} aria-label={t("Prev")} className="mt-1 rounded-lg border border-ink-600 p-2 text-ink-400 transition-colors hover:border-gold-500/60 hover:text-gold-300"><I name="chevL" size={15} /></button>
            <Avatar name={appt.name} size={52} ring />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-[23px] font-bold tracking-wide text-ink-50">{appt.name}</h2>
                <ApptStatusPill s={appt.status} />
                {appt.isFreePick && <Pill color="#7c4fe0">{t("Free Pick")}</Pill>}
                {!!appt.voiceCalls && (
                  <Pill color="#4c8dff" dot={false} className="!text-[9.5px]">
                    <span className="flex items-center gap-1"><I name="phone" size={10} />{appt.voiceCalls} {t("Calls").toLowerCase()}</span>
                  </Pill>
                )}
              </div>
              {appt.cancelReason && (
                <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-ember-500/40 bg-ember-500/8 px-3 py-1.5 text-[11.5px] font-bold text-ember-400 animate-pop">
                  <I name="alert" size={12} /> {appt.cancelReason}
                </div>
              )}
              {appt.userTimezone && (
                <div className="num mt-1.5 text-[10.5px] font-semibold text-ink-500">{t("Client timezone")}: {appt.userTimezone}</div>
              )}
              <div className="num mt-1 text-[11.5px] text-ink-400">{appt.uuid} · {prettyPhone(appt.formattedPhone)} · {tf("created {ago}", { ago: timeAgo(appt.createdAt) })}</div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Pill color="#948d7d">{studio?.name}</Pill>
                <PlatformPill p={appt.platform} />
                {appt.campaign && <Pill color="#fba200" dot={false}>{appt.campaign}</Pill>}
                <Pill color="#4c8dff" dot={false}>{appt.language.toUpperCase()}</Pill>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Btn variant="outline" onClick={() => navigate({ view: "customer", id: appt.customerId ?? String(appt.id) })} locked={!can("customers.view")}>
              <I name="users" size={14} /> {t("Customer 360°")}
            </Btn>
            <Btn variant="gold" locked={!can("appts.edit")} onClick={() => act("confirmed", tf("{uuid} → {status}", { uuid: appt.uuid, status: t("Confirmed") }))}>
              <I name="check" size={14} /> {t("Confirmed")}
            </Btn>
            <Btn variant="outline" locked={!can("appts.edit")} onClick={() => act("deposit_paid", tf("{uuid} → {status}", { uuid: appt.uuid, status: t("Deposit Paid") }))}>
              <I name="star" size={14} /> {t("Deposit Paid")}
            </Btn>
            <Btn variant="outline" onClick={() => setSmsOpen(true)} disabled={!appt.formattedPhone} locked={!can("sms.send")}><I name="chat" size={14} /> {t("Send SMS")}</Btn>
            <Btn variant="outline" onClick={() => setNotesOpen(true)}><I name="note" size={14} /> {t("Notes")} <span className="num opacity-70">{apptNotes.length}</span></Btn>
            <Btn variant="danger" locked={!can("appts.edit")} onClick={() => act("cancelled", tf("{uuid} → {status}", { uuid: appt.uuid, status: t("Cancelled") }), "info")}>
              <I name="x" size={14} /> {t("Cancelled")}
            </Btn>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-3">
          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle>{t("Tattoo Brief")}</SectionTitle>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {[[t("Purpose"), t(appt.purpose)], [t("Style"), t(appt.style)], [t("Size"), t(appt.size)]].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-ink-700 bg-ink-850 px-3.5 py-3">
                  <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-ink-500">{k}</div>
                  <div className="mt-1 text-[13px] font-extrabold text-ink-100">{v}</div>
                </div>
              ))}
              <div className="col-span-2 rounded-xl border border-ink-700 bg-ink-850 px-3.5 py-3 md:col-span-3">
                <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-ink-500">{t("Body Areas")}</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">{appt.bodyAreas.map(a => <Pill key={a} color="#7c4fe0" dot={false}>{t(a)}</Pill>)}</div>
              </div>
              <div className="col-span-2 rounded-xl border border-ink-700 bg-ink-850 px-3.5 py-3 md:col-span-3">
                <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-ink-500">{t("Story")}</div>
                <div className="mt-1 text-[12.5px] font-semibold leading-relaxed text-ink-300">{appt.story || "—"}</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle right={
              apptCalls.length > 0 ? (
                <Btn size="sm" variant="outline" onClick={() => navigate({ view: "appointment_subview", id: appt.id, sub: "calls" })} locked={!can("calls.view")}>
                  <I name="table" size={13} /> {t("View All in Table")}
                </Btn>
              ) : undefined
            }>
              {t("Call History")}
            </SectionTitle>
            <div className="max-h-[360px] overflow-y-auto pr-1 divide-y divide-ink-750">
              {apptCalls.map(c => (
                <div key={c.id} className="row-live flex items-center gap-3 py-2.5">
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${c.direction === "inbound" ? "border-jade-500/40 bg-jade-500/10 text-jade-400" : "border-lapis-500/40 bg-lapis-500/10 text-lapis-400"}`}><I name="phone" size={13} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="num block text-[12.5px] font-extrabold text-ink-100">{fmtDT(c.startTime)}</span>
                    <span className="block text-[11px] font-semibold text-ink-500">{t(c.direction)} · {c.agent}</span>
                  </span>
                  <Pill color={c.result === "Answered" ? "#2fbf71" : c.result === "Missed" ? "#e5484d" : c.result === "Voicemail" ? "#e8a33d" : "#948d7d"}>{t(c.result)}</Pill>
                  {c.hasRecording && (
                    <Btn size="sm" variant="ghost" title={t("Listen")} locked={!can("calls.view")} onClick={() => {
                      if (!guard("calls.view")) return;
                      setPlay(c);
                    }}>
                      <I name="play" size={13} />
                    </Btn>
                  )}
                </div>
              ))}
              {apptCalls.length === 0 && <div className="py-3 text-[12.5px] font-semibold text-ink-400">{t("No recording")}</div>}
            </div>
          </div>
        </div>

        <div className="space-y-4 xl:col-span-2">
          <div className="rounded-2xl border border-jade-500/40 bg-jade-500/6 p-5 shadow-panel">
            <SectionTitle>{t("Preferred Slot")}</SectionTitle>
            <div className="num text-[26px] font-extrabold text-jade-400">{fmtD(appt.preferredDate)}</div>
            <div className="num mt-1 text-[15px] font-bold text-ink-200">
              {appt.preferredTime} · {studio?.config.timezone}
            </div>
            {/* The same moment in three readings. The studio's clock decides
                whether the door is open; the customer's is what they were
                shown when they booked; UTC is what the database holds. They
                differ by hours, and "which 10:00?" is a question worth
                never having to ask. */}
            <SlotClocks appt={appt} studioTz={studio?.config.ianaTimezone} />
            <div className="mt-2"><AwayChip isoStr={appt.preferredDate} /></div>
          </div>

          {(appt.leadId || appt.customerId) && (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => {
                if (!guard("leads.view")) return;
                const targetLeadId = appt.leadId || appt.customerId;
                navigate({ view: "lead", id: targetLeadId });
              }}
                className={`rounded-2xl border border-ink-700 bg-ink-875 p-4 text-left shadow-panel transition-all ${can("leads.view") ? "hover:-translate-y-0.5 hover:border-gold-500/45 cursor-pointer" : "opacity-60 cursor-not-allowed"}`}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-display text-[14px] font-bold tracking-wide text-ink-50">
                    {!can("leads.view") && <I name="lock" size={12} className="text-ink-500" />}
                    {t("Source Lead")}
                  </span>
                  <I name="chevR" size={13} className="text-gold-400" />
                </div>
                <div className="num mt-1 truncate text-[11px] font-bold text-gold-300">
                  {appt.leadId ? appt.leadId : appt.customerId}
                </div>
              </button>

              <button onClick={() => {
                if (!guard("customers.view")) return;
                navigate({ view: "customer", id: appt.customerId });
              }}
                className={`rounded-2xl border border-gold-500/40 bg-gold-500/10 p-4 text-left shadow-panel transition-all ${can("customers.view") ? "hover:-translate-y-0.5 hover:border-gold-500/80 cursor-pointer" : "opacity-60 cursor-not-allowed"}`}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-display text-[14px] font-bold tracking-wide text-gold-300">
                    {!can("customers.view") && <I name="lock" size={12} className="text-ink-500" />}
                    <I name="users" size={14} className="text-gold-400" />
                    {t("Customer 360°")}
                  </span>
                  <I name="chevR" size={13} className="text-gold-400" />
                </div>
                <div className="num mt-1 truncate text-[11px] font-bold text-gold-400/80">{appt.name}</div>
              </button>
            </div>
          )}

          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle right={
              <div className="flex items-center gap-1.5">
                <span className="num text-[11px] font-bold text-ink-500">{apptNotes.length}</span>
                {apptNotes.length > 0 && (
                  <Btn size="sm" variant="outline" onClick={() => navigate({ view: "appointment_subview", id: appt.id, sub: "notes" })}>
                    <I name="table" size={13} /> {t("View All in Table")}
                  </Btn>
                )}
              </div>
            }>
              {t("Notes")}
            </SectionTitle>

            {/* Quick note input */}
            <form onSubmit={submitQuickNote} className="mb-3 space-y-2">
              <div className="relative">
                <textarea
                  value={quickNote}
                  onChange={e => setQuickNote(e.target.value)}
                  placeholder={can("appts.edit") ? t("Write booking note…") : `${t("locked")} · appts.edit`}
                  disabled={!can("appts.edit")}
                  rows={2}
                  className="w-full resize-none rounded-xl border border-ink-700 bg-ink-900/80 px-3 py-2 text-[12px] font-medium text-ink-100 placeholder:text-ink-500 focus:border-gold-500/60 focus:outline-none focus:ring-1 focus:ring-gold-500/30 disabled:opacity-50"
                />
              </div>
              <div className="flex justify-end">
                <Btn size="sm" variant="gold" locked={!can("appts.edit")} disabled={!quickNote.trim()}>
                  <I name="check" size={12} /> {t("Add note")}
                </Btn>
              </div>
            </form>

            <div className="max-h-[320px] overflow-y-auto pr-1 space-y-2.5">
              {apptNotes.map(n => (
                <div key={n.id} className="rounded-xl border border-ink-700 bg-ink-850 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10.5px] font-extrabold text-gold-300">{n.author}</span>
                    <span className="num text-[10px] text-ink-500">{timeAgo(n.createdAt)}</span>
                  </div>
                  <p className="text-[12px] font-semibold leading-relaxed text-ink-200">{n.content}</p>
                </div>
              ))}
              {apptNotes.length === 0 && <div className="py-2 text-[12.5px] font-semibold text-ink-400">{t("No notes yet")}</div>}
            </div>
          </div>
        </div>
      </div>

      {smsOpen && <SmsCompose leadId={appt.customerId} phone={appt.formattedPhone} name={appt.name} locationId={appt.locationId} recipientLocale={appt.language} onClose={() => setSmsOpen(false)} />}
      {notesOpen && <NotesDrawer type="appointment" id={String(id)} title={`${appt.uuid} · ${appt.name}`} onClose={() => setNotesOpen(false)} />}
      {play && <PlayerModal callId={play.id} durationHint={play.duration} title={appt.name} subtitle={`${play.ext} · ${fmtDT(play.startTime)}`} onClose={() => setPlay(null)} />}
    </div>
  );
}

export default function Appointments() {
  const { calls, updateApptStatus, toast, navigate, can, guard } = useStore();
  useI18n();
  const [onlyUpcoming, setOnlyUpcoming] = useState(false);
  const [notesAppt, setNotesAppt] = useState<{ id: number; title: string } | null>(null);
  const [histAppt, setHistAppt] = useState<Appointment | null>(null);
  const [smsAppt, setSmsAppt] = useState<Appointment | null>(null);

  /* Midnight resolved once. Rebuilding it every render would hand the
     query a new value each time and refetch forever. */
  const startOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);

  /* Searching, the status tabs, the KPI counters and "due from today" all
     described the bookings the store had loaded — the first hundred. The
     day sheet is exactly the list that must not stop at a hundred, so the
     question goes to the database and the counters describe the whole set.
     Soonest first, which is the order a desk reads it in. */
  const table = useServerTable<Appointment>({
    fetch: crmApi.appointments,
    pageSize: 10,
    defaultSort: "starts",
    defaultDir: "asc",
    extra: onlyUpcoming ? { startsFrom: startOfToday } : {},
  });
  const counts = table.counts;

  /* Only for the history modal. The badge on each row uses the count that
     came down with the booking, which is exact; this is the recent slice
     the store holds and is a drill-down, not a total. */
  const apptCalls = useMemo(() => {
    const m = new Map<number, typeof calls>();
    calls.forEach(c => { if (c.appointmentId) m.set(c.appointmentId, [...(m.get(c.appointmentId) ?? []), c]); });
    table.rows.forEach(a => { if (a.customerId) calls.filter(c => c.customerId === a.customerId).forEach(c => m.set(a.id, [...(m.get(a.id) ?? []).filter(x => x.id !== c.id), c])); });
    return m;
  }, [calls, table.rows]);

  /* Pending and Rescheduled are the two that owe someone a phone call: a
     new booking nobody has confirmed, and one the customer moved from their
     own link (which clears any earlier confirmation). Clicking a card jumps
     the list to that status. */
  const KPIS: { label: string; n: number; color: string; status?: ApptStatus }[] = [
    { label: t("Pending"), n: counts.pending ?? 0, color: "#e8a33d", status: "pending" },
    { label: t("Rescheduled"), n: counts.rescheduled ?? 0, color: "#4c8dff", status: "rescheduled" },
    { label: t("Confirmed"), n: counts.confirmed ?? 0, color: "#2fbf71", status: "confirmed" },
    { label: t("Deposit Paid"), n: counts.deposit_paid ?? 0, color: "#1e9e5c", status: "deposit_paid" },
    { label: t("No-Show"), n: counts.no_show ?? 0, color: "#d93a40", status: "no_show" },
  ];

  return (
    <div className="space-y-4 animate-rise">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {KPIS.map(k => (
          <button
            key={k.label}
            type="button"
            onClick={() => k.status && table.setStatus(table.status === k.status ? "all" : k.status)}
            aria-pressed={table.status === k.status}
            className={`flex items-center justify-between rounded-xl border bg-ink-875 px-4 py-3.5 text-left shadow-panel transition-all hover:-translate-y-0.5 hover:border-gold-500/40 ${
              table.status === k.status ? "border-gold-500/70" : "border-ink-700"
            }`}
          >
            <span>
              <span className="kpi-num block" style={{ color: k.color }}>{k.n}</span>
              <span className="mt-1 block text-[11px] font-bold uppercase tracking-wider text-ink-400">{k.label}</span>
            </span>
            <span className="h-8 w-1.5 rounded-full" style={{ background: k.color }} />
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-ink-700 bg-ink-875 p-4 shadow-panel">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1">
            <I name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input value={table.q} onChange={e => table.setQ(e.target.value)} placeholder={t("Search name, email, phone, booking UUID…")}
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              className="w-full rounded-lg border border-ink-600 bg-ink-900/70 py-2 pl-9 pr-3 text-[13px] font-semibold text-ink-100 outline-none focus:border-gold-500/70" />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-bold text-ink-300">
            <input type="checkbox" checked={onlyUpcoming} onChange={e => setOnlyUpcoming(e.target.checked)} className="h-4 w-4 accent-[#fba200]" />
            {t("Due")} ≥ {t("Today")}
          </label>
        </div>
        <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <button onClick={() => table.setStatus("all")} className={`shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-colors ${table.status === "all" ? "bg-gold-500 text-ink-50" : "border border-ink-600 text-ink-300 hover:text-ink-100"}`}>
            {t("All")} <span className="num opacity-75">· {counts.all ?? 0}</span>
          </button>
          {STATUS_ORDER.map(s => (
            <button key={s} onClick={() => table.setStatus(table.status === s ? "all" : s)}
              className="shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all"
              style={table.status === s
                ? { color: "#fffdf7", background: APPT_STATUS_META[s].color, border: `1px solid ${APPT_STATUS_META[s].color}` }
                : { color: APPT_STATUS_META[s].color, background: `${APPT_STATUS_META[s].color}10`, border: `1px solid ${APPT_STATUS_META[s].color}35` }}>
              {t(APPT_STATUS_META[s].label)} <span className="num opacity-75">· {counts[s] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1020px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-700 bg-ink-850">
                {[t("Client"), t("Studio"), t("Preferred Slot"), t("Calls"), t("Source"), t("Status"), ""].map((h, i) => (
                  <th key={i} className={`px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400 ${i === 6 ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-750">
              {table.rows.map(a => (
                <tr key={a.id} onClick={() => navigate({ view: "appointment", id: a.id })} className="row-live group cursor-pointer">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={a.name} size={34} />
                      <span>
                        <span className="block text-[13.5px] font-extrabold text-ink-100 transition-colors group-hover:text-gold-300">{a.name}</span>
                        <span className="num text-[11px] text-ink-500">{a.uuid}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3"><Pill color="#948d7d" dot={false}>{studioById(a.locationId)?.slug}</Pill></td>
                  <td className="px-4 py-3">
                    <div className="num text-[12.5px] font-bold text-ink-100">{fmtD(a.preferredDate)} · {a.preferredTime}</div>
                    <div className="mt-1"><AwayChip isoStr={a.preferredDate} /></div>
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    {/* The count comes down with the booking, counted in the
                        database. It used to be derived from the calls the
                        store held, and there was a missed-call marker beside
                        it derived the same way — so a booking could read
                        "3 calls, none missed" while two of them were, which
                        is worse than not saying. The exact number stays; the
                        marker is gone. */}
                    {(() => {
                      const cc = a.voiceCalls ?? 0;
                      return (
                        <button onClick={() => setHistAppt(a)} title={t("Open call history")}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-bold transition-all hover:scale-[1.04] ${cc > 0 ? "border-lapis-500/40 bg-lapis-500/10 text-lapis-400 hover:border-lapis-500/70" : "border-ink-600 text-ink-500"}`}>
                          <I name="phone" size={12} /> <span className="num">{cc}</span>
                        </button>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3"><PlatformPill p={a.platform} /></td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <Dropdown width={210} trigger={open => (
                      <button className={`flex items-center gap-1.5 transition-transform ${can("appts.edit") ? "" : "opacity-55"}`}
                        style={{ transform: open ? "scale(1.03)" : undefined }}
                        title={can("appts.edit") ? undefined : `${t("locked")} · appts.edit`}>
                        {!can("appts.edit") && <I name="lock" size={11} className="text-ink-500" />}
                        <ApptStatusPill s={a.status} />
                        <I name="chevD" size={12} className={`text-ink-500 transition-transform ${open ? "rotate-180" : ""}`} />
                      </button>
                    )}>
                      {close => (
                        <div className="py-1">
                          {STATUS_ORDER.map(s => (
                            <button key={s} onClick={() => { if (!guard("appts.edit")) return; updateApptStatus(a.id, s); toast(tf("{uuid} → {status}", { uuid: a.uuid, status: t(APPT_STATUS_META[s].label) })); close(); }}
                              className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[12.5px] font-bold transition-colors hover:bg-ink-800 ${a.status === s ? "text-gold-300" : "text-ink-200"}`}>
                              <span className="h-2 w-2 rounded-full" style={{ background: APPT_STATUS_META[s].color }} />
                              {t(APPT_STATUS_META[s].label)}
                              {a.status === s && <I name="check" size={12} className="ml-auto text-gold-400" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </Dropdown>
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <Btn size="sm" variant="ghost" title={t("Open detail")} onClick={() => navigate({ view: "appointment", id: a.id })}><I name="eye" size={14} /></Btn>
                      <Btn size="sm" variant="ghost" title={t("Send SMS (template)")} onClick={() => setSmsAppt(a)} disabled={!a.formattedPhone} locked={!can("sms.send")}><I name="chat" size={14} /></Btn>
                      <Btn size="sm" variant="ghost" title={t("Internal notes")} onClick={() => setNotesAppt({ id: a.id, title: a.name })}><I name="note" size={14} /></Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {table.error && <div className="p-6"><EmptyState title={t("Could not load bookings")} hint={table.error} /></div>}
        {!table.error && table.rows.length === 0 && (
          <div className="p-6"><EmptyState title={table.loading ? t("Loading…") : t("No bookings match these filters")} /></div>
        )}
        {table.total > 0 && (
          <Pagination total={table.total} page={table.page - 1} pageSize={table.pageSize}
            onPage={p => table.setPage(p + 1)} unit={t("Bookings").toLowerCase()} />
        )}
      </div>

      {histAppt && <CallHistoryModal leadName={histAppt.name} phone={histAppt.formattedPhone} calls={apptCalls.get(histAppt.id) ?? []} onClose={() => setHistAppt(null)} />}
      {notesAppt && <NotesDrawer type="appointment" id={String(notesAppt.id)} title={notesAppt.title} onClose={() => setNotesAppt(null)} />}
      {smsAppt && <SmsCompose leadId={smsAppt.customerId} phone={smsAppt.formattedPhone} name={smsAppt.name} locationId={smsAppt.locationId} recipientLocale={smsAppt.language} onClose={() => setSmsAppt(null)} />}
    </div>
  );
}
