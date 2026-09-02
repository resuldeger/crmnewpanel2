import { Fragment, useMemo, useState } from "react";
import { useStore } from "../store";
import { Avatar, Btn, Drawer, Field, I, LiveClock, Pill, SectionTitle, Toggle, inputCls } from "../components/ui";
import { PERMISSIONS, ROLES, prettyPhone, studioById, timeAgo, type StaffMember } from "../data/crm";

type Tab = "team" | "artists" | "roles";
const roleOf = (roleId: string) => ROLES.find(r => r.id === roleId) ?? ROLES[ROLES.length - 1];

function ScopePicker({ value, onChange }: { value: number[] | "all"; onChange: (v: number[] | "all") => void }) {
  const { studios } = useStore();
  const all = value === "all";
  const sel = all ? [] : value;
  return (
    <div>
      <button onClick={() => onChange(all ? [] : "all")}
        className={`mb-2 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-[12.5px] font-bold transition-colors ${all ? "border-gold-500/60 bg-gold-500/10 text-gold-300" : "border-ink-600 text-ink-300 hover:text-ink-100"}`}>
        <span className="flex items-center gap-2"><I name="globe" size={13} /> All studios — HQ scope</span>
        {all && <I name="check" size={13} className="text-gold-400" />}
      </button>
      {!all && (
        <div className="flex flex-wrap gap-1.5">
          {studios.map(s => {
            const on = sel.includes(s.id);
            return (
              <button key={s.id} onClick={() => onChange(on ? sel.filter(x => x !== s.id) : [...sel, s.id])}
                className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-bold transition-all"
                style={on
                  ? { color: "#0a0a0e", background: "#d4af37", border: "1px solid #d4af37" }
                  : { color: "#8b8ba0", background: "transparent", border: "1px solid #2d2d3b" }}>
                {s.city}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MemberDrawer({ initial, onClose }: { initial: StaffMember; onClose: () => void }) {
  const { saveStaff, toast } = useStore();
  const [f, setF] = useState<StaffMember>({ ...initial });
  const isNew = initial.id === 0;
  const save = () => {
    if (f.name.trim().length < 2) { toast("Member name is required", "error"); return; }
    saveStaff({ ...f, name: f.name.trim(), email: f.email.trim() || `${f.name.trim().toLowerCase().replace(/[^a-z ]/g, "").replace(/ +/g, ".")}@cleopatra.ink` });
    toast(isNew ? `${f.name.trim()} added as ${roleOf(f.roleId).name}` : `${f.name.trim()} updated`);
    onClose();
  };
  return (
    <Drawer onClose={onClose} w={460}>
      <div className="flex items-start justify-between border-b border-ink-700 px-5 py-4">
        <div>
          <h3 className="font-display text-[17px] font-bold tracking-wide text-ink-50">{isNew ? "Add Team Member" : "Edit Member"}</h3>
          <div className="mt-0.5 text-[12px] text-ink-300">Role defines the permission set — fine-tune it under Roles & Permissions.</div>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-ink-300 hover:bg-ink-700 hover:text-ink-50"><I name="x" size={17} /></button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <div className="flex items-center gap-3.5">
          <Avatar name={f.name || "New Member"} size={52} />
          <div className="flex-1 space-y-2.5">
            <Field label="Full name">
              <input value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} placeholder="Jordan Blake" className={inputCls} />
            </Field>
            <Field label="Email">
              <input value={f.email} onChange={e => setF(s => ({ ...s, email: e.target.value }))} placeholder="jordan@cleopatra.ink" className={inputCls} />
            </Field>
          </div>
        </div>
        <Field label="Role">
          <div className="grid grid-cols-2 gap-2">
            {ROLES.map(r => (
              <button key={r.id} onClick={() => setF(s => ({ ...s, roleId: r.id }))}
                className={`rounded-xl border px-3 py-2.5 text-left transition-all duration-150 ${f.roleId === r.id ? "border-transparent shadow-[0_0_0_1.5px_var(--ring)]" : "border-ink-600 bg-ink-900 hover:border-ink-500"}`}
                style={{ ["--ring" as string]: r.color, background: f.roleId === r.id ? `${r.color}14` : undefined }}>
                <span className="flex items-center gap-1.5 text-[12px] font-extrabold" style={{ color: r.color }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.color }} />{r.name}
                  {r.system && <span className="rounded bg-ink-750 px-1 text-[8.5px] font-bold text-ink-400">LOCKED</span>}
                </span>
                <span className="mt-0.5 block text-[10px] font-semibold leading-snug text-ink-400">{r.desc}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Panel scope — which branches this member manages">
          <ScopePicker value={f.locationIds} onChange={v => setF(s => ({ ...s, locationIds: v }))} />
        </Field>
        <div className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-900 px-4 py-3">
          <div>
            <div className="text-[12.5px] font-extrabold text-ink-100">Active seat</div>
            <div className="mt-0.5 text-[11px] font-semibold text-ink-400">Deactivated members keep history but lose console access.</div>
          </div>
          <Toggle on={f.active} onChange={() => setF(s => ({ ...s, active: !s.active }))} />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-ink-700 p-4">
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn variant="gold" onClick={save}><I name="check" size={14} /> {isNew ? "Add member" : "Save changes"}</Btn>
      </div>
    </Drawer>
  );
}

function TeamTab() {
  const { staff, toggleStaffActive, toast } = useStore();
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [editing, setEditing] = useState<StaffMember | null>(null);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return staff.filter(m =>
      (roleFilter === "all" || m.roleId === roleFilter) &&
      (!query || m.name.toLowerCase().includes(query) || m.email.toLowerCase().includes(query)));
  }, [staff, q, roleFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[220px] flex-1">
          <I name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search member…" className={`${inputCls} pl-9`} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setRoleFilter("all")}
            className={`rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition-colors ${roleFilter === "all" ? "bg-gold-500 text-ink-950" : "border border-ink-600 text-ink-300 hover:text-ink-100"}`}>
            All roles
          </button>
          {ROLES.map(r => (
            <button key={r.id} onClick={() => setRoleFilter(roleFilter === r.id ? "all" : r.id)}
              className="rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition-all"
              style={roleFilter === r.id
                ? { color: "#0a0a0e", background: r.color, border: `1px solid ${r.color}` }
                : { color: r.color, background: `${r.color}10`, border: `1px solid ${r.color}35` }}>
              {r.name}
            </button>
          ))}
        </div>
        <Btn variant="gold" onClick={() => setEditing({ id: 0, name: "", email: "", roleId: "agent", locationIds: "all", active: true, lastActiveAt: new Date().toISOString() })}>
          <I name="plus" size={14} /> Add member
        </Btn>
      </div>

      <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-700 bg-ink-850">
                {["Member", "Role", "Panel scope", "Last active", "Seat", ""].map(h => (
                  <th key={h} className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-750">
              {filtered.map(m => {
                const r = roleOf(m.roleId);
                return (
                  <tr key={m.id} className="row-live">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={m.name} size={36} />
                        <div>
                          <div className="text-[13px] font-extrabold text-ink-100">{m.name}</div>
                          <div className="num text-[11px] text-ink-500">{m.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><Pill color={r.color}>{r.name}</Pill></td>
                    <td className="px-4 py-3">
                      {m.locationIds === "all"
                        ? <Pill color="#d4af37" dot={false}>All studios</Pill>
                        : <div className="flex flex-wrap gap-1">{m.locationIds.map(id => <Pill key={id} color="#63637a" dot={false}>{studioById(id)?.city ?? `#${id}`}</Pill>)}</div>}
                    </td>
                    <td className="num px-4 py-3 text-[11.5px] font-semibold text-ink-400">{timeAgo(m.lastActiveAt)}</td>
                    <td className="px-4 py-3">
                      <Toggle on={m.active} onChange={() => {
                        toggleStaffActive(m.id);
                        toast(`${m.name} ${m.active ? "deactivated" : "reactivated"}`, m.active ? "info" : "success");
                      }} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Btn size="sm" variant="outline" onClick={() => setEditing(m)}><I name="gear" size={13} /> Edit</Btn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && <div className="p-8 text-center text-[13px] font-semibold text-ink-400">No members match this filter.</div>}
      </div>
      {editing && <MemberDrawer initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RolesTab() {
  const { staff, matrix, setMatrixGrant, toast } = useStore();
  const groups = useMemo(() => {
    const g = new Map<string, typeof PERMISSIONS>();
    PERMISSIONS.forEach(p => { g.set(p.group, [...(g.get(p.group) ?? []), p]); });
    return [...g.entries()];
  }, []);
  const editable = ROLES.filter(r => !r.system);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {ROLES.map(r => {
          const n = staff.filter(m => m.roleId === r.id).length;
          const grants = (matrix[r.id] ?? []).length;
          return (
            <div key={r.id} className="rounded-2xl border border-ink-700 bg-ink-875 p-4 shadow-panel" style={{ boxShadow: `inset 0 2px 0 ${r.color}55` }}>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
                <span className="text-[12.5px] font-extrabold text-ink-50">{r.name}</span>
              </div>
              <div className="num mt-2 text-[20px] font-bold leading-none" style={{ color: r.color }}>{n}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-500">member{n === 1 ? "" : "s"}</div>
              <div className="mt-2 text-[10.5px] font-semibold text-ink-400">{grants}/{PERMISSIONS.length} permissions</div>
            </div>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 px-5 py-3.5">
          <h3 className="font-display text-[15px] font-bold tracking-wide text-ink-50">Permission Matrix</h3>
          <Pill color="#8b8ba0" dot={false} className="!text-[9.5px]">Super Admin column is locked by policy</Pill>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-700 bg-ink-850">
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">Permission</th>
                {ROLES.map(r => (
                  <th key={r.id} className="px-3 py-3 text-center">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide" style={{ color: r.color }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.color }} />{r.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(([group, perms]) => (
                <Fragment key={group}>
                  <tr className="border-b border-ink-750 bg-ink-850/60">
                    <td colSpan={ROLES.length + 1} className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-gold-500">{group}</td>
                  </tr>
                  {perms.map(p => (
                    <tr key={p.id} className="row-live border-b border-ink-750">
                      <td className="px-4 py-2.5">
                        <div className="text-[12.5px] font-bold text-ink-200">{p.label}</div>
                        <div className="num text-[10px] text-ink-500">{p.id}</div>
                      </td>
                      {ROLES.map(r => {
                        const on = (matrix[r.id] ?? []).includes(p.id);
                        const locked = r.system;
                        return (
                          <td key={r.id} className="px-3 py-2.5 text-center">
                            <button
                              disabled={locked}
                              onClick={() => {
                                setMatrixGrant(r.id, p.id, !on);
                                toast(`${r.name} · “${p.label}” ${on ? "revoked" : "granted"}`, on ? "info" : "success");
                              }}
                              title={locked ? "System role — always full access" : undefined}
                              className={`grid h-7 w-7 place-items-center rounded-lg border transition-all duration-150 active:scale-90 ${locked
                                ? "cursor-not-allowed border-gold-500/40 bg-gold-500/15 text-gold-400"
                                : on
                                  ? "border-jade-500/50 bg-jade-500/15 text-jade-400 hover:bg-jade-500/25"
                                  : "border-ink-600 bg-ink-900 text-ink-600 hover:border-ink-500 hover:text-ink-400"}`}>
                              <I name={locked ? "star" : on ? "check" : "x"} size={13} />
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] font-semibold text-ink-500">
        Changes apply to the console session immediately and sync to Supabase auth policies on the next deploy. {editable.length} editable roles · role provisioning API ships next sprint.
      </p>
    </div>
  );
}

export default function Staff() {
  const { artists, extensions, toggleArtist, toast } = useStore();
  const [tab, setTab] = useState<Tab>("team");

  return (
    <div className="space-y-5 animate-rise">
      <SectionTitle right={
        <div className="flex items-center gap-1.5 rounded-xl border border-ink-600 bg-ink-875 p-1">
          {([["team", "Team & Roles"], ["artists", "Artists"], ["roles", "Permissions"]] as [Tab, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-lg px-3.5 py-1.5 text-[12.5px] font-bold transition-all ${tab === t ? "bg-gold-500 text-ink-950 shadow-[0_2px_12px_-4px_rgba(212,175,55,0.6)]" : "text-ink-300 hover:text-ink-100"}`}>
              {label}
            </button>
          ))}
        </div>
      }>Staff & Access Control</SectionTitle>

      {tab === "team" && <TeamTab />}
      {tab === "roles" && <RolesTab />}

      {tab === "artists" && (
        <div className="space-y-6">
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
                  <Toggle on={a.active} onChange={() => {
                    toggleArtist(a.id);
                    toast(`${a.name} ${a.active ? "paused — hidden from booking form" : "reopened for bookings"}`, a.active ? "info" : "success");
                  }} />
                </div>
                <p className="mt-3 text-[12.5px] font-medium leading-relaxed text-ink-300">{a.bio}</p>
                <div className="mt-3.5 flex flex-wrap items-center gap-1.5 border-t border-ink-750 pt-3">
                  <I name="pin" size={12} className="text-gold-400" />
                  {a.locationIds.map(id => <Pill key={id} color="#63637a" dot={false}>{studioById(id)?.slug ?? `#${id}`}</Pill>)}
                  <span className={`ml-auto flex items-center gap-1.5 text-[10.5px] font-bold ${a.active ? "text-jade-400" : "text-ink-500"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${a.active ? "bg-jade-400" : "bg-ink-500"}`} />
                    {a.active ? "Taking bookings" : "On break"}
                  </span>
                </div>
              </div>
            ))}
          </div>

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
                            {st ? <Pill color="#63637a" dot={false}>{st.city}</Pill> : <Pill color="#4c8dff">Call Center</Pill>}
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
      )}
    </div>
  );
}
