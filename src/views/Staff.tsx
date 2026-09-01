import { useStore } from "../store";
import { Avatar, I, LiveClock, Pill, SectionTitle, Toggle } from "../components/ui";
import { prettyPhone, studioById } from "../data/crm";

export default function Staff() {
  const { artists, extensions, toggleArtist, toast } = useStore();

  return (
    <div className="space-y-6 animate-rise">
      {/* artists */}
      <div>
        <SectionTitle right={<Pill color="#d4af37" dot={false}><span className="num">{artists.filter(a => a.active).length}</span>&nbsp;active</Pill>}>
          Resident Artists
        </SectionTitle>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {artists.map(a => (
            <div key={a.id} className={`group rounded-2xl border bg-ink-875 p-5 shadow-panel transition-all duration-200 hover:-translate-y-0.5 ${a.active ? "border-ink-700 hover:border-gold-500/45" : "border-ink-700 opacity-70"}`}>
              <div className="flex items-start gap-3.5">
                <div className="relative">
                  <Avatar name={a.name} size={50} />
                  <span className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-ink-875 ${a.active ? "bg-jade-400" : "bg-ink-500"}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-extrabold text-ink-50">{a.name}</div>
                  <button
                    onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(`https://instagram.com/${a.instagram}`).catch(() => undefined); toast(`@${a.instagram} link copied`, "info"); }}
                    className="num mt-0.5 flex items-center gap-1 text-[11.5px] font-bold text-lapis-400 transition-colors hover:text-lapis-500/80">
                    @{a.instagram} <I name="copy" size={10} />
                  </button>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {a.specialties.map(sp => <Pill key={sp} color="#b18aff" dot={false}>{sp}</Pill>)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Toggle on={a.active} onChange={() => {
                    toggleArtist(a.id);
                    toast(`${a.name} ${a.active ? "paused — hidden from booking form" : "reopened for bookings"}`, a.active ? "info" : "success");
                  }} />
                </div>
              </div>
              <p className="mt-3 text-[12.5px] font-medium leading-relaxed text-ink-300">{a.bio}</p>
              <div className="mt-3.5 flex flex-wrap items-center gap-1.5 border-t border-ink-750 pt-3">
                <I name="pin" size={12} className="text-gold-400" />
                {a.locationIds.map(id => (
                  <Pill key={id} color="#63637a" dot={false}>{studioById(id)?.slug ?? `#${id}`}</Pill>
                ))}
                <span className={`ml-auto flex items-center gap-1.5 text-[10.5px] font-bold ${a.active ? "text-jade-400" : "text-ink-500"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${a.active ? "bg-jade-400" : "bg-ink-500"}`} />
                  {a.active ? "Taking bookings" : "On break"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* phone directory */}
      <div>
        <SectionTitle right={<Pill color="#4c8dff" dot={false}>Vonage VBC directory</Pill>}>Extensions & Agents</SectionTitle>
        <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-700 bg-ink-850">
                  {["Ext", "Line", "Username", "Number", "Scope", "Local time"].map(h => (
                    <th key={h} className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-750">
                {extensions.map(e => {
                  const st = e.locationId ? studioById(e.locationId) : undefined;
                  return (
                    <tr key={e.id} className="row-live">
                      <td className="px-4 py-3">
                        <span className="num grid h-9 w-12 place-items-center rounded-lg border border-gold-500/35 bg-gold-500/10 text-[13px] font-bold text-gold-300">#{e.extension}</span>
                      </td>
                      <td className="px-4 py-3 text-[13px] font-extrabold text-ink-100">{e.displayName.replace("Cleopatra Ink ", "")}</td>
                      <td className="num px-4 py-3 text-[12px] font-semibold text-ink-300">{e.username}</td>
                      <td className="num px-4 py-3 text-[12px] font-semibold text-ink-200">{prettyPhone(e.phoneNumber)}</td>
                      <td className="px-4 py-3">
                        {st
                          ? <Pill color="#63637a" dot={false}>{st.city}</Pill>
                          : <Pill color="#4c8dff">Call Center</Pill>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="num text-[12.5px] font-bold text-jade-400">
                          <LiveClock tz={st?.timezone ?? "America/New_York"} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
