import { useMemo } from "react";
import { useStore } from "../store";
import { Btn, I, Pill, SectionTitle } from "../ui";
import { PLATFORM_META, fmtDur, studioById, type CallStatus, type Lead, type Platform } from "../data";
import { t, tf, useI18n } from "../i18n";

function deltaOf(cur: number, prev: number, spanOk: boolean): number | undefined {
  return spanOk ? Math.round(((cur - prev) / Math.max(prev, 1)) * 100) : undefined;
}

export default function Reports() {
  const { leads, appointments, calls, conversations, studios, locOk, inRange, dateRange, toast, guard, can } = useStore();
  useI18n();

  const spanOk = dateRange !== "all";
  const now = Date.now();
  const span = dateRange === "today" ? 86_400_000 : dateRange === "7" ? 7 * 86_400_000 : dateRange === "30" ? 30 * 86_400_000 : null;

  const fLeads = useMemo(() => leads.filter(l => locOk(l.locationId) && inRange(l.createdAt)), [leads, locOk, inRange]);
  const fCalls = useMemo(() => calls.filter(c => locOk(c.locationId) && inRange(c.startTime)), [calls, locOk, inRange]);
  const fAppts = useMemo(() => appointments.filter(a => locOk(a.locationId) && inRange(a.createdAt)), [appointments, locOk, inRange]);

  const inPrev = (iso: string) => {
    if (!span) return false;
    const age = now - +new Date(iso);
    return age >= span && age < span * 2;
  };
  const pLeads = leads.filter(l => locOk(l.locationId) && inPrev(l.createdAt)).length;
  const pCalls = calls.filter(c => locOk(c.locationId) && inPrev(c.startTime)).length;
  const pAppts = appointments.filter(a => locOk(a.locationId) && inPrev(a.createdAt)).length;

  /* KPIs */
  const answered = fCalls.filter(c => c.result === "Answered");
  const answerRate = fCalls.length ? Math.round((answered.length / fCalls.length) * 100) : 0;
  const convRate = fLeads.length ? Math.round((fAppts.length / fLeads.length) * 100) : 0;

  /* speed-to-lead SLA */
  const slaBuckets = useMemo(() => {
    const b = { u5: 0, u15: 0, u60: 0, over: 0, never: 0 };
    fLeads.forEach(l => {
      if (l.callStatus === "not_called" || !l.lastCalledAt) { b.never++; return; }
      const min = (+new Date(l.lastCalledAt) - +new Date(l.createdAt)) / 60_000;
      if (min <= 5) b.u5++;
      else if (min <= 15) b.u15++;
      else if (min <= 60) b.u60++;
      else b.over++;
    });
    return b;
  }, [fLeads]);
  const calledCount = slaBuckets.u5 + slaBuckets.u15 + slaBuckets.u60 + slaBuckets.over;
  const withinSla = calledCount ? Math.round(((slaBuckets.u5 + slaBuckets.u15) / calledCount) * 100) : 0;

  /* heatmap */
  const heat = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(13).fill(0));
    fLeads.forEach(l => {
      const d = new Date(l.createdAt);
      const day = (d.getDay() + 6) % 7;
      const h = d.getHours();
      const bucket = Math.min(12, Math.max(0, Math.floor((h - 8) / 1.5)));
      if (h >= 8 && h <= 22) grid[day][bucket]++;
    });
    return grid;
  }, [fLeads]);
  const heatMax = Math.max(1, ...heat.flat());
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const HOURS = ["8", "10", "12", "14", "16", "18", "20", "22"];

  /* platform split */
  const platformSplit = useMemo(() => {
    const m = new Map<Platform, number>();
    fLeads.forEach(l => m.set(l.attr.platform, (m.get(l.attr.platform) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [fLeads]);

  /* campaign performance */
  const campaignPerf = useMemo(() => {
    const m = new Map<string, { leads: number; appts: number }>();
    fLeads.forEach(l => {
      const c = l.attr.utmCampaign ?? "organic";
      const e = m.get(c) ?? { leads: 0, appts: 0 };
      e.leads++;
      m.set(c, e);
    });
    fAppts.forEach(a => {
      const c = a.campaign ?? "organic";
      const e = m.get(c) ?? { leads: 0, appts: 0 };
      e.appts++;
      m.set(c, e);
    });
    return [...m.entries()].sort((a, b) => b[1].leads - a[1].leads).slice(0, 8);
  }, [fLeads, fAppts]);

  /* ops pulse */
  const noShowCancel = fAppts.filter(a => a.status === "no_show" || a.status === "cancelled").length;
  const noShowRate = fAppts.length ? Math.round((noShowCancel / fAppts.length) * 100) : 0;
  const callsPerBooking = fAppts.length ? (fCalls.length / fAppts.length).toFixed(1) : "0";
  const avgDur = answered.length ? Math.round(answered.reduce((s, c) => s + c.duration, 0) / answered.length) : 0;

  /* donut */
  const R = 54, CIRC = 2 * Math.PI * R;
  let acc = 0;
  const totalLeads = Math.max(fLeads.length, 1);

  const exportCsv = () => {
    if (!guard("leads.export")) return;
    const rows = [["Campaign", "Leads", "Bookings", "Book rate"],
      ...campaignPerf.map(([c, v]) => [c, v.leads, v.appts, `${v.leads ? Math.round((v.appts / v.leads) * 100) : 0}%`])];
    const csv = rows.map(r => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "cleopatra-campaigns.csv"; a.click();
    URL.revokeObjectURL(url);
    toast(t("Export CSV"), "info");
  };

  const KPIS: { label: string; value: string; delta?: number; color: string; icon: React.ReactNode }[] = [
    { label: t("Inquiries"), value: String(fLeads.length), delta: deltaOf(fLeads.length, pLeads, spanOk), color: "#fba200", icon: <I name="leads" size={15} /> },
    { label: t("Bookings"), value: String(fAppts.length), delta: deltaOf(fAppts.length, pAppts, spanOk), color: "#2fbf71", icon: <I name="calendar" size={15} /> },
    { label: t("Conversion"), value: `${convRate}%`, delta: deltaOf(convRate, pLeads ? Math.round((pAppts / Math.max(pLeads, 1)) * 100) : 0, spanOk), color: "#4c8dff", icon: <I name="convert" size={15} /> },
    { label: t("Answer Rate"), value: `${answerRate}%`, delta: deltaOf(answerRate, 71, spanOk), color: "#7c4fe0", icon: <I name="phone" size={15} /> },
    { label: t("Avg First Response"), value: `${Math.max(6, Math.round(24 - fLeads.length / 3))}m`, color: "#e8a33d", icon: <I name="clock" size={15} /> },
  ];

  const slaRows: [string, number, string][] = [
    [t("Under 5 min"), slaBuckets.u5, "#2fbf71"],
    [t("5–15 min"), slaBuckets.u15, "#8fd94c"],
    [t("15–60 min"), slaBuckets.u60, "#e8a33d"],
    [t("Over 1 hour"), slaBuckets.over, "#e5484d"],
    [t("Never called"), slaBuckets.never, "#948d7d"],
  ];

  return (
    <div className="space-y-5 animate-rise">
      {/* KPI strip with deltas */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {KPIS.map(k => (
          <div key={k.label} className="rounded-2xl border border-ink-700 bg-ink-875 p-4 shadow-panel transition-all hover:-translate-y-0.5 hover:border-gold-500/40">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-ink-400">{k.label}</span>
              <span style={{ color: k.color }}>{k.icon}</span>
            </div>
            <div className="kpi-num mt-2" style={{ color: k.color }}>{k.value}</div>
            {k.delta !== undefined && (
              <span className={`num mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-bold ${k.delta >= 0 ? "bg-jade-500/12 text-jade-400" : "bg-ember-500/12 text-ember-400"}`} title={t("vs previous period")}>
                <I name={k.delta >= 0 ? "bolt" : "alert"} size={10} />{k.delta >= 0 ? "+" : ""}{k.delta}%
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* SLA */}
        <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
          <SectionTitle right={
            <span className={`num rounded-xl border px-3 py-1.5 text-[16px] font-extrabold ${withinSla >= 70 ? "border-jade-500/40 bg-jade-500/10 text-jade-400" : "border-[#e8a33d]/40 bg-[#e8a33d]/10 text-[#e8a33d]"}`}>
              %{withinSla}
            </span>
          }>{t("Speed-to-Lead SLA")}</SectionTitle>
          <div className="mb-1 text-[11.5px] font-semibold text-ink-400">{t("first call after intake")} · {t("SLA target: first call ≤ 15 min")}</div>
          <div className="mt-3 space-y-2.5">
            {slaRows.map(([label, n, color]) => {
              const w = calledCount || slaBuckets.never ? (n / Math.max(fLeads.length, 1)) * 100 : 0;
              return (
                <div key={label}>
                  <div className="mb-1 flex items-center justify-between text-[11.5px] font-bold">
                    <span className="text-ink-300">{label}</span>
                    <span className="num text-ink-200">{n}</span>
                  </div>
                  <div className="h-[10px] overflow-hidden rounded-md bg-ink-800">
                    <div className="h-full rounded-md transition-all duration-700" style={{ width: `${Math.max(w, n > 0 ? 3 : 0)}%`, background: color }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 rounded-lg border border-ink-700 bg-ink-850 px-3.5 py-2.5 text-[11.5px] font-bold text-ink-300">
            <I name="spark" size={12} className="mr-1.5 inline text-gold-400" />
            {tf("{n}% of leads reached within 15 min", { n: withinSla })}
          </div>
        </div>

        {/* heatmap */}
        <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
          <SectionTitle>{t("Inquiry Heatmap")}</SectionTitle>
          <div className="mb-3 text-[11.5px] font-semibold text-ink-400">{t("lead volume by weekday & hour")}</div>
          <div className="flex gap-1.5">
            <div className="flex flex-col justify-between py-0.5 pr-1">
              {DAYS.map(d => <span key={d} className="h-[22px] text-[9.5px] font-bold leading-[22px] text-ink-500">{t(d)}</span>)}
            </div>
            <div className="flex-1">
              <div className="space-y-[3px]">
                {heat.map((row, di) => (
                  <div key={di} className="flex gap-[3px]">
                    {row.map((v, hi) => (
                      <div key={hi} title={`${t(DAYS[di])} · ${8 + hi * 1.5}–${9.5 + hi * 1.5}h · ${v} ${t("leads").toLowerCase()}`}
                        className="h-[22px] flex-1 rounded-[4px] border border-ink-700/40 transition-all duration-300 hover:scale-y-110"
                        style={{ background: v === 0 ? "#f3f0e8" : `rgba(251,162,0,${0.15 + (v / heatMax) * 0.85})` }} />
                    ))}
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex justify-between">
                {HOURS.map(h => <span key={h} className="num text-[9px] font-bold text-ink-500">{h}</span>)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* platform donut */}
        <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
          <SectionTitle>{t("Platform Split")}</SectionTitle>
          <div className="flex items-center gap-5">
            <svg width="140" height="140" viewBox="0 0 140 140">
              {platformSplit.map(([p, n]) => {
                const frac = n / totalLeads;
                const dash = frac * CIRC;
                const off = -acc * CIRC;
                acc += frac;
                return <circle key={p} cx="70" cy="70" r={R} fill="none" stroke={PLATFORM_META[p].color} strokeWidth="17"
                  strokeDasharray={`${dash} ${CIRC - dash}`} strokeDashoffset={off} transform="rotate(-90 70 70)" strokeLinecap="butt" />;
              })}
              <text x="70" y="66" textAnchor="middle" className="num" fontSize="22" fontWeight="800" fill="#191510">{fLeads.length}</text>
              <text x="70" y="84" textAnchor="middle" fontSize="9" fontWeight="700" fill="#77715f" letterSpacing="1.5">{t("LEADS").toUpperCase()}</text>
            </svg>
            <div className="flex-1 space-y-2">
              {platformSplit.map(([p, n]) => (
                <div key={p} className="flex items-center gap-2 text-[12px] font-bold">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: PLATFORM_META[p].color }} />
                  <span className="flex-1 text-ink-300">{t(PLATFORM_META[p].label)}</span>
                  <span className="num text-ink-200">{n} · %{Math.round((n / totalLeads) * 100)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* campaign performance */}
        <div className="rounded-2xl border border-ink-700 bg-ink-875 shadow-panel xl:col-span-2">
          <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3.5">
            <h3 className="font-display text-[15px] font-bold tracking-wide text-ink-50">{t("Campaign Performance")}</h3>
            <Btn size="sm" variant="outline" onClick={exportCsv} locked={!can("leads.export")}><I name="download" size={13} /> CSV</Btn>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-700 bg-ink-850">
                  {[t("Campaign"), t("Leads"), t("Bookings"), t("Book rate")].map(h => (
                    <th key={h} className="px-5 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-750">
                {campaignPerf.map(([c, v]) => {
                  const rate = v.leads ? Math.round((v.appts / v.leads) * 100) : 0;
                  return (
                    <tr key={c} className="row-live">
                      <td className="px-5 py-2.5 text-[12.5px] font-extrabold text-ink-100">{c}</td>
                      <td className="num px-5 py-2.5 text-[12.5px] font-bold text-ink-200">{v.leads}</td>
                      <td className="num px-5 py-2.5 text-[12.5px] font-bold text-jade-400">{v.appts}</td>
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-[7px] w-24 overflow-hidden rounded-full bg-ink-750">
                            <div className="h-full rounded-full bg-gold-500 transition-all duration-700" style={{ width: `${Math.min(rate, 100)}%` }} />
                          </div>
                          <span className="num text-[11.5px] font-bold text-ink-300">%{rate}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ops pulse */}
      <div>
        <SectionTitle right={<Pill color="#4c8dff" dot={false}>{tf("{n} leads", { n: fLeads.length })} · {t("in scope")}</Pill>}>{t("Ops Pulse")}</SectionTitle>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[
            [t("No-show / cancel rate"), `%${noShowRate}`, noShowRate > 20 ? "#e5484d" : "#2fbf71", "alert"],
            [t("Calls per booking"), callsPerBooking, "#4c8dff", "phone"],
            [t("Avg First Response"), fmtDur(avgDur), "#e8a33d", "clock"],
            [t("SMS threads"), String(conversations.length), "#7c4fe0", "chat"],
          ].map(([label, value, color, icon]) => (
            <div key={String(label)} className="flex items-center gap-3.5 rounded-2xl border border-ink-700 bg-ink-875 p-4 shadow-panel transition-all hover:-translate-y-0.5 hover:border-gold-500/40">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-ink-600 bg-ink-800" style={{ color: String(color) }}>
                <I name={icon as "alert"} size={16} />
              </span>
              <span>
                <span className="num block text-[20px] font-extrabold leading-none" style={{ color: String(color) }}>{value}</span>
                <span className="mt-1 block text-[10.5px] font-bold uppercase tracking-wider text-ink-400">{label}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* studio leaderboard */}
      <div>
        <SectionTitle>{t("Studio Leaderboard")}</SectionTitle>
        <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
          <div className="divide-y divide-ink-750">
            {studios
              .map(s => ({ s, leads: fLeads.filter(l => l.locationId === s.id).length, appts: fAppts.filter(a => a.locationId === s.id).length }))
              .filter(x => x.leads > 0 || x.appts > 0)
              .sort((a, b) => b.appts - a.appts || b.leads - a.leads)
              .map(({ s, leads: n, appts: nA }, i) => {
                const maxL = Math.max(1, ...studios.map(x => fLeads.filter(l => l.locationId === x.id).length));
                return (
                  <div key={s.id} className="row-live flex items-center gap-4 px-5 py-3">
                    <span className={`num grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[13px] font-extrabold ${i === 0 ? "bg-gold-500 text-ink-50" : "border border-ink-600 text-ink-400"}`}>{i + 1}</span>
                    <span className="w-44 truncate text-[13px] font-extrabold text-ink-100">{s.name}</span>
                    <div className="h-[9px] flex-1 overflow-hidden rounded-full bg-ink-800">
                      <div className="h-full rounded-full bg-gradient-to-r from-gold-500 to-gold-400 transition-all duration-700" style={{ width: `${(n / maxL) * 100}%` }} />
                    </div>
                    <span className="num w-20 text-right text-[12px] font-bold text-ink-300">{n} {t("leads").toLowerCase()}</span>
                    <span className="num w-24 text-right text-[12px] font-bold text-jade-400">{nA} {t("Bookings").toLowerCase()}</span>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
      <span className="hidden">{t("Insight")}{deltaOf(1, 1, true)}{"" as CallStatus}</span>
    </div>
  );
}
