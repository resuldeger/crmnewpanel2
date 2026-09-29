import { Fragment, useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { Avatar, Btn, Drawer, Field, I, LiveClock, Pill, SectionTitle, Toggle, inputCls } from "../ui";
import { PERMISSIONS, ROLES, prettyPhone, studioById, timeAgo, type Artist, type StaffMember } from "../data";
import { t, tf, useI18n } from "../i18n";
import { crmApi } from "../services/crmApi";

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
        <span className="flex items-center gap-2"><I name="globe" size={13} /> {t("All studios — HQ scope")}</span>
        {all && <I name="check" size={13} className="text-gold-400" />}
      </button>
      {!all && (
        <div className="flex flex-wrap gap-1.5">
          {studios.map(s => {
            const on = sel.includes(s.id);
            return (
              <button key={s.id} onClick={() => onChange(on ? sel.filter(x => x !== s.id) : [...sel, s.id])}
                className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-bold transition-all"
                style={on ? { color: "#fffdf7", background: "#fba200", border: "1px solid #fba200" } : { color: "#77715f", background: "transparent", border: "1px solid #c9c2b0" }}>
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
  const { deleteStaff, refreshData, toast, guard } = useStore();
  const [f, setF] = useState<StaffMember>({ ...initial });
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const isNew = initial.id === 0;

  const save = async () => {
    if (!guard("staff.manage")) return;
    if (f.name.trim().length < 2) { toast(t("Member name is required"), "error"); return; }
    if (!f.email.trim()) { toast(t("Member email is required"), "error"); return; }
    if (isNew && password.trim().length < 6) {
      toast(t("Password must be at least 6 characters"), "error");
      return;
    }
    if (!isNew && password.trim() && password.trim().length < 6) {
      toast(t("Password must be at least 6 characters"), "error");
      return;
    }

    setBusy(true);
    try {
      if (isNew) {
        await crmApi.createStaff({
          name: f.name.trim(),
          email: f.email.trim(),
          role_id: f.roleId,
          password: password.trim() || undefined,
          scope_all: f.locationIds === "all",
          location_ids: f.locationIds === "all" ? [] : f.locationIds,
        });
        toast(tf("{name} added as {role}", { name: f.name.trim(), role: t(roleOf(f.roleId).name) }), "success");
      } else {
        await crmApi.saveStaff({
          id: f.id,
          name: f.name.trim(),
          email: f.email.trim(),
          role_id: f.roleId,
          password: password.trim() || undefined,
          active: f.active,
          scope_all: f.locationIds === "all",
          location_ids: f.locationIds === "all" ? [] : f.locationIds,
        });
        toast(tf("{name} updated", { name: f.name.trim() }), "success");
      }
      void refreshData();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : t("Could not save"), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!guard("staff.manage")) return;
    if (!confirm(tf("Are you sure you want to delete {name}?", { name: f.name }))) return;
    setBusy(true);
    try {
      await deleteStaff(f.id);
      toast(tf("{name} deleted", { name: f.name }), "info");
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : t("Could not delete"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer onClose={onClose} w={480}>
      <div className="flex items-start justify-between border-b border-ink-700 px-5 py-4">
        <div>
          <h3 className="font-display text-[17px] font-bold tracking-wide text-ink-50">{isNew ? t("Add Team Member") : t("Edit Member")}</h3>
          <div className="mt-0.5 text-[12px] text-ink-400">{t("Role defines the permission set — fine-tune it under Roles & Permissions.")}</div>
        </div>
        <button onClick={onClose} aria-label={t("Close")} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100"><I name="x" size={17} /></button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <div className="flex items-center gap-3.5">
          <Avatar name={f.name || "New Member"} size={52} />
          <div className="flex-1 space-y-2.5">
            <Field label={t("Name")}>
              <input value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} placeholder="Jordan Blake"
                autoComplete="off" autoCorrect="off" spellCheck={false}
                className={inputCls} />
            </Field>
            <Field label={t("Email")}>
              <input value={f.email} onChange={e => setF(s => ({ ...s, email: e.target.value }))} placeholder="jordan@cleopatraink.com"
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                className={inputCls} />
            </Field>
          </div>
        </div>

        <Field label={t("Password")} hint={isNew ? t("Min 6 characters. Used to sign in to CRM console.") : t("Leave blank to keep current password unchanged.")}>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={isNew ? t("Password (min 6 characters)") : "••••••••"}
              autoComplete="new-password"
              className={`${inputCls} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(s => !s)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-200"
              title={showPassword ? t("Hide password") : t("Show password")}
            >
              <I name={showPassword ? "eyeOff" : "eye"} size={14} />
            </button>
          </div>
        </Field>

        <Field label={t("Role")}>
          <div className="grid grid-cols-2 gap-2">
            {ROLES.map(r => (
              <button key={r.id} onClick={() => setF(s => ({ ...s, roleId: r.id }))}
                className="rounded-xl border px-3 py-2.5 text-left transition-all duration-150"
                style={f.roleId === r.id
                  ? { borderColor: r.color, background: `${r.color}14`, boxShadow: `0 0 0 1.5px ${r.color}` }
                  : { borderColor: "#c9c2b0", background: "#f6f3ec" }}>
                <span className="flex items-center gap-1.5 text-[12px] font-extrabold" style={{ color: r.color }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.color }} />{r.name}
                  {r.system && <span className="rounded bg-ink-750 px-1 text-[8.5px] font-bold text-ink-400"><I name="lock" size={8} /></span>}
                </span>
                <span className="mt-0.5 block text-[10px] font-semibold leading-snug text-ink-400">{r.desc}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field label={t("Panel scope — which branches this member manages")}>
          <ScopePicker value={f.locationIds} onChange={v => setF(s => ({ ...s, locationIds: v }))} />
        </Field>
        <div className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-colors ${f.active ? "border-jade-500/40 bg-jade-500/6" : "border-ember-500/40 bg-ember-500/6"}`}>
          <div>
            <div className="flex items-center gap-2 text-[12.5px] font-extrabold text-ink-100">
              {t("Account status")}
              <Pill color={f.active ? "#2fbf71" : "#e5484d"} dot={false} className="!text-[9.5px]">{f.active ? t("Active") : t("Inactive")}</Pill>
            </div>
            <div className="mt-0.5 text-[11px] font-semibold text-ink-400">
              {f.active ? t("Console access is open.") : t("Console access is cut — history is kept.")}
            </div>
          </div>
          <Toggle on={f.active} onChange={() => setF(s => ({ ...s, active: !s.active }))} />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-ink-700 p-4">
        {!isNew && initial.id !== 1 && (
          <Btn variant="outline" className="mr-auto !border-ember-500/40 !text-ember-400 hover:!bg-ember-500/10" disabled={busy} onClick={() => void handleDelete()}>
            <I name="trash" size={13} /> {t("Delete Member")}
          </Btn>
        )}
        <Btn variant="outline" disabled={busy} onClick={onClose}>{t("Cancel")}</Btn>
        <Btn variant="gold" disabled={busy} onClick={() => void save()}>
          <I name="check" size={14} /> {busy ? t("Saving…") : isNew ? t("Add member") : t("Save")}
        </Btn>
      </div>
    </Drawer>
  );
}

function TeamTab() {
  const { staff, toggleStaffActive, toast, guard, can } = useStore();
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
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
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("Search member…")}
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            className={`${inputCls} pl-9`} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {ROLES.map(r => (
            <button key={r.id} onClick={() => setRoleFilter(roleFilter === r.id ? "all" : r.id)}
              className="rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition-all"
              style={roleFilter === r.id
                ? { color: "#fffdf7", background: r.color, border: `1px solid ${r.color}` }
                : { color: r.color, background: `${r.color}10`, border: `1px solid ${r.color}35` }}>
              {r.name}
            </button>
          ))}
        </div>
        <Btn variant="gold" locked={!can("staff.manage")} onClick={() => setEditing({ id: 0, name: "", email: "", roleId: "callcenter_agent", locationIds: "all", active: true, lastActiveAt: new Date().toISOString() })}>
          <I name="plus" size={14} /> {t("Add member")}
        </Btn>
      </div>

      <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-700 bg-ink-850">
                {[t("Member"), t("Role"), t("Panel scope"), t("Last active"), t("Status"), ""].map((h, i) => (
                  <th key={i} className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-750">
              {filtered.map(m => {
                const r = roleOf(m.roleId);
                return (
                  <tr key={m.id} className={`row-live transition-opacity ${m.active ? "" : "opacity-60"}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={m.name} size={36} />
                        <div>
                          <div className="flex items-center gap-1.5 text-[13px] font-extrabold text-ink-100">
                            {m.name}
                            {!m.active && <span title={t("Console access is cut — history is kept.")}><I name="lock" size={11} className="text-ember-400" /></span>}
                          </div>
                          <div className="num text-[11px] text-ink-500">{m.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><Pill color={r.color}>{r.name}</Pill></td>
                    <td className="px-4 py-3">
                      {m.locationIds === "all"
                        ? <Pill color="#fba200" dot={false}>{t("All Studios")}</Pill>
                        : <div className="flex flex-wrap gap-1">{m.locationIds.map(id => <Pill key={id} color="#948d7d" dot={false}>{studioById(id)?.city ?? `#${id}`}</Pill>)}</div>}
                    </td>
                    <td className="num px-4 py-3 text-[11.5px] font-semibold text-ink-400">{timeAgo(m.lastActiveAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Toggle on={m.active} onChange={() => {
                          if (!guard("staff.manage")) return;
                          toggleStaffActive(m.id);
                          toast(tf("{name} {action}", { name: m.name, action: m.active ? t("deactivated") : t("reactivated") }), m.active ? "info" : "success");
                        }} />
                        <span className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10.5px] font-extrabold transition-colors ${m.active ? "border-jade-500/40 bg-jade-500/10 text-jade-400" : "border-ember-500/40 bg-ember-500/10 text-ember-400"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${m.active ? "bg-jade-400" : "bg-ember-400"}`} />
                          {m.active ? t("Active") : t("Inactive")}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Btn size="sm" variant="outline" locked={!can("staff.manage")} onClick={() => setEditing(m)}><I name="gear" size={13} /> {t("Edit")}</Btn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && <div className="p-8 text-center text-[13px] font-semibold text-ink-400">{t("No members match this filter.")}</div>}
      </div>
      {editing && <MemberDrawer initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RolesTab() {
  const { staff, matrix, setMatrixGrant, toast, guard, can } = useStore();
  const groups = useMemo(() => {
    const g = new Map<string, typeof PERMISSIONS>();
    PERMISSIONS.forEach(p => { g.set(p.group, [...(g.get(p.group) ?? []), p]); });
    return [...g.entries()];
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {ROLES.map(r => {
          const n = staff.filter(m => m.roleId === r.id).length;
          const grants = (matrix[r.id] ?? []).length;
          return (
            <div key={r.id} className="rounded-2xl border border-ink-700 bg-ink-875 p-4 shadow-panel" style={{ boxShadow: `inset 0 2px 0 ${r.color}66` }}>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
                <span className="text-[12.5px] font-extrabold text-ink-50">{r.name}</span>
              </div>
              <div className="num mt-2 text-[20px] font-bold leading-none" style={{ color: r.color }}>{n}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-500">{t("Member").toLowerCase()}{n === 1 ? "" : "s"}</div>
              <div className="mt-2 text-[10.5px] font-semibold text-ink-400">{grants}/{PERMISSIONS.length} {t("Permissions").toLowerCase()}</div>
            </div>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 px-5 py-3.5">
          <h3 className="font-display text-[15px] font-bold tracking-wide text-ink-50">{t("Permission Matrix")}</h3>
          <Pill color="#948d7d" dot={false} className="!text-[9.5px]">{t("Super Admin column is locked by policy")}</Pill>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-700 bg-ink-850">
                <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Permission")}</th>
                {ROLES.map(r => (
                  <th key={r.id} className="px-3 py-3 text-center">
                    <span className="inline-flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-wide" style={{ color: r.color }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.color }} />{r.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(([group, perms]) => (
                <Fragment key={group}>
                  <tr className="border-b border-ink-750 bg-ink-850/70">
                    <td colSpan={ROLES.length + 1} className="px-4 py-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-gold-300">{group}</td>
                  </tr>
                  {perms.map(p => (
                    <tr key={p.id} className="row-live border-b border-ink-750">
                      <td className="px-4 py-2.5">
                        <div className="text-[12.5px] font-bold text-ink-200">{t(p.label)}</div>
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
                                if (!guard("staff.manage")) return;
                                setMatrixGrant(r.id, p.id, !on);
                                toast(tf("{role} · “{perm}” {action}", { role: t(r.name), perm: t(p.label), action: on ? t("revoked") : t("granted") }), on ? "info" : "success");
                              }}
                              title={locked ? t("Super Admin column is locked by policy") : undefined}
                              className={`grid h-7 w-7 place-items-center rounded-lg border transition-all duration-150 active:scale-90 ${locked
                                ? "cursor-not-allowed border-gold-500/50 bg-gold-500/15 text-gold-400"
                                : on
                                  ? "border-jade-500/50 bg-jade-500/15 text-jade-400 hover:bg-jade-500/25"
                                  : "border-ink-600 bg-ink-900/60 text-ink-500 hover:border-ink-500 hover:text-ink-300"}`}>
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
        {can("staff.manage") ? t("Switch role to see what the console looks like for that role.") : t("Permission required · {perm}".replace("{perm}", "staff.manage"))}
      </p>
    </div>
  );
}

export default function Staff() {
  const { artists, extensions, toggleArtist, toast, guard } = useStore();
  const [tab, setTab] = useState<Tab>("team");

  return (
    <div className="space-y-5 animate-rise">
      <SectionTitle right={
        <div className="flex items-center gap-1.5 rounded-xl border border-ink-600 bg-ink-875 p-1">
          {([["team", "Team & Roles"], ["artists", "Artists"], ["roles", "Permissions"]] as [Tab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded-lg px-3.5 py-1.5 text-[12.5px] font-bold transition-all ${tab === k ? "bg-gold-500 text-ink-50 shadow-[0_2px_12px_-4px_rgba(251,162,0,0.6)]" : "text-ink-300 hover:text-ink-100"}`}>
              {t(label)}
            </button>
          ))}
        </div>
      }>{t("Staff & Access Control")}</SectionTitle>

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
                    <button onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(`https://instagram.com/${a.instagram}`).catch(() => undefined); toast(`@${a.instagram}`, "info"); }}
                      className="num mt-0.5 flex items-center gap-1 text-[11.5px] font-bold text-lapis-400 transition-colors hover:text-lapis-500/80">
                      @{a.instagram} <I name="copy" size={10} />
                    </button>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {a.specialties.map(sp => <Pill key={sp} color="#7c4fe0" dot={false}>{t(sp)}</Pill>)}
                    </div>
                  </div>
                  <Toggle on={a.active} onChange={() => {
                    if (!guard("staff.manage")) return;
                    toggleArtist(a.id);
                    toast(tf("{name} {action}", { name: a.name, action: a.active ? t("paused") : t("reopened") }), a.active ? "info" : "success");
                  }} />
                </div>
                <p className="mt-3 text-[12.5px] font-medium leading-relaxed text-ink-300">{a.bio}</p>
                <div className="mt-3.5 flex flex-wrap items-center gap-1.5 border-t border-ink-750 pt-3">
                  <I name="pin" size={12} className="text-gold-400" />
                  {a.locationIds.map(lid => <Pill key={lid} color="#948d7d" dot={false}>{studioById(lid)?.slug ?? `#${lid}`}</Pill>)}
                  <span className={`ml-auto flex items-center gap-1.5 text-[10.5px] font-bold ${a.active ? "text-jade-400" : "text-ink-500"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${a.active ? "bg-jade-400" : "bg-ink-500"}`} />
                    {a.active ? t("Taking bookings") : t("On break")}
                  </span>
                </div>

                <TimelyFeed artist={a} />
              </div>
            ))}
          </div>

          <div>
            <SectionTitle right={<Pill color="#4c8dff" dot={false}>{t("Vonage VBC directory")}</Pill>}>{t("Extensions & Agents")}</SectionTitle>
            <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-ink-700 bg-ink-850">
                      {["Ext", t("Studio"), "Username", t("Phone"), t("Studio"), "Local time"].map((h, i) => (
                        <th key={i} className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-750">
                    {extensions.map(e => {
                      const st = e.locationId ? studioById(e.locationId) : undefined;
                      return (
                        <tr key={e.id} className="row-live">
                          <td className="px-4 py-3">
                            <span className="num grid h-9 w-12 place-items-center rounded-lg border border-gold-500/40 bg-gold-500/10 text-[13px] font-bold text-gold-300">#{e.extension}</span>
                          </td>
                          <td className="px-4 py-3 text-[13px] font-extrabold text-ink-100">{e.displayName.replace("Cleopatra Ink ", "")}</td>
                          <td className="num px-4 py-3 text-[12px] font-semibold text-ink-300">{e.username}</td>
                          <td className="num px-4 py-3 text-[12px] font-semibold text-ink-200">{prettyPhone(e.phoneNumber)}</td>
                          <td className="px-4 py-3">
                            {st ? <Pill color="#948d7d" dot={false}>{st.city}</Pill> : <Pill color="#4c8dff">Callcenter</Pill>}
                          </td>
                          <td className="px-4 py-3">
                            <span className="num text-[12.5px] font-bold text-jade-400">
                              <LiveClock tz={st?.config.ianaTimezone ?? "America/New_York"} />
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

/* ── An artist's Timely diary ──────────────────────────────────────────
 * Timely publishes each artist's calendar at a private URL with the token
 * in the path. That makes the URL a credential — it needs no login — so it
 * is never sent to the browser and never shown here. The card says only
 * whether a link is on file and whether it answered.
 *
 * Links die: regenerated in Timely, or the artist leaves. Thirty of ours
 * answer 404 on every sweep, which means thirty diaries we cannot see and
 * thirty studios showing every slot free. Pasting the replacement belongs
 * on this card rather than in a shell command, where it would end up in
 * somebody's history.
 * ────────────────────────────────────────────────────────────────── */
function TimelyFeed({ artist }: { artist: Artist }) {
  const { saveArtistFeed, can, toast } = useStore();
  const [editing, setEditing] = useState(false);
  /* Empty, never prefilled: the link does not come down from the server, so
     there is nothing to show. Saving replaces it; leaving it blank and
     pressing Remove clears it. */
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  /* Not held in the artist record: it is fetched on request so the page
     does not carry 125 diary links it has no use for. */
  const [revealed, setRevealed] = useState<string | null>(null);
  const [timelyStaffList, setTimelyStaffList] = useState<import("../services/crmApi").TimelyMappingStaff[]>([]);
  const [timelyStaffError, setTimelyStaffError] = useState<string | null>(null);
  const multiTimelyAccount = useMemo(
    () => new Set(timelyStaffList.map(s => s.accountId)).size > 1,
    [timelyStaffList],
  );
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  const broken = Boolean(artist.feedError);

  useEffect(() => {
    if (editing) {
      /* Kept, not swallowed. With the list empty the picker simply is not
         drawn, and a request that failed looks exactly like an account with
         no staff — so the one thing this form is for disappears with no
         explanation. */
      crmApi.getTimelyMappings().then((res) => {
        setTimelyStaffList(res.staff);
        setTimelyStaffError(null);
        const mapped = res.staff.find(s => s.artistId === artist.id);
        if (mapped) setSelectedStaffId(mapped.id);
      }).catch((err: unknown) => {
        setTimelyStaffError(err instanceof Error ? err.message : "Could not load Timely staff");
      });
    }
  }, [editing, artist.id]);

  const save = async () => {
    setBusy(true);
    const ok = await saveArtistFeed(artist.id, url.trim() || null);
    setBusy(false);
    if (ok) { setEditing(false); }
  };

  const handleMapStaff = async (staffIdVal: string) => {
    const staffId = staffIdVal === "" ? null : Number(staffIdVal);
    setSelectedStaffId(staffId);
    setBusy(true);
    try {
      if (staffId) {
        await crmApi.mapTimelyStaff(staffId, artist.id);
        toast(t("Mapped to Timely staff member"), "success");
      } else if (selectedStaffId) {
        await crmApi.mapTimelyStaff(selectedStaffId, null);
        toast(t("Timely staff mapping removed"), "info");
      }
      setEditing(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : t("Mapping failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2.5 border-t border-ink-750 pt-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-500">{t("Timely diary")}</span>
        {!artist.hasFeed ? (
          <Pill color="#948d7d" dot={false}>{t("no link")}</Pill>
        ) : broken ? (
          <Pill color="#e5484d">{artist.feedError}</Pill>
        ) : (
          <Pill color="#2fbf71" dot={false}>{t("reading")}</Pill>
        )}
        {can("studios.edit") && !editing && (
          <button onClick={() => { setUrl(""); setEditing(true); }}
            className="ml-auto text-[11px] font-bold text-lapis-400 hover:text-lapis-500/80">
            {artist.hasFeed ? t("Replace link") : t("Map / Add link")}
          </button>
        )}
      </div>

      {/* Only for a role that manages staff, and only when asked. The URL is
          a credential — it used to be broadcast to every signed-in browser. */}
      {artist.hasFeed && !editing && can("staff.manage") && (
        <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-ink-700/60 bg-ink-900/40 px-2 py-1 text-[11px] text-ink-400">
          <I name="calendar" size={12} className="shrink-0 text-gold-400" />
          {revealed ? (
            <>
              <span className="num min-w-0 flex-1 truncate font-mono text-[10.5px]" title={revealed}>{revealed}</span>
              <button type="button" title={t("Copy ICS link")}
                onClick={() => {
                  if (navigator.clipboard) navigator.clipboard.writeText(revealed).catch(() => undefined);
                  toast(t("ICS link copied to clipboard"), "info");
                }}
                className="rounded p-1 text-ink-400 hover:bg-ink-750 hover:text-ink-100">
                <I name="copy" size={11} />
              </button>
              <button type="button" onClick={() => setRevealed(null)}
                className="rounded p-1 text-ink-400 hover:bg-ink-750 hover:text-ink-100" title={t("Hide")}>
                <I name="eyeOff" size={11} />
              </button>
            </>
          ) : (
            <button type="button"
              onClick={() => {
                crmApi.revealArtistFeed(artist.id)
                  .then(setRevealed)
                  .catch((e: Error) => toast(e.message, "error"));
              }}
              className="flex items-center gap-1 font-bold text-lapis-400 hover:text-lapis-500/80">
              <I name="eye" size={11} /> {t("Show the diary link")}
            </button>
          )}
        </div>
      )}

      {broken && !editing && (
        <p className="mt-1.5 text-[11px] font-semibold leading-relaxed text-ink-500">
          {t("This diary is not being read, so every slot for it looks free. Get a fresh link from Timely and paste it here.")}
        </p>
      )}

      {editing && (
        <div className="mt-2 space-y-2">
          {timelyStaffError && (
            <p className="text-[11px] font-semibold text-ember-400">
              {tf("Could not load the Timely staff · {err}", { err: timelyStaffError })}
            </p>
          )}
          {timelyStaffList.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase text-ink-400">{t("Match with Timely Staff")}</span>
              <select
                value={selectedStaffId ? String(selectedStaffId) : ""}
                onChange={e => void handleMapStaff(e.target.value)}
                disabled={busy}
                className="num w-full rounded-lg border border-ink-600 bg-ink-900/70 px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-100 outline-none focus:border-gold-500/70"
              >
                <option value="">{t("Select Timely Staff member…")}</option>
                {timelyStaffList.map(s => (
                  <option key={s.id} value={String(s.id)}>
                    {/* The person first. The account came before the name and
                        was the same on every row, so a list of 126 read as one
                        repeated e-mail address. It is only worth naming when
                        there is more than one account to tell apart. */}
                    {s.name}
                    {s.artistId && s.artistId !== artist.id ? ` — ${t("already matched")}` : ""}
                    {s.calendarSyncEnabled === false ? ` — ${t("no calendar feed")}` : ""}
                    {multiTimelyAccount ? ` · ${s.accountLabel}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase text-ink-400">{t("Or paste direct Webhook / ICS URL")}</span>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://webhooks.gettimely.com/…"
              autoComplete="off"
              spellCheck={false}
              className="num w-full rounded-lg border border-ink-600 bg-ink-900/70 px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-100 outline-none focus:border-gold-500/70"
            />
          </div>

          <div className="flex items-center gap-2">
            <Btn size="sm" variant="gold" disabled={busy || !url.trim()} onClick={() => void save()}>
              {busy ? t("Saving…") : t("Save Direct URL")}
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => { setEditing(false); setUrl(""); }}>{t("Cancel")}</Btn>
            {artist.hasFeed && (
              <button onClick={() => { setUrl(""); void save(); }}
                className="ml-auto text-[11px] font-bold text-ink-500 hover:text-ember-400">
                {t("Remove Link")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

