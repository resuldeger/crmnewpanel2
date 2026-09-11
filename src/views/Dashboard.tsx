import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Avatar, CallStatusPill, I, PlatformPill, ResultPill, SectionTitle, Sparkline, useCountUp, PlayerModal } from "../ui";
import { DAILY, FUNNEL, PLATFORM_META, fmtDur, timeAgo, studioById, type CallLog, type Platform } from "../data";
import { t, tf, useI18n } from "../i18n";

function KpiCard({ label, value, sub, delta, values, color, icon }: {
  label: string; value: string; sub: string; delta?: number; values: number[]; color: string; icon: React.ReactNode;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel transition-all duration-200 hover:-translate-y-0.5 hover:border-gold-500/40">
      <div className="absolute -right-6 -top-8 h-24 w-24 rounded-full opacity-[0.1] blur-2xl transition-opacity group-hover:opacity-[0.2]" style={{ background: color }} />
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-400">{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-lg border border-ink-600 bg-ink-800" style={{ color }}>{icon}</span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <div className="kpi-num text-ink-50">{value}</div>
          <div className="mt-1.5 text-[11.5px] font-semibold text-ink-400">{sub}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {delta !== undefined && (
            <span className={`num inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${up ? "bg-jade-500/12 text-jade-400" : "bg-ember-500/12 text-ember-400"}`}
              title={t("vs previous period")}>
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
    { key: "leads" as const, label: "Leads", color: "#fba200" },
    { key: "appts" as const, label: "Appointments", color: "#2fbf71" },
  ];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        {series.map(s => (
          <span key={s.key} className="flex items-center gap-2 text-[12px] font-bold text-ink-300">
            <span className="h-[3px] w-5 rounded-full" style={{ background: s.color }} />{t(s.label)}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[0.25, 0.5, 0.75, 1].map(f => (
          <line key={f} x1={P} x2={W - P} y1={y(max * f)} y2={y(max * f)} stroke="#dbd5c6" strokeDasharray="3 5" />
        ))}
        <polygon points={area("calls")} fill="#4c8dff" opacity="0.07" />
        <polygon points={area("leads")} fill="#fba200" opacity="0.12" />
        <polyline points={line("calls")} fill="none" stroke="#4c8dff" strokeWidth="2" opacity="0.85" strokeLinejoin="round" />
        <polyline points={line("leads")} fill="none" stroke="#fba200" strokeWidth="2.4" strokeLinejoin="round" />
        <polyline points={line("appts")} fill="none" stroke="#2fbf71" strokeWidth="2" strokeDasharray="6 4" strokeLinejoin="round" />
        {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.leads)} r="2.6" fill="#fba200" />)}
      </svg>
    </div>
  );
}

