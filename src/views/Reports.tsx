import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { Btn, I, Pill, SectionTitle } from "../ui";
import { PLATFORM_META, fmtDur, type CallStatus, type Platform } from "../data";
import { crmApi, type ReportSummary } from "../services/crmApi";
import { t, tf, useI18n } from "../i18n";

function deltaOf(cur: number, prev: number, spanOk: boolean): number | undefined {
  return spanOk ? Math.round(((cur - prev) / Math.max(prev, 1)) * 100) : undefined;
}

/* ── Reporting ─────────────────────────────────────────────────────────
 * Everything here used to be reduced in the browser over the full lead,
 * appointment and call arrays. That works on seed data and collapses on a
 * real chain — a year across 46 studios is hundreds of thousands of rows
 * sent to a laptop to produce about forty numbers. The aggregation is now
 * /api/crm/reports; this file draws the answer.
 *
 * Three figures on this screen were not measurements at all: the answer
 * rate was compared against a hardcoded 71, and "average first response"
 * was `24 - leadCount / 3` — a formula that moved with traffic and had
 * never touched a call record. Both now come from the data.
 * ────────────────────────────────────────────────────────────────── */

export default function Reports() {
  const { studios, conversations, dateRange, toast, guard, can } = useStore();
  useI18n();

  const [data, setData] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setFailed(false);
    crmApi
      .reports(dateRange)
      .then((d) => { if (live) { setData(d); setFailed(false); } })
      .catch(() => { if (live) setFailed(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [dateRange]);

  const spanOk = data?.window.comparable ?? false;
  const prev = data?.previous;

  const totalLeads = Math.max(data?.current.leads ?? 0, 1);
  const heat = data?.heat ?? Array.from({ length: 7 }, () => Array(13).fill(0) as number[]);
  const heatMax = Math.max(1, ...heat.flat());
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const HOURS = ["8", "10", "12", "14", "16", "18", "20", "22"];

  const platformSplit = data?.platforms ?? [];
  const campaignPerf = data?.campaigns ?? [];
  const slaBuckets = data?.sla ?? { u5: 0, u15: 0, u60: 0, over: 0, never: 0, medianResponseSeconds: 0, called: 0, withinSla: 0 };
  const calledCount = slaBuckets.called;
  const withinSla = slaBuckets.withinSla;
  const leadCount = data?.current.leads ?? 0;

  /* donut */
  const R = 54, CIRC = 2 * Math.PI * R;
  let acc = 0;

  const exportCsv = () => {
    if (!guard("leads.export")) return;
    const rows: (string | number)[][] = [["Campaign", "Leads", "Bookings", "Book rate"],
      ...campaignPerf.map(([c, v]) => [c, v.leads, v.appts, `${v.leads ? Math.round((v.appts / v.leads) * 100) : 0}%`])];
    const csv = rows.map(r => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "cleopatra-campaigns.csv"; a.click();
    URL.revokeObjectURL(url);
    toast(t("Export CSV"), "info");
  };

  const KPIS: { label: string; value: string; delta?: number; color: string; icon: React.ReactNode }[] = [
    { label: t("Inquiries"), value: String(leadCount), delta: prev ? deltaOf(leadCount, prev.leads, spanOk) : undefined, color: "#fba200", icon: <I name="leads" size={15} /> },
    { label: t("Bookings"), value: String(data?.current.appointments ?? 0), delta: prev ? deltaOf(data?.current.appointments ?? 0, prev.appointments, spanOk) : undefined, color: "#2fbf71", icon: <I name="calendar" size={15} /> },
    { label: t("Conversion"), value: `${data?.current.conversion ?? 0}%`, delta: prev ? deltaOf(data?.current.conversion ?? 0, prev.conversion, spanOk) : undefined, color: "#4c8dff", icon: <I name="convert" size={15} /> },
    { label: t("Answer Rate"), value: `${data?.current.answerRate ?? 0}%`, delta: prev ? deltaOf(data?.current.answerRate ?? 0, prev.answerRate, spanOk) : undefined, color: "#7c4fe0", icon: <I name="phone" size={15} /> },
    { label: t("Avg First Response"), value: fmtDur(slaBuckets.medianResponseSeconds), color: "#e8a33d", icon: <I name="clock" size={15} /> },
  ];

  const slaRows: [string, number, string][] = [
    [t("Under 5 min"), slaBuckets.u5, "#2fbf71"],
    [t("5–15 min"), slaBuckets.u15, "#8fd94c"],
    [t("15–60 min"), slaBuckets.u60, "#e8a33d"],
    [t("Over 1 hour"), slaBuckets.over, "#e5484d"],
    [t("Never called"), slaBuckets.never, "#948d7d"],
  ];

  if (loading && !data) {
    return (
      <div className="grid h-64 place-items-center rounded-2xl border border-ink-700 bg-ink-875 text-ink-400">
        <span className="flex items-center gap-2.5 text-[13px] font-semibold">
          <I name="spin" size={18} className="text-gold-400" /> {t("Loading reports…")}
        </span>
      </div>
    );
  }

  /* An empty screen and a screen whose figures never arrived look the same,
     and reading zeroes as real numbers is the worse of the two mistakes. */
  if (failed && !data) {
    return (
      <div className="grid h-64 place-items-center rounded-2xl border border-ember-500/40 bg-ink-875 px-6 text-center">
        <div>
          <I name="alert" size={22} className="text-ember-400" />
          <div className="mt-2 text-[13px] font-bold text-ink-200">{t("Reports could not be loaded")}</div>
          <div className="mt-1 text-[11.5px] text-ink-400">{t("The figures shown would not be real, so none are shown.")}</div>
        </div>
      </div>
    );
  }

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
              const w = calledCount || slaBuckets.never ? (n / Math.max(leadCount, 1)) * 100 : 0;
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
              <text x="70" y="66" textAnchor="middle" className="num" fontSize="22" fontWeight="800" fill="#191510">{leadCount}</text>
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
        <SectionTitle right={<Pill color="#4c8dff" dot={false}>{tf("{n} leads", { n: leadCount })} · {t("in scope")}</Pill>}>{t("Ops Pulse")}</SectionTitle>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[
            [t("No-show / cancel rate"), `%${data?.ops.noShowRate ?? 0}`, (data?.ops.noShowRate ?? 0) > 20 ? "#e5484d" : "#2fbf71", "alert"],
            [t("Calls per booking"), String(data?.ops.callsPerBooking ?? 0), "#4c8dff", "phone"],
            [t("Avg talk time"), fmtDur(data?.ops.avgTalkSeconds ?? 0), "#e8a33d", "clock"],
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
            {(data?.studios ?? []).map(({ id, name, leads: n, appts: nA }, i) => {
              const maxL = Math.max(1, ...(data?.studios ?? []).map(x => x.leads));
              return (
                <div key={id} className="row-live flex items-center gap-4 px-5 py-3">
                  <span className={`num grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[13px] font-extrabold ${i === 0 ? "bg-gold-500 text-ink-50" : "border border-ink-600 text-ink-400"}`}>{i + 1}</span>
                  <span className="w-44 truncate text-[13px] font-extrabold text-ink-100">{name}</span>
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
