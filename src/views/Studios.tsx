import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Btn, Field, I, LiveClock, Modal, ModalHead, Pill, SectionTitle, Toggle, inputCls } from "../components/ui";
import { NUMBER_KIND_META, initials, prettyPhone, type NumberKind, type Studio } from "../data/crm";

const EMPTY_STUDIO: Studio = {
  id: 0, name: "", slug: "", phone: "", email: "", address: "", city: "", state: "", country: "USA",
  gtmCountry: "US", timezone: "America/New_York", bookingActive: true, manager: "", hours: "Mon–Sat · 11:00–20:00",
};

function StudioMonogram({ s }: { s: Studio }) {
  return (
    <div className="relative h-28 overflow-hidden rounded-xl border border-ink-700 bg-gradient-to-br from-ink-750 to-ink-900">
      <div className="absolute inset-0 grid place-items-center">
        <span className="font-display text-[42px] font-extrabold tracking-[0.2em] text-gold-500/35">{initials(s.name.replace("Cleopatra Ink ", ""))}</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-3 py-2" style={{ background: "linear-gradient(transparent, rgba(8,8,12,0.92))" }}>
        <span className="flex items-center gap-1.5 text-[10.5px] font-bold text-ink-200"><I name="pin" size={11} className="text-gold-400" />{s.city}, {s.country}</span>
        <span className="num text-[10.5px] font-bold text-jade-400"><LiveClock tz={s.timezone} /></span>
      </div>
    </div>
  );
}

function NumberRows({ studioId }: { studioId: number }) {
  const { numbers, saveNumber, removeNumber, toast } = useStore();
  const [kind, setKind] = useState<NumberKind>("twilio");
  const [label, setLabel] = useState("");
  const [num, setNum] = useState("");
  const rows = numbers.filter(n => n.studioId === studioId);
  const add = () => {
    if (!num.trim()) { toast("Enter a phone number first", "error"); return; }
    saveNumber({ id: 0, studioId, kind, label: label.trim() || NUMBER_KIND_META[kind].label, number: num.trim(), smsCapable: kind !== "branch" });
    setLabel(""); setNum("");
    toast(`${NUMBER_KIND_META[kind].label} added`);
  };
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-400">Phone numbers · routing</span>
        <Pill color="#8b8ba0" dot={false} className="!text-[9.5px]"><span className="num">{rows.length}</span>&nbsp;registered</Pill>
      </div>
      <div className="space-y-2">
        {rows.map(n => (
          <div key={n.id} className="flex items-center gap-2.5 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2">
            <Pill color={NUMBER_KIND_META[n.kind].color} dot={false} className="!text-[9.5px]">{NUMBER_KIND_META[n.kind].label}</Pill>
            <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-ink-200">{n.label}</span>
            <span className="num text-[12px] font-semibold text-ink-300">{prettyPhone(n.number)}</span>
            {n.smsCapable && <span title="SMS capable"><I name="chat" size={12} className="text-ember-400" /></span>}
            <button onClick={() => { removeNumber(n.id); toast(`${NUMBER_KIND_META[n.kind].label} removed`, "info"); }}
              className="rounded-md p-1 text-ink-500 transition-colors hover:bg-ember-500/10 hover:text-ember-400" title="Remove number">
              <I name="x" size={12} />
            </button>
          </div>
        ))}
        {rows.length === 0 && <div className="rounded-lg border border-dashed border-ink-600 px-3 py-3 text-center text-[11.5px] font-semibold text-ink-500">No numbers yet — add the Twilio SMS sender and Vonage line below.</div>}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[150px_1fr_170px_auto]">
        <select value={kind} onChange={e => setKind(e.target.value as NumberKind)} className={inputCls}>
          {(Object.keys(NUMBER_KIND_META) as NumberKind[]).map(k => <option key={k} value={k}>{NUMBER_KIND_META[k].label}</option>)}
        </select>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (e.g. Booking SMS)" className={inputCls} />
        <input value={num} onChange={e => setNum(e.target.value)} placeholder="+1 555 000 0000" className={`${inputCls} num`} />
        <Btn variant="gold" onClick={add}><I name="plus" size={13} /> Add</Btn>
      </div>
    </div>
  );
}

