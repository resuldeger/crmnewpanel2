"use client";

import { useMemo, useState } from "react";
import { useStore } from "../store";
import {
  Avatar, ApptStatusPill, Btn, CallStatusPill, Dropdown, EmptyState, I, Pill,
  PlatformPill, PlayerModal, SectionTitle
} from "../ui";
import {
  CALL_STATUS_META, APPT_STATUS_META, fmtDT, fmtDur, fmtD, prettyPhone,
  studioById, timeAgo, type CallLog, type Appointment, type Lead, type AuditLog
} from "../data";
import { t, tf, useI18n } from "../i18n";
import { CallHistoryModal, NotesDrawer, SmsCompose } from "./Leads";

export default function CustomerDetail({ id }: { id: string }) {
  const {
    customerById, leads, appointments, calls, notes, conversations, auditLogs,
    navigate, toast, logCallback, addNote, can, guard
  } = useStore();
  useI18n();

  const [activeTab, setActiveTab] = useState<"timeline" | "briefs" | "comms" | "attribution">("timeline");
  const [smsOpen, setSmsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [play, setPlay] = useState<CallLog | null>(null);
  const [quickNote, setQuickNote] = useState("");

  const cust = customerById(id);

  const custLeads = useMemo(() => {
    if (!cust) return [];
    return leads.filter(l => cust.leadIds.includes(l.id) || (cust.phone && l.formattedPhone.replace(/\D/g, "") === cust.phone.replace(/\D/g, "")));
  }, [cust, leads]);

  const custAppts = useMemo(() => {
    if (!cust) return [];
    return appointments.filter(a => cust.apptIds.includes(a.id) || (a.customerId && cust.leadIds.includes(a.customerId)));
  }, [cust, appointments]);

  const custCalls = useMemo(() => {
    if (!cust) return [];
    return calls.filter(c =>
      (c.customerId && cust.leadIds.includes(c.customerId)) ||
      (c.appointmentId && cust.apptIds.includes(c.appointmentId)) ||
      (cust.phone && (c.fromNumber.includes(cust.phone) || c.toNumber.includes(cust.phone)))
    ).sort((a, b) => +new Date(b.startTime) - +new Date(a.startTime));
  }, [cust, calls]);

  const custConv = useMemo(() => {
    if (!cust) return undefined;
    return conversations.find(c =>
      (c.customerId && cust.leadIds.includes(c.customerId)) ||
      (c.phone && cust.phone && c.phone.replace(/\D/g, "") === cust.phone.replace(/\D/g, ""))
    );
  }, [cust, conversations]);

  const custNotes = useMemo(() => {
    if (!cust) return [];
    const leadIds = cust.leadIds;
    const apptIds = cust.apptIds.map(String);
    return notes.filter(n =>
      (n.notableType === "lead" && leadIds.includes(n.notableId)) ||
      (n.notableType === "appointment" && apptIds.includes(n.notableId)) ||
      (n.notableType === "customer" && n.notableId === cust.id)
    ).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [cust, notes]);

  // Unified Audit Trail for this Customer across leads, bookings and communications
  const customerAudit = useMemo(() => {
    if (!cust) return [];
    const leadIds = cust.leadIds;
    const apptIds = cust.apptIds.map(String);
    return auditLogs.filter(a =>
      (a.targetType === "lead" && leadIds.includes(a.targetId)) ||
      (a.targetType === "appointment" && apptIds.includes(a.targetId)) ||
      (a.targetType === "customer" && a.targetId === cust.id)
    ).sort((a, b) => +new Date(b.at) - +new Date(a.at));
  }, [cust, auditLogs]);

  if (!cust) {
    return (
      <div className="animate-rise">
        <EmptyState title={t("Customer not found")} hint={id} />
        <div className="text-center">
          <Btn variant="gold" onClick={() => navigate({ view: "customers" })}>{t("Customers Directory")}</Btn>
        </div>
      </div>
    );
  }

  const studio = studioById(cust.locationId);

  const dial = () => {
    if (!guard("calls.manage")) return;
    const res = logCallback({ name: cust.name, phone: cust.phone, customerId: cust.id, locationId: cust.locationId });
    toast(res === "Answered" ? tf("Callback to {name} answered", { name: cust.name }) : tf("Callback to {name} · no answer", { name: cust.name }), res === "Answered" ? "success" : "info");
  };

  const submitQuickNote = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!guard("customers.edit")) return;
    const txt = quickNote.trim();
    if (!txt) return;
    addNote("customer", cust.id, txt);
    setQuickNote("");
    toast(t("Customer note added"), "success");
  };

  return (
    <div className="space-y-4 animate-rise">
      {/* Header Profile Card */}
      <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <button
              onClick={() => navigate({ view: "customers" })}
              aria-label={t("Prev")}
              className="mt-1 rounded-lg border border-ink-600 p-2 text-ink-400 transition-colors hover:border-gold-500/60 hover:text-gold-300"
            >
              <I name="chevL" size={15} />
            </button>
            <Avatar name={cust.name} size={56} ring />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-[24px] font-bold tracking-wide text-ink-50">{cust.name}</h2>
                {cust.stage === "vip" && <Pill color="#fba200">{t("VIP Client")}</Pill>}
                {cust.stage === "completed" && <Pill color="#2fbf71">{t("Completed Tattoo")}</Pill>}
                {cust.stage === "booked" && <Pill color="#4c8dff">{t("Active Booking")}</Pill>}
                {cust.stage === "lead" && <Pill color="#948d7d">{t("Lead Inquirer")}</Pill>}
              </div>

              <div className="num mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-400">
                <span>{cust.id}</span>
                <span>·</span>
                <span>{prettyPhone(cust.phone)}</span>
                <span>·</span>
                <span>{cust.email}</span>
                <span>·</span>
                <span>{tf("first contact {ago}", { ago: timeAgo(cust.firstTouchAt) })}</span>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Pill color="#948d7d">{studio?.name ?? "—"}</Pill>
                {cust.primaryAttr && <PlatformPill p={cust.primaryAttr.platform} />}
                <Pill color="#4c8dff" dot={false}>{cust.language.toUpperCase()}</Pill>
                <Pill color="#7c4fe0" dot={false}>{cust.apptCount} {t("Bookings").toLowerCase()}</Pill>
                <Pill color="#2fbf71" dot={false}>{cust.leadCount} {t("Inquiries").toLowerCase()}</Pill>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Btn variant="outline" onClick={dial} locked={!can("calls.manage")}>
              <I name="phone" size={14} /> {t("Call")}
            </Btn>
            <Btn variant="outline" onClick={() => setSmsOpen(true)} disabled={!cust.phone} locked={!can("sms.send")}>
              <I name="chat" size={14} /> {t("Send SMS")}
            </Btn>
            {custConv && (
              <Btn variant="outline" onClick={() => navigate({ view: "sms", id: custConv.id })} locked={!can("sms.view")}>
                <I name="eye" size={14} /> {t("Thread")}
              </Btn>
            )}
            <Btn variant="gold" onClick={() => setNotesOpen(true)} locked={!can("customers.edit")}>
              <I name="note" size={14} /> {t("Notes")} <span className="num opacity-70">({custNotes.length})</span>
            </Btn>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-ink-700 pb-2">
        {[
          { key: "timeline", label: t("Lifecycle & State Audit Trail"), icon: "spark" as const, count: customerAudit.length },
          { key: "comms", label: t("Communications Hub (SMS & Calls)"), icon: "chat" as const, count: custCalls.length + (custConv?.messages.length ?? 0) },
          { key: "briefs", label: t("Inquiries & Bookings"), icon: "calendar" as const, count: custAppts.length + custLeads.length },
          { key: "attribution", label: t("Marketing & Attribution"), icon: "chart" as const },
        ].map(tb => (
          <button
            key={tb.key}
            onClick={() => setActiveTab(tb.key as typeof activeTab)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-[12.5px] font-extrabold transition-all duration-150 ${
              activeTab === tb.key
                ? "border border-gold-500/60 bg-gold-500/15 text-gold-300 shadow-sm"
                : "text-ink-400 hover:bg-ink-800 hover:text-ink-100"
            }`}
          >
            <I name={tb.icon} size={14} />
            {tb.label}
            {tb.count !== undefined && (
              <span className="num rounded-full bg-ink-800 px-2 py-0.5 text-[10px] text-ink-300">
                {tb.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* Main Content Area */}
        <div className="space-y-4 xl:col-span-3">
          {/* TAB 1: Lifecycle & State Transitions Audit Trail */}
          {activeTab === "timeline" && (
            <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
              <SectionTitle right={
                <div className="flex items-center gap-2">
                  <span className="num text-[11px] font-bold text-ink-500">{customerAudit.length} {t("audit events")}</span>
                  {customerAudit.length > 0 && (
                    <Btn size="sm" variant="outline" onClick={() => navigate({ view: "customer_subview", id: cust.id, sub: "audit" })}>
                      <I name="table" size={13} /> {t("View All in Table")}
                    </Btn>
                  )}
                </div>
              }>
                {t("Complete Lifecycle & Status Transitions")}
              </SectionTitle>

              {customerAudit.length === 0 && <div className="py-6 text-center text-[12.5px] text-ink-400">{t("No audit events recorded yet.")}</div>}

              <div className="max-h-[420px] overflow-y-auto pr-2 relative space-y-3.5 pl-6">
                <span className="absolute bottom-2 left-[11px] top-2 w-px bg-ink-700" />
                {customerAudit.map(entry => (
                  <div key={entry.id} className="relative group">
                    <span className={`absolute -left-[23px] top-1 grid h-6 w-6 place-items-center rounded-full border shadow-sm ${
                      entry.action === "status_change" ? "border-gold-500/60 bg-gold-500/20 text-gold-300" :
                      entry.action === "converted" ? "border-jade-500/60 bg-jade-500/20 text-jade-300" :
                      entry.action === "sms_sent" ? "border-lapis-500/60 bg-lapis-500/20 text-lapis-300" :
                      "border-ink-500/60 bg-ink-800 text-ink-300"
                    }`}>
                      <I name={entry.action === "status_change" ? "spark" : entry.action === "converted" ? "convert" : entry.action === "sms_sent" ? "chat" : "checks"} size={11} />
                    </span>

                    <div className="rounded-xl border border-ink-750 bg-ink-850 p-3.5 transition-colors hover:border-ink-600">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[12.5px] font-extrabold text-ink-100">
                            {entry.action === "status_change" ? t("Status Transition") :
                             entry.action === "converted" ? t("Converted to Booking") :
                             entry.action === "created" ? t("Record Created") :
                             entry.action === "sms_sent" ? t("SMS Dispatched") :
                             entry.action}
                          </span>
                          <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[9.5px] font-extrabold text-ink-400">
                            {entry.targetType.toUpperCase()} #{entry.targetId}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 text-[11px] font-bold">
                          <span className="text-gold-400">👤 {entry.actor}</span>
                          {entry.actorRole && <span className="text-ink-500">({entry.actorRole})</span>}
                        </div>
                      </div>

                      {entry.fromStatus && entry.toStatus && (
                        <div className="mt-2 flex items-center gap-2 text-[12px] font-bold">
                          <span className="rounded-md bg-ink-800 px-2 py-0.5 text-ink-400">{t(entry.fromStatus)}</span>
                          <span className="text-gold-400">➔</span>
                          <span className="rounded-md bg-gold-500/15 px-2 py-0.5 text-gold-300">{t(entry.toStatus)}</span>
                        </div>
                      )}

                      {entry.details && (
                        <p className="mt-1.5 text-[11.5px] font-medium leading-relaxed text-ink-300">
                          {entry.details}
                        </p>
                      )}

                      <div className="num mt-2 text-[10px] font-semibold text-ink-500">
                        {fmtDT(entry.at)} · {timeAgo(entry.at)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: Communications Hub (SMS & Calls) */}
          {activeTab === "comms" && (
            <div className="space-y-4">
              {/* Calls Box */}
              <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
                <SectionTitle right={
                  <div className="flex items-center gap-2">
                    <span className="num text-[11px] font-bold text-ink-500">{custCalls.length} {t("calls")}</span>
                    {custCalls.length > 0 && (
                      <Btn size="sm" variant="outline" onClick={() => navigate({ view: "customer_subview", id: cust.id, sub: "calls" })} locked={!can("calls.view")}>
                        <I name="table" size={13} /> {t("View All in Table")}
                      </Btn>
                    )}
                  </div>
                }>
                  {t("Telephony & Call Records (Vonage VBC)")}
                </SectionTitle>
                <div className="max-h-[380px] overflow-y-auto pr-1 divide-y divide-ink-750">
                  {custCalls.map(c => (
                    <div key={c.id} className="row-live flex items-center gap-3 py-3">
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${
                        c.direction === "inbound" ? "border-jade-500/40 bg-jade-500/10 text-jade-400" : "border-lapis-500/40 bg-lapis-500/10 text-lapis-400"
                      }`}>
                        <I name="phone" size={13} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="num block text-[12.5px] font-extrabold text-ink-100">
                          {c.direction === "inbound" ? `${c.fromNumber} ➔ #${c.ext}` : `#${c.ext} ➔ ${c.toNumber}`}
                        </span>
                        <span className="block text-[11px] font-semibold text-ink-400">
                          {t(c.direction)} · {c.agent} · {fmtDT(c.startTime)}
                        </span>
                      </span>
                      {c.duration > 0 && <span className="num text-[11.5px] font-bold text-ink-300">{fmtDur(c.duration)}</span>}
                      <Pill color={c.result === "Answered" ? "#2fbf71" : c.result === "Missed" ? "#e5484d" : "#e8a33d"}>{t(c.result)}</Pill>
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
                  {custCalls.length === 0 && <div className="py-4 text-[12px] text-ink-400">{t("No call history logged.")}</div>}
                </div>
              </div>

              {/* SMS Messages Box */}
              <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
                <SectionTitle right={
                  <div className="flex items-center gap-2">
                    <span className="num text-[11px] font-bold text-ink-500">{custConv?.messages.length ?? 0} {t("messages")}</span>
                    {custConv && (
                      <Btn size="sm" variant="outline" onClick={() => navigate({ view: "sms", id: custConv.id })} locked={!can("sms.view")}>
                        <I name="chat" size={13} /> {t("Open Messenger")}
                      </Btn>
                    )}
                  </div>
                }>
                  {t("SMS Messaging History (Twilio 10DLC)")}
                </SectionTitle>
                <div className="max-h-[380px] overflow-y-auto pr-1 space-y-3">
                  {custConv?.messages.map((m, idx) => (
                    <div key={idx} className={`flex flex-col ${m.direction === "outbound" ? "items-end" : "items-start"}`}>
                      <div className="flex items-center gap-1.5 pb-1 text-[10px] font-extrabold text-ink-500">
                        {m.direction === "outbound" ? (
                          <>
                            <span className="rounded bg-gold-500/15 px-1 text-gold-300">
                              {m.senderType === "system" ? "🤖 SYSTEM" : `👤 ${m.senderName ?? "Agent"}`}
                            </span>
                            <span>· {m.fromNumber}</span>
                          </>
                        ) : (
                          <span>{cust.name} ({cust.phone})</span>
                        )}
                      </div>
                      <div className={`max-w-md rounded-2xl p-3 text-[12px] font-semibold leading-relaxed shadow-sm ${
                        m.direction === "outbound"
                          ? "border border-gold-500/40 bg-gold-500/10 text-gold-100 rounded-tr-none"
                          : "border border-ink-700 bg-ink-850 text-ink-100 rounded-tl-none"
                      }`}>
                        {m.body}
                      </div>
                      <div className="num pt-1 text-[9.5px] text-ink-500">
                        {timeAgo(m.at)} · {fmtDT(m.at)} · <span className="uppercase">{m.status}</span>
                      </div>
                    </div>
                  ))}
                  {(!custConv || custConv.messages.length === 0) && (
                    <div className="py-4 text-center text-[12px] text-ink-400">{t("No SMS messages on file.")}</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Inquiries & Bookings */}
          {activeTab === "briefs" && (
            <div className="space-y-4">
              {/* Appointments */}
              <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
                <SectionTitle right={
                  (custAppts.length > 0 || custLeads.length > 0) ? (
                    <Btn size="sm" variant="outline" onClick={() => navigate({ view: "customer_subview", id: cust.id, sub: "briefs" })}>
                      <I name="table" size={13} /> {t("View All in Table")}
                    </Btn>
                  ) : undefined
                }>
                  {t("Studio Appointments")}
                </SectionTitle>
                <div className="max-h-[340px] overflow-y-auto pr-1 grid grid-cols-1 gap-3 md:grid-cols-2">
                  {custAppts.map(a => (
                    <button
                      key={a.id}
                      onClick={() => navigate({ view: "appointment", id: a.id })}
                      className="rounded-xl border border-ink-700 bg-ink-850 p-4 text-left transition-all hover:border-gold-500/60"
                    >
                      <div className="flex items-center justify-between">
                        <span className="num text-[13px] font-extrabold text-ink-100">{a.uuid}</span>
                        <ApptStatusPill s={a.status} />
                      </div>
                      <div className="num mt-2 text-[12.5px] font-bold text-jade-400">{fmtDT(a.preferredDate)} · {a.preferredTime}</div>
                      <div className="mt-1 text-[11.5px] font-semibold text-ink-300">{a.purpose} · {a.style}</div>
                    </button>
                  ))}
                  {custAppts.length === 0 && <div className="col-span-2 py-4 text-[12px] text-ink-400">{t("No studio bookings found.")}</div>}
                </div>
              </div>

              {/* Leads */}
              <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
                <SectionTitle>{t("Web / Ad Inquiries")}</SectionTitle>
                <div className="max-h-[340px] overflow-y-auto pr-1 grid grid-cols-1 gap-3 md:grid-cols-2">
                  {custLeads.map(l => (
                    <button
                      key={l.id}
                      onClick={() => navigate({ view: "lead", id: l.id })}
                      className="rounded-xl border border-ink-700 bg-ink-850 p-4 text-left transition-all hover:border-gold-500/60"
                    >
                      <div className="flex items-center justify-between">
                        <span className="num text-[12.5px] font-extrabold text-ink-100">{l.id}</span>
                        <CallStatusPill s={l.callStatus} />
                      </div>
                      <div className="mt-1 text-[12px] font-bold text-ink-200">{l.meta.purpose} · {l.meta.style}</div>
                      <div className="num mt-1 text-[10.5px] text-ink-400">{fmtDT(l.createdAt)} · {l.attr.platform.toUpperCase()}</div>
                    </button>
                  ))}
                  {custLeads.length === 0 && <div className="col-span-2 py-4 text-[12px] text-ink-400">{t("No lead inquiries found.")}</div>}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Marketing & Attribution */}
          {activeTab === "attribution" && (
            <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
              <SectionTitle>{t("Acquisition & Marketing Attribution")}</SectionTitle>
              {cust.primaryAttr ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {[
                    ["Platform", cust.primaryAttr.platform.toUpperCase()],
                    ["UTM Campaign", cust.primaryAttr.utmCampaign ?? "—"],
                    ["UTM Medium", cust.primaryAttr.utmMedium ?? "—"],
                    ["UTM Source", cust.primaryAttr.utmSource ?? "—"],
                    ["gclid (Google)", cust.primaryAttr.gclid ?? "—"],
                    ["fbclid (Meta)", cust.primaryAttr.fbclid ?? "—"],
                    ["ttclid (TikTok)", cust.primaryAttr.ttclid ?? "—"],
                    ["Landing Page", cust.primaryAttr.landingPage || "—"],
                  ].map(([label, val]) => (
                    <div key={label} className="rounded-xl border border-ink-700 bg-ink-850 p-3">
                      <div className="text-[10px] font-extrabold uppercase tracking-wider text-ink-500">{t(label)}</div>
                      <div className="num mt-1 truncate text-[12.5px] font-bold text-ink-100">{val}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-4 text-[12px] text-ink-400">{t("No marketing attribution data available.")}</div>
              )}
            </div>
          )}
        </div>

        {/* Right Sidebar Column: Notes & Quick Info */}
        <div className="space-y-4 xl:col-span-2">
          {/* Quick Metrics */}
          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle>{t("Lifetime Touchpoints")}</SectionTitle>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
                <div className="text-[10px] font-extrabold uppercase text-ink-500">{t("Total Bookings")}</div>
                <div className="num mt-1 text-[20px] font-extrabold text-jade-400">{cust.apptCount}</div>
              </div>
              <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
                <div className="text-[10px] font-extrabold uppercase text-ink-500">{t("Total Inquiries")}</div>
                <div className="num mt-1 text-[20px] font-extrabold text-gold-400">{cust.leadCount}</div>
              </div>
              <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
                <div className="text-[10px] font-extrabold uppercase text-ink-500">{t("Phone Calls")}</div>
                <div className="num mt-1 text-[20px] font-extrabold text-lapis-400">{cust.totalCalls}</div>
              </div>
              <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
                <div className="text-[10px] font-extrabold uppercase text-ink-500">{t("SMS Messages")}</div>
                <div className="num mt-1 text-[20px] font-extrabold text-ink-100">{cust.totalSms}</div>
              </div>
            </div>
          </div>

          {/* Staff Notes & Composer */}
          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle right={
              <div className="flex items-center gap-1.5">
                <span className="num text-[11px] font-bold text-ink-500">{custNotes.length}</span>
                {custNotes.length > 0 && (
                  <Btn size="sm" variant="outline" onClick={() => navigate({ view: "customer_subview", id: cust.id, sub: "notes" })}>
                    <I name="table" size={13} /> {t("View All in Table")}
                  </Btn>
                )}
              </div>
            }>
              {t("Staff Collaboration Notes")}
            </SectionTitle>

            <form onSubmit={submitQuickNote} className="mb-3 space-y-2">
              <textarea
                value={quickNote}
                onChange={e => setQuickNote(e.target.value)}
                placeholder={can("customers.edit") ? t("Add a note about this customer…") : `${t("locked")} · customers.edit`}
                disabled={!can("customers.edit")}
                rows={2}
                className="w-full resize-none rounded-xl border border-ink-700 bg-ink-900/80 px-3 py-2 text-[12px] font-medium text-ink-100 placeholder:text-ink-500 focus:border-gold-500/60 focus:outline-none focus:ring-1 focus:ring-gold-500/30 disabled:opacity-50"
              />
              <div className="flex justify-end">
                <Btn size="sm" variant="gold" locked={!can("customers.edit")} disabled={!quickNote.trim()}>
                  <I name="check" size={12} /> {t("Add note")}
                </Btn>
              </div>
            </form>

            <div className="max-h-[320px] overflow-y-auto pr-1 space-y-2.5">
              {custNotes.map(n => (
                <div key={n.id} className="rounded-xl border border-ink-700 bg-ink-850 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10.5px] font-extrabold text-gold-300">{n.author}</span>
                    <span className="num text-[10px] text-ink-500">{timeAgo(n.createdAt)}</span>
                  </div>
                  <p className="text-[12px] font-semibold leading-relaxed text-ink-200">{n.content}</p>
                </div>
              ))}
              {custNotes.length === 0 && <div className="py-2 text-[12px] text-ink-400">{t("No notes on file.")}</div>}
            </div>
          </div>
        </div>
      </div>

      {smsOpen && (
        <SmsCompose
          leadId={cust.leadIds[0]}
          phone={cust.phone}
          name={cust.name}
          locationId={cust.locationId}
          onClose={() => setSmsOpen(false)}
          openThread={cid => navigate({ view: "sms", id: cid })}
        />
      )}
      {notesOpen && (
        <NotesDrawer type="customer" id={cust.id} title={cust.name} onClose={() => setNotesOpen(false)} />
      )}
      {play && (
        <PlayerModal title={cust.name} subtitle={`${play.ext} · ${fmtDT(play.startTime)}`} onClose={() => setPlay(null)} />
      )}
    </div>
  );
}
