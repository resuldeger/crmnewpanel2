import { useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { Btn, Field, I, Pill, Toggle, inputCls, type IconName } from "../components/ui";
import {
  FRIENDLY_TZ, GTM_COUNTRIES, WEEKDAYS, emptyConfig, makeConfig,
  type Studio, type StudioConfig, type Weekday,
} from "../data/crm";
import { t, tf, useI18n } from "../services/i18n";

const slugify = (s: string) =>
  s.toLowerCase().replace(/cleopatra ink/i, "").trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* ── small building blocks ─────────────────────────────────────────────── */
function Card({ accent, icon, title, note, children }: {
  accent: string; icon: IconName; title: string; note?: string; children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
      <header className="flex items-start gap-3 border-b border-ink-750 px-5 py-4" style={{ boxShadow: `inset 3px 0 0 ${accent}` }}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border" style={{ color: accent, borderColor: `${accent}40`, background: `${accent}12` }}>
          <I name={icon} size={16} />
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-[15px] font-bold tracking-wide" style={{ color: accent }}>{title}</h3>
          {note && <p className="mt-0.5 text-[11px] font-semibold leading-snug text-ink-400">{note}</p>}
        </div>
      </header>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

function Secret({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label}>
      <div className="relative">
        <input type={show ? "text" : "password"} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className={`${inputCls} num pr-10`} />
        <button type="button" onClick={() => setShow(s => !s)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-400 transition-colors hover:text-gold-300"
          title={show ? t("Hide") : t("Reveal")}>
          <I name={show ? "eyeOff" : "eye"} size={14} />
        </button>
      </div>
    </Field>
  );
}

function Check({ on, onChange, label, sub, disabled }: {
  on: boolean; onChange: () => void; label: string; sub?: string; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onChange} disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${disabled ? "cursor-not-allowed opacity-50" : "hover:border-gold-500/40"} ${on ? "border-jade-500/45 bg-jade-500/8" : "border-ink-600 bg-ink-900"}`}>
      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors ${on ? "border-jade-500 bg-jade-500 text-ink-950" : "border-ink-500 bg-ink-800"}`}>
        {on && <I name="check" size={12} />}
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-extrabold text-ink-100">{label}</span>
        {sub && <span className="mt-0.5 block text-[10.5px] font-semibold text-ink-400">{sub}</span>}
      </span>
    </button>
  );
}

/* ── main view ─────────────────────────────────────────────────────────── */
export default function StudioEdit({ id }: { id?: number }) {
  const { studios, navigate, saveStudio, toast } = useStore();
  useI18n();
  const existing = id ? studios.find(s => s.id === id) : undefined;
  const isNew = !existing;

  const initial = useMemo<Studio>(() => existing
    ? { ...existing, config: existing.config ?? makeConfig(existing, existing.id) }
    : {
        id: 0, name: "", slug: "", phone: "", email: "", address: "", city: "", state: "",
        country: "USA", gtmCountry: "US", timezone: "America/New_York", bookingActive: true,
        manager: "", hours: "Mon–Sat · 11:00–20:00", config: emptyConfig("", ""),
      }, [existing]);

  const [name, setName] = useState(initial.name);
  const [city, setCity] = useState(initial.city);
  const [state_, setState] = useState(initial.state);
  const [country, setCountry] = useState(initial.country);
  const [email, setEmail] = useState(initial.email);
  const [manager, setManager] = useState(initial.manager);
  const [cfg, setCfg] = useState<StudioConfig>({ ...(initial.config as StudioConfig), hours: { ...(initial.config as StudioConfig).hours } });
  const [dirty, setDirty] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [smtp, setSmtp] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [imgPreview, setImgPreview] = useState(initial.config?.locationImage ?? "");
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof StudioConfig>(k: K, v: StudioConfig[K]) => { setCfg(c => ({ ...c, [k]: v })); setDirty(true); };
  const setDay = (day: Weekday, patch: Partial<{ enabled: boolean; open: string; close: string }>) => {
    setCfg(c => ({ ...c, hours: { ...c.hours, [day]: { ...c.hours[day], ...patch } } }));
    setDirty(true);
  };
  const touch = () => setDirty(true);

  const geocode = () => {
    if (!cfg.fullAddress.trim()) return;
    setGeoBusy(true);
    setTimeout(() => {
      const h = [...cfg.fullAddress].reduce((a, c) => a * 33 + c.charCodeAt(0), 11);
      set("latitude", (25 + (h % 2300) / 100).toFixed(4));
      set("longitude", (-122 + (h % 5100) / 100).toFixed(4));
      setGeoBusy(false);
      toast(t("GPS coordinates refreshed from address"), "info");
    }, 900);
  };

  const testSmtp = () => {
    setSmtp("testing");
    setTimeout(() => {
      const ok = cfg.smtpHost.trim().length > 3 && cfg.smtpPort > 0 && cfg.smtpUsername.includes("@");
      setSmtp(ok ? "ok" : "fail");
      toast(ok ? tf("SMTP handshake OK — {host}:{port}", { host: cfg.smtpHost, port: cfg.smtpPort }) : t("SMTP test failed — check host, port & credentials"), ok ? "success" : "error");
    }, 1200);
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    setImgPreview(url); set("locationImage", url);
    toast(tf("Image “{file}” attached", { file: f.name }), "info");
  };

  const save = () => {
    const slug = cfg.bookingSlug.trim() || slugify(name) || `studio-${studios.length + 1}`;
    const tzIana = Object.entries(FRIENDLY_TZ).find(([, v]) => v === cfg.timezone)?.[0] ?? cfg.ianaTimezone;
    const next: Studio = {
      id: initial.id, name: name.trim() || `Cleopatra Ink ${city || "Studio"}`, slug,
      phone: cfg.publicPhone || initial.phone, email: email.trim(),
      address: cfg.fullAddress, city: city.trim(), state: state_.trim(), country: country.trim(),
      gtmCountry: cfg.gtmCountry === "United States" ? "US" : initial.gtmCountry,
      timezone: tzIana, bookingActive: cfg.enableOnlineBooking,
      image: cfg.locationImage || undefined, manager: manager.trim() || initial.manager,
      hours: initial.hours, twilioNumber: initial.twilioNumber, branchNumber: cfg.publicPhone || initial.branchNumber,
      vonageExt: cfg.vonageExtension,
      config: { ...cfg, bookingSlug: slug, ianaTimezone: tzIana },
    };
    saveStudio(next);
    toast(isNew
      ? tf("{name} created · booking {state}", { name: next.name, state: cfg.enableOnlineBooking ? t("online") : t("paused") })
      : tf("{name} — all changes saved", { name: next.name }), "success");
    setDirty(false);
    navigate({ view: "studios" });
  };

  const back = () => navigate({ view: "studios" });

  return (
    <div className="animate-rise">
      {/* header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-[24px] font-extrabold tracking-wide text-ink-50">
              {isNew ? t("Add Booking Location") : t("Edit Booking Location")}
            </h2>
            {dirty && <Pill color="#e8a33d">{t("Unsaved changes")}</Pill>}
            {!isNew && (
              <Pill color={cfg.enableOnlineBooking ? "#2fbf71" : "#8b8ba0"}>
                {cfg.enableOnlineBooking ? t("Booking live") : t("Booking paused")}
              </Pill>
            )}
          </div>
          <span className="title-rule" />
          <p className="num mt-2 text-[12px] font-semibold text-ink-400">
            {isNew
              ? t("Register a new branch and wire its SMS, voice & mail integrations.")
              : tf("{city} · /{slug}/book · order #{order}", { city: city || initial.city, slug: cfg.bookingSlug || initial.slug, order: cfg.displayOrder })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Btn variant="outline" onClick={back}><I name="chevL" size={14} /> {t("Back to List")}</Btn>
          <Btn variant="gold" onClick={save} disabled={!dirty && !isNew}><I name="check" size={14} /> {t("Save All Changes")}</Btn>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* ── General ── */}
        <Card accent="#d4af37" icon="building" title={t("General Settings")} note={t("Core identity, public URL, geolocation and booking behaviour.")}>
          <Field label={t("Location name")}>
            <input value={name} onChange={e => { setName(e.target.value); touch(); }} placeholder="Cleopatra Ink Atlanta" className={inputCls} />
          </Field>
          <Field label={t("Location image")}>
            <div className="flex items-center gap-3">
              <div className="grid h-16 w-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-ink-600 bg-ink-900">
                {imgPreview
                  ? <img src={imgPreview} alt="preview" className="h-full w-full object-cover" onError={e => ((e.target as HTMLImageElement).style.display = "none")} />
                  : <I name="image" size={18} className="text-ink-500" />}
              </div>
              <div className="min-w-0 flex-1">
                <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
                <Btn variant="outline" size="sm" onClick={() => fileRef.current?.click()}><I name="upload" size={13} /> {t("Choose File")}</Btn>
                <div className="mt-1 text-[10.5px] font-semibold text-ink-500">{t("Recommended: landscape format. Max 5MB.")}</div>
              </div>
            </div>
          </Field>
          <Field label={t("Booking slug")}>
            <input value={cfg.bookingSlug} onChange={e => set("bookingSlug", slugify(e.target.value))} placeholder="atlanta" className={`${inputCls} num`} />
            <div className="num mt-1 text-[10.5px] font-bold text-gold-400">URL: /{cfg.bookingSlug || t("slug")}/book</div>
          </Field>
          <Field label={t("Full address")}>
            <textarea value={cfg.fullAddress} onChange={e => set("fullAddress", e.target.value)} onBlur={geocode} rows={2}
              placeholder="8610 Roswell Rd, Suite 340, Atlanta, GA 30350" className={`${inputCls} resize-none`} />
            <div className="mt-1 flex items-center gap-1.5 text-[10.5px] font-semibold text-ink-500">
              {geoBusy
                ? <><span className="h-1.5 w-1.5 animate-ping rounded-full bg-gold-400" /> {t("Fetching GPS coordinates…")}</>
                : <>{t("Updating the address will automatically fetch new GPS coordinates.")}</>}
            </div>
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("Location email (optional)")}>
              <input value={email} onChange={e => { setEmail(e.target.value); touch(); }} placeholder="branch@cleopatraink.com" className={inputCls} />
            </Field>
            <Field label={t("Branch public phone")}>
              <input value={cfg.publicPhone} onChange={e => set("publicPhone", e.target.value)} placeholder="+14703440356" className={`${inputCls} num`} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("Latitude")}>
              <input value={cfg.latitude} readOnly placeholder={t("Auto-generated")} className={`${inputCls} num opacity-70`} />
            </Field>
            <Field label={t("Longitude")}>
              <input value={cfg.longitude} readOnly placeholder={t("Auto-generated")} className={`${inputCls} num opacity-70`} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("GTM country")}>
              <select value={cfg.gtmCountry} onChange={e => set("gtmCountry", e.target.value)} className={inputCls}>
                {GTM_COUNTRIES.map(c => <option key={c} value={c}>{t(c)}</option>)}
              </select>
            </Field>
            <Field label={t("GTM city / state")}>
              <input value={cfg.gtmCityState} onChange={e => set("gtmCityState", e.target.value)} placeholder="e.g. Georgia_111590" className={`${inputCls} num`} />
            </Field>
          </div>
          <Field label={t("Google Maps URL")}>
            <input value={cfg.mapsUrl} onChange={e => set("mapsUrl", e.target.value)} placeholder="https://maps.app.goo.gl/…" className={`${inputCls} num`} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={t("Timezone")}>
              <select value={cfg.timezone} onChange={e => set("timezone", e.target.value)} className={inputCls}>
                {[...new Set(Object.values(FRIENDLY_TZ))].map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </Field>
            <Field label={t("Display order")}>
              <input type="number" value={cfg.displayOrder} onChange={e => set("displayOrder", Number(e.target.value))} className={`${inputCls} num`} />
            </Field>
            <Field label={t("Booking interval (min)")}>
              <select value={cfg.bookingInterval} onChange={e => set("bookingInterval", Number(e.target.value))} className={`${inputCls} num`}>
                {[15, 30, 45, 60, 90].map(v => <option key={v} value={v}>{v} min</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("City")}><input value={city} onChange={e => { setCity(e.target.value); touch(); }} placeholder="Atlanta" className={inputCls} /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("State")}><input value={state_} onChange={e => { setState(e.target.value); touch(); }} placeholder="GA" className={inputCls} /></Field>
              <Field label={t("Manager")}><input value={manager} onChange={e => { setManager(e.target.value); touch(); }} placeholder={t("Name")} className={inputCls} /></Field>
            </div>
          </div>
          <Check on={cfg.enableOnlineBooking} onChange={() => set("enableOnlineBooking", !cfg.enableOnlineBooking)}
            label={t("Enable Online Booking")} sub={t("Hides the branch from the public booking form when off.")} />
        </Card>

        {/* ── Social ── */}
        <div className="space-y-5">
          <Card accent="#e1589a" icon="spark" title={t("Social Media Settings")}
            note={t("Filled links show as icons on this branch's booking page.")}>
            {([
              ["instagram", "Instagram URL", "https://www.instagram.com/cleopatraink…"],
              ["facebook", "Facebook URL", "https://www.facebook.com/cleopatraink…"],
              ["tiktok", "TikTok URL", "https://www.tiktok.com/@cleopatraink…"],
              ["twitter", "Twitter URL", "https://twitter.com/…"],
              ["youtube", "YouTube URL", "https://youtube.com/…"],
            ] as [keyof StudioConfig, string, string][]).map(([k, label, ph]) => (
              <Field key={k} label={t(label)}>
                <input value={String(cfg[k])} onChange={e => set(k, e.target.value)} placeholder={ph} className={`${inputCls} num`} />
              </Field>
            ))}
          </Card>

          {/* ── Vonage ── */}
          <Card accent="#2fbf71" icon="phone" title={t("Vonage Integration Settings")}
            note={t("Incoming calls are matched to this branch by DID, then routed to the extension.")}>
            <Field label={t("Vonage DID phone number")}>
              <input value={cfg.vonageDid} onChange={e => set("vonageDid", e.target.value)} placeholder="+14703440356" className={`${inputCls} num`} />
              <div className="mt-1 text-[10.5px] font-semibold text-ink-500">{t("The direct phone number (DID) routed to this branch.")}</div>
            </Field>
            <Field label={t("Vonage extension")}>
              <input value={cfg.vonageExtension} onChange={e => set("vonageExtension", e.target.value)} placeholder="404" className={`${inputCls} num`} />
              <div className="mt-1 text-[10.5px] font-semibold text-ink-500">{t("The primary extension number assigned to this branch.")}</div>
            </Field>
            <div className="rounded-xl border border-jade-500/25 bg-jade-500/6 px-3.5 py-3">
              <div className="num text-[11px] font-bold leading-relaxed text-jade-400">
                {t("incoming DID")} → {cfg.vonageDid || "+1 (DID)"} → ext {cfg.vonageExtension || "—"} → {city || initial.city || t("this branch")}
              </div>
            </div>
          </Card>
        </div>

        {/* ── Twilio ── */}
        <Card accent="#4c8dff" icon="chat" title={t("Twilio & SMS Settings")} note={t("Powers lead and appointment messaging for this branch.")}>
          <Field label={t("Twilio Account SID")}>
            <input value={cfg.twilioAccountSid} onChange={e => set("twilioAccountSid", e.target.value)} placeholder="AC…" className={`${inputCls} num`} />
          </Field>
          <Secret label={t("Twilio Auth Token")} value={cfg.twilioAuthToken} onChange={v => set("twilioAuthToken", v)} placeholder="••••••••••••••••" />
          <Field label={t("Twilio Sender ID (Messaging Service)")}>
            <input value={cfg.twilioMessagingSid} onChange={e => set("twilioMessagingSid", e.target.value)} placeholder="MG…" className={`${inputCls} num`} />
            <div className="mt-1 text-[10.5px] font-semibold text-ink-500">{t("Messaging Service SID used for A2P 10DLC sending in the US.")}</div>
          </Field>
          <Field label={t("Twilio specific phone (optional)")}>
            <input value={cfg.twilioSpecificPhone} onChange={e => set("twilioSpecificPhone", e.target.value)} placeholder="+14702764016" className={`${inputCls} num`} />
          </Field>
          <div className="space-y-2.5">
            <Check on={cfg.smsAutomation} onChange={() => set("smsAutomation", !cfg.smsAutomation)}
              label={t("Enable SMS Automation (Leads & Appointments)")} sub={t("Confirmation, reminder and follow-up texts for this branch.")} />
            <Check on={cfg.callTracking} onChange={() => undefined} disabled
              label={t("Enable Call Tracking (Coming Soon)")} sub={t("Attribution per campaign — ships in a future release.")} />
          </div>
        </Card>

        {/* ── Mail ── */}
        <Card accent="#b18aff" icon="mail" title={t("Mail & SMTP Settings")} note={t("Transactional email (confirmations, receipts) sent from this branch.")}>
          <Check on={cfg.mailAutomation} onChange={() => set("mailAutomation", !cfg.mailAutomation)}
            label={t("Enable MAIL Automation")} sub={t("Automatic booking confirmations and reminders.")} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("Sender name")}>
              <input value={cfg.senderName} onChange={e => set("senderName", e.target.value)} placeholder="Cleopatra Ink Atlanta" className={inputCls} />
            </Field>
            <Field label={t("Sender email address")}>
              <input value={cfg.senderEmail} onChange={e => set("senderEmail", e.target.value)} placeholder="atlanta@cleopatraink.com" className={`${inputCls} num`} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-1"><Field label={t("SMTP host")}><input value={cfg.smtpHost} onChange={e => set("smtpHost", e.target.value)} placeholder="smtp.gmail.com" className={`${inputCls} num`} /></Field></div>
            <div className="col-span-1"><Field label={t("Port")}><input type="number" value={cfg.smtpPort} onChange={e => set("smtpPort", Number(e.target.value))} className={`${inputCls} num`} /></Field></div>
            <div className="col-span-1"><Field label={t("Username")}><input value={cfg.smtpUsername} onChange={e => set("smtpUsername", e.target.value)} className={`${inputCls} num`} /></Field></div>
          </div>
          <Secret label={t("SMTP password (app password)")} value={cfg.smtpPassword} onChange={v => set("smtpPassword", v)} placeholder="•••• •••• •••• ••••" />
          <div className="flex flex-wrap items-center gap-3">
            <Btn variant="outline" onClick={testSmtp} disabled={smtp === "testing"}>
              {smtp === "testing"
                ? <><span className="h-3 w-3 animate-spin rounded-full border-2 border-ink-400 border-t-gold-400" /> {t("Testing…")}</>
                : <><I name="refresh" size={14} /> {t("Test SMTP Connection")}</>}
            </Btn>
            {smtp === "ok" && <Pill color="#2fbf71">{t("Connection OK")}</Pill>}
            {smtp === "fail" && <Pill color="#e5484d">{t("Connection failed")}</Pill>}
          </div>
          <p className="text-[10.5px] font-semibold text-ink-500">{t("For Gmail or secure SMTP providers, use an App Password.")}</p>
        </Card>

        {/* ── Business hours ── */}
        <Card accent="#5fd6c9" icon="clock" title={tf("Business Hours ({tz})", { tz: cfg.ianaTimezone })}
          note={t("Slot generation and SMS reminders respect these local hours.")}>
          <div className="space-y-2">
            {WEEKDAYS.map(d => {
              const day = cfg.hours[d.key];
              return (
                <div key={d.key}
                  className={`flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${day.enabled ? "border-ink-600 bg-ink-900" : "border-ink-700 bg-ink-900/50 opacity-60"}`}>
                  <button type="button" onClick={() => setDay(d.key, { enabled: !day.enabled })}
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors ${day.enabled ? "border-[#5fd6c9] bg-[#5fd6c9] text-ink-950" : "border-ink-500 bg-ink-800"}`}>
                    {day.enabled && <I name="check" size={12} />}
                  </button>
                  <span className="w-24 text-[12.5px] font-extrabold text-ink-100">{t(d.label)}</span>
                  {day.enabled ? (
                    <div className="flex items-center gap-2">
                      <input type="time" value={day.open} onChange={e => setDay(d.key, { open: e.target.value })} className={`${inputCls} num !w-[110px]`} />
                      <span className="text-ink-500">→</span>
                      <input type="time" value={day.close} onChange={e => setDay(d.key, { close: e.target.value })} className={`${inputCls} num !w-[110px]`} />
                    </div>
                  ) : <span className="text-[11px] font-bold uppercase tracking-wider text-ink-500">{t("Closed")}</span>}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* footer */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-ink-750 pt-5">
        <span className="num text-[11px] font-semibold text-ink-500">
          {isNew
            ? t("New location — will be added to the branch list.")
            : tf("Editing record #{id} · changes apply to booking, SMS, voice & mail.", { id: initial.id })}
        </span>
        <div className="flex items-center gap-2">
          <Btn variant="outline" onClick={back}>{t("Cancel")}</Btn>
          <Btn variant="gold" onClick={save} disabled={!dirty && !isNew}><I name="check" size={14} /> {t("Save All Changes")}</Btn>
        </div>
      </div>
    </div>
  );
}