export default function Dashboard() {
  const { leads, appointments, calls, locOk, inRange, dateRange, navigate, unreadTotal, notCalledCount } = useStore();
  useI18n();
  const [playCall, setPlayCall] = useState<CallLog | null>(null);

  const fLeads = useMemo(() => leads.filter(l => locOk(l.locationId) && inRange(l.createdAt)), [leads, locOk, inRange]);
  const fAppts = useMemo(() => appointments.filter(a => locOk(a.locationId) && inRange(a.createdAt)), [appointments, locOk, inRange]);
  const fCalls = useMemo(() => calls.filter(c => locOk(c.locationId) && inRange(c.startTime)), [calls, locOk, inRange]);

  /* previous-period comparison */
  const now = Date.now();
  const span = dateRange === "today" ? 86_400_000 : dateRange === "7" ? 7 * 86_400_000 : dateRange === "30" ? 30 * 86_400_000 : null;
  const inPrev = (iso: string) => {
    if (!span) return false;
    const age = now - +new Date(iso);
    return age >= span && age < span * 2;
  };
  const pct = (cur: number, prev: number) => (span ? Math.round(((cur - prev) / Math.max(prev, 1)) * 100) : undefined);
  const leadsDelta = pct(fLeads.length, leads.filter(l => locOk(l.locationId) && inPrev(l.createdAt)).length);
  const apptsDelta = pct(fAppts.length, appointments.filter(a => locOk(a.locationId) && inPrev(a.createdAt)).length);
  const callsDelta = pct(fCalls.length, calls.filter(c => locOk(c.locationId) && inPrev(c.startTime)).length);

  const kLeads = useCountUp(fLeads.length);
  const kAppts = useCountUp(fAppts.length);
  const kCalls = useCountUp(fCalls.length);

  const inbound = fCalls.filter(c => c.direction === "inbound").length;
  const answered = fCalls.filter(c => c.result === "Answered");
  const avgDur = answered.length ? Math.round(answered.reduce((s, c) => s + c.duration, 0) / answered.length) : 0;
  const awaiting = fLeads.filter(l => l.callStatus === "not_called").length;

  const platformCounts = useMemo(() => {
    const m = new Map<Platform, number>();
    fLeads.forEach(l => m.set(l.attr.platform, (m.get(l.attr.platform) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [fLeads]);
  const topChannel = platformCounts[0];

  const recentLeads = [...fLeads].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 6);
  const recentCalls = fCalls.slice(0, 6);
  const funnelMax = FUNNEL[0].count;

  return (
    <div className="space-y-6 animate-rise">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={t("New Leads")} value={String(kLeads)} sub={tf("{n} awaiting first call", { n: awaiting })} delta={leadsDelta} values={DAILY.slice(-14).map(d => d.leads)} color="#fba200" icon={<I name="leads" size={15} />} />
        <KpiCard label={t("Appointments Booked")} value={String(kAppts)} sub={tf("{p}% lead conversion rate", { p: fLeads.length ? Math.round((fAppts.length / Math.max(fLeads.length, 1)) * 100) : 0 })} delta={apptsDelta} values={DAILY.slice(-14).map(d => d.appts)} color="#2fbf71" icon={<I name="calendar" size={15} />} />
        <KpiCard label={t("Call Volume")} value={String(kCalls)} sub={tf("{i} in · {o} out · avg {d}", { i: inbound, o: fCalls.length - inbound, d: fmtDur(avgDur) })} delta={callsDelta} values={DAILY.slice(-14).map(d => d.calls)} color="#4c8dff" icon={<I name="phone" size={15} />} />
        <div className="relative overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-400">{t("Top Channel")}</span>
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-ink-600 bg-ink-800 text-gold-400"><I name="spark" size={15} /></span>
          </div>
          {topChannel && (
            <>
              <div className="mt-3 flex items-end gap-2">
                <span className="text-[26px] font-extrabold leading-none" style={{ color: PLATFORM_META[topChannel[0]].color }}>{t(PLATFORM_META[topChannel[0]].label)}</span>
              </div>
              <div className="mt-1.5 text-[11.5px] font-semibold text-ink-400">{tf("{n} leads · {p}% of total", { n: topChannel[1], p: Math.round((topChannel[1] / Math.max(fLeads.length, 1)) * 100) })}</div>
            </>
          )}
          <div className="mt-3 space-y-1.5">
            {platformCounts.slice(0, 4).map(([p, n]) => (
              <div key={p} className="flex items-center gap-2">
                <span className="w-[76px] text-[10.5px] font-bold text-ink-400">{t(PLATFORM_META[p].label)}</span>
                <div className="h-[7px] flex-1 overflow-hidden rounded-full bg-ink-750">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(n / Math.max(topChannel?.[1] ?? 1, 1)) * 100}%`, background: PLATFORM_META[p].color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SLA strip */}
      {notCalledCount > 0 && (
        <button onClick={() => navigate({ view: "leads" })}
          className="flex w-full items-center gap-3 rounded-2xl border border-gold-500/45 bg-gold-500/10 px-5 py-3.5 text-left shadow-panel transition-all hover:border-gold-500/70 hover:bg-gold-500/15">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gold-500 text-ink-50"><I name="clock" size={16} /></span>
          <span className="flex-1 text-[13.5px] font-extrabold text-gold-300">
            {tf("{n} awaiting first call", { n: notCalledCount })}
            <span className="ml-2 text-[12px] font-bold text-ink-400">{t("First call SLA: 15 minutes")}</span>
          </span>
          <span className="flex items-center gap-1 text-[12px] font-bold text-gold-300">{t("Leads Pipeline")} <I name="chevR" size={13} /></span>
        </button>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel xl:col-span-2">
          <SectionTitle>{t("Volume — last 14 days")}</SectionTitle>
          <VolumeChart />
        </div>
        <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
          <SectionTitle>{t("Conversion Funnel")}</SectionTitle>
          <div className="space-y-2.5">
            {FUNNEL.map((f, i) => (
              <div key={f.key}>
                <div className="mb-1 flex items-center justify-between text-[12px] font-bold">
                  <span className="text-ink-300">{t(f.key)}</span>
                  <span className="num text-ink-200">{f.count}{i > 0 && <span className="ml-1.5 text-[10.5px] text-ink-500">−{Math.round((1 - f.count / FUNNEL[i - 1].count) * 100)}%</span>}</span>
                </div>
                <div className="h-[18px] overflow-hidden rounded-md bg-ink-800">
                  <div className="flex h-full items-center rounded-md pl-2 transition-all duration-700" style={{ width: `${(f.count / funnelMax) * 100}%`, background: `linear-gradient(90deg, ${f.color}, ${f.color}88)` }}>
                    <span className="num text-[10px] font-bold text-white/90">{Math.round((f.count / funnelMax) * 100)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {unreadTotal > 0 && (
            <button onClick={() => navigate({ view: "sms" })} className="mt-4 flex w-full items-center gap-2 rounded-xl border border-ember-500/40 bg-ember-500/8 px-3.5 py-2.5 text-[12.5px] font-bold text-ember-400 transition-colors hover:bg-ember-500/15">
              <I name="chat" size={14} /> {unreadTotal} {t("Unread")} · {t("SMS Messenger")} <I name="chevR" size={12} className="ml-auto" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
          <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3.5">
            <h3 className="font-display text-[15px] font-bold tracking-wide text-ink-50">{t("Recent Leads")}</h3>
            <button
              onClick={() => navigate({ view: "leads" })}
              className="inline-flex items-center gap-1 text-[12px] font-bold text-gold-400 hover:text-gold-300 transition-colors"
            >
              <I name="table" size={13} /> {t("View All in Table")}
            </button>
          </div>
          <div className="max-h-[360px] overflow-y-auto pr-1 divide-y divide-ink-750">
            {recentLeads.map(l => (
              <button key={l.id} onClick={() => navigate({ view: "lead", id: l.id })} className="row-live flex w-full items-center gap-3 px-5 py-3 text-left">
                <Avatar name={l.name} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-extrabold text-ink-100">{l.name}</span>
                  <span className="block text-[11px] font-semibold text-ink-500">{studioById(l.locationId)?.city} · {timeAgo(l.createdAt)}</span>
                </span>
                <PlatformPill p={l.attr.platform} />
                <CallStatusPill s={l.callStatus} />
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
          <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3.5">
            <h3 className="font-display text-[15px] font-bold tracking-wide text-ink-50">{t("Recent Calls")}</h3>
            <button
              onClick={() => navigate({ view: "calls" })}
              className="inline-flex items-center gap-1 text-[12px] font-bold text-gold-400 hover:text-gold-300 transition-colors"
            >
              <I name="table" size={13} /> {t("View All in Table")}
            </button>
          </div>
          <div className="max-h-[360px] overflow-y-auto pr-1 divide-y divide-ink-750">
            {recentCalls.map(c => (
              <div key={c.id} className="row-live flex items-center gap-3 px-5 py-3">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${c.direction === "inbound" ? "border-jade-500/40 bg-jade-500/10 text-jade-400" : "border-lapis-500/40 bg-lapis-500/10 text-lapis-400"}`}>
                  <I name="phone" size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-extrabold text-ink-100">{c.direction === "inbound" ? c.fromName : c.toName}</span>
                  <span className="num block text-[11px] font-semibold text-ink-500">{timeAgo(c.startTime)} · {c.ext}</span>
                </span>
                <ResultPill r={c.result} duration={c.duration} />
                {c.hasRecording && (
                  <button onClick={() => setPlayCall(c)} title={t("Listen")} className="rounded-lg border border-ink-600 p-1.5 text-ink-400 transition-colors hover:border-gold-500/60 hover:text-gold-300">
                    <I name="play" size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {playCall && <PlayerModal title={playCall.direction === "inbound" ? playCall.fromName : playCall.toName} subtitle={`${playCall.ext} · ${fmtDur(playCall.duration)}`} onClose={() => setPlayCall(null)} />}
    </div>
  );
}
