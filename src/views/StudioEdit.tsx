import { useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "../store";
import { Btn, Field, I, Pill, SearchableSelect, SectionTitle, Toggle, inputCls } from "../ui";
import { NUMBER_KIND_META, prettyPhone, type Studio, type StudioConfig } from "../data";
import { t, tf, useI18n } from "../i18n";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_LABELS: Record<string, string> = { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday" };
const FRIENDLY_TZ: Record<string, string> = {
  "America/New_York": "Eastern Standard Time", "America/Chicago": "Central Standard Time",
  "America/Denver": "Mountain Standard Time", "Europe/Istanbul": "GMT+3", "Europe/London": "Greenwich Mean Time",
  "Europe/Berlin": "Central European Time", "America/Toronto": "Eastern Standard Time", "Asia/Dubai": "Gulf Standard Time",
};
const slugify = (s: string) => s.toLowerCase().replace(/cleopatra ink/i, "").trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function Card({ title, color, icon, children }: { title: string; color: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg border" style={{ color, borderColor: `${color}55`, background: `${color}12` }}>{icon}</span>
        <h3 className="font-display text-[15px] font-bold tracking-wide" style={{ color }}>{t(title)}</h3>
      </div>
      {children}
    </div>
  );
}

const emptyConfig = (slug: string): StudioConfig => ({
  bookingSlug: slug, publicPhone: "", latitude: 0, longitude: 0, gtmCountry: "United States",
  gtmCityState: "", mapsUrl: "", timezone: "Eastern Standard Time", ianaTimezone: "America/New_York",
  displayOrder: 100, bookingInterval: 30, enableOnlineBooking: true,
  socials: { instagram: "", facebook: "", tiktok: "", twitter: "", youtube: "" },
  twilio: { accountSid: "", authToken: "", messagingSid: "", specificPhone: "", smsAutomation: true },
  vonage: { did: "", extension: "" },
  mail: { enabled: true, senderName: "", senderEmail: "", smtpHost: "smtp.gmail.com", smtpPort: 587, smtpUser: "", smtpPass: "" },
  businessHours: Object.fromEntries(DAYS.map((d, i) => [d, { enabled: i < 6, open: "10:30", close: "19:30" }])),
});

export default function StudioEdit({ id }: { id?: number }) {
  const { studios, saveStudio, numbers, saveNumber, removeNumber, navigate, toast, guard } = useStore();
  useI18n();
  const studio = id ? studios.find(s => s.id === id) : undefined;
  const isNew = !studio;

  const [name, setName] = useState(studio?.name ?? "");
  const [cfg, setCfg] = useState<StudioConfig>(studio?.config ?? emptyConfig(""));
  const [manager, setManager] = useState(studio?.manager ?? "");
  const [address, setAddress] = useState(studio?.address ?? "");
  const [city, setCity] = useState(studio?.city ?? "");
  const [country, setCountry] = useState(studio?.country ?? "USA");
  const [locEmail, setLocEmail] = useState(studio?.email ?? "");
  const [fetchingGps, setFetchingGps] = useState(false);
  const [smtpState, setSmtpState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [imgName, setImgName] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /* number editor state */
  const [numKind, setNumKind] = useState<"vonage" | "twilio" | "branch">("twilio");
  const [numLabel, setNumLabel] = useState("");
  const [numVal, setNumVal] = useState("");
  const studioNumbers = useMemo(() => numbers.filter(n => n.studioId === (studio?.id ?? -1)), [numbers, studio]);

  const set = <K extends keyof StudioConfig>(k: K, v: StudioConfig[K]) => { setCfg(c => ({ ...c, [k]: v })); setDirty(true); };
  const setTw = (k: keyof StudioConfig["twilio"], v: string | boolean) => { setCfg(c => ({ ...c, twilio: { ...c.twilio, [k]: v } })); setDirty(true); };
  const setVon = (k: keyof StudioConfig["vonage"], v: string) => { setCfg(c => ({ ...c, vonage: { ...c.vonage, [k]: v } })); setDirty(true); };
  const setMail = (k: keyof StudioConfig["mail"], v: string | number | boolean) => { setCfg(c => ({ ...c, mail: { ...c.mail, [k]: v } })); setDirty(true); };
  const setSoc = (k: keyof StudioConfig["socials"], v: string) => { setCfg(c => ({ ...c, socials: { ...c.socials, [k]: v } })); setDirty(true); };
  const setDay = (day: string, patch: Partial<{ enabled: boolean; open: string; close: string }>) => {
    setCfg(c => ({ ...c, businessHours: { ...c.businessHours, [day]: { ...c.businessHours[day], ...patch } } }));
    setDirty(true);
  };

  const geocode = () => {
    if (!address.trim() && !city.trim()) return;
    setFetchingGps(true);
    setTimeout(() => {
      const h = [...(address + city)].reduce((a, ch) => a + ch.charCodeAt(0), 7);
      set("latitude", Math.round((30 + (h % 200) / 10) * 10000) / 10000);
      set("longitude", Math.round((-95 + (h % 300) / 10) * 10000) / 10000);
      setFetchingGps(false);
    }, 900);
  };

  const save = () => {
    if (!guard("studios.edit")) return;
    const slug = cfg.bookingSlug.trim() || slugify(name) || `studio-${studios.length + 1}`;
    const tzIana = Object.entries(FRIENDLY_TZ).find(([, v]) => v === cfg.timezone)?.[0] ?? cfg.ianaTimezone;
    const next: Studio = {
      id: studio?.id ?? 0, name: name.trim() || `Cleopatra Ink ${city || "Studio"}`, slug,
      phone: cfg.publicPhone, email: locEmail, address, city, state: "", country,
      gtmCountry: cfg.gtmCountry, timezone: cfg.timezone, bookingActive: cfg.enableOnlineBooking,
      manager, hours: "Mon–Sat · 10:30–19:30", accent: studio?.accent ?? "#fba200", image: studio?.image,
      config: { ...cfg, bookingSlug: slug, ianaTimezone: tzIana },
    };
    const savedId = saveStudio(next);
    setDirty(false);
    toast(isNew ? tf("{name} created · booking {state}", { name: next.name, state: cfg.enableOnlineBooking ? t("online") : t("paused") }) : tf("{name} saved", { name: next.name }));
    navigate({ view: "studio", id: savedId });
  };

  const testSmtp = () => {
    setSmtpState("testing");
    setTimeout(() => {
      const ok = cfg.mail.smtpHost.trim().length > 3 && cfg.mail.smtpUser.includes("@");
      setSmtpState(ok ? "ok" : "fail");
      toast(ok ? t("Connection OK") : t("Connection failed"), ok ? "success" : "error");
    }, 1400);
  };

  const tzName = FRIENDLY_TZ[cfg.ianaTimezone] ?? cfg.timezone;

  return (
    <div className="space-y-4 animate-rise">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate({ view: "studios" })} aria-label={t("Back to List")}
            className="rounded-lg border border-ink-600 p-2 text-ink-400 transition-colors hover:border-gold-500/60 hover:text-gold-300"><I name="chevL" size={15} /></button>
          <div>
            <h2 className="font-display text-[21px] font-bold tracking-wide text-ink-50">{isNew ? t("Add Studio") : t("Edit Booking Location")}</h2>
            <div className="num text-[11.5px] text-ink-400">{isNew ? "BookingLocation · new" : `${city || studio?.name} · /${cfg.bookingSlug}/book`}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <Pill color="#e8a33d" className="animate-blink">{t("Unsaved changes")}</Pill>}
          <Btn variant="outline" onClick={() => navigate({ view: "studios" })}>{t("Back to List")}</Btn>
          <Btn variant="gold" onClick={save} locked={!dirty && !isNew}><I name="check" size={14} /> {t("Save All Changes")}</Btn>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* General */}
        <Card title="General Settings" color="#d97f00" icon={<I name="gear" size={15} />}>
          <div className="space-y-3.5">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Field label={t("Studio name")}>
                <input value={name} onChange={e => { setName(e.target.value); setDirty(true); }} placeholder="Cleopatra Ink Atlanta"
                  autoComplete="off" autoCorrect="off" spellCheck={false} className={inputCls} />
              </Field>
              <Field label={t("Booking Slug")} hint={<span className="num">URL: /{cfg.bookingSlug || "…"}/book</span>}>
                <input value={cfg.bookingSlug} onChange={e => set("bookingSlug", slugify(e.target.value))} placeholder="atlanta"
                  autoComplete="off" autoCorrect="off" spellCheck={false} className={`${inputCls} num`} />
              </Field>
            </div>
            <div className="rounded-xl border border-dashed border-ink-600 p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Location Image")}</div>
              <div className="mt-2 flex items-center gap-3">
                <div className="grid h-14 w-24 place-items-center overflow-hidden rounded-lg border border-ink-600 bg-gradient-to-br from-ink-800 to-ink-750">
                  {imgName ? <I name="image" size={18} className="text-gold-400" /> : <span className="text-[9px] font-bold text-ink-500">JPG/PNG</span>}
                </div>
                <div>
                  <Btn size="sm" variant="outline" onClick={() => fileRef.current?.click()}><I name="upload" size={12} /> Choose File</Btn>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) { setImgName(f.name); toast(tf("Image “{file}” attached", { file: f.name }), "info"); setDirty(true); }
                  }} />
                  <div className="num mt-1 text-[10.5px] text-ink-500">{imgName ?? t("Recommended: Landscape format. Max 5MB.")}</div>
                </div>
              </div>
            </div>
            <Field label={t("Full Address")} hint={fetchingGps ? t("Fetching coordinates…") : t("Updating the address will automatically fetch new GPS coordinates.")}>
              <textarea value={address} onChange={e => { setAddress(e.target.value); setDirty(true); }} onBlur={geocode} rows={2}
                autoComplete="off" autoCorrect="off" spellCheck={false}
                placeholder="8610 Roswell Rd, Suite 340" className={`${inputCls} resize-none`} />
            </Field>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Field label={t("Manager")}>
                <input value={manager} onChange={e => { setManager(e.target.value); setDirty(true); }} placeholder="Luis Ortega"
                  autoComplete="off" autoCorrect="off" spellCheck={false} className={inputCls} />
              </Field>
              <Field label={t("Location Email (Optional)")}>
                <input value={locEmail} onChange={e => { setLocEmail(e.target.value); setDirty(true); }} placeholder="branch@cleopatraink.com"
                  autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} className={inputCls} />
              </Field>
              <Field label={t("City")}>
                <input value={city} onChange={e => { setCity(e.target.value); setDirty(true); }} placeholder="Atlanta"
                  autoComplete="off" autoCorrect="off" spellCheck={false} className={inputCls} />
              </Field>
              <Field label={t("Country")}>
                <input value={country} onChange={e => { setCountry(e.target.value); setDirty(true); }} placeholder="USA"
                  autoComplete="off" autoCorrect="off" spellCheck={false} className={inputCls} />
              </Field>
              <Field label={t("Branch Public Phone")}>
                <input value={cfg.publicPhone} onChange={e => set("publicPhone", e.target.value)} placeholder="+14703440356"
                  autoComplete="off" autoCorrect="off" spellCheck={false} className={`${inputCls} num`} />
              </Field>
              <Field label={t("Latitude")}>
                <input value={cfg.latitude || ""} onChange={e => set("latitude", Number(e.target.value))} placeholder="Auto-generated"
                  autoComplete="off" autoCorrect="off" spellCheck={false} className={`${inputCls} num`} />
              </Field>
              <Field label={t("Longitude")}>
                <input value={cfg.longitude || ""} onChange={e => set("longitude", Number(e.target.value))} placeholder="Auto-generated"
                  autoComplete="off" autoCorrect="off" spellCheck={false} className={`${inputCls} num`} />
              </Field>
              <Field label={t("GTM Country")}>
                <input value={cfg.gtmCountry} onChange={e => set("gtmCountry", e.target.value)} placeholder="United States"
                  autoComplete="off" autoCorrect="off" spellCheck={false} className={inputCls} />
              </Field>
              <Field label={t("GTM City / State")}>
                <input value={cfg.gtmCityState} onChange={e => set("gtmCityState", e.target.value)} placeholder="e.g. Georgia_111590"
                  autoComplete="off" autoCorrect="off" spellCheck={false} className={`${inputCls} num`} />
              </Field>
              <Field label={t("Google Maps URL")}>
                <input value={cfg.mapsUrl} onChange={e => set("mapsUrl", e.target.value)} placeholder="https://maps.app.goo.gl/…"
                  autoComplete="off" autoCorrect="off" spellCheck={false} className={`${inputCls} num`} />
              </Field>
              <Field label={t("Timezone")}>
                <SearchableSelect
                  value={cfg.timezone}
                  onChange={friendly => {
                    const iana = Object.entries(FRIENDLY_TZ).find(([, v]) => v === friendly)?.[0] ?? cfg.ianaTimezone;
                    setCfg(c => ({ ...c, timezone: friendly, ianaTimezone: iana })); setDirty(true);
                  }}
                  searchPlaceholder={t("Search timezone…")}
                  options={[...new Set(Object.values(FRIENDLY_TZ))].map(tz => ({
                    value: tz,
                    label: tz,
                    icon: "clock",
                  }))}
                />
              </Field>
              <Field label={t("Display Order")}>
                <input type="number" value={cfg.displayOrder} onChange={e => set("displayOrder", Number(e.target.value))} className={`${inputCls} num`} />
              </Field>
              <Field label={t("Booking Interval (Min)")}>
                <input type="number" value={cfg.bookingInterval} onChange={e => set("bookingInterval", Number(e.target.value))} className={`${inputCls} num`} />
              </Field>
            </div>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-850 px-3.5 py-3 text-[12.5px] font-extrabold text-ink-200">
              <input type="checkbox" checked={cfg.enableOnlineBooking} onChange={e => set("enableOnlineBooking", e.target.checked)} className="h-4 w-4 accent-[#fba200]" />
              {t("Enable Online Booking")}
            </label>
          </div>
        </Card>

        {/* Social */}
        <Card title="Social Media Settings" color="#e1589a" icon={<I name="spark" size={15} />}>
          <div className="space-y-3.5">
            {([
              ["instagram", "Instagram URL", "https://www.instagram.com/cleopatraink…"],
              ["facebook", "Facebook URL", "https://www.facebook.com/cleopatraink…"],
              ["tiktok", "TikTok URL", "https://www.tiktok.com/@cleopatraink…"],
              ["twitter", "Twitter URL", "https://twitter.com/…"],
              ["youtube", "YouTube URL", "https://youtube.com/…"],
            ] as [keyof StudioConfig["socials"], string, string][]).map(([k, label, ph]) => (
              <Field key={k} label={t(label)}>
                <input value={cfg.socials[k]} onChange={e => setSoc(k, e.target.value)} placeholder={ph}
                  autoComplete="off" autoCorrect="off" spellCheck={false} className={`${inputCls} num`} />
              </Field>
            ))}
            <p className="text-[11px] font-semibold text-ink-500">Social icons appear on the public booking page when filled.</p>
          </div>
        </Card>

        {/* Twilio */}
        <Card title="Twilio & SMS Settings" color="#2f6fe4" icon={<I name="chat" size={15} />}>
          <div className="space-y-3.5">
            <Field label={t("Twilio Account SID")}>
              <input value={cfg.twilio.accountSid} onChange={e => setTw("accountSid", e.target.value)} placeholder="AC…"
                autoComplete="off" autoCorrect="off" spellCheck={false} className={`${inputCls} num`} />
            </Field>
            <Field label={t("Twilio Auth Token")}>
              <input type="password" value={cfg.twilio.authToken} onChange={e => setTw("authToken", e.target.value)} placeholder="••••••••••••••••"
                autoComplete="new-password" className={`${inputCls} num`} />
            </Field>
            <Field label={t("Messaging Service SID")} hint="Used as the SMS sender (A2P 10DLC, US).">
              <input value={cfg.twilio.messagingSid} onChange={e => setTw("messagingSid", e.target.value)} placeholder="MG…"
                autoComplete="off" autoCorrect="off" spellCheck={false} className={`${inputCls} num`} />
            </Field>
            <Field label={t("Twilio Specific Phone (Optional)")}>
              <input value={cfg.twilio.specificPhone} onChange={e => setTw("specificPhone", e.target.value)} placeholder="+14702764016"
                autoComplete="off" autoCorrect="off" spellCheck={false} className={`${inputCls} num`} />
            </Field>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-850 px-3.5 py-3 text-[12.5px] font-extrabold text-ink-200">
              <input type="checkbox" checked={cfg.twilio.smsAutomation} onChange={e => setTw("smsAutomation", e.target.checked)} className="h-4 w-4 accent-[#fba200]" />
              {t("Enable SMS Automation (Leads & Appointments)")}
            </label>
            <label className="flex cursor-not-allowed items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-850 px-3.5 py-3 text-[12.5px] font-extrabold text-ink-500 opacity-60">
              <input type="checkbox" disabled className="h-4 w-4" />
              {t("Enable Call Tracking (Coming Soon)")}
            </label>
          </div>
        </Card>

        {/* Vonage */}
        <Card title="Vonage Integration Settings" color="#1e9e5c" icon={<I name="phone" size={15} />}>
          <div className="space-y-3.5">
            <Field label={t("Vonage DID Phone Number")} hint={t("The direct phone number (DID) routed to this branch.")}>
              <input value={cfg.vonage.did} onChange={e => setVon("did", e.target.value)} placeholder="+14703440356"
                autoComplete="off" autoCorrect="off" spellCheck={false} className={`${inputCls} num`} />
            </Field>
            <Field label={t("Vonage Extension")} hint={t("The primary extension number assigned to this branch.")}>
              <input value={cfg.vonage.extension} onChange={e => setVon("extension", e.target.value)} placeholder="404"
                autoComplete="off" autoCorrect="off" spellCheck={false} className={`${inputCls} num`} />
            </Field>
            <div className="rounded-xl border border-jade-500/30 bg-jade-500/6 p-3.5">
              <div className="num text-center text-[11.5px] font-bold leading-relaxed text-jade-400">
                incoming DID → {prettyPhone(cfg.vonage.did) || "…"} → ext #{cfg.vonage.extension || "…"} → {city || "branch"}
              </div>
            </div>
            {/* registered numbers */}
            {!isNew && (
              <div className="rounded-xl border border-ink-700 bg-ink-850 p-3.5">
                <div className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.14em] text-ink-500">Registered numbers</div>
                <div className="space-y-1.5">
                  {studioNumbers.map(n => (
                    <div key={n.id} className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-875 px-2.5 py-1.5">
                      <Pill color={NUMBER_KIND_META[n.kind].color} dot={false} className="!text-[9px]">{NUMBER_KIND_META[n.kind].label}</Pill>
                      <span className="min-w-0 flex-1 truncate text-[11.5px] font-bold text-ink-200">{n.label}</span>
                      <span className="num text-[11.5px] text-ink-400">{prettyPhone(n.number)}</span>
                      <button onClick={() => { removeNumber(n.id); toast(t("Delete"), "info"); }} aria-label={t("Delete")} className="text-ink-500 hover:text-ember-400"><I name="x" size={11} /></button>
                    </div>
                  ))}
                </div>
                <div className="mt-2.5 grid grid-cols-[130px_1fr_auto] gap-1.5">
                  <SearchableSelect
                    value={numKind}
                    onChange={v => setNumKind(v as "vonage" | "twilio" | "branch")}
                    options={[
                      { value: "twilio", label: "Twilio", badgeColor: "#2f6fe4" },
                      { value: "vonage", label: "Vonage", badgeColor: "#1e9e5c" },
                      { value: "branch", label: "Branch", badgeColor: "#fba200" },
                    ]}
                  />
                  <input value={numVal} onChange={e => setNumVal(e.target.value)} placeholder="+1 555 000 0000"
                    autoComplete="off" autoCorrect="off" spellCheck={false} className={`${inputCls} num !py-1.5 !text-[11.5px]`} />
                  <Btn size="sm" variant="gold" onClick={() => {
                    if (!guard("studios.edit") || !numVal.trim() || !studio) return;
                    saveNumber({ id: 0, studioId: studio.id, kind: numKind, label: numLabel || NUMBER_KIND_META[numKind].label, number: numVal.trim(), smsCapable: numKind !== "branch" });
                    setNumVal(""); toast(t("Add"), "success");
                  }}><I name="plus" size={12} /></Btn>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Mail */}
        <Card title="Mail & SMTP Settings" color="#7c4fe0" icon={<I name="mail" size={15} />}>
          <div className="space-y-3.5">
            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-850 px-3.5 py-3 text-[12.5px] font-extrabold text-ink-200">
              <input type="checkbox" checked={cfg.mail.enabled} onChange={e => setMail("enabled", e.target.checked)} className="h-4 w-4 accent-[#fba200]" />
              {t("Enable MAIL Automation")}
            </label>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Field label={t("Sender Name")}>
                <input value={cfg.mail.senderName} onChange={e => setMail("senderName", e.target.value)} placeholder="Cleopatra Ink Atlanta"
                  autoComplete="off" autoCorrect="off" spellCheck={false} className={inputCls} />
              </Field>
              <Field label={t("Sender Email Address")}>
                <input value={cfg.mail.senderEmail} onChange={e => setMail("senderEmail", e.target.value)} placeholder="atlanta@cleopatraink.com"
                  autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} className={inputCls} />
              </Field>
              <Field label={t("SMTP Host")}>
                <input value={cfg.mail.smtpHost} onChange={e => setMail("smtpHost", e.target.value)} placeholder="smtp.gmail.com"
                  autoComplete="off" autoCorrect="off" spellCheck={false} className={`${inputCls} num`} />
              </Field>
              <Field label={t("SMTP Port")}>
                <input type="number" value={cfg.mail.smtpPort} onChange={e => setMail("smtpPort", Number(e.target.value))}
                  autoComplete="off" autoCorrect="off" spellCheck={false} className={`${inputCls} num`} />
              </Field>
              <Field label={t("SMTP Username")}>
                <input value={cfg.mail.smtpUser} onChange={e => setMail("smtpUser", e.target.value)} placeholder="atlanta@cleopatraink.com"
                  autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} className={inputCls} />
              </Field>
              <Field label={t("SMTP Password (App Password)")}>
                <input type="password" value={cfg.mail.smtpPass} onChange={e => setMail("smtpPass", e.target.value)} placeholder="••••••••"
                  autoComplete="new-password" className={`${inputCls} num`} />
              </Field>
            </div>
            <div className="flex items-center gap-2.5">
              <Btn variant="outline" onClick={testSmtp} disabled={smtpState === "testing"}>
                {smtpState === "testing" ? <I name="refresh" size={13} className="animate-spin" /> : <I name="bolt" size={13} />}
                {smtpState === "testing" ? t("Testing…") : t("Test SMTP Connection")}
              </Btn>
              {smtpState === "ok" && <Pill color="#2fbf71">{t("Connection OK")}</Pill>}
              {smtpState === "fail" && <Pill color="#e5484d">{t("Connection failed")}</Pill>}
            </div>
          </div>
        </Card>

        {/* Business hours */}
        <Card title={`Business Hours (${cfg.ianaTimezone})`} color="#12a5b8" icon={<I name="clock" size={15} />}>
          <div className="space-y-2">
            {DAYS.map(d => {
              const day = cfg.businessHours[d];
              return (
                <div key={d} className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${day.enabled ? "border-ink-700 bg-ink-850" : "border-ink-700 bg-ink-900/50 opacity-60"}`}>
                  <input type="checkbox" checked={day.enabled} onChange={e => setDay(d, { enabled: e.target.checked })} className="h-4 w-4 accent-[#fba200]" aria-label={t(DAY_LABELS[d])} />
                  <span className="w-24 text-[12.5px] font-extrabold text-ink-200">{t(DAY_LABELS[d])}</span>
                  {day.enabled ? (
                    <div className="num flex flex-1 items-center justify-end gap-2">
                      <input type="time" value={day.open} onChange={e => setDay(d, { open: e.target.value })} className="rounded-lg border border-ink-600 bg-ink-900/70 px-2 py-1.5 text-[12px] font-bold text-ink-100 outline-none focus:border-gold-500/70" />
                      <span className="text-ink-500">→</span>
                      <input type="time" value={day.close} onChange={e => setDay(d, { close: e.target.value })} className="rounded-lg border border-ink-600 bg-ink-900/70 px-2 py-1.5 text-[12px] font-bold text-ink-100 outline-none focus:border-gold-500/70" />
                    </div>
                  ) : (
                    <span className="flex-1 text-right text-[12px] font-bold text-ink-500">{t("Closed")}</span>
                  )}
                </div>
              );
            })}
            <p className="num pt-1 text-[10.5px] font-semibold text-ink-500">{tzName} · {cfg.ianaTimezone}</p>
          </div>
        </Card>
      </div>

      <div className="sticky bottom-4 flex justify-end">
        <Btn variant="gold" onClick={save} locked={!dirty && !isNew} className="!px-6 !py-3 !text-[14px] shadow-pop">
          <I name="check" size={16} /> {t("Save All Changes")}
        </Btn>
      </div>
    </div>
  );
}
