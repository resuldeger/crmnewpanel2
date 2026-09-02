import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Avatar, EmptyState, I, LiveClock, Pill, Toggle, inputCls } from "../components/ui";
import { initials, prettyPhone, type Studio } from "../data/crm";

function StudioCard({ s, leadsN, apptsN }: { s: Studio; leadsN: number; apptsN: number }) {
  const { toggleBooking, toast } = useStore();
  const [imgErr, setImgErr] = useState(false);

  return (
    <div className={`group overflow-hidden rounded-2xl border bg-ink-875 shadow-panel transition-all duration-200 hover:-translate-y-1 ${s.bookingActive ? "border-ink-700 hover:border-gold-500/45" : "border-ember-500/25 hover:border-ember-500/50"}`}>
      {/* header art */}
      <div className="relative h-28 overflow-hidden">
        {s.image && !imgErr ? (
          <img src={s.image} alt={s.name} onError={() => setImgErr(true)}
            className={`h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 ${s.bookingActive ? "" : "opacity-40 grayscale"}`} />
        ) : (
          <div className="grid h-full w-full place-items-center bg-gradient-to-br from-ink-750 via-ink-850 to-ink-900">
            <span className="font-display text-[34px] font-bold tracking-[0.2em] text-gold-500/70">{initials(s.city)}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-875 via-ink-900/30 to-transparent" />
        <span className={`absolute right-3 top-3 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-wider backdrop-blur ${s.bookingActive ? "border-jade-500/40 bg-jade-500/15 text-jade-400" : "border-ember-500/40 bg-ember-500/15 text-ember-400"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${s.bookingActive ? "animate-pulse bg-jade-400" : "bg-ember-400"}`} />
          {s.bookingActive ? "Booking live" : "Paused"}
        </span>
        <div className="absolute bottom-2.5 left-4">
          <div className="font-display text-[15px] font-bold tracking-wide text-ink-50">{s.name.replace("Cleopatra Ink ", "")}</div>
          <div className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-gold-400">{s.city} · {s.country}</div>
        </div>
      </div>

      {/* body */}
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2.5">
          <Avatar name={s.manager} size={30} />
          <div className="leading-tight">
            <div className="text-[12px] font-extrabold text-ink-100">{s.manager}</div>
            <div className="text-[10.5px] font-semibold text-ink-400">Studio manager · {s.hours}</div>
          </div>
        </div>

        <div className="space-y-1.5 rounded-xl border border-ink-700 bg-ink-900 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-400"><I name="pin" size={12} className="text-gold-400" />{s.address}</span>
          </div>
          <button onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(s.phone).catch(() => undefined); toast(`${s.name} phone copied`, "info"); }}
            className="num flex w-full items-center justify-between gap-2 text-[12px] font-bold text-ink-200 transition-colors hover:text-gold-300">
            <span className="flex items-center gap-1.5"><I name="phone" size={12} className="text-gold-400" />{prettyPhone(s.phone)}</span>
            <I name="copy" size={11} className="text-ink-500" />
          </button>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-400"><I name="globe" size={12} className="text-gold-400" />{s.timezone}</span>
            <span className="num text-[12px] font-bold text-jade-400"><LiveClock tz={s.timezone} /></span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-center">
            <div className="num text-[17px] font-bold text-gold-300">{leadsN}</div>
            <div className="text-[9.5px] font-bold uppercase tracking-wider text-ink-400">Leads</div>
          </div>
          <div className="rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-center">
            <div className="num text-[17px] font-bold text-jade-400">{apptsN}</div>
            <div className="text-[9.5px] font-bold uppercase tracking-wider text-ink-400">Bookings</div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-ink-750 pt-3">
          <span className={`text-[11px] font-bold ${s.bookingActive ? "text-ink-300" : "text-ember-400"}`}>
            {s.bookingActive ? "Accepting online bookings" : "Online booking paused"}
          </span>
          <Toggle on={s.bookingActive} onChange={() => {
            toggleBooking(s.id);
            toast(`${s.name} — booking ${s.bookingActive ? "paused" : "reopened"}`, s.bookingActive ? "info" : "success");
          }} />
        </div>
      </div>
    </div>
  );
}

export default function Studios() {
  const { studios, leads, appointments } = useStore();
  const [q, setQ] = useState("");
  const [country, setCountry] = useState("all");
  const [onlyActive, setOnlyActive] = useState(false);

  const countries = useMemo(() => [...new Set(studios.map(s => s.country))].sort(), [studios]);
  const counts = useMemo(() => {
    const m = new Map<number, { l: number; a: number }>();
    leads.forEach(ld => m.set(ld.locationId, { l: (m.get(ld.locationId)?.l ?? 0) + 1, a: m.get(ld.locationId)?.a ?? 0 }));
    appointments.forEach(ap => {
      const cur = m.get(ap.locationId) ?? { l: 0, a: 0 };
      m.set(ap.locationId, { ...cur, a: cur.a + 1 });
    });
    return m;
  }, [leads, appointments]);

  const filtered = studios.filter(s => {
    const query = q.trim().toLowerCase();
    return (
      (country === "all" || s.country === country) &&
      (!onlyActive || s.bookingActive) &&
      (!query || s.name.toLowerCase().includes(query) || s.city.toLowerCase().includes(query) || s.manager.toLowerCase().includes(query))
    );
  });

  const activeN = studios.filter(s => s.bookingActive).length;

  return (
    <div className="space-y-4 animate-rise">
      <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-ink-700 bg-ink-875 p-4 shadow-panel">
        <div className="relative min-w-[220px] flex-1">
          <I name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search studio, city or manager…" className={`${inputCls} pl-9`} />
        </div>
        <select value={country} onChange={e => setCountry(e.target.value)}
          className="rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-[13px] font-semibold text-ink-100 outline-none focus:border-gold-500/70">
          <option value="all">All countries</option>
          {countries.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-ink-600 px-3 py-2 text-[12.5px] font-bold text-ink-300 transition-colors hover:border-gold-500/50 hover:text-gold-300">
          <input type="checkbox" checked={onlyActive} onChange={e => setOnlyActive(e.target.checked)} className="accent-[#d4af37]" />
          Booking live only
        </label>
        <Pill color="#2fbf71" dot={false}><span className="num">{activeN}</span>&nbsp;/ {studios.length} live</Pill>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="building" title="No studios match" hint="Clear the search or pick another country." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(s => {
            const c = counts.get(s.id) ?? { l: 0, a: 0 };
            return <StudioCard key={s.id} s={s} leadsN={c.l} apptsN={c.a} />;
          })}
        </div>
      )}
    </div>
  );
}
