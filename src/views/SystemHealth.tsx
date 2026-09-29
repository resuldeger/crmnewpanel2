import { useCallback, useEffect, useState } from "react";
import { useStore } from "../store";
import { Btn, I, Pill, SectionTitle, type IconName } from "../ui";
import { timeAgo } from "../data";
import { t, tf, useI18n } from "../i18n";

/* ── Where every number on this console comes from ─────────────────────
 * Every figure here arrives from outside: the call log and the recordings
 * from Vonage, 126 diaries from Timely, the messages from Twilio. When one
 * of those stops, the symptom is not an error — it is a screen that looks
 * perfectly normal and is quietly showing yesterday. That is exactly how a
 * whole day of calls went missing.
 *
 * So this page answers one question per source: is it still arriving? Not
 * "are the credentials in place" — that was already on the settings screen
 * and it told nobody anything.
 * ────────────────────────────────────────────────────────────────── */

type Status = "ok" | "degraded" | "down" | "halted" | "off" | "unconfigured";

interface Check { id: string; label: string; status: Status; detail: string | null; at: string | null; optional?: boolean }
interface JobHealth {
  name: string; everySeconds: number; configured: boolean; running: boolean;
  lastRunAt: string | null; lastSuccessAt: string | null; lastError: string | null;
  overdue: boolean; status: Status;
}
interface Freshness { label: string; at: string | null; count: number | null; of: number | null }
interface Source {
  id: string; label: string; kind: string; status: Status; summary: string;
  credential: "present" | "absent" | null; enabled: boolean;
  halt: { reason: string | null; detail: string | null; at: string | null; failureCount: number; clearedByName: string | null } | null;
  jobs: JobHealth[]; checks: Check[]; freshness: Freshness[]; action: string | null;
}
interface Report {
  generatedAt: string;
  status: Status;
  worker: {
    alive: boolean; lastBeatAt: string | null; staleSeconds: number | null;
    pid: string | null; startedAt: string | null; uptimeSeconds: number | null; beatEverySeconds: number;
  };
  sources: Source[];
}

/* Amber and red are the same colour to a glancing eye, so the words carry
   the meaning and the colour only reinforces it. */
const TONE: Record<Status, { color: string; label: string }> = {
  ok: { color: "#2fbf71", label: "Working" },
  degraded: { color: "#e8a33d", label: "Degraded" },
  down: { color: "#e5484d", label: "Not arriving" },
  halted: { color: "#e5484d", label: "Stopped" },
  off: { color: "#948d7d", label: "Switched off" },
  unconfigured: { color: "#948d7d", label: "Not set up" },
};

const KIND_ICON: Record<string, IconName> = {
  telephony: "phone", messaging: "chat", calendar: "calendar",
  email: "mail", security: "shield", infra: "layers",
};

/* A status page that is itself stale is worse than none. Half a minute is
   often enough to catch a worker dying while someone is looking at it. */
const POLL_MS = 30_000;

function StatusPill({ status }: { status: Status }) {
  useI18n();
  const tone = TONE[status];
  return <Pill color={tone.color} dot={status !== "off" && status !== "unconfigured"}>{t(tone.label)}</Pill>;
}

function when(at: string | null): string {
  return at ? timeAgo(at) : t("never");
}

function duration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}

