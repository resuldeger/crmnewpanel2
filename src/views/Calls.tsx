import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { Avatar, Btn, EmptyState, I, Pagination, Pill, PlayerModal, ResultPill, SectionTitle } from "../ui";
import { fmtDT, fmtDur, prettyPhone, studioById, timeAgo, type CallLog, type CallResult } from "../data";
import { t, tf, useI18n } from "../i18n";

const RESULT_ORDER: CallResult[] = ["Answered", "Missed", "Voicemail", "Attempted"];
const RESULT_COLORS: Record<CallResult, string> = { Answered: "#2fbf71", Missed: "#e5484d", Voicemail: "#e8a33d", Attempted: "#948d7d" };

function LiveTimer({ startedAt, ringing }: { startedAt: number; ringing: boolean }) {
  const [, force] = useState(0);
  useEffect(() => { const i = setInterval(() => force(x => x + 1), 1000); return () => clearInterval(i); }, []);
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return (
    <span className={`num text-[15px] font-extrabold ${ringing ? "text-ember-400 animate-blink" : "text-jade-400"}`}>
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

export default function Calls() {
  const { calls, liveCallsArr, liveEvents, endLiveCall, logCallback, addTask, toast, navigate, can, guard } = useStore();
  useI18n();
  const [resultFilter, setResultFilter] = useState<"all" | CallResult>("all");
  const [play, setPlay] = useState<CallLog | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 12;
  useEffect(() => setPage(0), [resultFilter]);

  const counts = useMemo(() => {
    const m = new Map<CallResult, number>();
    calls.forEach(c => m.set(c.result, (m.get(c.result) ?? 0) + 1));
    return m;
  }, [calls]);

  const filtered = useMemo(() =>
    calls.filter(c => resultFilter === "all" || c.result === resultFilter), [calls, resultFilter]);

  const callbackQueue = useMemo(() => {
    const seen = new Set<string>();
    return calls
      .filter(c => (c.result === "Missed" || c.result === "Voicemail"))
      .filter(c => {
        const key = c.customerId ?? c.fromNumber;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
  }, [calls]);

  const createTask = (name: string, phone: string, customerId: string | null, locationId: number, source: "callback" | "voicemail") => {
    if (!guard("calls.manage")) return;
    addTask({
      title: source === "voicemail" ? tf("Callback · {name}", { name }) + " (VM)" : tf("Callback · {name}", { name }),
      leadId: customerId, leadName: name, phone, locationId,
      assignee: "Agent · Callcenter1",
      dueAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
      source,
    });
    toast(tf("Task created · due {ago}", { ago: "+2h" }), "success");
  };

  return (
    <div className="space-y-5 animate-rise">
      {/* live floor */}
      <div>
        <SectionTitle right={
          <span className="flex items-center gap-2 text-[11px] font-bold text-jade-400">
            <span className="relative flex h-2 w-2"><span className="absolute h-2 w-2 animate-ping rounded-full bg-jade-400 opacity-60" /><span className="h-2 w-2 rounded-full bg-jade-400" /></span>
            {t("Live active calls on the Vonage VBC floor")}
          </span>
        }>{t("Live Floor")}</SectionTitle>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {liveCallsArr.map(c => (
            <div key={c.id} className={`rounded-2xl border bg-ink-875 p-4 shadow-panel transition-all ${c.ringing ? "border-ember-500/50" : "border-jade-500/40"}`}>
              <div className="flex items-center gap-3">
                <Avatar name={c.name} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-extrabold text-ink-50">{c.name}</div>
                  <div className="num text-[10.5px] font-semibold text-ink-400">{prettyPhone(c.phone)} · #{c.ext}</div>
                </div>
                <LiveTimer startedAt={c.startedAt} ringing={c.ringing} />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Pill color={c.direction === "inbound" ? "#2fbf71" : "#4c8dff"} dot={false}>{t(c.direction === "inbound" ? "Incoming" : "Outgoing")}</Pill>
                  {c.ringing
                    ? <Pill color="#e5484d" dot={false} className="animate-blink">{t("Ringing")}</Pill>
                    : <span className="flex h-4 items-end gap-[2.5px]">{[0, 1, 2].map(i => <span key={i} className="eq-bar w-[3px] rounded-full bg-jade-500" style={{ height: "100%" }} />)}</span>}
                </div>
                <Btn size="sm" variant={c.ringing ? "danger" : "outline"} locked={!can("calls.manage")}
                  onClick={() => {
                    const dur = endLiveCall(c.id);
                    toast(dur === null || dur === 0 ? t("Call logged as missed") : tf("Call ended · {d}", { d: fmtDur(dur) }), dur && dur > 0 ? "success" : "info");
                  }}>
                  <I name="x" size={12} /> {t("End")}
                </Btn>
              </div>
            </div>
          ))}
          {liveCallsArr.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-ink-600 p-6 text-center text-[12.5px] font-semibold text-ink-400">
              {t("No open tasks — the floor is clear.")}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* event stream */}
        <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel xl:col-span-2">
          <SectionTitle right={<Pill color="#4c8dff" dot={false}>{t("Real-time events from the Vonage Events API")}</Pill>}>{t("Event Stream")}</SectionTitle>
          <div className="space-y-2">
            {liveEvents.map(e => (
              <div key={e.id} className="flex items-center gap-2.5 rounded-lg border border-ink-700 bg-ink-900/70 px-3 py-2 animate-pop">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: e.kind === "answer" || e.kind === "end" ? RESULT_COLORS.Answered : e.kind === "queue" ? RESULT_COLORS.Attempted : e.kind === "voicemail" ? RESULT_COLORS.Voicemail : RESULT_COLORS.Missed }} />
                <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-ink-200">{e.text}</span>
                <span className="num shrink-0 text-[10px] text-ink-500">{timeAgo(e.at)}</span>
              </div>
            ))}
            {liveEvents.length === 0 && <div className="py-6 text-center text-[12px] font-semibold text-ink-400">…</div>}
          </div>
        </div>

        {/* callback queue */}
        <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel xl:col-span-3">
          <SectionTitle right={<Pill color="#e5484d" dot={false}>{t("Missed & voicemail, deduplicated per lead")}</Pill>}>{t("Needs a Callback")}</SectionTitle>
          <div className="divide-y divide-ink-750">
            {callbackQueue.map(c => {
              const name = c.direction === "inbound" ? c.fromName : c.toName;
              return (
                <div key={c.id} className="row-live flex flex-wrap items-center gap-3 py-3">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${c.result === "Voicemail" ? "border-[#e8a33d]/40 bg-[#e8a33d]/10 text-[#e8a33d]" : "border-ember-500/40 bg-ember-500/10 text-ember-400"}`}>
                    <I name={c.result === "Voicemail" ? "note" : "phone"} size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-extrabold text-ink-100">{name}</div>
                    <div className="num text-[11px] font-semibold text-ink-500">{prettyPhone(c.direction === "inbound" ? c.fromNumber : c.toNumber)} · {studioById(c.locationId)?.slug} · {timeAgo(c.startTime)}</div>
                  </div>
                  <ResultPill r={c.result} />
                  <div className="flex gap-1.5">
                    <Btn size="sm" variant="outline" locked={!can("calls.manage")}
                      onClick={() => {
                        const res = logCallback({ name, phone: c.direction === "inbound" ? c.fromNumber : c.toNumber, customerId: c.customerId, locationId: c.locationId });
                        toast(res === "Answered" ? tf("Callback to {name} answered", { name }) : tf("Callback to {name} · no answer", { name }), res === "Answered" ? "success" : "info");
                      }}>
                      <I name="phone" size={12} /> {t("Call back")}
                    </Btn>
                    <Btn size="sm" variant="ghost" title={t("Create task")} locked={!can("calls.manage")}
                      onClick={() => createTask(name, c.direction === "inbound" ? c.fromNumber : c.toNumber, c.customerId, c.locationId, c.result === "Voicemail" ? "voicemail" : "callback")}>
                      <I name="checks" size={13} />
                    </Btn>
                    {c.customerId && <Btn size="sm" variant="ghost" title={t("Open 360° view")} onClick={() => navigate({ view: "lead", id: c.customerId! })}><I name="eye" size={13} /></Btn>}
                  </div>
                </div>
              );
            })}
            {callbackQueue.length === 0 && <div className="p-6"><EmptyState title={t("No open tasks — the floor is clear.")} /></div>}
          </div>
        </div>
      </div>

      {/* call log */}
      <div>
        <SectionTitle right={
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => setResultFilter("all")} className={`rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition-colors ${resultFilter === "all" ? "bg-gold-500 text-ink-50" : "border border-ink-600 text-ink-300"}`}>
              {t("All")} · <span className="num">{calls.length}</span>
            </button>
            {RESULT_ORDER.map(r => (
              <button key={r} onClick={() => setResultFilter(resultFilter === r ? "all" : r)}
                className="rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition-all"
                style={resultFilter === r
                  ? { color: "#fffdf7", background: RESULT_COLORS[r], border: `1px solid ${RESULT_COLORS[r]}` }
                  : { color: RESULT_COLORS[r], background: `${RESULT_COLORS[r]}10`, border: `1px solid ${RESULT_COLORS[r]}35` }}>
                {t(r)} · <span className="num">{counts.get(r) ?? 0}</span>
              </button>
            ))}
          </div>
        }>{t("Call Log")}</SectionTitle>
        <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-700 bg-ink-850">
                  {[t("Created"), t("Direction"), t("Client"), t("Studio"), t("Agent"), t("Status"), ""].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-750">
                {filtered.slice(page * pageSize, (page + 1) * pageSize).map(c => {
                  const name = c.direction === "inbound" ? c.fromName : c.toName;
                  return (
                    <tr key={c.id} className="row-live">
                      <td className="num px-4 py-3 text-[11.5px] font-semibold text-ink-400">{fmtDT(c.startTime)}</td>
                      <td className="px-4 py-3"><Pill color={c.direction === "inbound" ? "#2fbf71" : "#4c8dff"} dot={false}>{t(c.direction === "inbound" ? "Incoming" : "Outgoing")}</Pill></td>
                      <td className="px-4 py-3">
                        <button onClick={() => c.customerId && navigate({ view: "lead", id: c.customerId })} disabled={!c.customerId}
                          className={`text-left text-[13px] font-extrabold ${c.customerId ? "text-ink-100 hover:text-gold-300" : "text-ink-300"}`}>
                          {name}
                          <span className="num block text-[10.5px] font-semibold text-ink-500">{prettyPhone(c.direction === "inbound" ? c.fromNumber : c.toNumber)}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3"><Pill color="#948d7d" dot={false}>{studioById(c.locationId)?.slug ?? "—"}</Pill></td>
                      <td className="num px-4 py-3 text-[11.5px] font-semibold text-ink-300">{c.agent} · #{c.ext}</td>
                      <td className="px-4 py-3"><ResultPill r={c.result} duration={c.duration} /></td>
                      <td className="px-4 py-3 text-right">
                        {c.hasRecording
                          ? <Btn size="sm" variant="outline" onClick={() => setPlay(c)}><I name="play" size={12} /> {t("Listen")}</Btn>
                          : <span className="text-[11px] font-semibold text-ink-500">{t("No recording")}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 && <Pagination total={filtered.length} page={page} pageSize={pageSize} onPage={setPage} unit={t("Calls").toLowerCase()} />}
        </div>
      </div>

      {play && <PlayerModal title={play.direction === "inbound" ? play.fromName : play.toName} subtitle={`#${play.ext} · ${fmtDT(play.startTime)} · ${fmtDur(play.duration)}`} onClose={() => setPlay(null)} />}
    </div>
  );
}
