import { useState } from "react";
import { useStore, groupDuplicates } from "../store";
import { Avatar, Btn, CallStatusPill, I, Pill, PlatformPill, SectionTitle } from "../ui";
import { prettyPhone, shortId, studioById, timeAgo, type Lead } from "../data";
import { t, tf, useI18n } from "../i18n";

type FieldKey = "name" | "email" | "formattedPhone" | "callStatus";
const FIELDS: { k: FieldKey; label: string }[] = [
  { k: "name", label: "Name" },
  { k: "email", label: "Email" },
  { k: "formattedPhone", label: "Phone" },
];

function MergeCard({ group }: { group: Lead[] }) {
  const { mergeLeads, toast, navigate, guard, can } = useStore();
  const best = group.reduce((a, b) => (+new Date(a.createdAt) < +new Date(b.createdAt) ? a : b));
  const [primaryId, setPrimaryId] = useState(best.id);
  const [sources, setSources] = useState<Record<FieldKey, string>>({
    name: best.id, email: best.id, formattedPhone: best.id, callStatus: best.id,
  });

  const others = group.filter(l => l.id !== primaryId);
  const primary = group.find(l => l.id === primaryId)!;

  const merge = () => {
    if (!guard("leads.merge")) return;
    const pick = (k: FieldKey) => group.find(l => l.id === sources[k])?.[k];
    const statusSrc = group.find(l => l.id === sources.callStatus);
    const take: Partial<Pick<Lead, FieldKey | "callStatus">> = {
      name: pick("name"), email: pick("email"), formattedPhone: pick("formattedPhone"),
      callStatus: statusSrc?.callStatus,
    };
    mergeLeads(primaryId, others.map(o => o.id), take);
    toast(tf("Merged {n} records into {id}", { n: group.length, id: primaryId }));
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-gold-500/35 bg-ink-875 shadow-panel">
      <div className="flex items-center justify-between border-b border-ink-700 bg-gold-500/6 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-gold-500/40 bg-gold-500/10 text-gold-400"><I name="merge" size={15} /></span>
          <span className="text-[13.5px] font-extrabold text-ink-100">{group.length} × {group[0].name.split(" ")[0]} · {prettyPhone(group[0].formattedPhone) || group[0].email}</span>
        </div>
        <Pill color="#e8a33d" dot={false}>{t("Grouped by phone / email / name+branch")}</Pill>
      </div>

      <div className="grid grid-cols-1 gap-0 divide-y divide-ink-750 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        {group.map(l => {
          const isPrimary = l.id === primaryId;
          return (
            <div key={l.id} className={`p-4 transition-colors ${isPrimary ? "bg-jade-500/5" : ""}`}>
              <label className="flex cursor-pointer items-center gap-3">
                <input type="radio" name={`primary-${group[0].id}`} checked={isPrimary} onChange={() => setPrimaryId(l.id)} className="h-4 w-4 accent-[#2fbf71]" />
                <Avatar name={l.name} size={36} ring={isPrimary} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] font-extrabold text-ink-100">
                    {l.name}
                    {isPrimary && <Pill color="#2fbf71" dot={false} className="!text-[9px]">{t("Primary record")}</Pill>}
                  </span>
                  <span className="num block text-[10.5px] font-semibold text-ink-500" title={l.id}>{shortId(l.id)} · {tf("created {ago}", { ago: timeAgo(l.createdAt) })}</span>
                </span>
              </label>
              <div className="mt-2.5 space-y-1 pl-7 text-[11.5px] font-semibold text-ink-400">
                <div className="flex items-center gap-1.5"><I name="mail" size={11} className="text-ink-500" />{l.email}</div>
                <div className="num flex items-center gap-1.5"><I name="phone" size={11} className="text-ink-500" />{prettyPhone(l.formattedPhone) || t("no phone")}</div>
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <PlatformPill p={l.attr.platform} />
                  <Pill color="#948d7d" dot={false}>{studioById(l.locationId)?.slug}</Pill>
                  <CallStatusPill s={l.callStatus} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* field source picker */}
      <div className="border-t border-ink-700 px-5 py-4">
        <div className="mb-2.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-ink-500">{t("Keep from")}</div>
        <div className="space-y-2">
          {[...FIELDS, { k: "callStatus" as FieldKey, label: "Call Status" }].map(f => (
            <div key={f.k} className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-[11.5px] font-bold text-ink-400">{t(f.label)}</span>
              <div className="flex flex-wrap gap-1.5">
                {group.map(l => {
                  const val = f.k === "callStatus" ? t((l.callStatus as string).replace(/_/g, " ")) : String(l[f.k] ?? "—");
                  const on = sources[f.k] === l.id;
                  return (
                    <button key={l.id} onClick={() => setSources(s => ({ ...s, [f.k]: l.id }))}
                      title={`${l.id} · ${l[f.k === "callStatus" ? "callStatus" : f.k]}`}
                      className="rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all"
                      style={on
                        ? { color: "#fffdf7", background: "#fba200", border: "1px solid #fba200" }
                        : { color: "#57534a", background: "transparent", border: "1px solid #c9c2b0" }}>
                      {val.slice(0, 24)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink-750 pt-3.5">
          <span className="text-[11px] font-semibold text-ink-500">{t("Merged activity stays on the primary record.")}</span>
          <div className="flex items-center gap-2">
            <Btn size="sm" variant="ghost" onClick={() => navigate({ view: "lead", id: primary.id })}><I name="eye" size={13} /> {primary.id}</Btn>
            <Btn variant="gold" locked={!can("leads.merge")} onClick={merge}>
              <I name="merge" size={14} /> {tf("Merge {n} records", { n: group.length })}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Duplicates() {
  const { leads, dupGroupCount, navigate } = useStore();
  useI18n();
  const groups = groupDuplicates(leads);

  return (
    <div className="space-y-5 animate-rise">
      <SectionTitle right={
        <div className="flex items-center gap-2">
          {dupGroupCount > 0 && <Pill color="#e8a33d">{tf("{n} duplicate groups need review", { n: dupGroupCount })}</Pill>}
          <Btn variant="outline" onClick={() => navigate({ view: "leads" })}><I name="chevL" size={13} /> {t("Leads Pipeline")}</Btn>
        </div>
      }>{t("Duplicate Merge")}</SectionTitle>

      {groups.length === 0 && (
        <div className="rounded-2xl border border-jade-500/40 bg-jade-500/6 p-10 text-center shadow-panel">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-jade-500/40 bg-jade-500/10 text-jade-400"><I name="check" size={20} /></span>
          <div className="mt-3 text-[15px] font-extrabold text-jade-400">{t("No duplicates found — clean list.")}</div>
        </div>
      )}

      <div className="space-y-4">
        {groups.map(g => <MergeCard key={g.map(x => x.id).join("-")} group={g} />)}
      </div>
    </div>
  );
}