function every(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds / 3600)}h`;
}

function formatActionText(action: string | null): string | null {
  if (!action) return null;
  const timelyMatch = action.match(/^(\d+)\s+feed\(s\)\s+return\s+an\s+error\s+every\s+sweep(?:\s*\(([^)]+)\))?\s*—\s*(.*)$/i);
  if (timelyMatch) {
    const [, count, breakdown] = timelyMatch;
    return tf("{count} feed(s) return an error every sweep{breakdown} — each one is an artist whose diary cannot be read.", {
      count,
      breakdown: breakdown ? ` (${breakdown})` : "",
    });
  }
  const twilioMatch = action.match(/^(\d+)\s+studio\(s\)\s+send\s+real\s+messages\s*—\s*(.*)$/i);
  if (twilioMatch) {
    return tf("{count} studio(s) send real messages — every test on those costs money.", {
      count: twilioMatch[1],
    });
  }
  return t(action);
}

function formatCheckDetail(detail: string | null): string | null {
  if (!detail) return null;
  const answeringMatch = detail.match(/^(\d+)\/(\d+)\s+answering\s*·\s*(\d+)\s+failing(?:\s*\(([^)]+)\))?$/i);
  if (answeringMatch) {
    const [, answered, total, failing, breakdown] = answeringMatch;
    return tf("{answered}/{total} answering · {failing} failing{breakdown}", {
      answered,
      total,
      failing,
      breakdown: breakdown ? ` (${breakdown})` : "",
    });
  }
  const sweepMatch = detail.match(/^(\d+)\s+feed\(s\)\s+read\s+every\s+(\d+)m$/i);
  if (sweepMatch) {
    return tf("{total} feed(s) read every {min}m", {
      total: sweepMatch[1],
      min: sweepMatch[2],
    });
  }
  return detail;
}

export default function SystemHealth() {
  const { can, toast } = useStore();
  useI18n();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/system/health", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReport((await res.json()) as Report);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const i = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(i);
  }, [load]);

  const clear = async (provider: string) => {
    setBusy(provider);
    try {
      const res = await fetch(`/api/crm/integrations/${provider}/clear`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        toast(b.message ?? t("Could not clear the halt"), "error");
        return;
      }
      toast(tf("{name} resumed", { name: provider }), "success");
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (error && !report) {
    return (
      <div className="rounded-2xl border border-ember-500/40 bg-ember-500/5 p-6 text-[13px] font-semibold text-ember-400">
        {t("Could not read the system status")} — {error}
      </div>
    );
  }
  if (!report) {
    return <div className="p-8 text-center text-[12.5px] font-semibold text-ink-400">{t("Checking every source…")}</div>;
  }

  const w = report.worker;
  const trouble = report.sources.filter(s => s.status === "down" || s.status === "halted" || s.status === "degraded");

  return (
    <div className="space-y-4 animate-rise">
      <SectionTitle right={
        <div className="flex items-center gap-2">
          <span className="num text-[10.5px] font-semibold text-ink-500">
            {tf("checked {ago}", { ago: timeAgo(report.generatedAt) })}
          </span>
          <Btn size="sm" variant="outline" onClick={() => void load()}><I name="refresh" size={13} /> {t("Refresh")}</Btn>
        </div>
      }>
        {t("Data Sources")}
      </SectionTitle>

      {/* ── The worker, first and on its own ──────────────────────────
          Everything below is downstream of it. When it is not running the
          other cards are not reporting health, they are reporting the last
          thing that happened before it stopped — which is the single most
          misleading state this page can be in. */}
      <div className={`overflow-hidden rounded-2xl border shadow-panel ${w.alive ? "border-ink-700 bg-ink-875" : "border-ember-500/50 bg-ember-500/8"}`}>
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${w.alive ? "border-jade-500/40 bg-jade-500/10 text-jade-400" : "border-ember-500/50 bg-ember-500/12 text-ember-400"}`}>
            <I name={w.alive ? "bolt" : "alert"} size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-extrabold text-ink-100">
              {w.alive ? t("The background worker is running") : t("The background worker is not running")}
            </div>
            <div className="num mt-0.5 text-[11.5px] font-semibold text-ink-400">
              {w.alive
                ? tf("up {uptime} · last heartbeat {stale} ago · pid {pid}", {
                    uptime: duration(w.uptimeSeconds),
                    stale: duration(w.staleSeconds),
                    pid: w.pid ?? "?",
                  })
                : w.lastBeatAt
                  ? tf("last heartbeat {ago}", { ago: timeAgo(w.lastBeatAt) })
                  : t("it has never checked in on this database")}
            </div>
            {!w.alive && (
              <div className="mt-1.5 text-[11.5px] font-semibold text-ember-400">
                {t("No calls are being imported, no scheduled message is being sent and no SLA task is being raised. Nothing below will recover on its own.")}
              </div>
            )}
          </div>
          <StatusPill status={w.alive ? "ok" : "down"} />
        </div>
      </div>

      {trouble.length > 0 && (
        <div className="rounded-2xl border border-ink-700 bg-ink-875 px-5 py-3.5 shadow-panel">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Needs attention")}</div>
          <ul className="mt-2 space-y-1.5">
            {trouble.map(s => (
              <li key={s.id} className="flex flex-wrap items-baseline gap-2 text-[12px] font-semibold text-ink-200">
                <StatusPill status={s.status} />
                <span className="font-extrabold text-ink-100">{s.label}</span>
                <span className="text-ink-400">{formatActionText(s.action) ?? s.halt?.reason ?? s.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
        {report.sources.map(s => {
          const tone = TONE[s.status];
          const expanded = open[s.id] ?? false;
          return (
            <div key={s.id} className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
              <div className="flex items-start gap-3 px-4 py-3.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-ink-600 bg-ink-800" style={{ color: tone.color }}>
                  <I name={KIND_ICON[s.kind] ?? "spark"} size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-extrabold text-ink-50">{s.label}</span>
                    <StatusPill status={s.status} />
                    {s.credential === "absent" && (
                      <span className="num rounded-md border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[10px] font-bold text-ink-400">
                        {t("no credentials")}
                      </span>
                    )}
                  </div>
                  <div className="num mt-1 text-[11.5px] font-semibold text-ink-400">{s.summary}</div>
                  {s.action && (
                    <div className="mt-1.5 text-[11.5px] font-semibold" style={{ color: tone.color }}>{formatActionText(s.action)}</div>
                  )}
                </div>
              </div>

              {/* The halt, and the one button that lifts it. Kept here as well
                  as on the banner, because this is the page someone opens when
                  they have just fixed the cause. */}
              {s.halt && (
                <div className="border-t border-ember-500/30 bg-ember-500/6 px-4 py-3">
                  <div className="text-[11.5px] font-bold text-ember-400">{s.halt.reason}</div>
                  <div className="num mt-0.5 text-[10.5px] font-semibold text-ink-500">
                    {tf("stopped {ago} after {n} failure(s)", { ago: when(s.halt.at), n: String(s.halt.failureCount) })}
                  </div>
                  {s.halt.detail && (
                    <pre className="num mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-ink-700 bg-ink-900/70 px-2.5 py-2 text-[10.5px] leading-relaxed text-ink-300">
                      {s.halt.detail}
                    </pre>
                  )}
                  <div className="mt-2">
                    {can("settings.manage") ? (
                      <Btn size="sm" variant="gold" disabled={busy === s.id} onClick={() => void clear(s.id)}>
                        <I name="check" size={13} /> {busy === s.id ? t("Resuming…") : t("Fixed — resume")}
                      </Btn>
                    ) : (
                      <span className="text-[11px] font-bold text-ink-400">{t("An administrator must clear this.")}</span>
                    )}
                  </div>
                </div>
              )}

              {s.freshness.length > 0 && (
                <div className="grid grid-cols-2 gap-px border-t border-ink-750 bg-ink-750">
                  {s.freshness.map(fr => (
                    <div key={fr.label} className="bg-ink-875 px-4 py-2.5">
                      <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-500">{t(fr.label)}</div>
                      <div className="num mt-0.5 text-[13px] font-extrabold text-ink-100">
                        {fr.count === null ? "—" : fr.count.toLocaleString()}
                        {fr.of !== null && <span className="text-[11px] font-bold text-ink-500"> / {fr.of.toLocaleString()}</span>}
                      </div>
                      <div className="num text-[10px] font-semibold text-ink-500">{when(fr.at)}</div>
                    </div>
                  ))}
                </div>
              )}

              {(s.checks.length > 0 || s.jobs.length > 0) && (
                <button
                  onClick={() => setOpen(o => ({ ...o, [s.id]: !expanded }))}
                  className="flex w-full items-center justify-between border-t border-ink-750 px-4 py-2 text-[11px] font-bold text-ink-400 hover:bg-ink-850 hover:text-ink-100"
                >
                  <span>{expanded ? t("Hide detail") : tf("{n} check(s)", { n: String(s.checks.length + s.jobs.length) })}</span>
                  <I name={expanded ? "chevD" : "chevR"} size={13} />
                </button>
              )}

              {expanded && (
                <div className="divide-y divide-ink-750 border-t border-ink-750">
                  {s.checks.map(c => (
                    <div key={c.id} className="flex items-start gap-2.5 px-4 py-2.5">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TONE[c.status].color }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-extrabold text-ink-100">{c.label}</div>
                        {/* Provider error strings are shown verbatim: a
                            paraphrase of "900901 Invalid Credentials" is not
                            something anyone can search for. */}
                        {c.detail && <div className="num mt-0.5 break-words text-[11px] font-semibold text-ink-400">{formatCheckDetail(c.detail)}</div>}
                      </div>
                      <span className="num shrink-0 text-[10px] font-semibold text-ink-500">{when(c.at)}</span>
                    </div>
                  ))}
                  {s.jobs.map(j => (
                    <div key={j.name} className="flex items-start gap-2.5 bg-ink-900/40 px-4 py-2.5">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TONE[j.status].color }} />
                      <div className="min-w-0 flex-1">
                        <div className="num text-[11.5px] font-extrabold text-ink-200">
                          {j.name} <span className="font-semibold text-ink-500">· {tf("every {t}", { t: every(j.everySeconds) })}</span>
                        </div>
                        <div className="num mt-0.5 text-[10.5px] font-semibold text-ink-500">
                          {j.configured
                            ? tf("last success {ago}", { ago: when(j.lastSuccessAt) })
                            : t("not configured — the worker skips it")}
                          {j.running && ` · ${t("running now")}`}
                        </div>
                        {j.lastError && (
                          <div className="num mt-1 break-words text-[10.5px] font-semibold text-ember-400">{j.lastError}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
