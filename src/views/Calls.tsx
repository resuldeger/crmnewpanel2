import { useEffect, useMemo, useState } from "react";
import { useStore, type LiveCall } from "../store";
import { Btn, EmptyState, I, Pill, PlayerModal, ResultPill, SectionTitle, Sparkline, inputCls } from "../components/ui";
import { DAILY, fmtDT, fmtDur, prettyPhone, studioById, timeAgo, type CallLog, type CallResult } from "../data/crm";
import { t, tf, useI18n } from "../services/i18n";

const mmss = (sec: number) => `${Math.floor(sec / 60).toString().padStart(2, "0")}:${(sec % 60).toString().padStart(2, "0")}`;

const EVENT_COLOR: Record<string, string> = { answer: "#4fd08d", queue: "#74a8ff", end: "#63637a", voicemail: "#b18aff", miss: "#f0716b" };

function LiveCard({ c, onEnd }: { c: LiveCall; onEnd: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  const ringing = now - c.startedAt < 4500;
  const elapsed = Math.max(0, Math.floor((now - c.startedAt) / 1000));
  return (
    <div className={`row-live flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors ${ringing ? "border-amber-500/40 bg-amber-500/5" : "border-ink-700 bg-ink-900/80"}`}>
      {ringing ? (
        <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-amber-500/45 bg-amber-500/10 text-amber-400">
          <span className="absolute inset-0 animate-ping rounded-lg bg-amber-500/20" />
          <I name="phone" size={15} />
        </span>
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-end justify-center gap-[2.5px] rounded-lg border border-jade-500/40 bg-jade-500/10 px-2">
          <span className="eq-bar w-[3px] rounded-sm bg-jade-400" />
          <span className="eq-bar w-[3px] rounded-sm bg-jade-400" />
          <span className="eq-bar w-[3px] rounded-sm bg-jade-400" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12.5px] font-extrabold text-ink-100">{c.name}</span>
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${ringing ? "animate-blink bg-amber-500/15 text-amber-400" : "bg-jade-500/15 text-jade-400"}`}>
            {ringing ? t("Ringing") : t(c.direction === "inbound" ? "Inbound" : "Outbound")}
          </span>
        </div>
        <div className="num truncate text-[10.5px] text-ink-400">{prettyPhone(c.phone)} · {c.agent} · #{c.ext}</div>
      </div>
      <span className={`num shrink-0 rounded-lg border px-2 py-1 text-[12px] font-bold ${ringing ? "border-amber-500/40 bg-amber-500/10 text-amber-400" : "border-jade-500/35 bg-jade-500/10 text-jade-400"}`}>
        {mmss(elapsed)}
      </span>
      <Btn size="sm" variant="outline" onClick={onEnd} title={t("Wrap call & write to log")}>
        <I name="check" size={12} /> {t("End")}
      </Btn>
    </div>
  );
}

function LiveBoard() {
  const { liveCallsArr, liveEvents, extensions, endLiveCall, toast } = useStore();
  useI18n();
  const ccExts = extensions.filter(e => e.locationId === null);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {/* live now */}
      <div className="relative overflow-hidden rounded-2xl border border-jade-500/30 bg-ink-875 p-5 shadow-panel xl:col-span-2">
        <div className="pointer-events-none absolute -left-16 -top-20 h-52 w-52 rounded-full bg-jade-500/10 blur-3xl" />
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-[19px] font-bold tracking-wide text-ink-50">{t("Live Floor")}</h2>
            <span className="title-rule" />
            <p className="mt-2 max-w-md text-[11.5px] font-semibold leading-relaxed text-ink-400">
              {t("Real queue from the Vonage Events API — every call below is written to the log below when it ends.")}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-jade-500/40 bg-jade-500/10 px-3.5 py-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-jade-400 opacity-70" />
              <span className="h-2.5 w-2.5 rounded-full bg-jade-400" />
            </span>
            <span className="num text-[16px] font-bold text-jade-400">{liveCallsArr.length}</span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-jade-400/80">{t("on a call")}</span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {liveCallsArr.map(c => (
            <LiveCard key={c.id} c={c} onEnd={() => { endLiveCall(c.id); toast(tf("Call with {name} wrapped & logged with recording", { name: c.name })); }} />
          ))}
          {liveCallsArr.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-ink-600 p-5 text-center text-[12px] font-semibold text-ink-500">
              {t("Floor is quiet — new calls ring in automatically.")}
            </div>
          )}
        </div>
      </div>

      {/* callcenter extensions */}
      <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
        <SectionTitle right={<Pill color="#4c8dff" dot={false}>Vonage VBC</Pill>}>{t("Call Center Lines")}</SectionTitle>
        <div className="space-y-2">
          {ccExts.map(e => {
            const busy = liveCallsArr.some(c => c.ext === e.extension);
            return (
              <div key={e.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${busy ? "border-jade-500/40 bg-jade-500/5" : "border-ink-700 bg-ink-900 hover:border-lapis-500/40"}`}>
                <span className="num grid h-9 w-11 place-items-center rounded-lg border border-gold-500/35 bg-gold-500/10 text-[13px] font-bold text-gold-300">#{e.extension}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-extrabold text-ink-100">{e.username.replace("Cleo.", "")}</div>
                  <div className="num text-[10.5px] text-ink-400">{prettyPhone(e.phoneNumber)}</div>
                </div>
                <Pill color={busy ? "#4fd08d" : "#8b8ba0"} dot={false} className="!text-[9.5px]">{busy ? t("IN CALL") : t("READY")}</Pill>
              </div>
            );
          })}
        </div>
        <div className="mt-3 rounded-xl border border-ink-700 bg-ink-900 p-3 text-[11px] font-semibold leading-relaxed text-ink-400">
          <span className="text-lapis-400">{t("Routing rule:")}</span> {t("lead location ext first → fallback to least-busy callcenter line after 18s ring.")}
        </div>
      </div>

      {/* live event stream */}
      <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel xl:col-span-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.16em] text-ink-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-jade-400" />
            {t("Live event stream · Vonage Events API")}
          </div>
          <div className="flex items-center gap-3">
            {Object.entries(EVENT_COLOR).map(([k, col]) => (
              <span key={k} className="hidden items-center gap-1.5 text-[10px] font-bold capitalize text-ink-500 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: col }} />{t(k)}
              </span>
            ))}
            <span className="num text-[10.5px] font-bold text-ink-500">{t("websocket · heartbeat 4s")}</span>
          </div>
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

