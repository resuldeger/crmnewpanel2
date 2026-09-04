import { useEffect, useState } from "react";
import { useStore, type DateRange } from "../store";
import { Btn, Field, I, Pill, SectionTitle, Toggle, inputCls, type IconName } from "../ui";
import { timeAgo } from "../data";
import { t, useI18n } from "../i18n";

const genKey = (prefix: string) =>
  prefix + Array.from({ length: 18 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");

const INTEGRATIONS: { key: string; name: string; desc: string; icon: IconName; keyLabel: string; keyPrefix: string; onDefault: boolean; accent: string }[] = [
  { key: "vonage", name: "Vonage VBC", desc: "Cloud telephony — call routing, recordings & live floor sync.", icon: "phone", keyLabel: "API Secret", keyPrefix: "VG-", onDefault: true, accent: "#2fbf71" },
  { key: "twilio", name: "Twilio Programmable SMS", desc: "A2P 10DLC messaging, templates & opt-out compliance.", icon: "chat", keyLabel: "Auth Token", keyPrefix: "TW-", onDefault: true, accent: "#2f6fe4" },
  { key: "timely", name: "Timely Booking Sync", desc: "Two-way calendar sync for appointments & deposits.", icon: "calendar", keyLabel: "Partner Key", keyPrefix: "TL-", onDefault: true, accent: "#1e9e5c" },
  { key: "meta", name: "Meta Conversions API", desc: "Server-side lead events for Instagram & Facebook pixels.", icon: "spark", keyLabel: "Access Token", keyPrefix: "EA-", onDefault: true, accent: "#e1589a" },
  { key: "google", name: "Google Ads Offline Conversions", desc: "gclid matching for booked-appointment imports.", icon: "chart", keyLabel: "Developer Token", keyPrefix: "GA-", onDefault: false, accent: "#e8a33d" },
  { key: "tiktok", name: "TikTok Events API", desc: "ttclid matching for Spark Ads attribution.", icon: "bolt", keyLabel: "Access Token", keyPrefix: "TT-", onDefault: false, accent: "#5fd6c9" },
];

const EVENT_POOL = [
  { method: "POST", path: "/hooks/lead.created", status: 200 },
  { method: "POST", path: "/hooks/call.completed", status: 200 },
  { method: "POST", path: "/hooks/sms.delivered", status: 200 },
  { method: "POST", path: "/hooks/appointment.updated", status: 200 },
  { method: "POST", path: "/hooks/sms.received", status: 201 },
  { method: "POST", path: "/hooks/campaign.progress", status: 200 },
];

export default function Settings() {
  const { toast, dateRange, setDateRange, guard, can } = useStore();
  useI18n();
  const [ints, setInts] = useState(() =>
    INTEGRATIONS.map(i => ({ ...i, on: i.onDefault, secret: genKey(i.keyPrefix), revealed: false, sync: Date.now() - Math.random() * 900_000 })));
  const [events, setEvents] = useState(() => EVENT_POOL.slice(0, 4).map((e, i) => ({ id: i, ...e, at: new Date(Date.now() - (i + 1) * 3.4 * 60_000).toISOString() })));
  const [prefs, setPrefs] = useState({ autoAssign: true, smsSound: true, digest: false });

  useEffect(() => {
    const tick = setInterval(() => {
      setEvents(ev => [{
        id: Date.now(),
        ...EVENT_POOL[Math.floor(Math.random() * EVENT_POOL.length)],
        at: new Date().toISOString(),
      }, ...ev].slice(0, 7));
    }, 6000);
    return () => clearInterval(tick);
  }, []);

  const mask = (s: string) => s.slice(0, 3) + "•".repeat(14) + s.slice(-4);
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
                      <div className="num text-[10px] font-semibold text-ink-500">last sync · {timeAgo(new Date(it.sync).toISOString())}</div>
                    </div>
                  </div>
                  <Toggle on={it.on} onChange={() => {
                    if (!guard("settings.manage")) return;
                    setInts(xs => xs.map(x => x.key === it.key ? { ...x, on: !x.on, sync: Date.now() } : x));
                    toast(`${it.name} ${it.on ? "−" : "+"}`, "info");
                  }} />
                </div>
                <p className="mt-2.5 text-[11.5px] font-medium leading-relaxed text-ink-400">{it.desc}</p>
                <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900/70 px-2.5 py-1.5">
                  <span className="text-[9.5px] font-bold uppercase tracking-wider text-ink-500">{it.keyLabel}</span>
                  <span className="num min-w-0 flex-1 truncate text-[11px] font-bold text-ink-200">{it.revealed ? it.secret : mask(it.secret)}</span>
                  <button onClick={() => setInts(xs => xs.map(x => x.key === it.key ? { ...x, revealed: !x.revealed } : x))}
                    className="rounded-md p-1 text-ink-400 transition-colors hover:text-gold-300" title={it.revealed ? "Hide" : "Reveal"}>
                    <I name={it.revealed ? "eyeOff" : "eye"} size={13} />
                  </button>
                  <button onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(it.secret).catch(() => undefined); toast(it.keyLabel, "info"); }}
                    className="rounded-md p-1 text-ink-400 transition-colors hover:text-gold-300" title="Copy">
                    <I name="copy" size={13} />
                  </button>
                </div>
                <div className="mt-2.5 flex items-center justify-between">
                  <span className={`flex items-center gap-1.5 text-[10.5px] font-bold ${it.on ? "text-jade-400" : "text-ink-500"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${it.on ? "animate-pulse bg-jade-400" : "bg-ink-500"}`} />
                    {it.on ? t("live") : "idle"}
                  </span>
                  <Btn size="sm" variant="ghost" locked={locked} onClick={() => {
                    setInts(xs => xs.map(x => x.key === it.key ? { ...x, secret: genKey(x.keyPrefix), revealed: false } : x));
                    toast(`${it.name} ↻`, "info");
                  }}>
                    <I name="refresh" size={12} /> {t("Rotate")}
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4 xl:col-span-2">
          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle right={
              <span className="flex items-center gap-1.5 text-[10.5px] font-bold text-jade-400">
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-jade-400" /> {t("listening")}
              </span>
            }>{t("Webhook Activity")}</SectionTitle>
            <div className="space-y-2">
              {events.map(e => (
                <div key={e.id} className="flex items-center gap-2.5 rounded-lg border border-ink-700 bg-ink-900/70 px-3 py-2 animate-pop">
                  <Pill color="#7c4fe0" dot={false} className="!text-[9.5px]">{e.method}</Pill>
                  <span className="num min-w-0 flex-1 truncate text-[11.5px] font-bold text-ink-200">{e.path}</span>
                  <span className="num rounded-md border border-jade-500/40 bg-jade-500/10 px-1.5 py-0.5 text-[10px] font-bold text-jade-400">{e.status}</span>
                  <span className="num w-14 text-right text-[10px] text-ink-500">{timeAgo(e.at)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle>{t("Console Preferences")}</SectionTitle>
            <div className="space-y-4">
              <Field label={t("Default date range")}>
                <select value={dateRange} onChange={e => { setDateRange(e.target.value as DateRange); toast(t("Console Preferences"), "info"); }} className={inputCls}>
                  <option value="today">{t("Today")}</option>
                  <option value="7">{t("Last 7 Days")}</option>
                  <option value="30">{t("Last 30 Days")}</option>
                  <option value="all">{t("All Time")}</option>
                </select>
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
