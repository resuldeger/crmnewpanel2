import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Avatar, ApptStatusPill, Btn, CallStatusPill, Dropdown, EmptyState, I, Pill, PlatformPill, PlayerModal, SectionTitle, SlaBadge } from "../ui";
import { CALL_STATUS_META, fmtDT, fmtDur, prettyPhone, shortId, studioById, timeAgo, type CallLog, type CallStatus } from "../data";
import { t, tf, useI18n } from "../i18n";
import { CallHistoryModal, NotesDrawer, SmsCompose } from "./Leads";

const TAB_ORDER: CallStatus[] = ["not_called", "no_answer", "busy", "interested", "not_interested", "callback_requested", "appointment_made", "already_scheduled", "didnt_pick_up", "wrong_number", "double_lead", "no_pn", "spam", "not_trusted"];

interface TimelineItem {
  id: string;
  at: string;
  kind: "call" | "sms" | "note" | "milestone" | "audit";
  title: string;
  subtitle?: string;
  meta?: string;
  color?: string;
  badge?: string;
  call?: CallLog;
}

export default function LeadDetail({ id }: { id: string }) {
  const { leads, appointments, calls, notes, conversations, auditLogs, navigate, updateLeadStatus, convertLead, toast, logCallback, addNote, can, guard } = useStore();
  useI18n();
  const [smsOpen, setSmsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [play, setPlay] = useState<CallLog | null>(null);
  const [quickNote, setQuickNote] = useState("");

  const lead = leads.find(l => l.id === id);
  const leadId = lead?.id ?? "";
  const conv = useMemo(() => conversations.find(c => c.customerId === leadId), [conversations, leadId]);
  const leadCalls = useMemo(() => calls.filter(c => c.customerId === leadId).sort((a, b) => +new Date(b.startTime) - +new Date(a.startTime)), [calls, leadId]);
  const leadNotes = useMemo(() => notes.filter(n => n.notableType === "lead" && n.notableId === leadId).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)), [notes, leadId]);
  const leadAudits = useMemo(() => auditLogs.filter(a => a.targetType === "lead" && a.targetId === leadId), [auditLogs, leadId]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];

    // Milestone: Lead creation
    if (lead) {
      items.push({
        id: `created-${lead.id}`,
        at: lead.createdAt,
        kind: "milestone",
        title: t("Lead Created"),
        subtitle: `${lead.attr.platform.toUpperCase()} · ${lead.meta.language.toUpperCase()}`,
        badge: t("Created"),
        color: "#fba200",
      });
    }

    // State Transition Audits
    leadAudits.forEach(a => {
      if (a.action === "status_change" && a.fromStatus && a.toStatus) {
        items.push({
          id: `audit-${a.id}`,
          at: a.at,
          kind: "audit",
          title: tf("Status → {to}", { to: t(a.toStatus) }),
          subtitle: `${a.actor} (${a.fromStatus} ➔ ${a.toStatus}) ${a.details ? `· ${a.details}` : ""}`,
          badge: t(a.toStatus),
          color: "#2fbf71",
        });
      }
    });

    // Calls
    leadCalls.forEach(c => {
      const durText = c.duration > 0 ? fmtDur(c.duration) : "";
      items.push({
        id: `call-${c.id}`,
        at: c.startTime,
        kind: "call",
        title: `${t(c.direction === "inbound" ? "Inbound Call" : "Outbound Call")}`,
        subtitle: `${c.agent} (${c.ext}) ${durText ? `· ${durText}` : ""}`,
        badge: t(c.result),
        color: c.result === "Answered" ? "#2fbf71" : c.result === "Missed" ? "#e5484d" : "#e8a33d",
        call: c,
      });
    });

    // SMS Messages
    conv?.messages.forEach((m, idx) => {
      const senderTag = m.senderType === "system" ? "🤖 [System]" : `👤 [${m.senderName ?? "Agent"}]`;
      items.push({
        id: `sms-${idx}-${m.at}`,
        at: m.at,
        kind: "sms",
        title: m.direction === "inbound" ? t("Incoming SMS") : `${t("Outgoing SMS")} · ${senderTag}`,
        subtitle: m.body,
        badge: m.direction === "inbound" ? t("Inbound") : t("Outbound"),
        color: m.direction === "inbound" ? "#2fbf71" : "#4c8dff",
      });
    });

    // Notes
    leadNotes.forEach(n => {
      items.push({
        id: `note-${n.id}`,
        at: n.createdAt,
        kind: "note",
        title: tf("Note by {author}", { author: n.author }),
        subtitle: n.content,
        color: "#fba200",
      });
    });

    return items.sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 14);
  }, [lead, leadAudits, leadCalls, conv, leadNotes]);

  if (!lead) {
    return (
      <div className="animate-rise"><EmptyState title="Lead not found" hint={id} />
        <div className="text-center"><Btn variant="gold" onClick={() => navigate({ view: "leads" })}>{t("Leads Pipeline")}</Btn></div>
      </div>
    );
  }

  const studio = studioById(lead.locationId);
  const appt = appointments.find(a => a.customerId === lead.id);
  const avgDur = leadCalls.length ? Math.round(leadCalls.filter(c => c.duration > 0).reduce((s, c) => s + c.duration, 0) / Math.max(leadCalls.filter(c => c.duration > 0).length, 1)) : 0;

  const dial = () => {
    if (!guard("calls.manage")) return;
    const res = logCallback({ name: lead.name, phone: lead.formattedPhone, customerId: lead.id, locationId: lead.locationId });
    toast(res === "Answered" ? tf("Callback to {name} answered", { name: lead.name }) : tf("Callback to {name} · no answer", { name: lead.name }), res === "Answered" ? "success" : "info");
    if (lead.callStatus === "not_called") updateLeadStatus(lead.id, res === "Answered" ? "interested" : "no_answer");
  };

  const submitQuickNote = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!guard("leads.edit")) return;
    const txt = quickNote.trim();
    if (!txt) return;
    addNote("lead", lead.id, txt);
    setQuickNote("");
    toast(t("Note added"), "success");
  };

  const ATTR: [string, string | null][] = [
    ["Platform", lead.attr.platform], ["Campaign", lead.attr.utmCampaign], ["Medium", lead.attr.utmMedium],
    ["Source", lead.attr.utmSource], ["gclid", lead.attr.gclid], ["fbclid", lead.attr.fbclid], ["ttclid", lead.attr.ttclid],
    ["Landing Page", lead.attr.landingPage],
  ];

  return (
    <div className="space-y-4 animate-rise">
      {/* header */}
      <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <button onClick={() => navigate({ view: "leads" })} aria-label={t("Prev")}
              className="mt-1 rounded-lg border border-ink-600 p-2 text-ink-400 transition-colors hover:border-gold-500/60 hover:text-gold-300"><I name="chevL" size={15} /></button>
            <Avatar name={lead.name} size={52} ring />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-[23px] font-bold tracking-wide text-ink-50">{lead.name}</h2>
                {lead.isDuplicate && <Pill color="#e8a33d">{t("Duplicate")}</Pill>}
                {lead.unsubscribedAt && <Pill color="#e5484d">{t("SMS Opt-Out")}</Pill>}
              </div>
              <div className="num mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-400">
                <span title={lead.id}>{shortId(lead.id)} · {tf("created {ago}", { ago: timeAgo(lead.createdAt) })} · {fmtDT(lead.createdAt)}</span>
                <SlaBadge createdAt={lead.createdAt} called={lead.callStatus !== "not_called"} />
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Dropdown width={236} trigger={open => (
                  <button className={`flex items-center gap-1.5 transition-transform ${can("leads.edit") ? "" : "opacity-55 cursor-not-allowed"}`}
                    style={{ transform: open ? "scale(1.03)" : undefined }}
                    title={can("leads.edit") ? undefined : `${t("locked")} · leads.edit`}>
                    {!can("leads.edit") && <I name="lock" size={11} className="text-ink-500" />}
                    <CallStatusPill s={lead.callStatus} />
                    <I name="chevD" size={12} className={`text-ink-500 transition-transform ${open ? "rotate-180" : ""}`} />
                  </button>
                )}>
                  {close => (
                    <div className="max-h-72 overflow-y-auto py-1">
                      {TAB_ORDER.map(s => (
                        <button key={s} onClick={() => { if (!guard("leads.edit")) return; updateLeadStatus(lead.id, s); toast(tf("{name} → {status}", { name: lead.name, status: t(CALL_STATUS_META[s].label) })); close(); }}
                          className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[12.5px] font-bold transition-colors hover:bg-ink-800 ${lead.callStatus === s ? "text-gold-300" : "text-ink-200"}`}>
                          <span className="h-2 w-2 rounded-full" style={{ background: CALL_STATUS_META[s].color }} />
                          {t(CALL_STATUS_META[s].label)}
                          {lead.callStatus === s && <I name="check" size={12} className="ml-auto text-gold-400" />}
                        </button>
                      ))}
                    </div>
                  )}
                </Dropdown>
                <PlatformPill p={lead.attr.platform} />
                <Pill color="#948d7d">{studio?.name ?? "—"}</Pill>
                <Pill color="#4c8dff" dot={false}>{lead.meta.language.toUpperCase()}</Pill>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Btn variant="outline" onClick={() => navigate({ view: "customer", id: lead.id })} locked={!can("customers.view")}>
              <I name="users" size={14} /> {t("Customer 360°")}
            </Btn>
            <Btn variant="outline" onClick={dial} locked={!can("calls.manage")}><I name="phone" size={14} /> {t("Call")}</Btn>
            <Btn variant="outline" onClick={() => setSmsOpen(true)} disabled={!lead.formattedPhone} locked={!can("sms.send")}
              title={lead.formattedPhone ? t("Send SMS from a template") : t("No phone on file")}>
              <I name="chat" size={14} /> {t("Send SMS")}
            </Btn>
            {conv && <Btn variant="outline" onClick={() => navigate({ view: "sms", id: conv.id })} locked={!can("sms.view")}><I name="eye" size={14} /> {t("Thread")}</Btn>}
            <Btn variant="outline" onClick={() => setNotesOpen(true)}><I name="note" size={14} /> {t("Notes")} <span className="num opacity-70">{leadNotes.length}</span></Btn>
            <Btn variant="gold" disabled={!!appt} locked={!can("leads.convert")}
              onClick={() => {
                if (!guard("leads.convert")) return;
                const aid = convertLead(lead.id);
                if (aid) {
                  toast(tf("{name} converted to appointment", { name: lead.name }));
                  navigate({ view: "appointment", id: aid });
                }
              }}>
              <I name="convert" size={14} /> {appt ? t("Converted") : t("Convert to Booking")}
            </Btn>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* left column */}
        <div className="space-y-4 xl:col-span-3">
          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle>{t("Tattoo Brief")}</SectionTitle>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {[[t("Purpose"), t(lead.meta.purpose)], [t("Style"), t(lead.meta.style)], [t("Size"), t(lead.meta.size)]].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-ink-700 bg-ink-850 px-3.5 py-3">
                  <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-ink-500">{k}</div>
                  <div className="mt-1 text-[13px] font-extrabold text-ink-100">{v}</div>
                </div>
              ))}
              <div className="col-span-2 rounded-xl border border-ink-700 bg-ink-850 px-3.5 py-3 md:col-span-3">
                <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-ink-500">{t("Body Areas")}</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">{lead.meta.bodyAreas.map(a => <Pill key={a} color="#7c4fe0" dot={false}>{t(a)}</Pill>)}</div>
              </div>
              <div className="col-span-2 rounded-xl border border-ink-700 bg-ink-850 px-3.5 py-3 md:col-span-3">
                <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-ink-500">{t("Story")} · {t(lead.meta.storyType)}</div>
                <div className="mt-1 text-[12.5px] font-semibold leading-relaxed text-ink-300">{lead.meta.story || "—"}</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle right={
              <div className="flex items-center gap-2">
                <Btn size="sm" variant="outline" onClick={() => navigate({ view: "lead_subview", id: lead.id, sub: "calls" })} locked={!can("calls.view")}>
                  <I name="table" size={13} /> {t("View All in Table")}
                </Btn>
              </div>
            }>
              {t("Call History")}
            </SectionTitle>
            <div className="num mb-3 text-[12px] font-bold text-ink-400">{tf("{n} calls · avg {d}", { n: leadCalls.length, d: fmtDur(avgDur) })}</div>
            <div className="max-h-[360px] overflow-y-auto pr-1 divide-y divide-ink-750">
              {leadCalls.map(c => (
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
              {leadCalls.length === 0 && <div className="py-4 text-[12.5px] font-semibold text-ink-400">{t("No recording")}</div>}
            </div>
          </div>

          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle>{t("Attribution")}</SectionTitle>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {ATTR.map(([k, v]) => (
                <div key={k} className="rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5">
                  <div className="text-[9.5px] font-extrabold uppercase tracking-[0.14em] text-ink-500">{t(k)}</div>
                  <div className="num mt-0.5 flex items-center gap-1 truncate text-[12px] font-bold text-ink-200">
                    <span className="truncate">{v ?? "—"}</span>
                    {v && (k === "gclid" || k === "fbclid" || k === "ttclid") && (
                      <button onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(v).catch(() => undefined); toast(k, "info"); }} aria-label="Copy" className="text-ink-500 hover:text-gold-300"><I name="copy" size={11} /></button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* right column */}
        <div className="space-y-4 xl:col-span-2">
          {/* Linked Appointment */}
          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle>{t("Linked Appointment")}</SectionTitle>
            {appt ? (
              <button onClick={() => navigate({ view: "appointment", id: appt.id })}
                className="group w-full rounded-xl border border-jade-500/40 bg-jade-500/8 p-4 text-left transition-all hover:border-jade-500/80 hover:bg-jade-500/15">
                <div className="flex items-center justify-between">
                  <span className="num text-[13px] font-extrabold text-ink-100 group-hover:text-jade-300">{appt.uuid}</span>
                  <ApptStatusPill s={appt.status} />
                </div>
                <div className="num mt-1.5 text-[12.5px] font-bold text-jade-400">{fmtDT(appt.preferredDate)} · {appt.preferredTime}</div>
                <div className="mt-1 flex items-center justify-between text-[11.5px] font-semibold text-ink-400">
                  <span>{studio?.name ?? "—"}</span>
                  <span className="flex items-center gap-1 text-gold-400 group-hover:translate-x-0.5 transition-transform">{t("View")} <I name="chevR" size={11} /></span>
                </div>
              </button>
            ) : (
              <div className="rounded-xl border border-dashed border-ink-700 bg-ink-900/40 p-5 text-center">
                <div className="mx-auto grid h-10 w-10 place-items-center rounded-full border border-ink-600 bg-ink-800 text-ink-400">
                  <I name="calendar" size={18} />
                </div>
                <div className="mt-2.5 text-[13px] font-extrabold text-ink-200">{t("No active booking")}</div>
                <div className="mt-1 text-[11.5px] text-ink-400">{t("Convert this lead into a scheduled studio appointment.")}</div>
                <div className="mt-3.5">
                  <Btn size="sm" variant="gold" locked={!can("leads.convert")}
                    onClick={() => {
                      if (!guard("leads.convert")) return;
                      const aid = convertLead(lead.id);
                      if (aid) {
                        toast(tf("{name} converted to appointment", { name: lead.name }));
                        navigate({ view: "appointment", id: aid });
                      }
                    }}>
                    <I name="convert" size={13} /> {t("Convert to Booking")}
                  </Btn>
                </div>
              </div>
            )}
          </div>

          {/* Activity Timeline */}
          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle right={
              <div className="flex items-center gap-2">
                <span className="num text-[11px] font-bold text-ink-500">{timeline.length} {t("Events")}</span>
                {timeline.length > 0 && (
                  <Btn size="sm" variant="outline" onClick={() => navigate({ view: "lead_subview", id: lead.id, sub: "audit" })}>
                    <I name="table" size={13} /> {t("View All in Table")}
                  </Btn>
                )}
              </div>
            }>
              {t("Activity Timeline")}
            </SectionTitle>
            {timeline.length === 0 && <div className="py-3 text-[12.5px] font-semibold text-ink-400">—</div>}
            <div className="max-h-[380px] overflow-y-auto pr-1 relative space-y-3 pl-6">
              <span className="absolute bottom-2 left-[11px] top-2 w-px bg-ink-700" />
              {timeline.map(item => (
                <div key={item.id} className="relative group">
                  <span className={`absolute -left-[23px] top-1 grid h-6 w-6 place-items-center rounded-full border shadow-sm ${
                    item.kind === "call" ? "border-lapis-500/50 bg-lapis-500/20 text-lapis-300" :
                    item.kind === "sms" ? "border-jade-500/50 bg-jade-500/20 text-jade-300" :
                    item.kind === "note" ? "border-gold-500/50 bg-gold-500/20 text-gold-300" :
                    "border-ink-500/50 bg-ink-800 text-ink-300"
                  }`}>
                    <I name={item.kind === "call" ? "phone" : item.kind === "sms" ? "chat" : item.kind === "note" ? "note" : "spark"} size={11} />
                  </span>

                  <div className="rounded-xl border border-ink-750 bg-ink-850 p-3 transition-colors hover:border-ink-600">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-extrabold text-ink-100">{item.title}</span>
                      <div className="flex items-center gap-1.5">
                        {item.badge && (
                          <span className="rounded-md px-1.5 py-0.5 text-[9.5px] font-extrabold" style={{ color: item.color, background: `${item.color}15`, border: `1px solid ${item.color}40` }}>
                            {item.badge}
                          </span>
                        )}
                        {item.call?.hasRecording && (
                          <button onClick={() => {
                            if (!guard("calls.view")) return;
                            setPlay(item.call!);
                          }} title={t("Listen recording")} className="rounded p-0.5 text-gold-400 hover:text-gold-300">
                            <I name="play" size={11} />
                          </button>
                        )}
                      </div>
                    </div>

                    {item.subtitle && (
                      <p className="mt-1 text-[11.5px] font-medium leading-relaxed text-ink-300 line-clamp-2">
                        {item.subtitle}
                      </p>
                    )}

                    <div className="num mt-1.5 text-[10px] font-semibold text-ink-500">
                      {timeAgo(item.at)} · {fmtDT(item.at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Notes Section with Quick Composer */}
          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle right={
              <div className="flex items-center gap-1.5">
                <span className="num text-[11px] font-bold text-ink-500">{leadNotes.length}</span>
                {leadNotes.length > 0 && (
                  <Btn size="sm" variant="outline" onClick={() => navigate({ view: "lead_subview", id: lead.id, sub: "notes" })}>
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
                  placeholder={can("leads.edit") ? t("Write an internal staff note…") : `${t("locked")} · leads.edit`}
                  disabled={!can("leads.edit")}
                  rows={2}
                  className="w-full resize-none rounded-xl border border-ink-700 bg-ink-900/80 px-3 py-2 text-[12px] font-medium text-ink-100 placeholder:text-ink-500 focus:border-gold-500/60 focus:outline-none focus:ring-1 focus:ring-gold-500/30 disabled:opacity-50"
                />
              </div>
              <div className="flex justify-end">
                <Btn size="sm" variant="gold" locked={!can("leads.edit")} disabled={!quickNote.trim()}>
                  <I name="check" size={12} /> {t("Add note")}
                </Btn>
              </div>
            </form>

            <div className="max-h-[320px] overflow-y-auto pr-1 space-y-2.5">
              {leadNotes.map(n => (
                <div key={n.id} className="rounded-xl border border-ink-700 bg-ink-850 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10.5px] font-extrabold text-gold-300">{n.author}</span>
                    <span className="num text-[10px] text-ink-500">{timeAgo(n.createdAt)}</span>
                  </div>
                  <p className="text-[12px] font-semibold leading-relaxed text-ink-200">{n.content}</p>
                </div>
              ))}
              {leadNotes.length === 0 && <div className="py-2 text-[12px] text-ink-400">{t("No notes on file.")}</div>}
            </div>
          </div>
        </div>
      </div>

      {smsOpen && <SmsCompose leadId={lead.id} phone={lead.formattedPhone} name={lead.name} locationId={lead.locationId} onClose={() => setSmsOpen(false)} openThread={cid => navigate({ view: "sms", id: cid })} />}
      {notesOpen && <NotesDrawer type="lead" id={lead.id} title={lead.name} onClose={() => setNotesOpen(false)} />}
      {histOpen && <CallHistoryModal leadName={lead.name} phone={lead.formattedPhone} calls={leadCalls} onClose={() => setHistOpen(false)} />}
      {play && <PlayerModal title={lead.name} subtitle={`${play.ext} · ${fmtDT(play.startTime)}`} onClose={() => setPlay(null)} />}
    </div>
  );
}
