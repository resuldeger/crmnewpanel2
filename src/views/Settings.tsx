import { useEffect, useState } from "react";
import { useStore, type DateRange } from "../store";
import { Btn, Field, I, Pill, SearchableSelect, SectionTitle, Toggle, inputCls, type IconName } from "../ui";
import { timeAgo } from "../data";
import { t, useI18n } from "../i18n";

/** Presentation only — the state of each integration comes from the API. */
const PRESENTATION: Record<string, { desc: string; icon: IconName; accent: string }> = {
  vonage: { desc: "Cloud telephony — call routing, recordings & live floor sync.", icon: "phone", accent: "#2fbf71" },
  twilio: { desc: "A2P 10DLC messaging, templates & opt-out compliance.", icon: "chat", accent: "#2f6fe4" },
  timely: { desc: "Two-way calendar sync for appointments & deposits.", icon: "calendar", accent: "#1e9e5c" },
  meta: { desc: "Server-side lead events for Instagram & Facebook pixels.", icon: "spark", accent: "#e1589a" },
  google: { desc: "gclid matching for booked-appointment imports.", icon: "chart", accent: "#e8a33d" },
  tiktok: { desc: "ttclid matching for Spark Ads attribution.", icon: "bolt", accent: "#5fd6c9" },
  turnstile: { desc: "Bot protection on the public booking form.", icon: "shield", accent: "#7c4fe0" },
};

interface ApiIntegration {
  provider: string; name: string; keyLabel: string;
  configured: boolean; enabled: boolean;
  secretPreview: string | null; publicKey: string | null;
  lastCheckedAt: string | null; lastStatus: string | null;
}

interface WebhookDelivery {
  id: number; provider: string; eventType: string;
  signatureValid: boolean; processed: boolean;
  error: string | null; receivedAt: string;
}

