import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Avatar, I, Pill, PlatformPill, ResultPill, SectionTitle, Sparkline, useCountUp } from "../components/ui";
import { DAILY, FUNNEL, PLATFORM_META, fmtDur, timeAgo, type CallLog, type Platform } from "../data/crm";
import { PlayerModal } from "../components/ui";

function KpiCard({ label, value, sub, delta, values, color, icon }: {
  label: string; value: string; sub: string; delta?: number; values: number[]; color: string; icon: React.ReactNode;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel transition-all duration-200 hover:-translate-y-0.5 hover:border-gold-500/40">
      <div className="absolute -right-6 -top-8 h-24 w-24 rounded-full opacity-[0.08] blur-2xl transition-opacity group-hover:opacity-[0.16]" style={{ background: color }} />
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-400">{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-lg border border-ink-600 bg-ink-800" style={{ color }}>{icon}</span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <div className="num text-[30px] font-bold leading-none tracking-tight text-ink-50">{value}</div>
          <div className="mt-1.5 text-[11.5px] font-semibold text-ink-400">{sub}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {delta !== undefined && (
            <span className={`num inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${up ? "bg-jade-500/12 text-jade-400" : "bg-ember-500/12 text-ember-400"}`}>
              <I name={up ? "bolt" : "alert"} size={11} />{up ? "+" : ""}{delta}%
            </span>
          )}
          <Sparkline values={values} color={color} />
        </div>
      </div>
    </div>
  );
}

function VolumeChart() {
  const W = 720, H = 220, P = 26;
  const data = DAILY.slice(-14);
  const max = Math.max(...data.map(d => Math.max(d.leads, d.calls)));
  const x = (i: number) => P + (i / (data.length - 1)) * (W - P * 2);
  const y = (v: number) => H - P - (v / max) * (H - P * 2);
  const line = (key: "leads" | "appts" | "calls") => data.map((d, i) => `${x(i)},${y(d[key])}`).join(" ");
  const area = (key: "leads" | "calls") => `${P},${H - P} ${line(key)} ${W - P},${H - P}`;
  const series = [
    { key: "calls" as const, label: "Calls", color: "#4c8dff" },
    { key: "leads" as const, label: "Leads", color: "#d4af37" },
    { key: "appts" as const, label: "Appointments", color: "#2fbf71" },
  ];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        {series.map(s => (
          <span key={s.key} className="flex items-center gap-2 text-[12px] font-bold text-ink-300">
            <span className="h-[3px] w-5 rounded-full" style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[0.25, 0.5, 0.75, 1].map(f => (
          <line key={f} x1={P} x2={W - P} y1={y(max * f)} y2={y(max * f)} stroke="#22222e" strokeDasharray="3 5" />
        ))}
        <polygon points={area("calls")} fill="#4c8dff" opacity="0.07" />
        <polygon points={area("leads")} fill="#d4af37" opacity="0.1" />
        <polyline points={line("calls")} fill="none" stroke="#4c8dff" strokeWidth="2" opacity="0.85" strokeLinejoin="round" />
        <polyline points={line("leads")} fill="none" stroke="#d4af37" strokeWidth="2.4" strokeLinejoin="round" />
        <polyline points={line("appts")} fill="none" stroke="#2fbf71" strokeWidth="2" strokeDasharray="6 4" strokeLinejoin="round" />
        {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.leads)} r="2.6" fill="#d4af37" />)}
      </svg>
    </div>
  );
}

