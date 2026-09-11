"use client";

import { useMemo, useState } from "react";
import { useStore } from "../store";
import {
  Avatar, ApptStatusPill, Btn, CallStatusPill, Dropdown, EmptyState, I, Pill,
  PlatformPill, PlayerModal, SectionTitle,
} from "../ui";
import {
  CALL_STATUS_META, APPT_STATUS_META, fmtDT, fmtDur, fmtD, prettyPhone,
  studioById, timeAgo, type CallLog, type Appointment, type Lead, type AuditLog, type Note,
} from "../data";
import { t, tf, useI18n } from "../i18n";
import { SmsCompose } from "./Leads";

export default function EntitySubView({
  entityType,
  id,
  sub,
}: {
  entityType: "customer" | "lead" | "appointment";
  id: string | number;
  sub: "calls" | "audit" | "notes" | "briefs";
}) {
  const {
    customerById, leads, appointments, calls, notes, auditLogs,
    navigate, toast, logCallback, addNote, can, guard,
  } = useStore();
  useI18n();

  const [q, setQ] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterDirection, setFilterDirection] = useState<string>("all");
  const [sortKey, setSortKey] = useState<string>("date");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [play, setPlay] = useState<CallLog | null>(null);
  const [smsOpen, setSmsOpen] = useState(false);
  const [newNoteText, setNewNoteText] = useState("");

  // Resolve parent entity
  const cust = entityType === "customer" ? customerById(String(id)) : null;
  const lead = entityType === "lead" ? leads.find(l => l.id === String(id)) : null;
  const appt = entityType === "appointment" ? appointments.find(a => a.id === Number(id)) : null;

  const parentName = cust?.name ?? lead?.name ?? appt?.name ?? String(id);
  const parentPhone = cust?.phone ?? lead?.formattedPhone ?? appt?.formattedPhone ?? "";
  const parentEmail = cust?.email ?? lead?.email ?? appt?.email ?? "";
  const parentLocationId = cust?.locationId ?? lead?.locationId ?? appt?.locationId ?? 1;
  const studio = studioById(parentLocationId);

  // Associated calls
  const entityCalls = useMemo<CallLog[]>(() => {
    if (entityType === "customer" && cust) {
      return calls.filter(c =>
        (c.customerId && cust.leadIds.includes(c.customerId)) ||
        (c.appointmentId && cust.apptIds.includes(c.appointmentId)) ||
        (cust.phone && (c.fromNumber.includes(cust.phone) || c.toNumber.includes(cust.phone)))
      );
    }
    if (entityType === "lead" && lead) {
      return calls.filter(c => c.customerId === lead.id || (lead.formattedPhone && (c.fromNumber.includes(lead.formattedPhone) || c.toNumber.includes(lead.formattedPhone))));
    }
    if (entityType === "appointment" && appt) {
      return calls.filter(c => c.appointmentId === appt.id || (appt.customerId && c.customerId === appt.customerId) || (appt.formattedPhone && (c.fromNumber.includes(appt.formattedPhone) || c.toNumber.includes(appt.formattedPhone))));
    }
    return [];
  }, [entityType, cust, lead, appt, calls]);

  // Associated audit logs
  const entityAudits = useMemo<AuditLog[]>(() => {
    if (entityType === "customer" && cust) {
      const leadIds = cust.leadIds;
      const apptIds = cust.apptIds.map(String);
      return auditLogs.filter(a =>
        (a.targetType === "lead" && leadIds.includes(a.targetId)) ||
        (a.targetType === "appointment" && apptIds.includes(a.targetId)) ||
        (a.targetType === "customer" && a.targetId === cust.id)
      );
    }
    if (entityType === "lead" && lead) {
      return auditLogs.filter(a => a.targetType === "lead" && a.targetId === lead.id);
    }
    if (entityType === "appointment" && appt) {
      return auditLogs.filter(a => a.targetType === "appointment" && a.targetId === String(appt.id));
    }
    return [];
  }, [entityType, cust, lead, appt, auditLogs]);

  // Associated notes
  const entityNotes = useMemo<Note[]>(() => {
    if (entityType === "customer" && cust) {
      const leadIds = cust.leadIds;
      const apptIds = cust.apptIds.map(String);
      return notes.filter(n =>
        (n.notableType === "lead" && leadIds.includes(n.notableId)) ||
        (n.notableType === "appointment" && apptIds.includes(n.notableId)) ||
        (n.notableType === "customer" && n.notableId === cust.id)
      );
    }
    if (entityType === "lead" && lead) {
      return notes.filter(n => n.notableType === "lead" && n.notableId === lead.id);
    }
    if (entityType === "appointment" && appt) {
      return notes.filter(n => n.notableType === "appointment" && n.notableId === String(appt.id));
    }
    return [];
  }, [entityType, cust, lead, appt, notes]);

  // Associated briefs (leads & appointments for customer)
  const entityBriefs = useMemo(() => {
    if (entityType !== "customer" || !cust) return [];
    const items: Array<{
      id: string;
      kind: "lead" | "appointment";
      rawId: string | number;
      title: string;
      status: string;
      style: string;
      purpose: string;
      date: string;
      platform?: string;
    }> = [];
    appointments.filter(a => cust.apptIds.includes(a.id) || (a.customerId && cust.leadIds.includes(a.customerId))).forEach(a => {
      items.push({
        id: `appt-${a.id}`,
        kind: "appointment",
        rawId: a.id,
        title: a.uuid,
        status: a.status,
        style: a.style,
        purpose: a.purpose,
        date: a.preferredDate,
        platform: a.platform,
      });
    });
    leads.filter(l => cust.leadIds.includes(l.id) || (cust.phone && l.formattedPhone.replace(/\D/g, "") === cust.phone.replace(/\D/g, ""))).forEach(l => {
      items.push({
        id: `lead-${l.id}`,
        kind: "lead",
        rawId: l.id,
        title: l.id,
        status: l.callStatus,
        style: l.meta.style,
        purpose: l.meta.purpose,
        date: l.createdAt,
        platform: l.attr.platform,
      });
    });
    return items;
  }, [entityType, cust, appointments, leads]);

  const goBack = () => {
    if (entityType === "customer") navigate({ view: "customer", id: String(id) });
    else if (entityType === "lead") navigate({ view: "lead", id: String(id) });
    else if (entityType === "appointment") navigate({ view: "appointment", id: Number(id) });
  };

  const dial = () => {
    if (!guard("calls.manage")) return;
    const res = logCallback({ name: parentName, phone: parentPhone, customerId: String(id), locationId: parentLocationId });
    toast(res === "Answered" ? tf("Callback to {name} answered", { name: parentName }) : tf("Callback to {name} · no answer", { name: parentName }), res === "Answered" ? "success" : "info");
  };

  const submitNote = (e: React.FormEvent) => {
    e.preventDefault();
    const txt = newNoteText.trim();
    if (!txt) return;
    const targetType = entityType === "customer" ? "customer" : entityType === "lead" ? "lead" : "appointment";
    addNote(targetType, String(id), txt);
    setNewNoteText("");
    toast(t("Note added"), "success");
  };

  // Subtitle / Page Title
  const subTitle =
    sub === "calls" ? t("Telephony & Call Records (Vonage VBC)") :
    sub === "audit" ? t("Complete Lifecycle & Status Transitions") :
    sub === "notes" ? t("Staff Collaboration Notes") :
    t("Inquiries & Bookings");

  // Filtered Calls
  const filteredCalls = useMemo(() => {
    const query = q.trim().toLowerCase();
    return entityCalls.filter(c => {
      const matchQ = !query ||
        c.fromName.toLowerCase().includes(query) ||
        c.toName.toLowerCase().includes(query) ||
        c.fromNumber.includes(query) ||
        c.toNumber.includes(query) ||
        c.agent.toLowerCase().includes(query) ||
        c.ext.includes(query);
      const matchCat = filterCategory === "all" || c.result.toLowerCase() === filterCategory.toLowerCase();
      const matchDir = filterDirection === "all" || c.direction === filterDirection;
      return matchQ && matchCat && matchDir;
    }).sort((a, b) => {
      if (sortKey === "duration") return sortDir * (a.duration - b.duration);
      return sortDir * (+new Date(a.startTime) - +new Date(b.startTime));
    });
  }, [entityCalls, q, filterCategory, filterDirection, sortKey, sortDir]);

  // Filtered Audit Logs
  const filteredAudits = useMemo(() => {
    const query = q.trim().toLowerCase();
    return entityAudits.filter(a => {
      const matchQ = !query ||
        a.actor.toLowerCase().includes(query) ||
        (a.details && a.details.toLowerCase().includes(query)) ||
        a.action.toLowerCase().includes(query) ||
        a.targetId.toLowerCase().includes(query);
      const matchCat = filterCategory === "all" || a.action === filterCategory;
      return matchQ && matchCat;
    }).sort((a, b) => sortDir * (+new Date(a.at) - +new Date(b.at)));
  }, [entityAudits, q, filterCategory, sortDir]);

  // Filtered Notes
  const filteredNotes = useMemo(() => {
    const query = q.trim().toLowerCase();
    return entityNotes.filter(n => {
      return !query || n.author.toLowerCase().includes(query) || n.content.toLowerCase().includes(query);
    }).sort((a, b) => sortDir * (+new Date(a.createdAt) - +new Date(b.createdAt)));
  }, [entityNotes, q, sortDir]);

  // Filtered Briefs
  const filteredBriefs = useMemo(() => {
    const query = q.trim().toLowerCase();
    return entityBriefs.filter(b => {
      const matchQ = !query || b.title.toLowerCase().includes(query) || b.style.toLowerCase().includes(query) || b.purpose.toLowerCase().includes(query);
      const matchCat = filterCategory === "all" || b.kind === filterCategory;
      return matchQ && matchCat;
    }).sort((a, b) => sortDir * (+new Date(a.date) - +new Date(b.date)));
  }, [entityBriefs, q, filterCategory, sortDir]);

  // Export CSV
  const exportCsv = () => {
    if (sub === "calls") {
      const rows = [
        ["ID", "Direction", "From Name", "From Number", "To Name", "To Number", "Agent", "Ext", "Duration Sec", "Result", "Start Time"],
        ...filteredCalls.map(c => [c.id, c.direction, c.fromName, c.fromNumber, c.toName, c.toNumber, c.agent, c.ext, c.duration, c.result, c.startTime]),
      ];
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a"); a.href = url; a.download = `${entityType}-${id}-calls.csv`; a.click();
      URL.revokeObjectURL(url);
      toast(tf("Exported {n} calls to CSV", { n: filteredCalls.length }), "info");
    } else if (sub === "audit") {
      const rows = [
        ["ID", "Timestamp", "Actor", "Actor Role", "Target Type", "Target ID", "Action", "From Status", "To Status", "Details"],
        ...filteredAudits.map(a => [a.id, a.at, a.actor, a.actorRole ?? "", a.targetType, a.targetId, a.action, a.fromStatus ?? "", a.toStatus ?? "", a.details ?? ""]),
      ];
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a"); a.href = url; a.download = `${entityType}-${id}-audit.csv`; a.click();
      URL.revokeObjectURL(url);
      toast(tf("Exported {n} audit logs to CSV", { n: filteredAudits.length }), "info");
    } else if (sub === "notes") {
      const rows = [
        ["ID", "Created", "Author", "Target Type", "Target ID", "Content"],
        ...filteredNotes.map(n => [n.id, n.createdAt, n.author, n.notableType, n.notableId, n.content]),
      ];
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a"); a.href = url; a.download = `${entityType}-${id}-notes.csv`; a.click();
      URL.revokeObjectURL(url);
      toast(tf("Exported {n} notes to CSV", { n: filteredNotes.length }), "info");
    }
  };

  const totalCount =
    sub === "calls" ? filteredCalls.length :
    sub === "audit" ? filteredAudits.length :
    sub === "notes" ? filteredNotes.length :
    filteredBriefs.length;

  const pagedItems = useMemo(() => {
    const start = page * pageSize;
    const end = start + pageSize;
    if (sub === "calls") return filteredCalls.slice(start, end);
    if (sub === "audit") return filteredAudits.slice(start, end);
    if (sub === "notes") return filteredNotes.slice(start, end);
    return filteredBriefs.slice(start, end);
  }, [sub, filteredCalls, filteredAudits, filteredNotes, filteredBriefs, page, pageSize]);

  return (
    <div className="space-y-4 animate-rise">
      {/* Header Bar */}
      <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <button
              onClick={goBack}
              aria-label={t("Back")}
              className="mt-1 rounded-lg border border-ink-600 p-2 text-ink-400 transition-colors hover:border-gold-500/60 hover:text-gold-300"
            >
              <I name="chevL" size={16} />
            </button>
            <Avatar name={parentName} size={50} ring />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-[22px] font-bold tracking-wide text-ink-50">{subTitle}</h1>
                <Pill color="#fba200" dot={false}>{totalCount} {t("records")}</Pill>
              </div>
              <div className="num mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-400">
                <span className="font-extrabold text-ink-200">{parentName}</span>
                <span>·</span>
                <span>{String(id)}</span>
                {parentPhone && (
                  <>
                    <span>·</span>
                    <span>{prettyPhone(parentPhone)}</span>
                  </>
                )}
                <span>·</span>
                <span>{studio?.name ?? "Cleopatra Ink"}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {parentPhone && (
              <>
                <Btn variant="outline" onClick={dial} locked={!can("calls.manage")}>
                  <I name="phone" size={14} /> {t("Call")}
                </Btn>
                <Btn variant="outline" onClick={() => setSmsOpen(true)} locked={!can("sms.send")}>
                  <I name="chat" size={14} /> {t("Send SMS")}
                </Btn>
              </>
            )}
            <Btn variant="gold" onClick={exportCsv}>
              <I name="download" size={14} /> {t("Export CSV")}
            </Btn>
            <Btn variant="outline" onClick={goBack}>
              <I name="chevL" size={14} /> {t("Back to Profile")}
            </Btn>
          </div>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="rounded-2xl border border-ink-700 bg-ink-875 p-4 shadow-panel">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <I name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              value={q}
              onChange={e => { setQ(e.target.value); setPage(0); }}
              placeholder={t("Search table records…")}
              className="w-full rounded-xl border border-ink-700 bg-ink-900 py-2 pl-9 pr-3 text-[12.5px] font-semibold text-ink-100 placeholder:text-ink-500 focus:border-gold-500/60 focus:outline-none"
            />
          </div>

          {sub === "calls" && (
            <>
              <div className="flex items-center gap-1">
                {(["all", "inbound", "outbound"] as const).map(d => (
                  <button
                    key={d}
                    onClick={() => { setFilterDirection(d); setPage(0); }}
                    className={`rounded-lg px-3 py-1.5 text-[11.5px] font-bold transition-all ${
                      filterDirection === d
                        ? "bg-gold-500/20 text-gold-300 border border-gold-500/60"
                        : "bg-ink-800 text-ink-400 hover:text-ink-200"
                    }`}
                  >
                    {t(d)}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1">
                {(["all", "Answered", "Missed", "Voicemail", "Attempted"] as const).map(res => (
                  <button
                    key={res}
                    onClick={() => { setFilterCategory(res); setPage(0); }}
                    className={`rounded-lg px-3 py-1.5 text-[11.5px] font-bold transition-all ${
                      filterCategory === res
                        ? "bg-gold-500/20 text-gold-300 border border-gold-500/60"
                        : "bg-ink-800 text-ink-400 hover:text-ink-200"
                    }`}
                  >
                    {t(res)}
                  </button>
                ))}
              </div>
            </>
          )}

          {sub === "audit" && (
            <div className="flex items-center gap-1">
              {(["all", "status_change", "converted", "sms_sent", "note_added", "call_logged"] as const).map(act => (
                <button
                  key={act}
                  onClick={() => { setFilterCategory(act); setPage(0); }}
                  className={`rounded-lg px-3 py-1.5 text-[11.5px] font-bold transition-all ${
                    filterCategory === act
                      ? "bg-gold-500/20 text-gold-300 border border-gold-500/60"
                      : "bg-ink-800 text-ink-400 hover:text-ink-200"
                  }`}
                >
                  {act === "all" ? t("All") :
                   act === "status_change" ? t("Status Transition") :
                   act === "converted" ? t("Converted") :
                   act === "sms_sent" ? t("SMS Sent") :
                   act === "note_added" ? t("Note Added") :
                   t("Call Logged")}
                </button>
              ))}
            </div>
          )}

          {sub === "briefs" && (
            <div className="flex items-center gap-1">
              {(["all", "appointment", "lead"] as const).map(k => (
                <button
                  key={k}
                  onClick={() => { setFilterCategory(k); setPage(0); }}
                  className={`rounded-lg px-3 py-1.5 text-[11.5px] font-bold transition-all ${
                    filterCategory === k
                      ? "bg-gold-500/20 text-gold-300 border border-gold-500/60"
                      : "bg-ink-800 text-ink-400 hover:text-ink-200"
                  }`}
                >
                  {k === "all" ? t("All") : k === "appointment" ? t("Bookings") : t("Leads")}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Notes Composer (if on notes subview) */}
      {sub === "notes" && (
        <div className="rounded-2xl border border-ink-700 bg-ink-875 p-4 shadow-panel">
          <SectionTitle>{t("Add Collaboration Note")}</SectionTitle>
          <form onSubmit={submitNote} className="space-y-2">
            <textarea
              value={newNoteText}
              onChange={e => setNewNoteText(e.target.value)}
              placeholder={t("Write an internal note…")}
              rows={2}
              className="w-full resize-none rounded-xl border border-ink-700 bg-ink-900/80 px-3 py-2 text-[12px] font-medium text-ink-100 placeholder:text-ink-500 focus:border-gold-500/60 focus:outline-none focus:ring-1 focus:ring-gold-500/30"
            />
            <div className="flex justify-end">
              <Btn size="sm" variant="gold" disabled={!newNoteText.trim()}>
                <I name="check" size={12} /> {t("Add note")}
              </Btn>
            </div>
          </form>
        </div>
      )}

      {/* Main Full Table */}
      <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
        <div className="overflow-x-auto">
          {sub === "calls" && (
            <table className="w-full min-w-[960px] border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-700 bg-ink-850">
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Direction")}</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Caller / Line")}</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Target Number")}</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Agent / Ext")}</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Duration")}</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Result")}</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Start Time")}</th>
                  <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Action")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-750">
                {(pagedItems as CallLog[]).map(c => (
                  <tr key={c.id} className="row-live">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-extrabold ${
                        c.direction === "inbound" ? "bg-jade-500/15 text-jade-300" : "bg-lapis-500/15 text-lapis-300"
                      }`}>
                        <I name="phone" size={11} /> {t(c.direction)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="num text-[12.5px] font-extrabold text-ink-100">{c.fromName}</div>
                      <div className="num text-[11px] text-ink-500">{c.fromNumber}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="num text-[12.5px] font-extrabold text-ink-100">{c.toName}</div>
                      <div className="num text-[11px] text-ink-500">{c.toNumber}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[12px] font-bold text-ink-200">{c.agent}</span>
                      <span className="num ml-1 text-[11px] text-ink-500">(#{c.ext})</span>
                    </td>
                    <td className="px-4 py-3 num text-[12px] font-bold text-ink-300">
                      {c.duration > 0 ? fmtDur(c.duration) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Pill color={c.result === "Answered" ? "#2fbf71" : c.result === "Missed" ? "#e5484d" : "#e8a33d"}>{t(c.result)}</Pill>
                    </td>
                    <td className="px-4 py-3">
                      <div className="num text-[11.5px] font-bold text-ink-200">{fmtDT(c.startTime)}</div>
                      <div className="num text-[10px] text-ink-500">{timeAgo(c.startTime)}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.hasRecording && (
                        <Btn size="sm" variant="ghost" title={t("Listen")} locked={!can("calls.view")} onClick={() => {
                          if (!guard("calls.view")) return;
                          setPlay(c);
                        }}>
                          <I name="play" size={13} />
                        </Btn>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {sub === "audit" && (
            <table className="w-full min-w-[960px] border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-700 bg-ink-850">
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Timestamp")}</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Action")}</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Actor")}</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Target")}</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("State Transition")}</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Details")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-750">
                {(pagedItems as AuditLog[]).map(a => (
                  <tr key={a.id} className="row-live">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="num text-[11.5px] font-bold text-ink-200">{fmtDT(a.at)}</div>
                      <div className="num text-[10px] text-ink-500">{timeAgo(a.at)}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-extrabold ${
                        a.action === "status_change" ? "bg-gold-500/15 text-gold-300" :
                        a.action === "converted" ? "bg-jade-500/15 text-jade-300" :
                        a.action === "sms_sent" ? "bg-lapis-500/15 text-lapis-300" :
                        "bg-ink-800 text-ink-300"
                      }`}>
                        {a.action === "status_change" ? t("Status Transition") :
                         a.action === "converted" ? t("Converted") :
                         a.action === "created" ? t("Created") :
                         a.action === "sms_sent" ? t("SMS Sent") :
                         a.action === "note_added" ? t("Note Added") :
                         a.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-[12px] font-bold text-gold-300">👤 {a.actor}</span>
                      {a.actorRole && <span className="ml-1 text-[10.5px] text-ink-500">({a.actorRole})</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] font-extrabold text-ink-400 uppercase">
                        {a.targetType} #{a.targetId}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {a.fromStatus && a.toStatus ? (
                        <div className="flex items-center gap-1.5 text-[11.5px] font-bold">
                          <span className="rounded bg-ink-800 px-2 py-0.5 text-ink-400">{t(a.fromStatus)}</span>
                          <span className="text-gold-400">➔</span>
                          <span className="rounded bg-gold-500/15 px-2 py-0.5 text-gold-300">{t(a.toStatus)}</span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-ink-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-ink-300">
                      {a.details || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {sub === "notes" && (
            <table className="w-full min-w-[800px] border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-700 bg-ink-850">
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Author")}</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Target")}</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Date")}</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Note Content")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-750">
                {(pagedItems as Note[]).map(n => (
                  <tr key={n.id} className="row-live">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-[12.5px] font-extrabold text-gold-300">{n.author}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] font-extrabold text-ink-400 uppercase">
                        {n.notableType} #{n.notableId}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="num text-[11.5px] font-bold text-ink-200">{fmtDT(n.createdAt)}</div>
                      <div className="num text-[10px] text-ink-500">{timeAgo(n.createdAt)}</div>
                    </td>
                    <td className="px-4 py-3 text-[12.5px] font-semibold text-ink-100">
                      {n.content}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {sub === "briefs" && (
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-700 bg-ink-850">
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Type")}</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Reference")}</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Status")}</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Style & Purpose")}</th>
                  <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Date / Slot")}</th>
                  <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-750">
                {(pagedItems as any[]).map(b => (
                  <tr
                    key={b.id}
                    onClick={() => {
                      if (b.kind === "appointment") navigate({ view: "appointment", id: Number(b.rawId) });
                      else navigate({ view: "lead", id: String(b.rawId) });
                    }}
                    className="row-live group cursor-pointer"
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-extrabold ${
                        b.kind === "appointment" ? "bg-jade-500/15 text-jade-300" : "bg-gold-500/15 text-gold-300"
                      }`}>
                        <I name={b.kind === "appointment" ? "calendar" : "leads"} size={11} />
                        {b.kind === "appointment" ? t("Booking") : t("Web Lead")}
                      </span>
                    </td>
                    <td className="px-4 py-3 num text-[13px] font-extrabold text-ink-100 group-hover:text-gold-300 transition-colors">
                      {b.title}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {b.kind === "appointment" ? <ApptStatusPill s={b.status as any} /> : <CallStatusPill s={b.status as any} />}
                    </td>
                    <td className="px-4 py-3 text-[12px] font-semibold text-ink-200">
                      {b.purpose} · {b.style}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="num text-[11.5px] font-bold text-ink-200">{fmtDT(b.date)}</div>
                      <div className="num text-[10px] text-ink-500">{timeAgo(b.date)}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex items-center gap-1 text-[12px] font-bold text-gold-400 group-hover:translate-x-0.5 transition-transform">
                        {t("View")} <I name="chevR" size={11} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {totalCount === 0 && (
            <div className="py-12 text-center text-[13px] text-ink-400">
              {t("No records match this filter.")}
            </div>
          )}
        </div>

        {/* Pagination Bar */}
        {totalCount > pageSize && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-700 bg-ink-850 px-5 py-3">
            <span className="num text-[12px] font-bold text-ink-400">
              {page * pageSize + 1}–{Math.min(totalCount, (page + 1) * pageSize)} / {totalCount}
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                className="rounded-lg border border-ink-600 px-3 py-1.5 text-[12px] font-bold text-ink-300 transition-colors hover:border-gold-500/60 disabled:opacity-40"
              >
                {t("Prev")}
              </button>
              <button
                disabled={(page + 1) * pageSize >= totalCount}
                onClick={() => setPage(p => p + 1)}
                className="rounded-lg border border-ink-600 px-3 py-1.5 text-[12px] font-bold text-ink-300 transition-colors hover:border-gold-500/60 disabled:opacity-40"
              >
                {t("Next")}
              </button>
            </div>
          </div>
        )}
      </div>

      {play && <PlayerModal title={play.direction === "inbound" ? play.fromName : play.toName} subtitle={`${play.ext} · ${fmtDT(play.startTime)}`} onClose={() => setPlay(null)} />}
      {smsOpen && parentPhone && (
        <SmsCompose
          leadId={entityType === "lead" ? String(id) : (cust?.leadIds[0] ?? null)}
          phone={parentPhone}
          name={parentName}
          locationId={parentLocationId}
          onClose={() => setSmsOpen(false)}
          openThread={cid => navigate({ view: "sms", id: cid })}
        />
      )}
    </div>
  );
}
