import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { Btn, Drawer, EmptyState, Field, I, Pagination, Pill, SectionTitle, inputCls } from "../ui";
import { EXTENSIONS, fmtDT, prettyPhone, studioById, timeAgo } from "../data";
import { t, tf, useI18n } from "../i18n";

function DueChip({ dueAt, done }: { dueAt: string; done: boolean }) {
  const { lang } = useI18n();
  const [, force] = useState(0);
  useEffect(() => {
    const i = setInterval(() => force(x => x + 1), 30_000);
    return () => clearInterval(i);
  }, []);
  const diffMin = Math.round((+new Date(dueAt) - Date.now()) / 60_000);
  if (done) return <Pill color="#2fbf71" dot={false}>{t("Done")}</Pill>;
  const abs = Math.abs(diffMin);
  const label = abs < 60 ? (lang === "tr" ? `${abs}dk` : `${abs}m`) : (lang === "tr" ? `${Math.floor(abs / 60)}sa ${abs % 60}dk` : `${Math.floor(abs / 60)}h ${abs % 60}m`);
  if (diffMin < 0) return <Pill color="#e5484d" className="animate-blink">{t("Overdue")} · {label}</Pill>;
  if (diffMin < 60) return <Pill color="#e8a33d">{t("Due")} · {label}</Pill>;
  return <Pill color="#948d7d" dot={false}>{t("Due")} · {label}</Pill>;
}