export default function Settings() {
  const { toast, dateRange, setDateRange, guard, can } = useStore();
  useI18n();
  const [apiInts, setApiInts] = useState<ApiIntegration[]>([]);
  const [events, setEvents] = useState<WebhookDelivery[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState({ autoAssign: true, smsSound: true, digest: false });

  /* Real integration state and the real webhook inbox. Both used to be
   * invented in the browser — plausible-looking keys and a synthetic event
   * every six seconds — which made an unconfigured integration look live. */
  useEffect(() => {
    let alive = true;
    fetch("/api/crm/settings", { credentials: "same-origin" })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { integrations: ApiIntegration[]; webhooks: WebhookDelivery[]; preferences: { autoAssign?: boolean; smsSound?: boolean; dailyDigest?: boolean } | null }) => {
        if (!alive) return;
        setApiInts(d.integrations);
        setEvents(d.webhooks);
        if (d.preferences) {
          setPrefs({
            autoAssign: d.preferences.autoAssign ?? false,
            smsSound: d.preferences.smsSound ?? true,
            digest: d.preferences.dailyDigest ?? false,
          });
        }
      })
      .catch((e: Error) => alive && setLoadError(e.message));
    return () => { alive = false; };
  }, []);

  const ints = apiInts.map(i => ({
    key: i.provider,
    name: i.name,
    keyLabel: i.keyLabel,
    on: i.enabled,
    configured: i.configured,
    secret: i.secretPreview ?? "",
    sync: i.lastCheckedAt ? new Date(i.lastCheckedAt).getTime() : null,
    ...(PRESENTATION[i.provider] ?? { desc: "", icon: "spark" as IconName, accent: "#948d7d" }),
  }));
  const locked = !can("settings.manage");

  return (
    <div className="space-y-4 animate-rise">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <SectionTitle right={<Pill color="#2fbf71" dot={false}><span className="num">{ints.filter(i => i.on).length}</span>&nbsp;{t("connected")}</Pill>}>
            {t("Integrations & API Keys")}
          </SectionTitle>
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
            {ints.map(it => (
              <div key={it.key} className={`rounded-2xl border bg-ink-875 p-4 shadow-panel transition-all duration-200 ${it.on ? "border-ink-700 hover:border-gold-500/40" : "border-ink-700 opacity-75"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-9 w-9 place-items-center rounded-lg border border-ink-600 bg-ink-800" style={{ color: it.accent }}>
                      <I name={it.icon} size={16} />
                    </span>
                    <div>
                      <div className="text-[13px] font-extrabold text-ink-50">{it.name}</div>
                      <div className="num text-[10px] font-semibold text-ink-500">
                        {it.sync ? `${t("last checked")} · ${timeAgo(new Date(it.sync).toISOString())}` : t("never checked")}
                      </div>
                    </div>
                  </div>
                  {/* The toggle is read-only until there is an endpoint to
                      persist it; a switch that only moves on screen is worse
                      than one that does not move. */}
                  <Toggle on={it.on} onChange={() => toast(t("Credentials are managed on the server"), "info")} />
                </div>
                <p className="mt-2.5 text-[11.5px] font-medium leading-relaxed text-ink-400">{it.desc}</p>
                <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900/70 px-2.5 py-1.5">
                  <span className="text-[9.5px] font-bold uppercase tracking-wider text-ink-500">{it.keyLabel}</span>
                  {/* Masked on the server. There is no reveal and no copy:
                      the console never receives the value. */}
                  <span className="num min-w-0 flex-1 truncate text-[11px] font-bold text-ink-200">
                    {it.configured ? it.secret || "••••••••" : t("not configured")}
                  </span>
                </div>
                <div className="mt-2.5 flex items-center justify-between">
                  <span className={`flex items-center gap-1.5 text-[10.5px] font-bold ${it.configured && it.on ? "text-jade-400" : "text-ink-500"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${it.configured && it.on ? "bg-jade-400" : "bg-ink-500"}`} />
                    {it.configured ? (it.on ? t("connected") : t("disabled")) : t("not configured")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4 xl:col-span-2">
          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle right={
              <span className="flex items-center gap-1.5 text-[10.5px] font-bold text-jade-400">
                <span className="h-1.5 w-1.5 rounded-full bg-jade-400" /> <span className="num">{events.length}</span>
              </span>
            }>{t("Webhook Activity")}</SectionTitle>
            <div className="space-y-2">
              {events.length === 0 && (
                <p className="rounded-lg border border-dashed border-ink-700 px-3 py-6 text-center text-[11px] font-semibold text-ink-500">
                  {loadError ?? t("No webhooks received yet")}
                </p>
              )}
              {events.map(e => (
                <div key={e.id} className="flex items-center gap-2.5 rounded-lg border border-ink-700 bg-ink-900/70 px-3 py-2">
                  <Pill color="#7c4fe0" dot={false} className="!text-[9.5px]">{e.provider}</Pill>
                  <span className="num min-w-0 flex-1 truncate text-[11.5px] font-bold text-ink-200">{e.eventType}</span>
                  {/* An unsigned webhook is the one thing worth shouting about. */}
                  {!e.signatureValid && (
                    <span className="num rounded-md border border-ember-500/40 bg-ember-500/10 px-1.5 py-0.5 text-[10px] font-bold text-ember-400">
                      {t("unsigned")}
                    </span>
                  )}
                  <span className={`num rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                    e.error
                      ? "border border-ember-500/40 bg-ember-500/10 text-ember-400"
                      : e.processed
                        ? "border border-jade-500/40 bg-jade-500/10 text-jade-400"
                        : "border border-ink-600 bg-ink-800 text-ink-400"
                  }`}>
                    {e.error ? t("failed") : e.processed ? t("processed") : t("queued")}
                  </span>
                  <span className="num w-14 text-right text-[10px] text-ink-500">{timeAgo(e.receivedAt)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle>{t("Console Preferences")}</SectionTitle>
            <div className="space-y-4">
              <Field label={t("Default date range")}>
                <SearchableSelect
                  value={dateRange}
                  onChange={v => { setDateRange(v as DateRange); toast(t("Console Preferences"), "info"); }}
                  options={[
                    { value: "today", label: t("Today"), icon: "clock" },
                    { value: "7", label: t("Last 7 Days"), icon: "clock" },
                    { value: "30", label: t("Last 30 Days"), icon: "clock" },
                    { value: "all", label: t("All Time"), icon: "globe" },
                  ]}
                />
              </Field>
              {[
                { k: "autoAssign" as const, t2: "Auto-assign new leads", d: "Route to the least-busy callcenter line on intake." },
                { k: "smsSound" as const, t2: "Sound on inbound SMS", d: "Play a chime in the messenger when a client replies." },
                { k: "digest" as const, t2: "Daily digest email", d: "KPI summary to super admins every morning at 08:00." },
              ].map(p => (
                <div key={p.k} className="flex items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-900/70 px-3.5 py-3">
                  <div>
                    <div className="text-[12.5px] font-extrabold text-ink-100">{t(p.t2)}</div>
                    <div className="mt-0.5 text-[11px] font-semibold text-ink-400">{p.d}</div>
                  </div>
                  <Toggle on={prefs[p.k]} onChange={() => {
                    setPrefs(s => ({ ...s, [p.k]: !s[p.k] }));
                    toast(tf2(p.t2, prefs[p.k] ? "disabled" : "enabled"), "info");
                  }} />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-ember-500/40 bg-ember-500/5 p-5">
            <div className="flex items-center gap-2">
              <I name="alert" size={16} className="text-ember-400" />
              <h3 className="font-display text-[15px] font-bold tracking-wide text-ember-400">{t("Danger Zone")}</h3>
            </div>
            <p className="mt-1.5 text-[11.5px] font-semibold leading-relaxed text-ink-400">
              {t("Destructive actions are locked in this environment. Purging leads or call history requires owner approval via Vonage verify.")}
            </p>
            <div className="mt-3 flex gap-2">
              <Btn variant="danger" size="sm" onClick={() => toast(t("Demo dataset is read-only in this sandbox"), "error")}><I name="x" size={13} /> {t("Purge leads")}</Btn>
              <Btn variant="danger" size="sm" onClick={() => toast(t("Call recordings are retained 90 days by policy"), "error")}><I name="x" size={13} /> {t("Wipe recordings")}</Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function tf2(key: string, action: string) {
  return `${t(key)} ${t(action)}`;
}
