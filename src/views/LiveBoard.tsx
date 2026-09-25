import { useMemo } from "react";
import { useStore } from "../store";
import { usePresence } from "../hooks/usePresence";
import { EmptyState, I, Pill, SectionTitle } from "../ui";
import { t, tf, useI18n } from "../i18n";
import type { LiveVisitor } from "../services/realtime";

/** Wizard step → a label an operator recognises. */
const STEP_LABEL: Record<string, string> = {
  welcome: "Welcome", purpose: "Purpose", style: "Style", story: "Story",
  body_area: "Placement", size: "Size", timing: "Date & time",
  contact: "Contact", address: "VIP pickup", success: "Done",
};

const SOURCE_COLOR: Record<string, string> = {
  instagram: "#e1589a", facebook: "#2f6fe4", google: "#e8a33d",
  tiktok: "#5fd6c9", webform: "#9b6bff", direct: "#948d7d",
};

const mmss = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
};

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-875 p-4 shadow-panel">
      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-ink-500">{label}</div>
      <div className="num mt-1 text-[30px] font-extrabold leading-none" style={{ color: tone ?? "var(--color-ink-50)" }}>
        {value}
      </div>
    </div>
  );
}

function Bars({ title, rows }: { title: string; rows: { key: string; label: string; count: number; color?: string }[] }) {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
      <SectionTitle>{title}</SectionTitle>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-[11px] font-semibold text-ink-500">{t("Nobody right now")}</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map(r => (
            <div key={r.key} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-[11.5px] font-bold text-ink-200">{r.label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-800">
                <div className="h-full rounded-full transition-all duration-500"
                     style={{ width: `${(r.count / max) * 100}%`, background: r.color ?? "var(--color-gold-500)" }} />
              </div>
              <span className="num w-7 text-right text-[12px] font-extrabold text-ink-100">{r.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VisitorRow({ v }: { v: LiveVisitor }) {
  const source = v.utmSource ?? v.platform;
  return (
    <tr className="row-live border-b border-ink-800 last:border-0">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${v.identified ? "bg-jade-400" : "bg-ink-500"}`} />
          <span className="text-[12px] font-bold text-ink-100">{v.studio?.replace(/^Cleopatra Ink\s+/, "") ?? "—"}</span>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <Pill color={SOURCE_COLOR[source] ?? "#948d7d"} dot={false} className="!text-[9.5px]">{source}</Pill>
        {v.utmCampaign && <span className="num ml-1.5 text-[10px] text-ink-500">{v.utmCampaign}</span>}
      </td>
      <td className="px-3 py-2.5">
        <span className="text-[12px] font-bold text-ink-100">{STEP_LABEL[v.step] ?? v.step}</span>
        <span className="num ml-1.5 text-[10px] text-ink-500">{v.stepIndex + 1}/8</span>
      </td>
      <td className="px-3 py-2.5">
        {v.identified
          ? <span className="text-[11px] font-bold text-jade-400">{t("contact left")}</span>
          : <span className="text-[11px] text-ink-500">—</span>}
      </td>
      <td className="num px-3 py-2.5 text-[11.5px] text-ink-300">{mmss(v.secondsOnSite)}</td>
      <td className="px-3 py-2.5">
        <span className="num text-[10.5px] uppercase text-ink-500">{v.deviceType ?? "—"} · {v.locale}</span>
      </td>
    </tr>
  );
}

/**
 * Who is on the booking form, right now.
 *
 * Visitors are never asked to open a socket: the public page already
 * reports its step and sends a small heartbeat, and this board reads that.
 * The gateway narrows every push to the viewer's own studios.
 */
export default function LiveBoard() {
  const { can } = useStore();
  useI18n();
  const allowed = can("reports.view");
  const { status, snapshot, error } = usePresence(allowed);

  const stepRows = useMemo(
    () => (snapshot?.byStep ?? []).map(s => ({ key: s.step, label: STEP_LABEL[s.step] ?? s.step, count: s.count })),
    [snapshot],
  );
  const sourceRows = useMemo(
    () => (snapshot?.bySource ?? []).map(s => ({ key: s.source, label: s.source, count: s.count, color: SOURCE_COLOR[s.source] })),
    [snapshot],
  );
  const studioRows = useMemo(
    () => (snapshot?.byStudio ?? []).map(s => ({ key: s.slug, label: s.studio.replace(/^Cleopatra Ink\s+/, ""), count: s.count })),
    [snapshot],
  );

  if (!allowed) {
    return <EmptyState title={t("Not available")} hint={t("This board needs the reports permission.")} />;
  }

  const live = status === "live";

  return (
    <div className="animate-rise space-y-4">
      <div className="flex items-center justify-between">
        <SectionTitle right={
          <span className={`flex items-center gap-1.5 text-[10.5px] font-bold ${live ? "text-jade-400" : "text-ink-500"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-jade-400" : "bg-ink-500"}`} />
            {live ? t("live") : status === "connecting" ? t("connecting") : t("disconnected")}
          </span>
        }>
          {t("Live Visitors")}
        </SectionTitle>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-ember-500/30 bg-ember-500/10 p-3 text-center text-[11.5px] font-semibold text-ember-400">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Stat label={t("On site now")} value={snapshot?.total ?? 0} tone="var(--color-gold-500)" />
        <Stat label={t("Contact left")} value={snapshot?.identified ?? 0} tone="var(--color-jade-400)" />
        <Stat label={t("Studios active")} value={snapshot?.byStudio.length ?? 0} />
        <Stat label={t("Sources")} value={snapshot?.bySource.length ?? 0} />
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
        <Bars title={t("By studio")} rows={studioRows} />
        <Bars title={t("By source")} rows={sourceRows} />
        <Bars title={t("By step")} rows={stepRows} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
        <div className="flex items-center justify-between px-5 pt-4">
          <SectionTitle>{t("Visitors")}</SectionTitle>
          {snapshot && (
            <span className="num text-[10px] text-ink-500">
              {tf("updated {ago}", { ago: new Date(snapshot.at).toLocaleTimeString() })}
            </span>
          )}
        </div>
        {(snapshot?.visitors.length ?? 0) === 0 ? (
          <EmptyState title={t("Nobody right now")} hint={t("Visitors appear here the moment they open a booking page.")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="border-b border-ink-700 text-left">
                  {[t("Studio"), t("Source"), t("Step"), t("Status"), t("On site"), t("Device")].map(h => (
                    <th key={h} className="px-3 py-2 text-[9.5px] font-black uppercase tracking-wider text-ink-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snapshot!.visitors.map(v => <VisitorRow key={v.sessionUuid} v={v} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
