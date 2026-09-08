import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { Btn, I, Pill, SectionTitle } from "../ui";
import { parseBookNowCsv, type CsvKind, type ParsedFile } from "../services/csv";
import { SAMPLE_APPOINTMENTS_CSV, SAMPLE_LEADS_CSV } from "../services/sampleCsv";
import { prettyPhone } from "../data";
import { t, tf, useI18n } from "../i18n";

const STAGES = ["Validating rows", "Creating studios", "Inserting leads", "Linking appointments", "Logging voice calls"];

function DropZone({ kind, parsed, onParse, onClear }: {
  kind: CsvKind; parsed: ParsedFile | null; onParse: (f: ParsedFile) => void; onClear: () => void;
}) {
  const { studios, toast } = useStore();
  const [drag, setDrag] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const accent = kind === "leads" ? "#4c8dff" : "#2fbf71";
  const icon: "leads" | "calendar" = kind === "leads" ? "leads" : "calendar";

  const handleText = (text: string, fileName: string) => {
    try {
      const res = parseBookNowCsv(fileName, text, studios);
      if (res.kind !== kind) {
        toast(tf("“{file}” looks like a {kind} export — drop it in the other card.", { file: fileName, kind: res.kind === "leads" ? t("Leads CSV").toLowerCase() : t("Appointments CSV").toLowerCase() }), "error");
        return;
      }
      onParse(res);
      toast(tf("Parsed {n} rows from {file}", { n: res.rows, file: fileName }), "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Could not parse that CSV"), "error");
    }
  };
  const handleFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => handleText(String(r.result ?? ""), f.name);
    r.readAsText(f);
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel transition-all duration-200"
      style={{ boxShadow: parsed ? `inset 0 2px 0 ${accent}88` : undefined }}>
      <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg border" style={{ borderColor: `${accent}55`, background: `${accent}12`, color: accent }}>
            <I name={icon} size={16} />
          </span>
          <div>
            <div className="text-[13.5px] font-extrabold text-ink-50">{kind === "leads" ? t("Leads CSV") : t("Appointments CSV")}</div>
            <div className="num text-[10.5px] font-semibold text-ink-500">{kind === "leads" ? "clean_leads_full_export.csv" : "appointments_full_export.csv"}</div>
          </div>
        </div>
        {parsed && (
          <button onClick={onClear} title={t("Remove file")} className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ember-500/10 hover:text-ember-400">
            <I name="x" size={15} />
          </button>
        )}
      </div>

      {!parsed ? (
        <div className="flex flex-1 flex-col">
          <button
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
            className={`m-4 flex flex-1 flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed px-6 py-10 transition-all duration-200 ${drag ? "scale-[1.01] border-gold-500 bg-gold-500/8" : "border-ink-600 hover:border-ink-500 hover:bg-ink-850"}`}>
            <span className={`grid h-11 w-11 place-items-center rounded-2xl border transition-colors ${drag ? "border-gold-500/60 bg-gold-500/15 text-gold-300" : "border-ink-600 bg-ink-850 text-ink-400"}`}>
              <I name="download" size={19} />
            </span>
            <span className="text-[13px] font-extrabold text-ink-200">{t("Drop the CSV here or click to browse")}</span>
            <span className="text-[11px] font-semibold text-ink-500">{t("Semicolon-delimited BookNow exports")}</span>
          </button>
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => { handleFiles(e.target.files); e.target.value = ""; }} />
          <div className="px-4 pb-4">
            <button
              onClick={() => handleText(kind === "leads" ? SAMPLE_LEADS_CSV : SAMPLE_APPOINTMENTS_CSV, kind === "leads" ? "clean_leads_sample_2026-09-04.csv" : "appointments_sample_2026-09-04.csv")}
              className="flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[12px] font-extrabold transition-all hover:scale-[1.01]"
              style={{ color: accent, borderColor: `${accent}45`, background: `${accent}0d` }}>
              <I name="spark" size={13} /> {t("Load Sept 4 sample export")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col p-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              { n: parsed.rows, label: t("rows") },
              { n: parsed.columns.length, label: t("columns mapped") },
              { n: parsed.warnings.length, label: t("warnings"), warn: parsed.warnings.length > 0 },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5 text-center">
                <div className="num text-[19px] font-bold leading-none" style={{ color: s.warn ? "#e8a33d" : accent }}>{s.n}</div>
                <div className="mt-1 text-[9.5px] font-extrabold uppercase tracking-wider text-ink-500">{s.label}</div>
              </div>
            ))}
          </div>

          {parsed.studios.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 rounded-xl border border-gold-500/35 bg-gold-500/8 px-3 py-2">
              <I name="building" size={13} className="text-gold-400" />
              <span className="text-[11px] font-bold text-gold-300">{t("New studios will be created")}:</span>
              {parsed.studios.map(s => <Pill key={s.id} color="#fba200" dot={false} className="!text-[9.5px]">{s.city}</Pill>)}
            </div>
          )}

          <button onClick={() => setShowMap(s => !s)}
            className="mt-2.5 flex w-full items-center justify-between rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5 text-[12px] font-extrabold text-ink-200 transition-colors hover:text-gold-300">
            <span className="flex items-center gap-2"><I name="merge" size={13} className="text-ink-400" /> {t("Column mapping")}</span>
            <I name="chevD" size={13} className={`transition-transform ${showMap ? "rotate-180" : ""}`} />
          </button>
          {showMap && (
            <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-ink-700 bg-ink-900/70 animate-pop">
              <table className="w-full border-collapse text-left">
                <tbody className="divide-y divide-ink-750">
                  {parsed.columns.map(c => (
                    <tr key={c.target} className="row-live">
                      <td className="w-4 px-3 py-1.5"><I name="check" size={11} className="text-jade-400" /></td>
                      <td className="max-w-[140px] truncate px-1 py-1.5 text-[10.5px] font-bold text-ink-300" title={c.source}>{c.source}</td>
                      <td className="px-1 py-1.5 text-[10.5px] text-ink-500">→</td>
                      <td className="num px-1 py-1.5 text-[10.5px] font-bold text-gold-300">{c.target}</td>
                      <td className="num max-w-[110px] truncate px-3 py-1.5 text-[10px] text-ink-500" title={c.sample}>{c.sample}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-2.5 flex-1 overflow-hidden rounded-xl border border-ink-700">
            <div className="border-b border-ink-700 bg-ink-850 px-3 py-1.5 text-[9.5px] font-extrabold uppercase tracking-[0.14em] text-ink-500">
              {t("Preview — first 5 rows")}
            </div>
            <div className="max-h-32 overflow-auto">
              <table className="w-full border-collapse text-left">
                <tbody className="divide-y divide-ink-750">
                  {parsed.preview.map((row, i) => (
                    <tr key={i} className="row-live">
                      <td className="px-3 py-1.5 text-[11px] font-extrabold text-ink-100">{row.name}</td>
                      <td className="num px-2 py-1.5 text-[10.5px] text-ink-400">{prettyPhone(row.phone)}</td>
                      <td className="px-2 py-1.5 text-[10.5px] font-bold text-ink-300">{row.studioName || "—"}</td>
                      <td className="num px-3 py-1.5 text-[10px] text-ink-500">{(row.createdAt ?? "").slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {parsed.warnings.length > 0 && (
            <div className="mt-2.5 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/8 px-3 py-2">
              <I name="alert" size={13} className="mt-0.5 shrink-0 text-[#e8a33d]" />
              <div className="space-y-0.5 text-[10.5px] font-semibold text-ink-300">
                {parsed.warnings.slice(0, 3).map((w, i) => <div key={i} className="num">{w.msg}</div>)}
                {parsed.warnings.length > 3 && <div className="text-ink-500">+{parsed.warnings.length - 3} {t("more")}</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Import() {
  const { importCsvData, leads, appointments, navigate, toast, guard, can } = useStore();
  useI18n();
  const [leadFile, setLeadFile] = useState<ParsedFile | null>(null);
  const [apptFile, setApptFile] = useState<ParsedFile | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [stage, setStage] = useState(0);
  const timerIds = useRef<ReturnType<typeof setTimeout>[]>([]);

  const newStudios = useMemo(() => {
    const seen = new Map<number, string>();
    [...(leadFile?.studios ?? []), ...(apptFile?.studios ?? [])].forEach(s => seen.set(s.id, s.city));
    return [...seen.values()];
  }, [leadFile, apptFile]);

  const totals = useMemo(() => {
    const exLeads = new Set(leads.map(l => l.id));
    const exAppts = new Set(appointments.map(a => a.id));
    return {
      newLeads: (leadFile?.leads ?? []).filter(l => !exLeads.has(l.id)).length,
      updLeads: (leadFile?.leads ?? []).filter(l => exLeads.has(l.id)).length,
      newAppts: (apptFile?.appointments ?? []).filter(a => !exAppts.has(a.id)).length,
      calls: (leadFile?.calls ?? []).length,
    };
  }, [leadFile, apptFile, leads, appointments]);

  const ready = phase === "idle" && (leadFile || apptFile);

  const run = () => {
    if (!guard("leads.edit")) return;
    setPhase("running"); setStage(0);
    const studios = [...(leadFile?.studios ?? [])];
    (apptFile?.studios ?? []).forEach(s => { if (!studios.some(x => x.id === s.id)) studios.push(s); });
    const payload = {
      studios,
      leads: leadFile?.leads ?? [],
      appointments: apptFile?.appointments ?? [],
      calls: leadFile?.calls ?? [],
    };
    timerIds.current.forEach(clearTimeout);
    timerIds.current = [];
    STAGES.forEach((_, i) => {
      const tId = setTimeout(() => setStage(i), 320 + i * 420);
      timerIds.current.push(tId);
    });
    const finalTId = setTimeout(() => {
      importCsvData(payload);
      setStage(STAGES.length);
      setPhase("done");
      toast(tf("Import complete — {n} records", { n: payload.leads.length + payload.appointments.length }), "success");
    }, 320 + STAGES.length * 420 + 260);
    timerIds.current.push(finalTId);
  };

  useEffect(() => {
    return () => { timerIds.current.forEach(clearTimeout); };
  }, []);

  return (
    <div className="space-y-5 animate-rise">
      <SectionTitle right={
        <Pill color="#4c8dff" dot={false} className="!text-[10px]">stage.booknow.cleopatraink.com</Pill>
      }>{t("CSV Import")}</SectionTitle>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DropZone kind="leads" parsed={leadFile} onParse={setLeadFile} onClear={() => { setLeadFile(null); setPhase("idle"); }} />
        <DropZone kind="appointments" parsed={apptFile} onParse={setApptFile} onClear={() => { setApptFile(null); setPhase("idle"); }} />
      </div>

      {/* action bar */}
      <div className="sticky bottom-4 z-20">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-ink-600 bg-ink-875/95 px-5 py-4 shadow-pop backdrop-blur">
          {phase === "done" ? (
            <>
              <span className="grid h-9 w-9 place-items-center rounded-xl border border-jade-500/50 bg-jade-500/12 text-jade-400"><I name="check" size={17} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-extrabold text-ink-50">{t("Import complete")}</div>
                <div className="num text-[11px] font-semibold text-ink-400">
                  {tf("{leads} leads · {appts} appointments · {studios} new studios · {calls} call logs", {
                    leads: totals.newLeads + totals.updLeads, appts: totals.newAppts, studios: newStudios.length, calls: totals.calls,
                  })}
                  {totals.updLeads > 0 && ` · ${totals.updLeads} ${t("updated")}`}
                </div>
              </div>
              <Btn variant="outline" onClick={() => navigate({ view: "leads" })}><I name="leads" size={14} /> {t("Open Leads Pipeline")}</Btn>
              <Btn variant="gold" onClick={() => navigate({ view: "appointments" })}><I name="calendar" size={14} /> {t("Open Appointments")}</Btn>
            </>
          ) : phase === "running" ? (
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[12.5px] font-extrabold text-ink-100">
                  <I name="refresh" size={14} className="animate-spin text-gold-400" /> {t(STAGES[Math.min(stage, STAGES.length - 1)])}…
                </span>
                <span className="num text-[11px] font-bold text-gold-300">{Math.min(100, Math.round(((stage + 1) / (STAGES.length + 1)) * 100))}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-750">
                <div className="h-full rounded-full bg-gold-500 transition-all duration-500 ease-out"
                  style={{ width: `${Math.min(100, ((stage + 1) / (STAGES.length + 1)) * 100)}%` }} />
              </div>
            </div>
          ) : (
            <>
              <div className="num min-w-0 flex-1 text-[12px] font-bold text-ink-300">
                {ready ? (
                  <span>
                    <span className="text-lapis-400">{totals.newLeads}</span> {t("leads").toLowerCase()} ·{" "}
                    <span className="text-jade-400">{totals.newAppts}</span> {t("bookings").toLowerCase()} ·{" "}
                    <span className="text-gold-300">{newStudios.length}</span> {t("studios").toLowerCase()} ·{" "}
                    <span className="text-iris-400">{totals.calls}</span> {t("call logs").toLowerCase()}
                  </span>
                ) : <span className="text-ink-500">{t("Parse at least one file to import")}</span>}
              </div>
              {newStudios.length > 0 && ready && (
                <span className="hidden items-center gap-1.5 text-[11px] font-bold text-gold-300 md:flex">
                  <I name="building" size={12} /> {newStudios.slice(0, 4).join(", ")}{newStudios.length > 4 ? ` +${newStudios.length - 4}` : ""}
                </span>
              )}
              <Btn variant="gold" disabled={!ready} locked={!can("leads.edit")} onClick={run} className="!px-5 !py-2.5">
                <I name="download" size={15} /> {t("Import everything")}
              </Btn>
            </>
          )}
        </div>
      </div>

      <p className="text-[10.5px] font-semibold text-ink-500">
        {t("Columns are auto-detected from the export headers; duplicate IDs are updated instead of re-inserted.")}
      </p>
    </div>
  );
}
