import { useMemo } from "react";
import { useStore } from "../store";
import { Btn, I, Pill, PlatformPill, SectionTitle } from "../components/ui";
import { FUNNEL, PLATFORM_META, campaignRows, studioById, type Platform } from "../data/crm";

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

export default function Reports() {
  const { leads, appointments, globalLocation, inRange, toast, dateRange } = useStore();

  const locOk = (locId: number) => globalLocation === "all" || globalLocation === locId;
  const fLeads = useMemo(() => leads.filter(l => locOk(l.locationId) && inRange(l.createdAt)), [leads, globalLocation, inRange]);
  const fAppts = useMemo(() => appointments.filter(a => locOk(a.locationId) && inRange(a.createdAt)), [appointments, globalLocation, inRange]);

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
    toast(`Exported ${campaigns.length} campaign rows to CSV`, "info");
  };

  return (
    <div className="space-y-4 animate-rise">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] font-semibold text-ink-400">
          Attribution window: <span className="font-bold text-gold-300">{dateRange === "today" ? "today" : dateRange === "7" ? "last 7 days" : dateRange === "30" ? "last 30 days" : "all time"}</span>
          {globalLocation !== "all" && <> · single studio scope</>}
        </p>
        <div className="flex items-center gap-2">
          <Pill color="#8b8ba0" dot={false}><span className="num">{fLeads.length}</span>&nbsp;leads in scope</Pill>
          <Pill color="#2fbf71" dot={false}><span className="num">{fAppts.length}</span>&nbsp;bookings in scope</Pill>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* funnel */}
        <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel xl:col-span-3">
          <SectionTitle right={<Pill color="#e5484d" dot={false}>−{Math.round((1 - FUNNEL[FUNNEL.length - 1].count / funnelMax) * 100)}% end-to-end</Pill>}>
            Booking Funnel
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
                        <I name="chevD" size={10} /> −{drop}% drop-off
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
          <SectionTitle>Leads by Platform</SectionTitle>
          <div className="flex flex-wrap items-center gap-5">
            <Donut data={platformData} centerLabel="LEADS" />
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
            <span className="text-gold-400">Insight:</span> {platformData[0]?.label ?? "—"} drives the largest share of inquiries — consider shifting flash-week budget toward it.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* campaign table */}
        <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel xl:col-span-3">
          <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3.5">
            <h3 className="font-display text-[15px] font-bold tracking-wide text-ink-50">Campaign Performance</h3>
            <Btn size="sm" variant="outline" onClick={exportCsv}><I name="download" size={13} /> CSV</Btn>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-700 bg-ink-850">
                  {["Campaign", "Inq.", "Booked", "CVR"].map(h => (
                    <th key={h} className="px-4 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-750">
                {campaigns.slice(0, 10).map(c => {
                  const cvr = c.inquiries ? Math.round((c.booked / c.inquiries) * 100) : 0;
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
                            <div className="h-full rounded-full bg-gradient-to-r from-gold-600 to-gold-400 transition-all duration-700" style={{ width: `${cvr}%` }} />
                          </div>
                          <span className="num text-[11.5px] font-bold text-ink-300">{cvr}%</span>
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
          <SectionTitle right={<Pill color="#d4af37" dot={false}>top 8</Pill>}>Studio Leaderboard</SectionTitle>
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
                      {s.leads} <span className="text-ink-500">leads · {s.rate}% cv</span>
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
    </div>
  );
}