export default function Tasks() {
  const { tasks, completeTask, deleteTask, addTask, logCallback, leads, navigate, toast, guard, can } = useStore();
  useI18n();
  const [drawer, setDrawer] = useState(false);
  const [openPage, setOpenPage] = useState(0);
  const [donePage, setDonePage] = useState(0);
  const [title, setTitle] = useState("");
  const [leadId, setLeadId] = useState("");
  const [assignee, setAssignee] = useState(EXTENSIONS[0].username.replace("Cleo.", "Agent · "));
  const [due, setDue] = useState(() => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 16));

  const open = useMemo(() => tasks.filter(x => x.status === "open").sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt)), [tasks]);
  const done = useMemo(() => tasks.filter(x => x.status === "done").sort((a, b) => +new Date(b.doneAt ?? 0) - +new Date(a.doneAt ?? 0)), [tasks]);
  const overdue = open.filter(x => +new Date(x.dueAt) < Date.now()).length;

  const submit = () => {
    if (!guard("calls.manage")) return;
    const lead = leads.find(l => l.id === leadId);
    addTask({
      title: title.trim(), leadId: lead?.id ?? null, leadName: lead?.name ?? "—",
      phone: lead?.formattedPhone ?? "", locationId: lead?.locationId ?? 1,
      assignee, dueAt: new Date(due).toISOString(), source: "manual",
    });
    toast(tf("Task created · due {ago}", { ago: fmtDT(new Date(due).toISOString()) }), "success");
    setDrawer(false); setTitle(""); setLeadId("");
  };

  const finish = (id: number, phone: string, name: string, customerId: string | null, locationId: number) => {
    if (!guard("calls.manage")) return;
    if (phone) {
      const res = logCallback({ name, phone, customerId, locationId });
      toast(res === "Answered" ? tf("Callback to {name} answered", { name }) : tf("Callback to {name} · no answer", { name }), res === "Answered" ? "success" : "info");
    }
    completeTask(id);
    toast(t("Task completed"), "success");
  };

  return (
    <div className="space-y-5 animate-rise">
      <SectionTitle right={
        <div className="flex items-center gap-2">
          {overdue > 0 && <Pill color="#e5484d" className="animate-blink">{overdue} {t("Overdue")}</Pill>}
          <Btn variant="gold" onClick={() => setDrawer(true)} locked={!can("calls.manage")}><I name="plus" size={14} /> {t("New Task")}</Btn>
        </div>
      }>{t("Tasks")}</SectionTitle>

      {/* open */}
      <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
        <div className="border-b border-ink-700 bg-ink-850 px-5 py-3">
          <h3 className="font-display text-[15px] font-bold tracking-wide text-ink-50">{t("Open")} <span className="num text-[13px] text-gold-400">· {open.length}</span></h3>
        </div>
        <div className="divide-y divide-ink-750">
          {open.slice(openPage * 8, (openPage + 1) * 8).map(x => {
            const isOver = +new Date(x.dueAt) < Date.now();
            return (
              <div key={x.id} className={`row-live flex flex-wrap items-center gap-3 px-5 py-3.5 ${isOver ? "bg-ember-500/4" : ""}`}>
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${x.source === "voicemail" ? "border-[#e8a33d]/40 bg-[#e8a33d]/10 text-[#e8a33d]" : x.source === "callback" ? "border-ember-500/40 bg-ember-500/10 text-ember-400" : "border-lapis-500/40 bg-lapis-500/10 text-lapis-400"}`}>
                  <I name={x.source === "manual" ? "note" : "phone"} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-extrabold text-ink-100">{x.title}</span>
                    <DueChip dueAt={x.dueAt} done={false} />
                  </div>
                  <div className="num mt-0.5 text-[11px] font-semibold text-ink-500">
                    {x.leadId ? x.leadId + " · " : ""}{prettyPhone(x.phone) || "—"} · {studioById(x.locationId)?.slug} · {t("Assignee")}: {x.assignee}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {x.leadId && <Btn size="sm" variant="ghost" title={t("Open 360° view")} onClick={() => navigate({ view: "lead", id: x.leadId! })}><I name="eye" size={13} /></Btn>}
                  <Btn size="sm" variant="gold" onClick={() => finish(x.id, x.phone, x.leadName, x.leadId, x.locationId)}>
                    <I name="check" size={13} /> {t("Complete")}
                  </Btn>
                  <Btn size="sm" variant="ghost" title={t("Delete")} onClick={() => { deleteTask(x.id); toast(t("Delete"), "info"); }}><I name="x" size={13} /></Btn>
                </div>
              </div>
            );
          })}
          {open.length === 0 && <div className="p-8"><EmptyState title={t("No open tasks — the floor is clear.")} /></div>}
        </div>
        {open.length > 8 && <Pagination total={open.length} page={openPage} pageSize={8} onPage={setOpenPage} unit={t("Tasks").toLowerCase()} />}
      </div>

      {/* done */}
      <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
        <div className="border-b border-ink-700 bg-ink-850 px-5 py-3">
          <h3 className="font-display text-[15px] font-bold tracking-wide text-ink-50">{t("Done")} <span className="num text-[13px] text-jade-400">· {done.length}</span></h3>
        </div>
        <div className="divide-y divide-ink-750 opacity-80">
          {done.slice(donePage * 6, (donePage + 1) * 6).map(x => (
            <div key={x.id} className="row-live flex items-center gap-3 px-5 py-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-jade-500/40 bg-jade-500/10 text-jade-400"><I name="check" size={13} /></span>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-ink-300 line-through decoration-ink-500/50">{x.title}</span>
                <span className="num text-[10.5px] font-semibold text-ink-500">{x.leadName} · {x.doneAt ? timeAgo(x.doneAt) : ""}</span>
              </div>
              <Pill color="#2fbf71" dot={false}>{t("Done")}</Pill>
            </div>
          ))}
          {done.length === 0 && <div className="p-6 text-center text-[12.5px] font-semibold text-ink-400">—</div>}
        </div>
        {done.length > 6 && <Pagination total={done.length} page={donePage} pageSize={6} onPage={setDonePage} unit={t("Tasks").toLowerCase()} />}
      </div>

      {drawer && (
        <Drawer onClose={() => setDrawer(false)} w={440}>
          <div className="flex items-start justify-between border-b border-ink-700 px-5 py-4">
            <div>
              <h3 className="font-display text-[17px] font-bold tracking-wide text-ink-50">{t("New Task")}</h3>
              <div className="mt-0.5 text-[12px] text-ink-400">{t("Assign a follow-up call with a due time.")}</div>
            </div>
            <button onClick={() => setDrawer(false)} aria-label={t("Close")} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100"><I name="x" size={17} /></button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            <Field label={t("Title")}>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder={tf("Callback · {name}", { name: "Sofia" })} className={inputCls} />
            </Field>
            <Field label={t("Client")}>
              <select value={leadId} onChange={e => setLeadId(e.target.value)} className={inputCls}>
                <option value="">—</option>
                {leads.filter(l => l.formattedPhone).map(l => <option key={l.id} value={l.id}>{l.name} · {l.id}</option>)}
              </select>
            </Field>
            <Field label={t("Assignee")}>
              <select value={assignee} onChange={e => setAssignee(e.target.value)} className={inputCls}>
                {EXTENSIONS.filter(e => e.locationId === null).map(e => <option key={e.id} value={e.username.replace("Cleo.", "Agent · ")}>{e.username.replace("Cleo.", "Agent · ")} · #{e.extension}</option>)}
              </select>
            </Field>
            <Field label={t("Due date & time")}>
              <input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} className={`${inputCls} num`} />
            </Field>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-ink-700 p-4">
            <Btn variant="outline" onClick={() => setDrawer(false)}>{t("Cancel")}</Btn>
            <Btn variant="gold" disabled={!title.trim()} onClick={submit}><I name="check" size={14} /> {t("Save")}</Btn>
          </div>
        </Drawer>
      )}
    </div>
  );
}
