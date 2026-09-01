import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { Avatar, Btn, CallStatusPill, Drawer, Dropdown, EmptyState, I, Modal, ModalHead, PlatformPill, Pill, PlayerModal as PlayerModalWrap, ResultPill, inputCls } from "../components/ui";
import {
  CALL_STATUS_META, PLATFORM_META, fmtDur, fmtDT, prettyPhone, studioById, timeAgo,
  type CallLog, type CallStatus, type Lead, type Platform,
} from "../data/crm";

const TAB_ORDER: CallStatus[] = ["not_called", "no_answer", "busy", "interested", "not_interested", "callback_requested", "appointment_made", "already_scheduled", "didnt_pick_up", "wrong_number", "double_lead", "no_pn", "spam", "not_trusted"];

export function CallHistoryModal({ leadName, phone, calls, onClose }: { leadName: string; phone: string; calls: CallLog[]; onClose: () => void }) {
  const [play, setPlay] = useState<CallLog | null>(null);
  const answered = calls.filter(c => c.result === "Answered");
  const totalTalk = answered.reduce((s, c) => s + c.duration, 0);
  return (
    <>
      <Modal onClose={onClose} w={700}>
        <ModalHead title={`Call History — ${leadName}`} sub={<span className="num">{prettyPhone(phone) || "no phone on file"} · {calls.length} calls on record</span>} onClose={onClose} />
        <div className="grid grid-cols-4 gap-2.5 border-b border-ink-700 px-5 py-4">
          {[
            { l: "Total Calls", v: calls.length, c: "#b6b6c6" },
            { l: "Answered", v: answered.length, c: "#2fbf71" },
            { l: "Missed", v: calls.filter(c => c.result === "Missed").length, c: "#e5484d" },
            { l: "Talk Time", v: fmtDur(totalTalk), c: "#d4af37" },
          ].map(s => (
            <div key={s.l} className="rounded-xl border border-ink-700 bg-ink-900 px-3 py-2.5 text-center">
              <div className="num text-[17px] font-bold" style={{ color: s.c }}>{s.v}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">{s.l}</div>
            </div>
          ))}
        </div>
        <div className="max-h-[46vh] divide-y divide-ink-750 overflow-y-auto">
          {calls.length === 0 && <div className="px-5 py-10 text-center text-[13px] text-ink-400">No calls synced for this client yet.</div>}
          {calls.map(c => (
            <div key={c.id} className="row-live flex items-center gap-3 px-5 py-3">
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${c.direction === "inbound" ? "border-lapis-500/35 bg-lapis-500/10 text-lapis-400" : "border-gold-500/35 bg-gold-500/10 text-gold-400"}`}
                title={c.direction}>
                <I name="phone" size={15} className={c.direction === "outbound" ? "-scale-x-100" : ""} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-bold text-ink-100">{c.fromName} <span className="text-ink-500">→</span> {c.toName}</div>
                <div className="num truncate text-[11px] text-ink-400">{prettyPhone(c.fromNumber)} → {prettyPhone(c.toNumber)} · {fmtDT(c.startTime)}</div>
              </div>
              <ResultPill r={c.result} duration={c.duration} />
              {c.hasRecording ? (
                <Btn size="sm" variant="outline" onClick={() => setPlay(c)}><I name="play" size={12} /> Listen</Btn>
              ) : <span className="num text-[10px] font-bold text-ink-600">no rec</span>}
            </div>
          ))}
        </div>
      </Modal>
      {play && <ListenModal call={play} onClose={() => setPlay(null)} />}
    </>
  );
}
export function ListenModal({ call, onClose }: { call: CallLog; onClose: () => void }) {
  return <PlayerModalWrap call={call} title={`${call.fromName} → ${call.toName}`} onClose={onClose} />;
}

export function NotesDrawer({ type, id, title, onClose }: { type: "lead" | "appointment"; id: string; title: string; onClose: () => void }) {
  const { notesFor, addNote, toast } = useStore();
  const [text, setText] = useState("");
  const notes = notesFor(type, id);
  return (
    <Drawer onClose={onClose}>
      <div className="flex items-start justify-between border-b border-ink-700 px-5 py-4">
        <div>
          <h3 className="font-display text-[17px] font-bold tracking-wide text-ink-50">Internal Notes</h3>
          <div className="mt-0.5 text-[12px] text-ink-300">{title} · visible to staff only</div>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-ink-300 hover:bg-ink-700 hover:text-ink-50"><I name="x" size={17} /></button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        {notes.length === 0 && <EmptyState icon="note" title="No notes yet" hint="Leave the first private note for the team about this record." />}
        {notes.map(n => (
          <div key={n.id} className="rounded-xl border border-ink-700 bg-ink-850 p-4 animate-rise">
            <div className="mb-1.5 flex items-center gap-2">
              <Avatar name={n.author} size={24} />
              <span className="text-[12px] font-extrabold text-ink-100">{n.author}</span>
              <span className="num ml-auto text-[10.5px] text-ink-500">{timeAgo(n.createdAt)}</span>
            </div>
            <p className="text-[13px] font-medium leading-relaxed text-ink-200">{n.content}</p>
          </div>
        ))}
      </div>
      <div className="border-t border-ink-700 p-4">
        <textarea value={text} onChange={e => setText(e.target.value)} rows={3}
          placeholder="Add a private note… (markup plain text)"
          className={`${inputCls} resize-none`} />
        <Btn variant="gold" className="mt-2.5 w-full" disabled={!text.trim()}
          onClick={() => { addNote(type, id, text.trim()); setText(""); toast("Note added to record"); }}>
          <I name="plus" size={14} /> Add Note
        </Btn>
      </div>
    </Drawer>
  );
}

export default function Leads() {
  const { leads, calls, globalLocation, setGlobalLocation, inRange, updateLeadStatus, toast, navigate, convertLead, studios, dateRange } = useStore();
  const [q, setQ] = useState("");
  const [statusTab, setStatusTab] = useState<"all" | CallStatus>("all");
  const [platform, setPlatform] = useState<"all" | Platform>("all");
  const [sortKey, setSortKey] = useState<"created" | "name" | "calls">("created");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [page, setPage] = useState(0);
  const [histLead, setHistLead] = useState<Lead | null>(null);
  const [notesLead, setNotesLead] = useState<Lead | null>(null);
  const pageSize = 10;

  const callCounts = useMemo(() => {
    const m = new Map<string, number>();
    calls.forEach(c => { if (c.customerId) m.set(c.customerId, (m.get(c.customerId) ?? 0) + 1); });
    return m;
  }, [calls]);
  const noteCounts = useMemo(() => {
    const m = new Map<string, number>();
    return m;
  }, []);
  void noteCounts;

  const countsByStatus = useMemo(() => {
    const m = new Map<CallStatus, number>();
    leads.forEach(l => m.set(l.callStatus, (m.get(l.callStatus) ?? 0) + 1));
    return m;
  }, [leads]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const digits = query.replace(/[^0-9]/g, "");
    let out = leads.filter(l =>
      (globalLocation === "all" || l.locationId === globalLocation) &&
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
  }, [leads, q, globalLocation, inRange, statusTab, platform, sortKey, sortDir, callCounts]);

  useEffect(() => setPage(0), [q, statusTab, platform, globalLocation, dateRange, sortKey, sortDir]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice(page * pageSize, (page + 1) * pageSize);

  const toggleSort = (k: typeof sortKey) => {
    if (sortKey === k) setSortDir(d => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(k === "name" ? 1 : -1); }
  };

  const exportCsv = () => {
    const rows = [
      ["ID", "Name", "Email", "Phone", "Form", "Call Status", "Platform", "Campaign", "Studio", "Style", "Size", "Created"],
      ...filtered.map(l => [l.id, l.name, l.email, l.formattedPhone, l.status, l.callStatus, l.attr.platform, l.attr.utmCampaign ?? "", studioById(l.locationId)?.name ?? "", l.meta.style, l.meta.size, l.createdAt]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "cleopatra-leads.csv"; a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${filtered.length} leads to CSV`, "info");
  };

  const SortHead = ({ k, children, className = "" }: { k: typeof sortKey; children: React.ReactNode; className?: string }) => (
    <th className={`px-4 py-3 ${className}`}>
      <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors ${sortKey === k ? "text-gold-400" : "text-ink-400 hover:text-ink-200"}`}>
        {children}
        <I name="chevD" size={11} className={`transition-transform ${sortKey === k ? (sortDir === 1 ? "rotate-180" : "") : "opacity-30"}`} />
      </button>
    </th>
  );

  return (
    <div className="space-y-4 animate-rise">
      {/* control deck */}
      <div className="rounded-2xl border border-ink-700 bg-ink-875 p-4 shadow-panel">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1">
            <I name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, phone, ID…" className={`${inputCls} pl-9`} />
          </div>
          <select value={String(globalLocation)} onChange={e => setGlobalLocation(e.target.value === "all" ? "all" : Number(e.target.value))}
            className="rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-[13px] font-semibold text-ink-100 outline-none focus:border-gold-500/70">
            <option value="all">All Studios</option>
            {studios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {/* platform pills */}
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPlatform("all")}
              className={`rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition-colors ${platform === "all" ? "bg-gold-500/15 text-gold-300 border border-gold-500/40" : "border border-ink-600 text-ink-300 hover:text-ink-100"}`}>All</button>
            {(Object.keys(PLATFORM_META) as Platform[]).map(p => (
              <button key={p} onClick={() => setPlatform(platform === p ? "all" : p)}
                className="rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition-all"
                style={platform === p
                  ? { color: PLATFORM_META[p].color, background: `${PLATFORM_META[p].color}1a`, border: `1px solid ${PLATFORM_META[p].color}55` }
                  : { color: "#8b8ba0", border: "1px solid #2d2d3b" }}>
                {PLATFORM_META[p].label}
              </button>
            ))}
          </div>
          <Btn variant="outline" onClick={exportCsv}><I name="download" size={14} /> CSV</Btn>
        </div>
        {/* status chips */}
        <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <button onClick={() => setStatusTab("all")}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-colors ${statusTab === "all" ? "bg-gold-500 text-ink-950" : "border border-ink-600 text-ink-300 hover:text-ink-100"}`}>
            All Active <span className="num opacity-75">· {leads.length}</span>
          </button>
          {TAB_ORDER.map(s => (
            <button key={s} onClick={() => setStatusTab(statusTab === s ? "all" : s)}
              className="shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all"
              style={statusTab === s
                ? { color: "#0a0a0e", background: CALL_STATUS_META[s].color, border: `1px solid ${CALL_STATUS_META[s].color}` }
                : { color: CALL_STATUS_META[s].color, background: `${CALL_STATUS_META[s].color}10`, border: `1px solid ${CALL_STATUS_META[s].color}35` }}>
              {CALL_STATUS_META[s].label} <span className="num opacity-75">· {countsByStatus.get(s) ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* table */}
      <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-700 bg-ink-850">
                <SortHead k="name">Client</SortHead>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">Contact</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">Source / Studio</th>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">Ink Request</th>
                <SortHead k="calls">Calls</SortHead>
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">Call Status</th>
                <SortHead k="created">Created</SortHead>
                <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-750">
              {pageRows.map(l => {
                const cc = callCounts.get(l.id) ?? 0;
                return (
                  <tr key={l.id} className="row-live group">
                    <td className="px-4 py-3">
                      <button onClick={() => navigate({ view: "lead", id: l.id })} className="flex items-center gap-3 text-left">
                        <Avatar name={l.name} size={34} />
                        <span>
                          <span className="flex items-center gap-1.5 text-[13.5px] font-extrabold text-ink-100 transition-colors group-hover:text-gold-300">
                            {l.name}
                            {l.isDuplicate && <Pill color="#9b6bff" dot={false} className="!text-[9.5px]">DUP</Pill>}
                            {l.unsubscribedAt && <Pill color="#e5484d" dot={false} className="!text-[9.5px]">OPT-OUT</Pill>}
                          </span>
                          <span className="num text-[11px] text-ink-500">{l.id}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-300"><I name="mail" size={12} className="text-ink-500" />{l.email}</div>
                      <div className="num mt-0.5 flex items-center gap-1.5 text-[12px] font-semibold text-ink-200"><I name="phone" size={12} className="text-ink-500" />{prettyPhone(l.formattedPhone) || <span className="text-ink-500">no phone</span>}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span title={`campaign: ${l.attr.utmCampaign ?? "—"} · medium: ${l.attr.utmMedium ?? "—"} · ${l.attr.gclid ? `gclid ${l.attr.gclid.slice(0, 10)}…` : l.attr.fbclid ? `fbclid ${l.attr.fbclid.slice(0, 10)}…` : l.attr.ttclid ? `ttclid ${l.attr.ttclid.slice(0, 10)}…` : "organic"}`}>
                          <PlatformPill p={l.attr.platform} />
                        </span>
                        <Pill color="#63637a" dot={false}>{studioById(l.locationId)?.slug}</Pill>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-[12.5px] font-bold text-ink-200">{l.meta.style}</div>
                      <div className="text-[11px] font-semibold text-ink-500">{l.meta.size} · {l.meta.bodyAreas.slice(0, 2).join(", ")}</div>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => setHistLead(l)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-bold transition-all hover:scale-[1.04] ${cc > 0 ? "border-lapis-500/40 bg-lapis-500/10 text-lapis-400 hover:border-lapis-500/70" : "border-ink-600 text-ink-500"}`}>
                        <I name="phone" size={12} /> <span className="num">{cc}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <Dropdown width={230} trigger={open => (
                        <button className="flex items-center gap-1.5 transition-transform" style={{ transform: open ? "scale(1.03)" : undefined }}>
                          <CallStatusPill s={l.callStatus} />
                          <I name="chevD" size={12} className={`text-ink-500 transition-transform ${open ? "rotate-180" : ""}`} />
                        </button>
                      )}>
                        {close => (
                          <div className="max-h-72 overflow-y-auto py-1">
                            {TAB_ORDER.map(s => (
                              <button key={s} onClick={() => { updateLeadStatus(l.id, s); toast(`${l.name} → ${CALL_STATUS_META[s].label}`); close(); }}
                                className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[12.5px] font-bold transition-colors hover:bg-ink-750 ${l.callStatus === s ? "text-gold-300" : "text-ink-200"}`}>
                                <span className="h-2 w-2 rounded-full" style={{ background: CALL_STATUS_META[s].color }} />
                                {CALL_STATUS_META[s].label}
                                {l.callStatus === s && <I name="check" size={12} className="ml-auto text-gold-400" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </Dropdown>
                    </td>
                    <td className="num px-4 py-3 text-[11.5px] font-semibold text-ink-400">{timeAgo(l.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Btn size="sm" variant="ghost" title="Open 360° view" onClick={() => navigate({ view: "lead", id: l.id })}><I name="eye" size={14} /></Btn>
                        <Btn size="sm" variant="ghost" title="Internal notes" onClick={() => setNotesLead(l)}><I name="note" size={14} /></Btn>
                        <Btn size="sm" variant="outline" title="Convert to appointment"
                          onClick={() => { const id = convertLead(l.id); if (id) { toast(`${l.name} converted to appointment`); navigate({ view: "appointment", id }); } }}>
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
          <div className="p-6"><EmptyState title="No leads match these filters" hint="Try widening the date range, clearing the search, or picking another call status." /></div>
        )}
        {/* pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-700 px-4 py-3">
          <span className="num text-[12px] font-semibold text-ink-400">
            {filtered.length} leads · page {page + 1}/{pages}
          </span>
          <div className="flex items-center gap-1.5">
            <Btn size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}><I name="chevL" size={13} /> Prev</Btn>
            {Array.from({ length: Math.min(pages, 5) }, (_, i) => {
              const p = Math.min(Math.max(0, page - 2), Math.max(0, pages - 5)) + i;
              if (p >= pages) return null;
              return (
                <button key={p} onClick={() => setPage(p)}
                  className={`num h-8 w-8 rounded-lg text-[12px] font-bold transition-colors ${p === page ? "bg-gold-500 text-ink-950" : "border border-ink-600 text-ink-300 hover:text-ink-100"}`}>
                  {p + 1}
                </button>
              );
            })}
            <Btn size="sm" variant="outline" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>Next <I name="chevR" size={13} /></Btn>
          </div>
        </div>
      </div>

      {histLead && <CallHistoryModal leadName={histLead.name} phone={histLead.formattedPhone} calls={calls.filter(c => c.customerId === histLead.id)} onClose={() => setHistLead(null)} />}
      {notesLead && <NotesDrawer type="lead" id={notesLead.id} title={notesLead.name} onClose={() => setNotesLead(null)} />}
    </div>
  );
}
