import { useMemo } from "react";
import { useStore } from "../store";
import { Btn, I, Pill, PlatformPill, SectionTitle } from "../components/ui";
import { FUNNEL, PLATFORM_META, campaignRows, fmtDur, studioById, type Platform } from "../data/crm";
import { t, tf } from "../services/i18n";

/* ── helpers ─────────────────────────────────────────────────────────────── */
const DOW = () => [t("Mon"), t("Tue"), t("Wed"), t("Thu"), t("Fri"), t("Sat"), t("Sun")];
const HOUR_BUCKETS = ["00–03", "03–06", "06–09", "09–12", "12–15", "15–18", "18–21", "21–24"];

function Delta({ cur, prev, invert = false }: { cur: number; prev: number | null; invert?: boolean }) {
  if (prev === null) return <span className="num rounded-md bg-ink-750 px-1.5 py-0.5 text-[9.5px] font-bold text-ink-500">{t("all time")}</span>;
  if (prev === 0) return cur > 0
    ? <span className="num rounded-md bg-jade-500/12 px-1.5 py-0.5 text-[9.5px] font-bold text-jade-400">▲ {t("new")}</span>
    : <span className="num text-[9.5px] font-bold text-ink-500">—</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return <span className="num rounded-md bg-ink-750 px-1.5 py-0.5 text-[9.5px] font-bold text-ink-400">±0%</span>;
  const good = invert ? pct < 0 : pct > 0;
  return (
    <span className={`num rounded-md px-1.5 py-0.5 text-[9.5px] font-bold ${good ? "bg-jade-500/12 text-jade-400" : "bg-ember-500/12 text-ember-400"}`}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

function Kpi({ label, value, color, cur, prev, invert }: {
  label: string; value: string; color: string; cur: number; prev: number | null; invert?: boolean;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 p-4 shadow-panel transition-all hover:-translate-y-0.5 hover:border-gold-500/35">
      <div className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full opacity-0 blur-2xl transition-opacity group-hover:opacity-100" style={{ background: `${color}22` }} />
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-400">{label}</span>
        <Delta cur={cur} prev={prev} invert={invert} />
      </div>
      <div className="num mt-2.5 text-[27px] font-bold leading-none" style={{ color }}>{value}</div>
      <div className="mt-1.5 text-[9.5px] font-semibold text-ink-500">{prev !== null ? t("vs previous period") : t("all time")}</div>
    </div>
  );
}

function Donut({ data, centerLabel }: { data: { label: string; value: number; color: string }[]; centerLabel: string }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = 52, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <svg viewBox="0 0 140 140" className="h-44 w-44">
      <circle cx="70" cy="70" r={R} fill="none" stroke="#1c1c27" strokeWidth="15" />
      {data.map(d => {
        const frac = d.value / total;
        const dash = Math.max(frac * C - 3, 0.6);
        const off = -acc * C;
        acc += frac;
        return (
          <circle key={d.label} cx="70" cy="70" r={R} fill="none" stroke={d.color} strokeWidth="15"
            strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={off}
            transform="rotate(-90 70 70)" className="transition-all duration-700" />
        );
      })}
      <text x="70" y="66" textAnchor="middle" fill="#f4f2ea" fontSize="22" fontWeight="700" fontFamily="JetBrains Mono, monospace">{total}</text>
      <text x="70" y="84" textAnchor="middle" fill="#63637a" fontSize="8.5" fontWeight="700" letterSpacing="1.6">{centerLabel}</text>
    </svg>
  );
}

/* ── main ────────────────────────────────────────────────────────────────── */
export default function Reports() {
  const { leads, appointments, calls, conversations, globalLocation, inRange, toast, dateRange } = useStore();

  const locOk = (locId: number) => globalLocation === "all" || globalLocation === locId;
  const winMs = dateRange === "today" ? 86_400_000 : dateRange === "7" ? 7 * 86_400_000 : dateRange === "30" ? 30 * 86_400_000 : 0;
  const inPrev = (iso: string) => {
    if (!winMs) return false;
    const ts = +new Date(iso);
    const now = Date.now();
    return ts >= now - 2 * winMs && ts < now - winMs;
  };

  const fLeads = useMemo(() => leads.filter(l => locOk(l.locationId) && inRange(l.createdAt)), [leads, globalLocation, inRange]); // eslint-disable-line
  const pLeads = useMemo(() => leads.filter(l => locOk(l.locationId) && inPrev(l.createdAt)), [leads, globalLocation, winMs]); // eslint-disable-line
  const fAppts = useMemo(() => appointments.filter(a => locOk(a.locationId) && inRange(a.createdAt)), [appointments, globalLocation, inRange]); // eslint-disable-line
  const pAppts = useMemo(() => appointments.filter(a => locOk(a.locationId) && inPrev(a.createdAt)), [appointments, globalLocation, winMs]); // eslint-disable-line
  const fCalls = useMemo(() => calls.filter(c => locOk(c.locationId) && inRange(c.startTime)), [calls, globalLocation, inRange]); // eslint-disable-line
  const pCalls = useMemo(() => calls.filter(c => locOk(c.locationId) && inPrev(c.startTime)), [calls, globalLocation, winMs]); // eslint-disable-line

  const prev = winMs ? { leads: pLeads.length, appts: pAppts.length, calls: pCalls.length } : null;

  /* speed-to-lead: first call per customer */
  const firstCallAt = useMemo(() => {
    const m = new Map<string, number>();
    calls.forEach(c => {
      if (!c.customerId) return;
      const ts = +new Date(c.startTime);
      const cur = m.get(c.customerId);
      if (cur === undefined || ts < cur) m.set(c.customerId, ts);
    });
    return m;
  }, [calls]);

  const avgResp = (list: typeof fLeads) => {
    const vals = list
      .map(l => { const fc = firstCallAt.get(l.id); return fc ? (fc - +new Date(l.createdAt)) / 60_000 : null; })
      .filter((v): v is number => v !== null && v >= 0);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  const respCur = useMemo(() => avgResp(fLeads), [fLeads, firstCallAt]); // eslint-disable-line
  const respPrev = useMemo(() => (winMs ? avgResp(pLeads) : null), [pLeads, firstCallAt, winMs]); // eslint-disable-line

  const slaBuckets = useMemo(() => {
    const b = [0, 0, 0, 0, 0]; // <5, 5-15, 15-60, >60, never
    fLeads.forEach(l => {
      const fc = firstCallAt.get(l.id);
      if (!fc) { b[4]++; return; }
      const m = (fc - +new Date(l.createdAt)) / 60_000;
      if (m < 0) { b[4]++; return; }
      if (m < 5) b[0]++;
      else if (m < 15) b[1]++;
      else if (m < 60) b[2]++;
      else b[3]++;
    });
    return b;
  }, [fLeads, firstCallAt]);

  const answerRate = (list: typeof fCalls) => list.length ? Math.round((list.filter(c => c.result === "Answered").length / list.length) * 100) : 0;

  const heat = useMemo(() => {
    const g: number[][] = Array.from({ length: 7 }, () => Array(8).fill(0));
    fLeads.forEach(l => {
      const d = new Date(l.createdAt);
      const row = (d.getDay() + 6) % 7; // Monday first
      const col = Math.min(7, Math.floor(d.getHours() / 3));
      g[row][col]++;
    });
    return g;
  }, [fLeads]);
  const heatMax = Math.max(...heat.flat(), 1);

  const campaigns = useMemo(() => campaignRows(fLeads, fAppts), [fLeads, fAppts]);
  const funnelMax = FUNNEL[0].count;

  const platformData = useMemo(() => {
    const m = new Map<Platform, number>();
    fLeads.forEach(l => m.set(l.attr.platform, (m.get(l.attr.platform) ?? 0) + 1));
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([p, n]) => ({ label: PLATFORM_META[p].label, value: n, color: PLATFORM_META[p].color }));
  }, [fLeads]);

  const studioBoard = useMemo(() => {
    const m = new Map<number, { leads: number; booked: number }>();
    fLeads.forEach(l => {
      const r = m.get(l.locationId) ?? { leads: 0, booked: 0 };
      r.leads++; m.set(l.locationId, r);
    });
    fAppts.forEach(a => {
      const r = m.get(a.locationId) ?? { leads: 0, booked: 0 };
      r.booked++; m.set(a.locationId, r);
    });
    return [...m.entries()]
      .map(([id, v]) => ({ id, ...v, rate: v.leads ? Math.round((v.booked / v.leads) * 100) : 0 }))
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 8);
  }, [fLeads, fAppts]);

  const noShowRate = fAppts.length
    ? Math.round((fAppts.filter(a => a.status === "cancelled" || a.status === "unreachable").length / fAppts.length) * 100)
    : 0;
  const callsPerBooking = fAppts.length ? (fCalls.length / fAppts.length).toFixed(1) : "—";
  const answered = fCalls.filter(c => c.result === "Answered");
  const avgTalk = answered.length ? Math.round(answered.reduce((s, c) => s + c.duration, 0) / answered.length) : 0;

  const exportCsv = () => {
    const rows = [
      ["Source", "Medium", "Campaign", "Content", "Inquiries", "Booked", "CVR %"],
      ...campaigns.map(c => [c.source, c.medium, c.campaign, c.content, c.inquiries, c.booked, c.inquiries ? Math.round((c.booked / c.inquiries) * 100) : 0]),
    ];
    const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "cleopatra-campaigns.csv"; a.click();
    URL.revokeObjectURL(url);
    toast(tf("Exported {n} campaign rows to CSV", { n: campaigns.length }), "info");
  };

  const cvr = fLeads.length ? Math.round((fAppts.length / fLeads.length) * 100) : 0;
  const cvrPrev = prev && pLeads.length ? Math.round((pAppts.length / pLeads.length) * 100) : null;
  const respFmt = (v: number | null) => v === null ? "—" : v < 60 ? `${Math.round(v)}${t("min")}` : `${Math.round(v / 60)}s ${Math.round(v % 60)}${t("min")}`;

  const slaRows = [
    { label: t("Under 5 min"), color: "#2fbf71", n: slaBuckets[0] },
    { label: t("5–15 min"), color: "#74a8ff", n: slaBuckets[1] },
    { label: t("15–60 min"), color: "#e8a33d", n: slaBuckets[2] },
    { label: t("Over 1 hour"), color: "#e5484d", n: slaBuckets[3] },
    { label: t("Never called"), color: "#4a4a5c", n: slaBuckets[4] },
  ];
  const calledTotal = slaBuckets[0] + slaBuckets[1] + slaBuckets[2] + slaBuckets[3];
  const slaPct = calledTotal ? Math.round(((slaBuckets[0] + slaBuckets[1]) / calledTotal) * 100) : 0;

  return (
    <div className="space-y-4 animate-rise">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] font-semibold text-ink-400">
          {t("Attribution window")}: <span className="font-bold text-gold-300">{dateRange === "today" ? t("today") : dateRange === "7" ? t("last 7 days") : dateRange === "30" ? t("last 30 days") : t("all time")}</span>
          {globalLocation !== "all" && <> · {t("single studio scope")}</>}
        </p>
        <div className="flex items-center gap-2">
          <Pill color="#8b8ba0" dot={false}><span className="num">{fLeads.length}</span>&nbsp;{t("leads in scope")}</Pill>
          <Pill color="#2fbf71" dot={false}><span className="num">{fAppts.length}</span>&nbsp;{t("bookings in scope")}</Pill>
        </div>
      </div>

      {/* KPI strip with period deltas */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label={t("Inquiries")} value={String(fLeads.length)} color="#d4af37" cur={fLeads.length} prev={prev ? prev.leads : null} />
        <Kpi label={t("Bookings")} value={String(fAppts.length)} color="#2fbf71" cur={fAppts.length} prev={prev ? prev.appts : null} />
        <Kpi label={t("Conversion")} value={`${cvr}%`} color="#74a8ff" cur={cvr} prev={cvrPrev} />
        <Kpi label={t("Avg First Response")} value={respFmt(respCur)} color="#e8a33d" cur={respCur ? Math.round(respCur) : 0} prev={respPrev ? Math.round(respPrev) : null} invert />
        <Kpi label={t("Answer Rate")} value={`${answerRate(fCalls)}%`} color="#b18aff" cur={answerRate(fCalls)} prev={prev ? answerRate(pCalls) : null} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* speed-to-lead SLA */}
        <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel xl:col-span-2">
          <SectionTitle right={
            <span className="num rounded-lg border border-jade-500/35 bg-jade-500/10 px-2 py-1 text-[13px] font-bold text-jade-400">{slaPct}%</span>
          }>{t("Speed-to-Lead SLA")}</SectionTitle>
          <p className="mb-3 text-[11px] font-semibold text-ink-500">{t("first call after intake")} · {t("SLA target: first call ≤ 15 min")}</p>
          <div className="flex h-4 w-full overflow-hidden rounded-lg border border-ink-750">
            {slaRows.map(r => r.n > 0 && (
              <div key={r.label} title={`${r.label} · ${r.n}`} className="h-full transition-all duration-700"
                style={{ width: `${(r.n / Math.max(fLeads.length, 1)) * 100}%`, background: r.color }} />
            ))}
          </div>
          <div className="mt-3.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {slaRows.map(r => (
              <div key={r.label} className="flex items-center gap-2 text-[12px]">
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: r.color }} />
                <span className="flex-1 font-semibold text-ink-300">{r.label}</span>
                <span className="num font-bold text-ink-100">{r.n}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-jade-500/25 bg-jade-500/6 px-3.5 py-2.5 text-[11.5px] font-bold text-jade-400">
            <I name="bolt" size={12} className="mr-1.5 inline" />
            {tf("{n}% of leads reached within 15 min", { n: slaPct })}
          </div>
        </div>

        {/* weekday × hour heatmap */}
        <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel xl:col-span-3">
          <SectionTitle right={<Pill color="#d4af37" dot={false}>{t("lead volume by weekday & hour")}</Pill>}>{t("Inquiry Heatmap")}</SectionTitle>
          <div className="mt-1 grid gap-[3px]" style={{ gridTemplateColumns: "38px repeat(8, 1fr)" }}>
            <span />
            {HOUR_BUCKETS.map(h => <span key={h} className="num pb-1 text-center text-[8.5px] font-bold text-ink-500">{h}</span>)}
            {heat.map((row, ri) => (
              <div key={ri} className="contents">
                <span className="flex items-center text-[10px] font-extrabold text-ink-400">{DOW()[ri]}</span>
                {row.map((v, ci) => (
                  <div key={ci} title={`${DOW()[ri]} ${HOUR_BUCKETS[ci]} · ${v} ${t("leads").toLowerCase()}`}
                    className="num grid h-8 place-items-center rounded-md border text-[9.5px] font-bold transition-all duration-300 hover:scale-[1.07]"
                    style={v > 0
                      ? { background: `rgba(212,175,55,${0.08 + (v / heatMax) * 0.72})`, borderColor: "rgba(212,175,55,0.25)", color: v / heatMax > 0.55 ? "#0a0a0e" : "#e8cf8a" }
                      : { background: "#14141c", borderColor: "#1c1c27", color: "#3a3a4c" }}>
                    {v > 0 ? v : ""}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* funnel */}
        <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel xl:col-span-3">
          <SectionTitle right={<Pill color="#e5484d" dot={false}>−{Math.round((1 - FUNNEL[FUNNEL.length - 1].count / funnelMax) * 100)}% {t("end-to-end")}</Pill>}>
            {t("Booking Funnel")}
          </SectionTitle>
          <div className="space-y-1">
            {FUNNEL.map((f, i) => {
              const pct = (f.count / funnelMax) * 100;
              const drop = i > 0 ? Math.round((1 - f.count / FUNNEL[i - 1].count) * 1000) / 10 : 0;
              return (
                <div key={f.label}>
                  {i > 0 && (
                    <div className="flex justify-center py-0.5">
                      <span className="num flex items-center gap-1 rounded-full border border-ember-500/30 bg-ember-500/8 px-2 py-[2px] text-[10px] font-bold text-ember-400">
                        <I name="chevD" size={10} /> −{drop}% {t("drop-off")}
                      </span>
                    </div>
                  )}
                  <div className="group flex items-center gap-3">
                    <span className="num w-5 text-right text-[12px] font-bold text-gold-500">{i + 1}</span>
                    <div className="relative h-9 flex-1 overflow-hidden rounded-lg bg-ink-800">
                      <div className="flex h-full items-center justify-between rounded-lg bg-gradient-to-r from-gold-700/60 via-gold-600/75 to-gold-500/90 pl-3 pr-2.5 transition-all duration-700 group-hover:from-gold-600 group-hover:to-gold-400"
                        style={{ width: `${Math.max(pct, 7)}%` }}>
                        <span className="truncate text-[11.5px] font-extrabold text-ink-950">{f.label}</span>
                        <span className="num shrink-0 text-[11px] font-bold text-ink-950/85">{f.count.toLocaleString()}</span>
                      </div>
                    </div>
                    <span className="num w-11 text-right text-[11.5px] font-bold text-ink-400">{Math.round(pct)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* platform donut */}
        <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel xl:col-span-2">
          <SectionTitle>{t("Leads by Platform")}</SectionTitle>
          <div className="flex flex-wrap items-center gap-5">
            <Donut data={platformData} centerLabel={t("LEADS")} />
            <div className="min-w-[150px] flex-1 space-y-2">
              {platformData.map(d => (
                <div key={d.label} className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color }} />
                  <span className="flex-1 text-[12.5px] font-bold text-ink-200">{d.label}</span>
                  <span className="num text-[12px] font-bold text-ink-100">{d.value}</span>
                  <span className="num w-10 text-right text-[11px] font-semibold text-ink-500">
                    {Math.round((d.value / Math.max(fLeads.length, 1)) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900 p-3 text-[11.5px] font-semibold leading-relaxed text-ink-400">
            <span className="text-gold-400">{t("Insight")}:</span> {tf("{p} drives the largest share of inquiries — consider shifting flash-week budget toward it.", { p: platformData[0]?.label ?? "—" })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* campaign table */}
        <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel xl:col-span-3">
          <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3.5">
            <h3 className="font-display text-[15px] font-bold tracking-wide text-ink-50">{t("Campaign Performance")}</h3>
            <Btn size="sm" variant="outline" onClick={exportCsv}><I name="download" size={13} /> CSV</Btn>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-700 bg-ink-850">
                  {[t("Campaign"), t("Inq."), t("Booked"), t("CVR")].map(h => (
                    <th key={h} className="px-4 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-750">
                {campaigns.slice(0, 10).map(c => {
                  const cv = c.inquiries ? Math.round((c.booked / c.inquiries) * 100) : 0;
                  return (
                    <tr key={c.campaign} className="row-live">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <PlatformPill p={c.source} />
                          <div>
                            <div className="num text-[12.5px] font-bold text-ink-100">{c.campaign}</div>
                            <div className="num text-[10px] text-ink-500">{c.medium} · {c.content}</div>
                          </div>
                        </div>
                      </td>
                      <td className="num px-4 py-2.5 text-[13px] font-bold text-ink-100">{c.inquiries}</td>
                      <td className="num px-4 py-2.5 text-[13px] font-bold text-jade-400">{c.booked}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-[7px] w-16 overflow-hidden rounded-full bg-ink-700">
                            <div className="h-full rounded-full bg-gradient-to-r from-gold-600 to-gold-400 transition-all duration-700" style={{ width: `${cv}%` }} />
                          </div>
                          <span className="num text-[11.5px] font-bold text-ink-300">{cv}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* studio leaderboard */}
        <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel xl:col-span-2">
          <SectionTitle right={<Pill color="#d4af37" dot={false}>{t("top 8")}</Pill>}>{t("Studio Leaderboard")}</SectionTitle>
          <div className="space-y-3">
            {studioBoard.map((s, i) => {
              const max = studioBoard[0]?.leads ?? 1;
              return (
                <div key={s.id} className="group">
                  <div className="mb-1 flex items-baseline justify-between text-[12px]">
                    <span className="font-bold text-ink-200">
                      <span className="num mr-2 text-gold-500">{i + 1}</span>
                      {studioById(s.id)?.name ?? `Studio #${s.id}`}
                    </span>
                    <span className="num font-bold text-ink-300">
                      {s.leads} <span className="text-ink-500">{t("leads")} · {s.rate}% cv</span>
                    </span>
                  </div>
                  <div className="h-[10px] overflow-hidden rounded-md bg-ink-800">
                    <div className={`h-full rounded-md transition-all duration-700 ${i === 0 ? "bg-gradient-to-r from-gold-600 to-gold-400" : "bg-gradient-to-r from-ink-500 to-ink-400"} group-hover:from-gold-600 group-hover:to-gold-500`}
                      style={{ width: `${Math.max((s.leads / max) * 100, 5)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ops pulse */}
      <div>
        <SectionTitle right={<Pill color="#8b8ba0" dot={false}>{t("in scope")}</Pill>}>{t("Ops Pulse")}</SectionTitle>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: t("No-show / cancel rate"), v: `${noShowRate}%`, c: noShowRate > 25 ? "#e5484d" : "#e8a33d", note: "cancelled + unreachable" },
            { label: t("Calls per booking"), v: String(callsPerBooking), c: "#74a8ff", note: "effort per conversion" },
            { label: t("Avg talk time"), v: fmtDur(avgTalk), c: "#2fbf71", note: "answered calls" },
            { label: t("SMS threads"), v: String(conversations.length), c: "#b18aff", note: "Twilio A2P 10DLC" },
          ].map(k => (
            <div key={k.label} className="rounded-2xl border border-ink-700 bg-ink-875 p-4 shadow-panel">
              <div className="num text-[22px] font-bold leading-none" style={{ color: k.c }}>{k.v}</div>
              <div className="mt-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400">{k.label}</div>
              <div className="num mt-0.5 text-[9.5px] font-semibold text-ink-500">{k.note}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
