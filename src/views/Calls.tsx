import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { Btn, EmptyState, I, Pill, PlayerModal, ResultPill, SectionTitle, Sparkline, inputCls } from "../components/ui";
import { DAILY, fmtDT, fmtDur, prettyPhone, studioById, timeAgo, type CallLog, type CallResult } from "../data/crm";

const mmss = (sec: number) => `${Math.floor(sec / 60).toString().padStart(2, "0")}:${(sec % 60).toString().padStart(2, "0")}`;

const EVENT_COLOR: Record<string, string> = { answer: "#4fd08d", queue: "#74a8ff", end: "#63637a", voicemail: "#b18aff", miss: "#f0716b" };

function LiveBoard() {
  const { calls, liveCalls, extensions, liveEvents } = useStore();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const active = useMemo(
    () => calls.filter(c => c.direction === "inbound" && c.result === "Answered").slice(0, Math.min(liveCalls, 4)),
    [calls, liveCalls],
  );
  const ccExts = extensions.filter(e => e.locationId === null);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {/* live now */}
      <div className="relative overflow-hidden rounded-2xl border border-jade-500/30 bg-ink-875 p-5 shadow-panel xl:col-span-2">
        <div className="pointer-events-none absolute -left-16 -top-20 h-52 w-52 rounded-full bg-jade-500/10 blur-3xl" />
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-[19px] font-bold tracking-wide text-ink-50">Live Floor</h2>
            <span className="title-rule" />
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-jade-500/40 bg-jade-500/10 px-3.5 py-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-jade-400 opacity-70" />
              <span className="h-2.5 w-2.5 rounded-full bg-jade-400" />
            </span>
            <span className="num text-[16px] font-bold text-jade-400">{liveCalls}</span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-jade-400/80">on a call</span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {active.map((c, i) => {
            const elapsed = (c.duration % 240) + tick + i * 37;
            return (
              <div key={c.id} className="row-live flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-900/80 px-3.5 py-3">
                <span className="flex h-4 w-4 items-end justify-center gap-[2px]">
                  <span className="eq-bar w-[3px] rounded-sm bg-jade-400" />
                  <span className="eq-bar w-[3px] rounded-sm bg-jade-400" />
                  <span className="eq-bar w-[3px] rounded-sm bg-jade-400" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-extrabold text-ink-100">{c.fromName}</div>
                  <div className="num truncate text-[10.5px] text-ink-400">{prettyPhone(c.fromNumber)} · {c.agent}</div>
                </div>
                <span className="num rounded-lg border border-jade-500/35 bg-jade-500/10 px-2 py-1 text-[12px] font-bold text-jade-400">{mmss(elapsed)}</span>
              </div>
            );
          })}
          {active.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-ink-600 p-4 text-center text-[12px] font-semibold text-ink-500">
              Floor is quiet — agents are wrapping up notes.
            </div>
          )}
        </div>
      </div>

      {/* callcenter extensions */}
      <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
        <SectionTitle right={<Pill color="#4c8dff" dot={false}>Vonage VBC</Pill>}>Call Center Lines</SectionTitle>
        <div className="space-y-2">
          {ccExts.map(e => (
            <div key={e.id} className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-900 px-3 py-2.5 transition-colors hover:border-lapis-500/40">
              <span className="num grid h-9 w-11 place-items-center rounded-lg border border-gold-500/35 bg-gold-500/10 text-[13px] font-bold text-gold-300">#{e.extension}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-extrabold text-ink-100">{e.username.replace("Cleo.", "")}</div>
                <div className="num text-[10.5px] text-ink-400">{prettyPhone(e.phoneNumber)}</div>
              </div>
              <Pill color="#2fbf71" dot={false} className="!text-[9.5px]">READY</Pill>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-xl border border-ink-700 bg-ink-900 p-3 text-[11px] font-semibold leading-relaxed text-ink-400">
          <span className="text-lapis-400">Routing rule:</span> lead location ext first → fallback to least-busy callcenter line after 18s ring.
        </div>
      </div>

      {/* live event stream */}
      <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel xl:col-span-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.16em] text-ink-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-jade-400" />
            Live event stream · Vonage Events API
          </div>
          <span className="num text-[10.5px] font-bold text-ink-500">websocket · heartbeat 4s</span>
        </div>
        <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
          {liveEvents.map(e => (
            <div key={e.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 animate-pop">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: EVENT_COLOR[e.kind] }} />
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink-200">{e.text}</span>
              <span className="num shrink-0 text-[10px] text-ink-500">{timeAgo(e.at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Calls() {
  const { calls, globalLocation, inRange, toast } = useStore();
  const [q, setQ] = useState("");
  const [dir, setDir] = useState<"all" | "inbound" | "outbound">("all");
  const [result, setResult] = useState<"all" | CallResult>("all");
  const [play, setPlay] = useState<CallLog | null>(null);

  const scoped = useMemo(() => {
    const query = q.trim().toLowerCase();
    const digits = query.replace(/[^0-9]/g, "");
    return calls.filter(c =>
      (globalLocation === "all" || c.locationId === globalLocation) &&
      inRange(c.startTime) &&
      (dir === "all" || c.direction === dir) &&
      (!query ||
        c.fromName.toLowerCase().includes(query) || c.toName.toLowerCase().includes(query) ||
        c.agent.toLowerCase().includes(query) ||
        (digits.length > 2 && (c.fromNumber.includes(digits) || c.toNumber.includes(digits)))));
  }, [calls, q, dir, globalLocation, inRange]);
  const resultCounts = useMemo(() => {
    const m: Record<string, number> = {};
    scoped.forEach(c => { m[c.result] = (m[c.result] ?? 0) + 1; });
    return m;
  }, [scoped]);
  const filtered = useMemo(
    () => (result === "all" ? scoped : scoped.filter(c => c.result === result)),
    [scoped, result],
  );

  const answered = filtered.filter(c => c.result === "Answered");
  const rate = filtered.length ? Math.round((answered.length / filtered.length) * 100) : 0;
  const avg = answered.length ? Math.round(answered.reduce((s, c) => s + c.duration, 0) / answered.length) : 0;
  const missed = filtered.filter(c => c.result === "Missed").length;
  const rows = filtered.slice(0, 50);

  return (
    <div className="space-y-4 animate-rise">
      <LiveBoard />

      {/* kpis */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { l: "Calls in range", v: String(filtered.length), c: "#b6b6c6" },
          { l: "Answer rate", v: `${rate}%`, c: "#2fbf71" },
          { l: "Avg talk time", v: fmtDur(avg), c: "#d4af37" },
          { l: "Missed", v: String(missed), c: "#e5484d" },
        ].map((k, i) => (
          <div key={k.l} className="relative overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 p-4 shadow-panel">
            <div className="flex items-end justify-between gap-2">
              <div>
                <div className="num text-[24px] font-bold leading-none" style={{ color: k.c }}>{k.v}</div>
                <div className="mt-1.5 text-[10.5px] font-bold uppercase tracking-wider text-ink-400">{k.l}</div>
              </div>
              {i === 0 && <Sparkline values={DAILY.slice(-14).map(d => d.calls)} color="#4c8dff" h={30} w={84} />}
            </div>
          </div>
        ))}
      </div>

      {/* filters + log */}
      <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-ink-700 p-4">
          <div className="relative min-w-[220px] flex-1">
            <I name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search caller, agent, number…" className={`${inputCls} pl-9`} />
          </div>
          <div className="flex items-center rounded-lg border border-ink-600 p-0.5">
            {(["all", "inbound", "outbound"] as const).map(dv => (
              <button key={dv} onClick={() => setDir(dv)}
                className={`rounded-md px-3 py-1.5 text-[12px] font-bold capitalize transition-colors ${dir === dv ? "bg-gold-500 text-ink-950" : "text-ink-300 hover:text-ink-100"}`}>
                {dv === "all" ? "Both" : dv}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["all", "Answered", "Missed", "Voicemail", "Attempted"] as const).map(r => {
              const active = result === r;
              const n = r === "all" ? scoped.length : resultCounts[r] ?? 0;
              const color = r === "all" ? "#d4af37" : r === "Answered" ? "#2fbf71" : r === "Missed" ? "#e5484d" : r === "Voicemail" ? "#9b6bff" : "#8b8ba0";
              return (
                <button key={r} onClick={() => setResult(r as "all" | CallResult)}
                  className="rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition-all"
                  style={active
                    ? { color: "#0a0a0e", background: color, border: `1px solid ${color}` }
                    : { color, background: `${color}10`, border: `1px solid ${color}35` }}>
                  {r === "all" ? "All results" : r} <span className="num opacity-70">· {n}</span>
                </button>
              );
            })}
          </div>
          <Btn variant="outline" onClick={() => toast("Call log export queued — check your email", "info")}><I name="download" size={14} /> Export</Btn>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-700 bg-ink-850">
                {["When", "Leg", "Parties", "Studio / Agent", "Result", "Recording"].map(h => (
                  <th key={h} className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-750">
              {rows.map(c => (
                <tr key={c.id} className="row-live">
                  <td className="px-4 py-3">
                    <div className="num text-[12.5px] font-bold text-ink-100">{fmtDT(c.startTime)}</div>
                    <div className="num text-[10.5px] text-ink-500">{timeAgo(c.startTime)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`grid h-8 w-8 place-items-center rounded-lg border ${c.direction === "inbound" ? "border-lapis-500/35 bg-lapis-500/10 text-lapis-400" : "border-gold-500/35 bg-gold-500/10 text-gold-400"}`}
                      title={c.direction}>
                      <I name="phone" size={14} className={c.direction === "outbound" ? "-scale-x-100" : ""} />
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-[12.5px] font-bold text-ink-100">{c.fromName} <span className="text-ink-500">→</span> {c.toName}</div>
                    <div className="num text-[10.5px] text-ink-500">{prettyPhone(c.fromNumber)} → {prettyPhone(c.toNumber)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Pill color="#63637a" dot={false}>{studioById(c.locationId)?.slug}</Pill>
                      <span className="num rounded-md border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[10px] font-bold text-ink-300">ext #{c.ext}</span>
                    </div>
                    <div className="mt-1 text-[10.5px] font-semibold text-ink-500">{c.agent}</div>
                  </td>
                  <td className="px-4 py-3"><ResultPill r={c.result} duration={c.duration} /></td>
                  <td className="px-4 py-3">
                    {c.hasRecording ? (
                      <button onClick={() => setPlay(c)}
                        className="group inline-flex items-center gap-2 rounded-lg border border-ink-600 px-2.5 py-1.5 text-[12px] font-bold text-ink-300 transition-all hover:scale-[1.04] hover:border-gold-500/60 hover:text-gold-300">
                        <I name="play" size={12} /> Listen
                      </button>
                    ) : (
                      <span className="num text-[10px] font-bold text-ink-600">no recording</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <div className="p-6"><EmptyState icon="phone" title="No calls match" hint="Widen the date range in the top bar or clear the filters." /></div>
        )}
        <div className="num flex items-center justify-between border-t border-ink-700 px-4 py-3 text-[12px] font-semibold text-ink-400">
          <span>showing {rows.length} of {filtered.length} calls</span>
          <span className="flex items-center gap-1.5 text-jade-400"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-jade-400" /> Vonage webhook streaming</span>
        </div>
      </div>

      {play && <PlayerModal call={play} title={`${play.fromName} → ${play.toName}`} onClose={() => setPlay(null)} />}
    </div>
  );
}