function CallbackQueue() {
  const { calls, globalLocation, inRange, logCallback, navigate, toast } = useStore();
  useI18n();
  const queue = useMemo(() => {
    const seen = new Set<string>();
    return calls
      .filter(c => (c.result === "Missed" || c.result === "Voicemail") &&
        (globalLocation === "all" || c.locationId === globalLocation) && inRange(c.startTime))
      .filter(c => {
        const key = c.customerId ?? (c.direction === "inbound" ? c.fromNumber : c.toNumber);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
  }, [calls, globalLocation, inRange]);

  return (
    <div className="rounded-2xl border border-ember-500/25 bg-ink-875 p-5 shadow-panel">
      <SectionTitle right={<Pill color="#f0716b" dot={false}>{t("missed + voicemail · deduped")}</Pill>}>{t("Needs a Callback")}</SectionTitle>
      {queue.length === 0 ? (
        <EmptyState icon="check" title={t("Queue is clear")} hint={t("No missed calls or voicemails in the selected range.")} />
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {queue.map(c => {
            const person = c.direction === "inbound" ? { name: c.fromName, phone: c.fromNumber } : { name: c.toName, phone: c.toNumber };
            return (
              <div key={c.id} className="row-live flex flex-col gap-2.5 rounded-xl border border-ink-700 bg-ink-900 p-3.5">
                <div className="flex items-center gap-2.5">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${c.result === "Voicemail" ? "border-iris-500/40 bg-iris-500/10 text-iris-400" : "border-ember-500/40 bg-ember-500/10 text-ember-400"}`}>
                    <I name={c.result === "Voicemail" ? "mic" : "phone"} size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-extrabold text-ink-100">{person.name}</div>
                    <div className="num text-[10.5px] text-ink-400">{prettyPhone(person.phone)} · {timeAgo(c.startTime)}</div>
                  </div>
                  <ResultPill r={c.result} duration={c.duration} />
                </div>
                <div className="flex items-center gap-1.5">
                  <Btn size="sm" variant="gold" className="flex-1"
                    onClick={() => {
                      const res = logCallback({ name: person.name, phone: person.phone, customerId: c.customerId, locationId: c.locationId });
                      toast(res === "Answered"
                        ? tf("{name} picked up the callback — logged", { name: person.name })
                        : tf("No answer from {name} — logged as Attempted", { name: person.name }), res === "Answered" ? "success" : "info");
                    }}>
                    <I name="phone" size={12} /> {t("Call back")}
                  </Btn>
                  {c.customerId && (
                    <Btn size="sm" variant="outline" onClick={() => navigate({ view: "lead", id: c.customerId! })}>
                      <I name="leads" size={12} />
                    </Btn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Calls() {
  const { calls, globalLocation, inRange, toast } = useStore();
  useI18n();
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
  const voicemail = filtered.filter(c => c.result === "Voicemail").length;
  const rows = filtered.slice(0, 50);

  return (
    <div className="space-y-4 animate-rise">
      <LiveBoard />
      <CallbackQueue />

      {/* kpis */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { l: "Calls in range", v: String(filtered.length), c: "#b6b6c6", spark: true },
          { l: "Answer rate", v: `${rate}%`, c: "#2fbf71" },
          { l: "Avg talk time", v: fmtDur(avg), c: "#d4af37" },
          { l: "Missed", v: String(missed), c: "#e5484d" },
          { l: "Voicemail", v: String(voicemail), c: "#9b6bff" },
        ].map(k => (
          <div key={k.l} className="relative overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 p-4 shadow-panel">
            <div className="flex items-end justify-between gap-2">
              <div>
                <div className="num text-[24px] font-bold leading-none" style={{ color: k.c }}>{k.v}</div>
                <div className="mt-1.5 text-[10.5px] font-bold uppercase tracking-wider text-ink-400">{t(k.l)}</div>
              </div>
              {k.spark && <Sparkline values={DAILY.slice(-14).map(d => d.calls)} color="#4c8dff" h={30} w={70} />}
            </div>
          </div>
        ))}
      </div>

      {/* filters + log */}
      <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-ink-700 p-4">
          <div className="relative min-w-[220px] flex-1">
            <I name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("Search caller, agent, number…")} className={`${inputCls} pl-9`} />
          </div>
          <div className="flex items-center rounded-lg border border-ink-600 p-0.5">
            {(["all", "inbound", "outbound"] as const).map(dv => (
              <button key={dv} onClick={() => setDir(dv)}
                className={`rounded-md px-3 py-1.5 text-[12px] font-bold transition-colors ${dir === dv ? "bg-gold-500 text-ink-950" : "text-ink-300 hover:text-ink-100"}`}>
                {dv === "all" ? t("Both") : t(dv === "inbound" ? "Inbound" : "Outbound")}
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
                  {r === "all" ? t("All results") : t(r)} <span className="num opacity-70">· {n}</span>
                </button>
              );
            })}
          </div>
          <Btn variant="outline" onClick={() => toast(t("Call log export queued — check your email"), "info")}><I name="download" size={14} /> {t("Export")}</Btn>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-700 bg-ink-850">
                {[t("When"), t("Leg"), t("Parties"), t("Studio / Agent"), t("Result"), t("Recording")].map(h => (
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
                      title={t(c.direction === "inbound" ? "Inbound" : "Outbound")}>
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
                        <I name="play" size={12} /> {t("Listen")}
                      </button>
                    ) : (
                      <span className="num text-[10px] font-bold text-ink-600">{t("no recording")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <div className="p-6"><EmptyState icon="phone" title={t("No calls match")} hint={t("Widen the date range in the top bar or clear the filters.")} /></div>
        )}
        <div className="num flex items-center justify-between border-t border-ink-700 px-4 py-3 text-[12px] font-semibold text-ink-400">
          <span>{tf("showing {n} of {m} calls", { n: rows.length, m: filtered.length })}</span>
          <span className="flex items-center gap-1.5 text-jade-400"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-jade-400" /> {t("Vonage webhook streaming")}</span>
        </div>
      </div>

      {play && <PlayerModal call={play} title={`${play.fromName} → ${play.toName}`} onClose={() => setPlay(null)} />}
    </div>
  );
}
