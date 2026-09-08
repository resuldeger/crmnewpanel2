import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { Avatar, Btn, CallStatusPill, Drawer, Dropdown, EmptyState, Field, I, Modal, ModalHead, Pagination, Pill, PlatformPill, PlayerModal, ResultPill, SlaBadge, inputCls } from "../ui";
import { CALL_STATUS_META, PLATFORM_META, TEMPLATES, fmtDT, prettyPhone, shortId, studioById, timeAgo, type CallLog, type CallStatus, type Lead, type Platform } from "../data";
import { t, tf, useI18n } from "../i18n";

const TAB_ORDER: CallStatus[] = ["not_called", "no_answer", "busy", "interested", "not_interested", "callback_requested", "appointment_made", "already_scheduled", "didnt_pick_up", "wrong_number", "double_lead", "no_pn", "spam", "not_trusted"];

export function CallHistoryModal({ leadName, phone, calls, onClose }: { leadName: string; phone: string; calls: CallLog[]; onClose: () => void }) {
  const [play, setPlay] = useState<CallLog | null>(null);
  return (
    <Modal onClose={onClose} w={640}>
      <ModalHead title={`${t("Call History")} — ${leadName}`} sub={prettyPhone(phone)} onClose={onClose} />
      <div className="max-h-[60vh] divide-y divide-ink-750 overflow-y-auto">
        {calls.length === 0 && <div className="p-8 text-center text-[13px] font-semibold text-ink-400">{t("No recording")}</div>}
        {calls.map(c => (
          <div key={c.id} className="row-live flex items-center gap-3 px-5 py-3">
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${c.direction === "inbound" ? "border-jade-500/40 bg-jade-500/10 text-jade-400" : "border-lapis-500/40 bg-lapis-500/10 text-lapis-400"}`}>
              <I name="phone" size={13} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-extrabold text-ink-100">{fmtDT(c.startTime)}</span>
              <span className="num block text-[11px] font-semibold text-ink-500">{t(c.direction)} · {c.agent} · #{c.ext}</span>
            </span>
            <ResultPill r={c.result} duration={c.duration} />
            {c.hasRecording && (
              <Btn size="sm" variant="outline" onClick={() => setPlay(c)} title={t("Listen")}><I name="play" size={12} /> {t("Listen")}</Btn>
            )}
          </div>
        ))}
      </div>
      {play && <PlayerModal title={leadName} subtitle={`${play.ext} · ${fmtDT(play.startTime)}`} onClose={() => setPlay(null)} />}
    </Modal>
  );
}

export function NotesDrawer({ type, id, title, onClose }: { type: "lead" | "appointment"; id: string; title: string; onClose: () => void }) {
  const { notesFor, addNote, toast, guard } = useStore();
  const [draft, setDraft] = useState("");
  const list = notesFor(type, id);
  return (
    <Drawer onClose={onClose} w={430}>
      <div className="flex items-start justify-between border-b border-ink-700 px-5 py-4">
        <div>
          <h3 className="font-display text-[17px] font-bold tracking-wide text-ink-50">{t("Internal notes")}</h3>
          <div className="mt-0.5 text-[12px] text-ink-400">{title}</div>
        </div>
        <button onClick={onClose} aria-label={t("Close")} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100"><I name="x" size={17} /></button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        {list.map(n => (
          <div key={n.id} className="rounded-xl border border-ink-700 bg-ink-850 p-3.5 animate-pop">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-extrabold text-gold-300">{n.author}</span>
              <span className="num text-[10.5px] text-ink-500">{timeAgo(n.createdAt)}</span>
            </div>
            <p className="text-[12.5px] font-semibold leading-relaxed text-ink-200">{n.content}</p>
          </div>
        ))}
        {list.length === 0 && <div className="py-8 text-center text-[12.5px] font-semibold text-ink-400">—</div>}
      </div>
      <div className="border-t border-ink-700 p-4">
        <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} placeholder={`${t("Notes")}…`} className={`${inputCls} resize-none`} />
        <div className="mt-2.5 flex justify-end">
          <Btn variant="gold" disabled={!draft.trim()} onClick={() => {
            if (!guard("leads.edit")) return;
            addNote(type, id, draft.trim()); setDraft(""); toast(t("Notes"), "info");
          }}><I name="note" size={14} /> {t("Save")}</Btn>
        </div>
      </div>
    </Drawer>
  );
}

export function SmsCompose({ leadId, phone, name, locationId, onClose, openThread }: {
  leadId: string | null; phone: string; name: string; locationId: number; onClose: () => void; openThread?: (convId: number) => void;
}) {
  const { sendLeadSms, sendSmsTo, toast, guard, can } = useStore();
  const studio = studioById(locationId);
  const sender = studio?.config.twilio.specificPhone ?? "+1 (833) 555-0100";
  const renderTemplate = (raw: string) => raw
    .replace(/\{customer_name\}/g, name.split(" ")[0])
    .replace(/\{location_name\}/g, studio?.city ?? "")
    .replace(/\{appointment_date\}/g, new Date(Date.now() + 4 * 86_400_000).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }));
  const [tpl, setTpl] = useState(TEMPLATES[0].id);
  const [body, setBody] = useState(() => renderTemplate(TEMPLATES[0].body));
  const [goThread, setGoThread] = useState(false);
  const fill = (id: string) => {
    setTpl(id);
    setBody(renderTemplate(TEMPLATES.find(x => x.id === id)?.body ?? ""));
  };
  const segs = Math.max(1, Math.ceil(body.length / 160));
  const send = () => {
    if (!guard("sms.send")) return;
    const convId = leadId ? sendLeadSms(leadId, body) : sendSmsTo(phone, name, locationId, body);
    toast(tf("SMS queued to {name} via Twilio", { name }), "info");
    if (goThread && openThread) openThread(convId);
    onClose();
  };
  return (
    <Drawer onClose={onClose} w={460}>
      <div className="flex items-start justify-between border-b border-ink-700 px-5 py-4">
        <div>
          <h3 className="font-display text-[17px] font-bold tracking-wide text-ink-50">{t("Send SMS")}</h3>
          <div className="num mt-0.5 text-[12px] text-ink-400">{tf("To {name} · {phone} · from {sender}", { name, phone: prettyPhone(phone), sender })}</div>
        </div>
        <button onClick={onClose} aria-label={t("Close")} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100"><I name="x" size={17} /></button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <Field label={t("Choose a template")}>
          <div className="grid grid-cols-2 gap-2">
            {TEMPLATES.map(x => (
              <button key={x.id} onClick={() => fill(x.id)}
                className={`rounded-xl border px-3 py-2.5 text-left text-[12px] font-bold transition-all ${tpl === x.id ? "border-gold-500/70 bg-gold-500/10 text-gold-300" : "border-ink-600 bg-ink-900 text-ink-300 hover:border-ink-500"}`}>
                {x.name}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t("Message preview — editable")}>
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={5} className={`${inputCls} resize-none`} />
          <span className="num mt-1 block text-right text-[10.5px] font-bold text-ink-500">{tf("{n} chars · {s} SMS", { n: body.length, s: segs })}</span>
        </Field>
        <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] font-bold text-ink-300">
          <input type="checkbox" checked={goThread} onChange={e => setGoThread(e.target.checked)} className="h-4 w-4 accent-[#fba200]" />
          {t("Open thread after sending")}
        </label>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-ink-700 p-4">
        <Pill color="#4c8dff" dot={false}>Twilio A2P</Pill>
        <div className="flex gap-2">
          <Btn variant="outline" onClick={onClose}>{t("Cancel")}</Btn>
          <Btn variant="gold" disabled={!body.trim() || !phone} locked={!can("sms.send")} onClick={send}><I name="send" size={14} /> {t("Send via Twilio")}</Btn>
        </div>
      </div>
    </Drawer>
  );
}

export default function Leads() {
  const { leads, calls, locOk, inRange, updateLeadStatus, toast, navigate, convertLead, dateRange, dupGroupCount, can, guard } = useStore();
  useI18n();
  const [q, setQ] = useState("");
  const [statusTab, setStatusTab] = useState<"all" | CallStatus>("all");
  const [platform, setPlatform] = useState<"all" | Platform>("all");
  const [sortKey, setSortKey] = useState<"created" | "name" | "calls">("created");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [page, setPage] = useState(0);
  const [histLead, setHistLead] = useState<Lead | null>(null);
  const [notesLead, setNotesLead] = useState<Lead | null>(null);
  const [smsLead, setSmsLead] = useState<Lead | null>(null);
  const pageSize = 10;

  const callCounts = useMemo(() => {
    const m = new Map<string, number>();
    calls.forEach(c => { if (c.customerId) m.set(c.customerId, (m.get(c.customerId) ?? 0) + 1); });
    return m;
  }, [calls]);
  const countsByStatus = useMemo(() => {
    const m = new Map<CallStatus, number>();
    leads.filter(l => locOk(l.locationId) && inRange(l.createdAt)).forEach(l => m.set(l.callStatus, (m.get(l.callStatus) ?? 0) + 1));
    return m;
  }, [leads, locOk, inRange]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const digits = query.replace(/[^0-9]/g, "");
    let out = leads.filter(l =>
      locOk(l.locationId) &&
      inRange(l.createdAt) &&
      (statusTab === "all" || l.callStatus === statusTab) &&
      (platform === "all" || l.attr.platform === platform) &&
      (!query || l.name.toLowerCase().includes(query) || l.email.toLowerCase().includes(query) ||
        l.id.toLowerCase().includes(query) || (digits.length > 2 && l.formattedPhone.replace(/[^0-9]/g, "").includes(digits))));
    out = [...out].sort((a, b) => {
      if (sortKey === "name") return sortDir * a.name.localeCompare(b.name);
      if (sortKey === "calls") return sortDir * ((callCounts.get(b.id) ?? 0) - (callCounts.get(a.id) ?? 0));
      return sortDir * (+new Date(b.createdAt) - +new Date(a.createdAt));
    });
    return out;
  }, [leads, q, locOk, inRange, statusTab, platform, sortKey, sortDir, callCounts]);

  useEffect(() => setPage(0), [q, statusTab, platform, locOk, dateRange, sortKey, sortDir]);
  const pageRows = filtered.slice(page * pageSize, (page + 1) * pageSize);

  const toggleSort = (k: typeof sortKey) => {
    if (sortKey === k) setSortDir(d => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(k === "name" ? 1 : -1); }
  };

  const exportCsv = () => {
    if (!guard("leads.export")) return;
    const rows = [
      ["ID", "Name", "Email", "Phone", "Call Status", "Platform", "Campaign", "Studio", "Created"],
      ...filtered.map(l => [l.id, l.name, l.email, l.formattedPhone, l.callStatus, l.attr.platform, l.attr.utmCampaign ?? "", studioById(l.locationId)?.name ?? "", l.createdAt]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "cleopatra-leads.csv"; a.click();
    URL.revokeObjectURL(url);
    toast(tf("Exported {n} leads to CSV", { n: filtered.length }), "info");
  };

  const SortHead = ({ k, children }: { k: typeof sortKey; children: React.ReactNode }) => (
    <th className="px-4 py-3">
      <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors ${sortKey === k ? "text-gold-400" : "text-ink-400 hover:text-ink-200"}`}>
        {children}
        <I name="chevD" size={11} className={`transition-transform ${sortKey === k ? (sortDir === 1 ? "rotate-180" : "") : "opacity-30"}`} />
      </button>
    </th>
  );

  return (
    <div className="space-y-4 animate-rise">
      <div className="rounded-2xl border border-ink-700 bg-ink-875 p-4 shadow-panel">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1">
            <I name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("Search name, email, phone, ID…")}
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              className={`${inputCls} pl-9`} />
          </div>
          <button onClick={() => navigate({ view: "duplicates" })}
            className="flex items-center gap-1.5 rounded-lg border border-gold-500/45 bg-gold-500/10 px-3 py-2 text-[12.5px] font-bold text-gold-300 transition-all hover:border-gold-500/70 hover:bg-gold-500/15">
            <I name="merge" size={14} /> {t("Duplicate Merge")}
            {dupGroupCount > 0 && <span className="num rounded bg-gold-500 px-1.5 py-0.5 text-[10.5px] font-bold text-ink-50">{dupGroupCount}</span>}
          </button>
          <Btn variant="outline" onClick={exportCsv} locked={!can("leads.export")}><I name="download" size={14} /> CSV</Btn>
        </div>
        <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <button onClick={() => setStatusTab("all")}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-colors ${statusTab === "all" ? "bg-gold-500 text-ink-50" : "border border-ink-600 text-ink-300 hover:text-ink-100"}`}>
            {t("All Active")} <span className="num opacity-75">· {leads.length}</span>
          </button>
          {TAB_ORDER.filter(s => (countsByStatus.get(s) ?? 0) > 0).map(s => (
            <button key={s} onClick={() => setStatusTab(statusTab === s ? "all" : s)}
              className="shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all"
              style={statusTab === s
                ? { color: "#fffdf7", background: CALL_STATUS_META[s].color, border: `1px solid ${CALL_STATUS_META[s].color}` }
                : { color: CALL_STATUS_META[s].color, background: `${CALL_STATUS_META[s].color}10`, border: `1px solid ${CALL_STATUS_META[s].color}35` }}>
              {t(CALL_STATUS_META[s].label)} <span className="num opacity-75">· {countsByStatus.get(s) ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-700 bg-ink-850">
                <SortHead k="name">{t("Client")}</SortHead>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Contact")}</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Source / Studio")}</th>
                <SortHead k="calls">{t("Calls")}</SortHead>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Call Status")}</th>
                <SortHead k="created">{t("Created")}</SortHead>
                <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-750">
              {pageRows.map(l => {
                const cc = callCounts.get(l.id) ?? 0;
                return (
                  <tr key={l.id} onClick={() => navigate({ view: "lead", id: l.id })} className="row-live group cursor-pointer">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={l.name} size={34} />
                        <span>
                          <span className="flex items-center gap-1.5 text-[13.5px] font-extrabold text-ink-100 transition-colors group-hover:text-gold-300">
                            {l.name}
                            {l.isDuplicate && <Pill color="#e8a33d" dot={false} className="!text-[9.5px]">{t("DUP")}</Pill>}
                            {l.unsubscribedAt && <Pill color="#e5484d" dot={false} className="!text-[9.5px]">{t("OPT-OUT")}</Pill>}
                          </span>
                          <span className="num text-[11px] text-ink-500" title={l.id}>{shortId(l.id)}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-300"><I name="mail" size={12} className="text-ink-500" />{l.email}</div>
                      <div className="num mt-0.5 flex items-center gap-1.5 text-[12px] font-semibold text-ink-200"><I name="phone" size={12} className="text-ink-500" />{prettyPhone(l.formattedPhone) || <span className="text-ink-500">{t("no phone")}</span>}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <PlatformPill p={l.attr.platform} />
                        <Pill color="#948d7d" dot={false}>{studioById(l.locationId)?.slug}</Pill>
                      </div>
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <button onClick={() => setHistLead(l)} title={t("Open call history")}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-bold transition-all hover:scale-[1.04] ${cc > 0 ? "border-lapis-500/40 bg-lapis-500/10 text-lapis-400 hover:border-lapis-500/70" : "border-ink-600 text-ink-500"}`}>
                        <I name="phone" size={12} /> <span className="num">{cc}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <Dropdown width={230} trigger={open => (
                        <button className={`flex items-center gap-1.5 transition-transform ${can("leads.edit") ? "" : "opacity-55"}`}
                          style={{ transform: open ? "scale(1.03)" : undefined }}
                          title={can("leads.edit") ? undefined : `${t("locked")} · leads.edit`}>
                          {!can("leads.edit") && <I name="lock" size={11} className="text-ink-500" />}
                          <CallStatusPill s={l.callStatus} />
                          <I name="chevD" size={12} className={`text-ink-500 transition-transform ${open ? "rotate-180" : ""}`} />
                        </button>
                      )}>
                        {close => (
                          <div className="max-h-72 overflow-y-auto py-1">
                            {TAB_ORDER.map(s => (
                              <button key={s} onClick={() => { if (!guard("leads.edit")) return; updateLeadStatus(l.id, s); toast(tf("{name} → {status}", { name: l.name, status: t(CALL_STATUS_META[s].label) })); close(); }}
                                className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[12.5px] font-bold transition-colors hover:bg-ink-800 ${l.callStatus === s ? "text-gold-300" : "text-ink-200"}`}>
                                <span className="h-2 w-2 rounded-full" style={{ background: CALL_STATUS_META[s].color }} />
                                {t(CALL_STATUS_META[s].label)}
                                {l.callStatus === s && <I name="check" size={12} className="ml-auto text-gold-400" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </Dropdown>
                    </td>
                    <td className="px-4 py-3">
                      <div className="num text-[11.5px] font-semibold text-ink-400">{timeAgo(l.createdAt)}</div>
                      <SlaBadge className="mt-1" createdAt={l.createdAt} called={l.callStatus !== "not_called"} />
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Btn size="sm" variant="ghost" title={t("Open 360° view")} onClick={() => navigate({ view: "lead", id: l.id })}><I name="eye" size={14} /></Btn>
                        <Btn size="sm" variant="ghost" title={t("Send SMS (template)")} onClick={() => setSmsLead(l)} disabled={!l.formattedPhone} locked={!can("sms.send")}><I name="chat" size={14} /></Btn>
                        <Btn size="sm" variant="ghost" title={t("Internal notes")} onClick={() => setNotesLead(l)}><I name="note" size={14} /></Btn>
                        <Btn size="sm" variant="outline" title={t("Convert to appointment")} locked={!can("leads.convert")}
                          onClick={() => { const id = convertLead(l.id); if (id) { toast(tf("{name} converted to appointment", { name: l.name })); navigate({ view: "appointment", id }); } }}>
                          <I name="convert" size={14} />
                        </Btn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pageRows.length === 0 && (
          <div className="p-6"><EmptyState title={t("No leads match these filters")} hint={t("Try widening the date range, clearing the search, or picking another call status.")} /></div>
        )}
        <Pagination total={filtered.length} page={page} pageSize={pageSize} onPage={setPage} unit={t("leads")} />
      </div>

      {histLead && <CallHistoryModal leadName={histLead.name} phone={histLead.formattedPhone} calls={calls.filter(c => c.customerId === histLead.id)} onClose={() => setHistLead(null)} />}
      {notesLead && <NotesDrawer type="lead" id={notesLead.id} title={notesLead.name} onClose={() => setNotesLead(null)} />}
      {smsLead && <SmsCompose leadId={smsLead.id} phone={smsLead.formattedPhone} name={smsLead.name} locationId={smsLead.locationId} onClose={() => setSmsLead(null)} openThread={id => navigate({ view: "sms", id })} />}
    </div>
  );
}
