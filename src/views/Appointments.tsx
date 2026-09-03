import { useMemo, useState } from "react";
import { useStore } from "../store";
import {
  Avatar, ApptStatusPill, Btn, Dropdown, EmptyState, Field, I, Modal, Pill, PlatformPill, SectionTitle, inputCls,
} from "../components/ui";
import { APPT_STATUS_META, STORY_TYPES, fmtD, fmtDT, prettyPhone, studioById, timeAgo, type ApptStatus, type Appointment, type CallLog } from "../data/crm";
import { CallHistoryModal, NotesDrawer } from "./Leads";
import SmsCompose from "../components/SmsCompose";
import { t, tf, useI18n } from "../services/i18n";

const STATUS_ORDER: ApptStatus[] = ["pending", "confirmed", "sms_sent", "cancelled", "unreachable", "spam", "not_trusted"];

const daysAway = (isoStr: string) => Math.round((new Date(isoStr).getTime() - Date.now()) / 86_400_000);

const AwayChip = ({ isoStr }: { isoStr: string }) => {
  const d = daysAway(isoStr);
  const color = d < 0 ? "#8b8ba0" : d <= 2 ? "#e8a33d" : "#2fbf71";
  return <Pill color={color} dot={false}>{d < 0 ? tf("{n}d past", { n: -d }) : d === 0 ? t("today") : tf("in {n}d", { n: d })}</Pill>;
};

