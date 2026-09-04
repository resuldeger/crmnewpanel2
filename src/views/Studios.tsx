import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Btn, I, LiveClock, Pill, SectionTitle, Toggle, inputCls } from "../ui";
import { initials, prettyPhone, type Studio } from "../data";
import { t, tf, useI18n } from "../i18n";

function StudioMonogram({ s }: { s: Studio }) {
  return (
    <div className="relative h-28 overflow-hidden rounded-xl border border-ink-700 bg-gradient-to-br from-ink-800 to-ink-850">
      <div className="absolute inset-0 grid place-items-center">
        <span className="font-display text-[40px] font-extrabold tracking-[0.2em] text-gold-500/40">{initials(s.name.replace("Cleopatra Ink ", ""))}</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-3 py-2" style={{ background: "linear-gradient(transparent, rgba(246,243,236,0.95))" }}>
        <span className="flex items-center gap-1.5 text-[10.5px] font-bold text-ink-200"><I name="pin" size={11} className="text-gold-400" />{s.city}, {s.country}</span>
        <span className="num text-[10.5px] font-bold text-jade-400"><LiveClock tz={s.config.ianaTimezone} /></span>
      </div>
    </div>
  );
}

export default function Studios() {
  const { studios, leads, appointments, toggleBooking, toast, navigate, can, guard } = useStore();
  useI18n();
  const [q, setQ] = useState("");
  const [country, setCountry] = useState("all");

  const countries = useMemo(() => [...new Set(studios.map(s => s.country))], [studios]);
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return studios
      .filter(s => (country === "all" || s.country === country) &&
        (!query || s.name.toLowerCase().includes(query) || s.city.toLowerCase().includes(query) || s.manager.toLowerCase().includes(query)))
      .sort((a, b) => a.config.displayOrder - b.config.displayOrder);
  }, [studios, q, country]);

  const statsFor = (id: number) => ({
    leads: leads.filter(l => l.locationId === id).length,
    appts: appointments.filter(a => a.locationId === id).length,
  });

  return (
    <div className="space-y-5 animate-rise">
      <SectionTitle right={
        <div className="flex flex-wrap items-center gap-2">
          <select value={country} onChange={e => setCountry(e.target.value)} className="rounded-lg border border-ink-600 bg-ink-900/70 px-3 py-2 text-[12.5px] font-semibold text-ink-100 outline-none focus:border-gold-500/70">
            <option value="all">{t("All")}</option>
            {countries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <Btn variant="gold" onClick={() => navigate({ view: "studio" })} locked={!can("studios.edit")}><I name="plus" size={14} /> {t("Add Studio")}</Btn>
        </div>
      }>{t("Studios & Branches")}</SectionTitle>

      <div className="relative max-w-sm">
        <I name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("Search name, email, phone, ID…")} className={`${inputCls} pl-9`} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map(s => {
          const st = statsFor(s.id);
          return (
            <div key={s.id} className={`group flex flex-col gap-3.5 rounded-2xl border bg-ink-875 p-4 shadow-panel transition-all duration-200 hover:-translate-y-0.5 ${s.bookingActive ? "border-ink-700" : "border-ink-700 opacity-75"}`}
              style={{ boxShadow: `inset 0 2px 0 ${s.accent}59, var(--shadow-panel)` }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = `${s.accent}66`)}
              onMouseLeave={e => (e.currentTarget.style.borderColor = "")}>
              {s.image ? (
                <div className="relative h-32 overflow-hidden rounded-xl border border-ink-700">
                  <img src={s.image} alt={s.name} loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <div className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(160deg, ${s.accent}26, transparent 45%), linear-gradient(transparent 55%, rgba(12,10,7,0.82))` }} />
                  <span className="absolute right-2.5 top-2.5 h-2.5 w-2.5 rounded-full border border-white/40" style={{ background: s.accent }} title={t("Branch accent")} />
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-3 py-2">
                    <span className="flex items-center gap-1.5 text-[10.5px] font-bold text-[#fdf8ee]"><span style={{ color: s.accent }}><I name="pin" size={11} /></span>{s.city}, {s.country}</span>
                    <span className="num text-[10.5px] font-bold text-[#e9f5ec]"><LiveClock tz={s.config.ianaTimezone} /></span>
                  </div>
                </div>
              ) : <StudioMonogram s={s} />}
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[14.5px] font-extrabold text-ink-50">{s.name}</div>
                    <div className="num mt-0.5 text-[11px] font-semibold text-ink-400">/{s.config.bookingSlug}/book · {s.hours}</div>
                  </div>
                  <Pill color={s.bookingActive ? "#2fbf71" : "#948d7d"}>{s.bookingActive ? t("Booking live") : t("Booking off")}</Pill>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11.5px] font-semibold text-ink-300">
                  <span className="flex items-center gap-1.5 truncate"><I name="leads" size={12} className="text-ink-500" />{s.manager}</span>
                  <span className="num flex items-center gap-1.5 truncate"><I name="phone" size={12} className="text-ink-500" />{prettyPhone(s.config.publicPhone)}</span>
                  <span className="num flex items-center gap-1.5 text-gold-400"><I name="leads" size={12} />{st.leads} {t("leads").toLowerCase()}</span>
                  <span className="num flex items-center gap-1.5 text-jade-400"><I name="calendar" size={12} />{st.appts} {t("bookings").toLowerCase()}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Pill color="#2fbf71" dot={false} className="!text-[9.5px]">Vonage ext #{s.config.vonage.extension}</Pill>
                  <Pill color="#4c8dff" dot={false} className="!text-[9.5px]">Twilio {s.config.twilio.messagingSid.slice(0, 7)}…</Pill>
                </div>
              </div>
              <div className="mt-auto flex items-center gap-2 border-t border-ink-750 pt-3">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-ink-500">{t("Online booking")}</span>
                <Toggle on={s.bookingActive} onChange={() => {
                  if (!guard("studios.edit")) return;
                  toggleBooking(s.id);
                  toast(tf("{name} booking {action}", { name: s.name, action: s.bookingActive ? t("paused") : t("reopened") }), s.bookingActive ? "info" : "success");
                }} />
                <Btn size="sm" variant="outline" className="ml-auto" locked={!can("studios.edit")} onClick={() => navigate({ view: "studio", id: s.id })}>
                  <I name="gear" size={13} /> {t("Edit")}
                </Btn>
              </div>
            </div>
          );
        })}
      </div>
      {filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-ink-600 p-10 text-center text-[13px] font-semibold text-ink-400">
          {t("No leads match these filters")}
        </div>
      )}
    </div>
  );
}