function StudioFormModal({ initial, onClose }: { initial: Studio; onClose: () => void }) {
  const { saveStudio, toast, studios } = useStore();
  const [f, setF] = useState<Studio>({ ...initial });
  const [savedId, setSavedId] = useState(initial.id);
  const isNew = initial.id === 0;
  const set = <K extends keyof Studio>(k: K, v: Studio[K]) => setF(s => ({ ...s, [k]: v }));
  const valid = f.name.trim().length > 1 && f.city.trim().length > 0;

  const save = () => {
    const slug = f.slug.trim() || f.name.trim().toLowerCase().replace(/cleopatra ink/i, "").trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `studio-${studios.length + 1}`;
    const id = saveStudio({ ...f, name: f.name.trim(), slug });
    setSavedId(id);
    toast(isNew && savedId === 0 ? `${f.name.trim()} created — now add its numbers` : `${f.name.trim()} saved`);
    if (isNew && savedId === 0) setF(s => ({ ...s, id }));
    else onClose();
  };

  const F = ({ label, k, placeholder, className = "" }: { label: string; k: keyof Studio; placeholder?: string; className?: string }) => (
    <Field label={label}>
      <input value={String(f[k] ?? "")} onChange={e => set(k, e.target.value)} placeholder={placeholder} className={`${inputCls} ${className}`} />
    </Field>
  );

  return (
    <Modal onClose={onClose} w={760}>
      <ModalHead
        title={isNew ? "Add Studio" : `Edit — ${initial.name}`}
        sub={isNew ? "Register a new branch, then attach its Vonage line and Twilio sender." : <span className="num">#{initial.id} · slug “{initial.slug}” · created record stays linked to leads</span>}
        onClose={onClose}
      />
      <div className="space-y-4 px-5 py-5">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <F label="Studio name" k="name" placeholder="Cleopatra Ink Denver" />
          <F label="Slug (booking URL)" k="slug" placeholder="denver" />
          <F label="Branch manager" k="manager" placeholder="Full name" />
          <F label="Hours" k="hours" placeholder="Mon–Sat · 11:00–20:00" />
          <F label="Branch phone (landline)" k="phone" placeholder="+1 303 555 0100" className="num" />
          <F label="Email" k="email" placeholder="denver@cleopatra.ink" />
          <F label="Address" k="address" placeholder="Street & number" />
          <F label="City" k="city" placeholder="Denver" />
          <F label="State / Region" k="state" placeholder="CO" />
          <F label="Country" k="country" placeholder="USA" />
          <F label="Timezone (IANA)" k="timezone" placeholder="America/Denver" />
          <F label="GTM country code" k="gtmCountry" placeholder="US" />
          <F label="Vonage extension" k="vonageExt" placeholder="486" className="num" />
          <F label="Twilio SMS sender" k="twilioNumber" placeholder="+1 (833) 555-0142" className="num" />
        </div>

        <div className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-900 px-4 py-3">
          <div>
            <div className="text-[12.5px] font-extrabold text-ink-100">Online booking</div>
            <div className="mt-0.5 text-[11px] font-semibold text-ink-400">When off, the branch is hidden from the booking form and lead routing.</div>
          </div>
          <Toggle on={f.bookingActive} onChange={() => set("bookingActive", !f.bookingActive)} />
        </div>

        {savedId > 0
          ? <NumberRows studioId={savedId} />
          : <div className="flex items-center gap-2.5 rounded-xl border border-lapis-500/30 bg-lapis-500/8 px-4 py-3 text-[12px] font-bold text-lapis-400">
              <I name="phone" size={14} /> Save the studio first — number registration unlocks right after.
            </div>}

        <div className="flex items-center justify-end gap-2 border-t border-ink-700 pt-4">
          <Btn variant="outline" onClick={onClose}>Cancel</Btn>
          <Btn variant="gold" disabled={!valid} onClick={save}>
            <I name="check" size={14} /> {isNew && savedId === 0 ? "Create studio" : "Save changes"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

export default function Studios() {
  const { studios, leads, appointments, toggleBooking, toast } = useStore();
  const [q, setQ] = useState("");
  const [country, setCountry] = useState<"all" | string>("all");
  const [editing, setEditing] = useState<Studio | null>(null);

  const countries = useMemo(() => [...new Set(studios.map(s => s.country))], [studios]);
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return studios.filter(s =>
      (country === "all" || s.country === country) &&
      (!query || s.name.toLowerCase().includes(query) || s.city.toLowerCase().includes(query) || s.manager.toLowerCase().includes(query)));
  }, [studios, q, country]);

  const statsFor = (id: number) => ({
    leads: leads.filter(l => l.locationId === id).length,
    appts: appointments.filter(a => a.locationId === id).length,
  });

  return (
    <div className="space-y-5 animate-rise">
      <SectionTitle right={
        <div className="flex flex-wrap items-center gap-2">
          <select value={country} onChange={e => setCountry(e.target.value)} className="rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-[12.5px] font-semibold text-ink-100 outline-none focus:border-gold-500/70">
            <option value="all">All countries</option>
            {countries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <Btn variant="gold" onClick={() => setEditing({ ...EMPTY_STUDIO })}><I name="plus" size={14} /> Add Studio</Btn>
        </div>
      }>Studios & Branches</SectionTitle>

      <div className="relative max-w-sm">
        <I name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search studio, city or manager…" className={`${inputCls} pl-9`} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map(s => {
          const st = statsFor(s.id);
          return (
            <div key={s.id} className={`group flex flex-col gap-3.5 rounded-2xl border bg-ink-875 p-4 shadow-panel transition-all duration-200 hover:-translate-y-0.5 ${s.bookingActive ? "border-ink-700 hover:border-gold-500/45" : "border-ink-700 opacity-75"}`}>
              {s.image
                ? <div className="relative h-28 overflow-hidden rounded-xl border border-ink-700">
                    <img src={s.image} alt={s.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-3 py-2" style={{ background: "linear-gradient(transparent, rgba(8,8,12,0.92))" }}>
                      <span className="flex items-center gap-1.5 text-[10.5px] font-bold text-ink-100"><I name="pin" size={11} className="text-gold-400" />{s.city}, {s.country}</span>
                      <span className="num text-[10.5px] font-bold text-jade-400"><LiveClock tz={s.timezone} /></span>
                    </div>
                  </div>
                : <StudioMonogram s={s} />}

              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[14.5px] font-extrabold text-ink-50">{s.name}</div>
                    <div className="num mt-0.5 text-[11px] font-semibold text-ink-400">/{s.slug} · {s.hours}</div>
                  </div>
                  <Pill color={s.bookingActive ? "#2fbf71" : "#8b8ba0"}>{s.bookingActive ? "Booking live" : "Booking off"}</Pill>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11.5px] font-semibold text-ink-300">
                  <span className="flex items-center gap-1.5 truncate"><I name="leads" size={12} className="text-ink-500" />{s.manager}</span>
                  <span className="num flex items-center gap-1.5 truncate"><I name="phone" size={12} className="text-ink-500" />{prettyPhone(s.phone)}</span>
                  <span className="num flex items-center gap-1.5 text-gold-400"><I name="leads" size={12} />{st.leads} leads</span>
                  <span className="num flex items-center gap-1.5 text-jade-400"><I name="calendar" size={12} />{st.appts} bookings</span>
                </div>
                {(s.vonageExt || s.twilioNumber) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.vonageExt && <Pill color="#4c8dff" dot={false} className="!text-[9.5px]">Vonage ext #{s.vonageExt}</Pill>}
                    {s.twilioNumber && <Pill color="#e5484d" dot={false} className="!text-[9.5px]">Twilio {prettyPhone(s.twilioNumber)}</Pill>}
                  </div>
                )}
              </div>

              <div className="mt-auto flex items-center gap-2 border-t border-ink-750 pt-3">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-ink-500">Online booking</span>
                <Toggle on={s.bookingActive} onChange={() => {
                  toggleBooking(s.id);
                  toast(`${s.name} booking ${s.bookingActive ? "paused" : "reopened"}`, s.bookingActive ? "info" : "success");
                }} />
                <Btn size="sm" variant="outline" className="ml-auto" onClick={() => setEditing(s)}>
                  <I name="gear" size={13} /> Edit
                </Btn>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-ink-600 p-10 text-center text-[13px] font-semibold text-ink-400">
          No studios match — clear the search or country filter.
        </div>
      )}

      {editing && <StudioFormModal initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