export default function Appointments() {
  const { appointments, calls, globalLocation, updateApptStatus, toast, navigate, can, guard } = useStore();
  useI18n();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | ApptStatus>("all");
  const [onlyUpcoming, setOnlyUpcoming] = useState(false);
  const [notesAppt, setNotesAppt] = useState<{ id: number; title: string } | null>(null);
  const [histAppt, setHistAppt] = useState<Appointment | null>(null);
  const [smsAppt, setSmsAppt] = useState<Appointment | null>(null);

  const apptCalls = useMemo(() => {
    const m = new Map<number, CallLog[]>();
    appointments.forEach(a => {
      m.set(a.id, calls.filter(c =>
        (a.customerId && c.customerId === a.customerId) ||
        (a.formattedPhone && (c.fromNumber === a.formattedPhone || c.toNumber === a.formattedPhone))));
    });
    return m;
  }, [appointments, calls]);

  const counts = useMemo(() => {
    const m = new Map<ApptStatus, number>();
    appointments.forEach(a => m.set(a.status, (m.get(a.status) ?? 0) + 1));
    return m;
  }, [appointments]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const digits = query.replace(/[^0-9]/g, "");
    return appointments
      .filter(a =>
        (globalLocation === "all" || a.locationId === globalLocation) &&
        (status === "all" || a.status === status) &&
        (!onlyUpcoming || daysAway(a.preferredDate) >= 0) &&
        (!query || a.name.toLowerCase().includes(query) || a.uuid.toLowerCase().includes(query) ||
          a.email.toLowerCase().includes(query) || (digits.length > 2 && a.formattedPhone.replace(/[^0-9]/g, "").includes(digits))))
      .sort((a, b) => +new Date(a.preferredDate) - +new Date(b.preferredDate));
  }, [appointments, q, status, onlyUpcoming, globalLocation]);
  const weekAhead = appointments.filter(a => { const d = daysAway(a.preferredDate); return d >= 0 && d <= 7; }).length;

  return (
    <div className="space-y-4 animate-rise">
      {/* kpi strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Pending Review", n: counts.get("pending") ?? 0, color: "#e8a33d", s: "pending" as ApptStatus },
          { label: "Confirmed", n: counts.get("confirmed") ?? 0, color: "#2fbf71", s: "confirmed" as ApptStatus },
          { label: "SMS Sent", n: counts.get("sms_sent") ?? 0, color: "#74a8ff", s: "sms_sent" as ApptStatus },
          { label: "Next 7 Days", n: weekAhead, color: "#d4af37", s: "all" as const },
        ].map(k => (
          <button key={k.label} onClick={() => setStatus(k.s)}
            className="group flex items-center justify-between rounded-xl border border-ink-700 bg-ink-875 px-4 py-3.5 text-left shadow-panel transition-all hover:-translate-y-0.5 hover:border-gold-500/40">
            <span>
              <span className="kpi-num block" style={{ color: k.color }}>{k.n}</span>
              <span className="mt-1 block text-[11px] font-bold uppercase tracking-wider text-ink-400">{t(k.label)}</span>
            </span>
            <I name="chevR" size={16} className="text-ink-600 transition-all group-hover:translate-x-1 group-hover:text-gold-400" />
          </button>
        ))}
      </div>

      {/* controls */}
      <div className="rounded-2xl border border-ink-700 bg-ink-875 p-4 shadow-panel">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1">
            <I name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("Search name, booking UUID, phone…")} className={`${inputCls} pl-9`} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-ink-600 px-3 py-2 text-[12.5px] font-bold text-ink-300 transition-colors hover:border-gold-500/50 hover:text-gold-300">
            <input type="checkbox" checked={onlyUpcoming} onChange={e => setOnlyUpcoming(e.target.checked)} className="accent-[#d4af37]" />
            {t("Upcoming only")}
          </label>
        </div>
        <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <button onClick={() => setStatus("all")}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-colors ${status === "all" ? "bg-gold-500 text-ink-950" : "border border-ink-600 text-ink-300 hover:text-ink-100"}`}>
            {t("All")} <span className="num opacity-75">· {appointments.length}</span>
          </button>
          {STATUS_ORDER.map(s => (
            <button key={s} onClick={() => setStatus(status === s ? "all" : s)}
              className="shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all"
              style={status === s
                ? { color: "#0a0a0e", background: APPT_STATUS_META[s].color, border: `1px solid ${APPT_STATUS_META[s].color}` }
                : { color: APPT_STATUS_META[s].color, background: `${APPT_STATUS_META[s].color}10`, border: `1px solid ${APPT_STATUS_META[s].color}35` }}>
              {t(APPT_STATUS_META[s].label)} <span className="num opacity-75">· {counts.get(s) ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* table */}
      <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1020px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-700 bg-ink-850">
                {[t("Client"), t("Studio"), t("Ink Request"), t("Preferred Slot"), t("Calls"), t("Source"), t("Status"), ""].map((h, ix) => (
                  <th key={h || `act-${ix}`} className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-750">
              {filtered.map(a => (
                <tr key={a.id} className="row-live group">
                  <td className="px-4 py-3">
                    <button onClick={() => navigate({ view: "appointment", id: a.id })} className="flex items-center gap-3 text-left">
                      <Avatar name={a.name} size={34} />
                      <span>
                        <span className="block text-[13.5px] font-extrabold text-ink-100 transition-colors group-hover:text-gold-300">{a.name}</span>
                        <span className="num text-[11px] text-ink-500">{a.uuid}</span>
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-3"><Pill color="#63637a" dot={false}>{studioById(a.locationId)?.slug}</Pill></td>
                  <td className="px-4 py-3">
                    <div className="text-[12.5px] font-bold text-ink-200">{t(a.style)}</div>
                    <div className="text-[11px] font-semibold text-ink-500">{t(a.size)} · {a.bodyAreas.slice(0, 2).map(b => t(b)).join(", ")}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="num text-[12.5px] font-bold text-ink-100">{fmtD(a.preferredDate)} · {a.preferredTime}</div>
                    <div className="mt-1"><AwayChip isoStr={a.preferredDate} /></div>
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const cc = apptCalls.get(a.id) ?? [];
                      const missed = cc.filter(c => c.result === "Missed" || c.result === "Voicemail").length;
                      return (
                        <button onClick={() => setHistAppt(a)} title={t("Open call history — click a call to listen")}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-bold transition-all hover:scale-[1.04] ${cc.length > 0 ? "border-lapis-500/40 bg-lapis-500/10 text-lapis-400 hover:border-lapis-500/70" : "border-ink-600 text-ink-500"}`}>
                          <I name="phone" size={12} /> <span className="num">{cc.length}</span>
                          {missed > 0 && <span className="num rounded bg-ember-500/15 px-1 text-[9.5px] text-ember-400">{missed}✕</span>}
                        </button>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3"><PlatformPill p={a.platform} /></td>
                  <td className="px-4 py-3">
                    <Dropdown width={210} trigger={open => (
                      <button className="flex items-center gap-1.5 transition-transform" style={{ transform: open ? "scale(1.03)" : undefined }}>
                        <ApptStatusPill s={a.status} />
                        <I name="chevD" size={12} className={`text-ink-500 transition-transform ${open ? "rotate-180" : ""}`} />
                      </button>
                    )}>
                      {close => (
                        <div className="py-1">
                          {STATUS_ORDER.map(s => (
                            <button key={s} onClick={() => { updateApptStatus(a.id, s); toast(tf("{uuid} → {status}", { uuid: a.uuid, status: t(APPT_STATUS_META[s].label) })); close(); }}
                              className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[12.5px] font-bold transition-colors hover:bg-ink-750 ${a.status === s ? "text-gold-300" : "text-ink-200"}`}>
                              <span className="h-2 w-2 rounded-full" style={{ background: APPT_STATUS_META[s].color }} />
                              {t(APPT_STATUS_META[s].label)}
                              {a.status === s && <I name="check" size={12} className="ml-auto text-gold-400" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </Dropdown>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Btn size="sm" variant="ghost" title={t("Open detail")} onClick={() => navigate({ view: "appointment", id: a.id })}><I name="eye" size={14} /></Btn>
                      <Btn size="sm" variant="ghost" title={t("Send SMS (template)")} onClick={() => setSmsAppt(a)} disabled={!a.formattedPhone}><I name="chat" size={14} /></Btn>
                      <Btn size="sm" variant="ghost" title={t("Internal notes")} onClick={() => setNotesAppt({ id: a.id, title: a.name })}><I name="note" size={14} /></Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="p-6"><EmptyState icon="calendar" title={t("No appointments match")} hint={t("Adjust the status filter or clear the search to see more bookings.")} /></div>
        )}
        <div className="flex items-center justify-between border-t border-ink-700 px-4 py-3">
          <span className="num text-[12px] font-semibold text-ink-400">{tf("{n} bookings · sorted by preferred date", { n: filtered.length })}</span>
          <span className="text-[11px] font-bold uppercase tracking-wider text-ink-500">{t("synced with Timely")}</span>
        </div>
      </div>

      {notesAppt && <NotesDrawer type="appointment" id={String(notesAppt.id)} title={notesAppt.title} onClose={() => setNotesAppt(null)} />}
      {histAppt && (
        <CallHistoryModal leadName={histAppt.name} phone={histAppt.formattedPhone}
          calls={apptCalls.get(histAppt.id) ?? []} onClose={() => setHistAppt(null)} />
      )}
      {smsAppt && (
        <SmsCompose phone={smsAppt.formattedPhone} name={smsAppt.name} locationId={smsAppt.locationId}
          dateOverride={`${fmtD(smsAppt.preferredDate)} at ${smsAppt.preferredTime}`}
          onSent={() => { updateApptStatus(smsAppt.id, "sms_sent"); toast(tf("{uuid} marked SMS Sent", { uuid: smsAppt.uuid }), "info"); }}
          onClose={() => setSmsAppt(null)} />
      )}
    </div>
  );
}

export function AppointmentDetail({ id }: { id: number }) {
  const { appointments, leads, notesFor, updateApptStatus, navigate, toast } = useStore();
  useI18n();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const appt = appointments.find(a => a.id === id);

  const copy = (text: string, label: string) => {
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => undefined);
    toast(tf("{label} copied to clipboard", { label: t(label) }), "info");
  };

  if (!appt) {
    return (
      <div className="space-y-4 animate-rise">
        <EmptyState icon="calendar" title={t("Appointment not found")} hint={t("This booking may have been removed.")} />
        <Btn variant="outline" onClick={() => navigate({ view: "appointments" })}><I name="chevL" size={14} /> {t("Back to Appointments")}</Btn>
      </div>
    );
  }

  const linkedLead = appt.customerId ? leads.find(l => l.id === appt.customerId) : undefined;
  const notes = notesFor("appointment", String(appt.id));
  const studio = studioById(appt.locationId);
  const d = daysAway(appt.preferredDate);

  const act = (s: ApptStatus, msg: string, kind: "success" | "info" | "error" = "success") => {
    updateApptStatus(appt.id, s);
    toast(msg, kind);
  };

  return (
    <div className="space-y-4 animate-rise">
      <button onClick={() => navigate({ view: "appointments" })}
        className="flex items-center gap-1.5 text-[12.5px] font-bold text-ink-400 transition-colors hover:text-gold-300">
        <I name="chevL" size={14} /> {t("Appointments")}
      </button>

      {/* header */}
      <div className="relative overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gold-500/8 blur-3xl" />
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={appt.name} size={58} ring />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-[22px] font-bold tracking-wide text-ink-50">{appt.name}</h2>
              <ApptStatusPill s={appt.status} />
              {appt.isFreePick && <Pill color="#9b6bff">{t("Free Pick")}</Pill>}
            </div>
            <div className="num mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-400">
              <button onClick={() => copy(appt.uuid, "Booking UUID")} className="flex items-center gap-1 transition-colors hover:text-gold-300">
                {appt.uuid} <I name="copy" size={11} />
              </button>
              · {tf("created {ago}", { ago: timeAgo(appt.createdAt) })}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <PlatformPill p={appt.platform} />
              <Pill color="#63637a">{studio?.name}</Pill>
              {appt.campaign && <Pill color="#4c8dff" dot={false}>{appt.campaign}</Pill>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {appt.status !== "confirmed" && (
              <Btn variant="gold" onClick={() => act("confirmed", tf("{uuid} confirmed — artist notified", { uuid: appt.uuid }))}>
                <I name="check" size={14} /> {t("Confirm")}
              </Btn>
            )}
            <Btn variant="outline" onClick={() => act("sms_sent", t("Confirmation SMS queued via Twilio"), "info")}>
              <I name="send" size={14} /> {t("Send SMS")}
            </Btn>
            <Btn variant="outline" onClick={() => act("unreachable", tf("{name} marked unreachable", { name: appt.name }), "info")}>
              <I name="phone" size={14} /> {t("Unreachable")}
            </Btn>
            <Btn variant="danger" onClick={() => act("cancelled", tf("{uuid} cancelled", { uuid: appt.uuid }), "error")}>
              <I name="x" size={14} /> {t("Cancel")}
            </Btn>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* left */}
        <div className="space-y-4 xl:col-span-3">
          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle right={<Pill color="#d4af37" dot={false}>{t(appt.purpose)}</Pill>}>{t("Booking Brief")}</SectionTitle>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Field label={t("Style")}><div className="text-[13px] font-bold text-ink-100">{t(appt.style)}</div></Field>
              <Field label={t("Story Type")}><div className="text-[13px] font-bold text-ink-100">{t(STORY_TYPES[appt.storyType] ?? appt.storyType)}</div></Field>
              <Field label={t("Size")}><div className="text-[13px] font-bold text-ink-100">{t(appt.size)}</div></Field>
              <Field label={t("Language")}><div className="text-[13px] font-bold uppercase text-ink-100">{appt.language}</div></Field>
            </div>
            <div className="mt-4">
              <Field label={t("Body Areas")}>
                <div className="mt-0.5 flex flex-wrap gap-1.5">
                  {appt.bodyAreas.map(a => <Pill key={a} color="#8b8ba0" dot={false}>{t(a)}</Pill>)}
                </div>
              </Field>
            </div>
            {appt.story && (
              <div className="mt-4">
                <Field label={t("Client Story")}>
                  <p className="mt-1 rounded-xl border border-ink-700 bg-ink-900 px-4 py-3 text-[13px] font-medium italic leading-relaxed text-ink-200">“{appt.story}”</p>
                </Field>
              </div>
            )}
            {appt.referenceImage && (
              <div className="mt-4">
                <Field label={t("Reference Image")}>
                  <button onClick={() => setLightbox(appt.referenceImage!)}
                    className="group relative mt-1.5 block h-28 w-28 overflow-hidden rounded-xl border border-ink-600 transition-all hover:scale-[1.03] hover:border-gold-500/60">
                    <img src={appt.referenceImage} alt="reference" className="h-full w-full object-cover" />
                    <span className="absolute inset-0 grid place-items-center bg-ink-950/60 opacity-0 transition-opacity group-hover:opacity-100">
                      <I name="eye" size={18} className="text-gold-300" />
                    </span>
                  </button>
                </Field>
              </div>
            )}
            <div className="mt-4 flex items-center gap-2 border-t border-ink-750 pt-3.5">
              <I name={appt.consent ? "check" : "alert"} size={14} className={appt.consent ? "text-jade-400" : "text-ember-400"} />
              <span className="text-[12px] font-bold text-ink-300">{appt.consent ? t("Marketing consent granted") : t("Marketing consent not granted")}</span>
            </div>
          </div>

          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle>{t("Customer")}</SectionTitle>
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-ink-400">{t("Email")}</div>
                  <div className="num truncate text-[12px] font-semibold text-ink-200">{appt.email}</div>
                </div>
                <button onClick={() => copy(appt.email, "Email")} className="rounded-md border border-ink-600 p-1.5 text-ink-400 transition-colors hover:border-gold-500/60 hover:text-gold-300"><I name="copy" size={12} /></button>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-ink-400">{t("Phone")}</div>
                  <div className="num truncate text-[12px] font-semibold text-ink-200">{prettyPhone(appt.formattedPhone)}</div>
                </div>
                <button onClick={() => copy(appt.formattedPhone, "Phone")} className="rounded-md border border-ink-600 p-1.5 text-ink-400 transition-colors hover:border-gold-500/60 hover:text-gold-300"><I name="copy" size={12} /></button>
              </div>
            </div>
            {linkedLead ? (
              <button onClick={() => navigate({ view: "lead", id: linkedLead.id })}
                className="group mt-3 flex w-full items-center gap-3 rounded-xl border border-lapis-500/30 bg-lapis-500/6 p-3 text-left transition-all hover:border-lapis-500/60">
                <span className="grid h-9 w-9 place-items-center rounded-lg border border-lapis-500/40 bg-lapis-500/10 text-lapis-400"><I name="leads" size={15} /></span>
                <span className="flex-1">
                  <span className="block text-[12.5px] font-extrabold text-ink-100">{tf("Origin lead · {id}", { id: linkedLead.id })}</span>
                  <span className="block text-[11px] font-semibold text-ink-400">{t("Open the full 360° record with calls, SMS & attribution")}</span>
                </span>
                <I name="chevR" size={15} className="text-lapis-400 transition-transform group-hover:translate-x-1" />
              </button>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-ink-600 bg-ink-900/60 p-3.5 text-center text-[12px] font-semibold text-ink-500">
                {t("Direct booking — no originating lead record")}
              </div>
            )}
          </div>
        </div>

        {/* right */}
        <div className="space-y-4 xl:col-span-2">
          <div className="rounded-2xl border border-gold-500/25 bg-gradient-to-br from-gold-500/10 to-transparent p-5 shadow-panel">
            <SectionTitle right={<AwayChip isoStr={appt.preferredDate} />}>{t("Preferred Slot")}</SectionTitle>
            <div className="num text-[30px] font-bold leading-tight tracking-tight text-gold-300">
              {new Date(appt.preferredDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "2-digit" })}
            </div>
            <div className="num mt-0.5 text-[20px] font-bold text-ink-100">{appt.preferredTime} <span className="text-[12px] font-semibold text-ink-400">{t("studio local time")}</span></div>
            <div className="mt-3 space-y-1.5 border-t border-gold-500/15 pt-3 text-[12px] font-semibold text-ink-300">
              <div className="flex justify-between"><span>{t("Studio")}</span><span className="font-bold text-ink-100">{studio?.name}</span></div>
              <div className="flex justify-between"><span>{t("Hours")}</span><span className="num text-ink-100">{studio?.hours}</span></div>
              <div className="flex justify-between"><span>{d >= 0 ? t("Countdown") : t("Elapsed")}</span>
                <span className={`num font-bold ${d < 0 ? "text-ink-400" : d <= 2 ? "text-ember-400" : "text-jade-400"}`}>{tf("{n} day(s)", { n: Math.abs(d) })}</span></div>
            </div>
          </div>

          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle right={<Btn size="sm" variant="outline" onClick={() => setNotesOpen(true)}><I name="note" size={13} /> {t("All notes")}</Btn>}>{t("Notes")}</SectionTitle>
            {notes.length === 0 ? (
              <EmptyState icon="note" title={t("No notes yet")} hint={t("Add private notes for the team from the drawer.")} />
            ) : (
              <div className="space-y-2.5">
                {notes.slice(0, 3).map(n => (
                  <div key={n.id} className="rounded-xl border border-ink-700 bg-ink-850 p-3.5">
                    <div className="mb-1 flex items-center gap-2">
                      <Avatar name={n.author} size={20} />
                      <span className="text-[11.5px] font-extrabold text-ink-100">{n.author}</span>
                      <span className="num ml-auto text-[10px] text-ink-500">{timeAgo(n.createdAt)}</span>
                    </div>
                    <p className="text-[12.5px] font-medium leading-snug text-ink-300">{n.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle>{t("Record Timeline")}</SectionTitle>
            <ol className="relative ml-3 space-y-4 border-l border-ink-700 pl-5">
              {[
                { icon: "spark" as const, cls: "border-gold-500/50 bg-gold-500/15 text-gold-400", title: t("Booking captured"), sub: `${t(appt.platform.charAt(0).toUpperCase() + appt.platform.slice(1))} · ${fmtDT(appt.createdAt)}` },
                { icon: "pin" as const, cls: "border-lapis-500/50 bg-lapis-500/15 text-lapis-400", title: tf("Routed to {slug}", { slug: studio?.slug ?? "—" }), sub: studio?.address ?? "" },
                { icon: "calendar" as const, cls: "border-jade-500/50 bg-jade-500/15 text-jade-400", title: tf("Status: {status}", { status: t(APPT_STATUS_META[appt.status].label) }), sub: t("updated by Cleo Rivera · Super Admin") },
              ].map((s, i) => (
                <li key={i} className="relative">
                  <span className={`absolute -left-[27px] top-0.5 grid h-5 w-5 place-items-center rounded-full border ${s.cls}`}>
                    <I name={s.icon} size={10} />
                  </span>
                  <div className="text-[12.5px] font-extrabold text-ink-100">{s.title}</div>
                  <div className="num mt-0.5 text-[11.5px] text-ink-400">{s.sub}</div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {lightbox && (
        <Modal onClose={() => setLightbox(null)} w={760}>
          <img src={lightbox} alt="Reference full size" className="w-full rounded-2xl" />
        </Modal>
      )}
      {notesOpen && <NotesDrawer type="appointment" id={String(appt.id)} title={`${appt.name} · ${appt.uuid}`} onClose={() => setNotesOpen(false)} />}
    </div>
  );
}