export default function Dashboard() {
  const { leads, appointments, calls, globalLocation, inRange, navigate, unreadTotal } = useStore();
  const [playCall, setPlayCall] = useState<CallLog | null>(null);

  const locOk = (locId: number) => globalLocation === "all" || globalLocation === locId;
  const fLeads = useMemo(() => leads.filter(l => locOk(l.locationId) && inRange(l.createdAt)), [leads, globalLocation, inRange]);
  const fAppts = useMemo(() => appointments.filter(a => locOk(a.locationId) && inRange(a.createdAt)), [appointments, globalLocation, inRange]);
  const fCalls = useMemo(() => calls.filter(c => locOk(c.locationId) && inRange(c.startTime)), [calls, globalLocation, inRange]);

  const missed = fCalls.filter(c => c.result === "Missed").length;
  const inbound = fCalls.filter(c => c.direction === "inbound").length;
  const answered = fCalls.filter(c => c.result === "Answered");
  const avgDur = answered.length ? Math.round(answered.reduce((s, c) => s + c.duration, 0) / answered.length) : 0;

  const platformCounts = useMemo(() => {
    const m = new Map<Platform, number>();
    fLeads.forEach(l => m.set(l.attr.platform, (m.get(l.attr.platform) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [fLeads]);
  const topChannel = platformCounts[0];

  const recentLeads = [...fLeads].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 6);
  const recentCalls = fCalls.slice(0, 6);

  const leadsDelta = 12, apptsDelta = 8, callsDelta = -4;
  const kLeads = useCountUp(fLeads.length);
  const kAppts = useCountUp(fAppts.length);
  const kCalls = useCountUp(fCalls.length);

  const funnelMax = FUNNEL[0].count;

  return (
    <div className="space-y-6 animate-rise">
      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="New Leads" value={String(kLeads)} sub={`${fLeads.filter(l => l.callStatus === "not_called").length} awaiting first call`} delta={leadsDelta} values={DAILY.slice(-14).map(d => d.leads)} color="#d4af37" icon={<I name="leads" size={15} />} />
        <KpiCard label="Appointments Booked" value={String(kAppts)} sub={`${fLeads.length ? Math.round((fAppts.length / Math.max(fLeads.length, 1)) * 100) : 0}% lead conversion rate`} delta={apptsDelta} values={DAILY.slice(-14).map(d => d.appts)} color="#2fbf71" icon={<I name="calendar" size={15} />} />
        <KpiCard label="Call Volume" value={String(kCalls)} sub={`${inbound} in · ${fCalls.length - inbound} out · avg ${fmtDur(avgDur)}`} delta={callsDelta} values={DAILY.slice(-14).map(d => d.calls)} color="#4c8dff" icon={<I name="phone" size={15} />} />
        <div className="relative overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-400">Top Channel</span>
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-ink-600 bg-ink-800 text-gold-400"><I name="spark" size={15} /></span>
          </div>
          {topChannel && (
            <>
              <div className="mt-3 flex items-end gap-2">
                <span className="text-[24px] font-extrabold leading-none text-ink-50" style={{ color: PLATFORM_META[topChannel[0]].color }}>{PLATFORM_META[topChannel[0]].label}</span>
              </div>
              <div className="mt-1.5 text-[11.5px] font-semibold text-ink-400">{topChannel[1]} leads · {Math.round((topChannel[1] / Math.max(fLeads.length, 1)) * 100)}% of total</div>
            </>
          )}
          <div className="mt-3 space-y-1.5">
            {platformCounts.slice(0, 4).map(([p, n]) => (
              <div key={p} className="flex items-center gap-2">
                <span className="w-[76px] text-[10.5px] font-bold text-ink-400">{PLATFORM_META[p].label}</span>
                <div className="h-[7px] flex-1 overflow-hidden rounded-full bg-ink-700">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(n / Math.max(fLeads.length, 1)) * 100}%`, background: PLATFORM_META[p].color }} />
                </div>
                <span className="num w-6 text-right text-[11px] font-bold text-ink-300">{n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel xl:col-span-3">
          <SectionTitle right={<Pill color="#8b8ba0" dot={false}>last 14 days</Pill>}>Daily Volume</SectionTitle>
          <VolumeChart />
        </div>
        <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel xl:col-span-2">
          <SectionTitle right={<Pill color="#e5484d" dot={false}>−{Math.round((1 - FUNNEL[FUNNEL.length - 1].count / funnelMax) * 100)}% total drop</Pill>}>Intake Funnel Drop-off</SectionTitle>
          <div className="space-y-3">
            {FUNNEL.map((f, i) => {
              const pct = Math.round((f.count / funnelMax) * 100);
              const dropPct = i > 0 ? Math.round((1 - f.count / FUNNEL[i - 1].count) * 100) : 0;
              return (
                <div key={f.label} className="group">
                  <div className="mb-1 flex items-baseline justify-between text-[12px]">
                    <span className="font-bold text-ink-200"><span className="num mr-2 text-gold-500">{i + 1}</span>{f.label}</span>
                    <span className="num font-bold text-ink-300">{f.count.toLocaleString()} <span className="text-ink-500">· {pct}%</span></span>
                  </div>
                  <div className="relative h-[22px] overflow-hidden rounded-md bg-ink-800">
                    <div className="flex h-full items-center rounded-md bg-gradient-to-r from-gold-600/70 to-gold-500/90 pl-2 transition-all duration-700 group-hover:from-gold-500 group-hover:to-gold-400" style={{ width: `${Math.max(pct, 4)}%` }}>
                      {i > 0 && <span className="num whitespace-nowrap text-[10px] font-bold text-ink-950/80">−{dropPct}% drop</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Feeds row */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
          <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3.5">
            <h3 className="font-display text-[15px] font-bold tracking-wide text-ink-50">Recent Inquiries</h3>
            <button onClick={() => navigate({ view: "leads" })} className="flex items-center gap-1 text-[12px] font-bold text-gold-400 transition-colors hover:text-gold-300">
              Open pipeline <I name="chevR" size={12} />
            </button>
          </div>
          <div className="divide-y divide-ink-750">
            {recentLeads.map(l => (
              <button key={l.id} onClick={() => navigate({ view: "lead", id: l.id })}
                className="row-live flex w-full items-center gap-3 px-5 py-3 text-left">
                <Avatar name={l.name} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-ink-100">{l.name}</span>
                  <span className="block truncate text-[11.5px] text-ink-400">{l.meta.style} · {l.meta.bodyAreas[0]} · {l.meta.size}</span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <PlatformPill p={l.attr.platform} />
                  <span className="num text-[10.5px] text-ink-500">{timeAgo(l.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
          <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3.5">
            <h3 className="font-display text-[15px] font-bold tracking-wide text-ink-50">Recent Call Activity</h3>
            <button onClick={() => navigate({ view: "calls" })} className="flex items-center gap-1 text-[12px] font-bold text-gold-400 transition-colors hover:text-gold-300">
              Call center <I name="chevR" size={12} />
            </button>
          </div>
          <div className="divide-y divide-ink-750">
            {recentCalls.map(c => (
              <div key={c.id} className="row-live flex items-center gap-3 px-5 py-3">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${c.direction === "inbound" ? "border-lapis-500/35 bg-lapis-500/10 text-lapis-400" : "border-gold-500/35 bg-gold-500/10 text-gold-400"}`}>
                  <I name="phone" size={14} className={c.direction === "outbound" ? "-scale-x-100" : ""} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-ink-100">
                    {c.direction === "inbound" ? c.fromName : c.toName}
                  </span>
                  <span className="num block truncate text-[11px] text-ink-400">{c.fromName} → {c.toName} · {timeAgo(c.startTime)}</span>
                </span>
                <ResultPill r={c.result} duration={c.duration} />
                {c.hasRecording ? (
                  <button onClick={() => setPlayCall(c)} className="grid h-8 w-8 place-items-center rounded-lg border border-ink-600 text-ink-300 transition-all hover:scale-105 hover:border-gold-500/60 hover:text-gold-300" title="Listen to recording">
                    <I name="play" size={13} />
                  </button>
                ) : <span className="num w-8 text-center text-[10px] font-bold text-ink-600">—</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* pipeline shortcut strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Uncalled leads", n: leads.filter(l => l.callStatus === "not_called").length, color: "#8b8ba0", view: "leads" as const },
          { label: "Pending bookings", n: appointments.filter(a => a.status === "pending").length, color: "#e8a33d", view: "appointments" as const },
          { label: "Unread SMS", n: unreadTotal, color: "#e5484d", view: "sms" as const },
          { label: "Missed calls", n: missed, color: "#f0716b", view: "calls" as const },
        ].map(s => (
          <button key={s.label} onClick={() => navigate({ view: s.view })}
            className="group flex items-center justify-between rounded-xl border border-ink-700 bg-ink-875 px-4 py-3.5 text-left shadow-panel transition-all hover:-translate-y-0.5 hover:border-gold-500/40">
            <span>
              <span className="num block text-[22px] font-bold leading-none" style={{ color: s.color }}>{s.n}</span>
              <span className="mt-1 block text-[11px] font-bold uppercase tracking-wider text-ink-400">{s.label}</span>
            </span>
            <I name="chevR" size={16} className="text-ink-600 transition-all group-hover:translate-x-1 group-hover:text-gold-400" />
          </button>
        ))}
      </div>

      {playCall && <PlayerModal call={playCall} title={`${playCall.fromName} → ${playCall.toName}`} onClose={() => setPlayCall(null)} />}
    </div>
  );
}
