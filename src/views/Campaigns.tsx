import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { Avatar, Btn, Drawer, Field, I, Pill, SectionTitle, inputCls } from "../ui";
import { CALL_STATUS_META, PLATFORM_META, TEMPLATES, fmtDT, studioById, timeAgo, type CallStatus, type Campaign, type Platform } from "../data";
import { t, tf, useI18n } from "../i18n";

const STATUS_META: Record<Campaign["status"], { label: string; color: string }> = {
  draft: { label: "Draft", color: "#948d7d" },
  scheduled: { label: "Scheduled", color: "#4c8dff" },
  sending: { label: "Sending", color: "#e8a33d" },
  sent: { label: "Sent", color: "#2fbf71" },
};

function matchSegment(leads: ReturnType<typeof useStore>["leads"], seg: Campaign["segment"]) {
  return leads.filter(l =>
    !l.unsubscribedAt && l.formattedPhone &&
    (seg.locationId === "all" || l.locationId === seg.locationId) &&
    (seg.status === "all" || l.callStatus === seg.status) &&
    (seg.platform === "all" || l.attr.platform === seg.platform));
}

function CampaignComposer({ initial, onClose }: { initial: Campaign | null; onClose: () => void }) {
  const { leads, studios, createCampaign, sendCampaign, toast, guard, can } = useStore();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initial?.name ?? "");
  const [seg, setSeg] = useState<Campaign["segment"]>(initial?.segment ?? { locationId: "all", status: "all", platform: "all" });
  const [body, setBody] = useState(initial?.body ?? TEMPLATES[0].body);
  const [mode, setMode] = useState<"now" | "later">("now");
  const [when, setWhen] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 16));

  const audience = useMemo(() => matchSegment(leads, seg), [leads, seg]);
  const sample = audience.slice(0, 5);

  const STEPS = [t("Audience"), t("Message"), t("Schedule"), t("Review & Send")];
  const segs = Math.max(1, Math.ceil(body.length / 160));

  const launch = (asSchedule: boolean) => {
    if (!guard("sms.campaign")) return;
    const id = createCampaign({
      name: name.trim(), segment: seg, body, total: audience.length,
      scheduledAt: asSchedule ? new Date(when).toISOString() : new Date().toISOString(),
      status: asSchedule ? "scheduled" : "sending",
    });
    if (!asSchedule) sendCampaign(id);
    toast(asSchedule
      ? tf("Campaign “{name}” scheduled for {date}", { name: name.trim(), date: fmtDT(new Date(when).toISOString()) })
      : tf("Campaign “{name}” queued via Twilio", { name: name.trim() }), "info");
    onClose();
  };

  return (
    <Drawer onClose={onClose} w={560}>
      <div className="flex items-start justify-between border-b border-ink-700 px-5 py-4">
        <div>
          <h3 className="font-display text-[17px] font-bold tracking-wide text-ink-50">{t("New Campaign")}</h3>
          <div className="mt-0.5 text-[12px] text-ink-400">Twilio Programmable SMS · A2P 10DLC</div>
        </div>
        <button onClick={onClose} aria-label={t("Close")} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100"><I name="x" size={17} /></button>
      </div>

      {/* stepper */}
      <div className="flex items-center gap-1 border-b border-ink-700 px-5 py-3">
        {STEPS.map((s, i) => (
          <button key={s} onClick={() => i < step && setStep(i)}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-extrabold transition-all ${i === step ? "bg-gold-500 text-ink-50" : i < step ? "text-gold-300" : "text-ink-500"}`}>
            <span className={`num grid h-4.5 w-4.5 place-items-center rounded-full border text-[9.5px] ${i === step ? "border-ink-50/40" : i < step ? "border-gold-500/50" : "border-ink-600"}`} style={{ width: 18, height: 18 }}>
              {i < step ? "✓" : i + 1}
            </span>
            {s}
            {i < STEPS.length - 1 && <span className="ml-1 h-px w-3 bg-ink-600" />}
          </button>
        ))}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {step === 0 && (
          <>
            <Field label={t("Campaign name")}>
              <input value={name} onChange={e => setName(e.target.value)} placeholder={t("Start typing a campaign name…")} className={inputCls} />
            </Field>
            <Field label={t("Branch")}>
              <select value={String(seg.locationId)} onChange={e => setSeg(s => ({ ...s, locationId: e.target.value === "all" ? "all" : Number(e.target.value) }))} className={inputCls}>
                <option value="all">{t("All Studios")}</option>
                {studios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label={t("Call Status")}>
              <select value={seg.status} onChange={e => setSeg(s => ({ ...s, status: e.target.value as Campaign["segment"]["status"] }))} className={inputCls}>
                <option value="all">{t("All")}</option>
                {(Object.keys(CALL_STATUS_META) as CallStatus[]).map(s => <option key={s} value={s}>{t(CALL_STATUS_META[s].label)}</option>)}
              </select>
            </Field>
            <Field label={t("Platform")}>
              <div className="flex flex-wrap gap-1.5">
                {(["all", ...(Object.keys(PLATFORM_META) as Platform[])] as ("all" | Platform)[]).map(p => (
                  <button key={p} onClick={() => setSeg(s => ({ ...s, platform: p }))}
                    className="rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition-all"
                    style={seg.platform === p
                      ? { color: "#fffdf7", background: p === "all" ? "#fba200" : PLATFORM_META[p as Platform].color, border: `1px solid ${p === "all" ? "#fba200" : PLATFORM_META[p as Platform].color}` }
                      : { color: "#57534a", border: "1px solid #c9c2b0" }}>
                    {p === "all" ? t("All") : t(PLATFORM_META[p as Platform].label)}
                  </button>
                ))}
              </div>
            </Field>
            <div className={`rounded-xl border p-4 transition-colors ${audience.length ? "border-jade-500/40 bg-jade-500/8" : "border-ember-500/40 bg-ember-500/8"}`}>
              <div className={`num text-[22px] font-extrabold ${audience.length ? "text-jade-400" : "text-ember-400"}`}>{audience.length}</div>
              <div className="text-[11.5px] font-bold text-ink-300">{audience.length ? tf("{n} recipients match this segment", { n: audience.length }) : t("No recipients match — widen the segment.")}</div>
              {sample.length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {sample.map(l => <Pill key={l.id} color="#948d7d" dot={false}>{l.name.split(" ")[0]} · {studioById(l.locationId)?.slug}</Pill>)}
                  {audience.length > sample.length && <span className="num text-[11px] font-bold text-ink-500">+{audience.length - sample.length}</span>}
                </div>
              )}
            </div>
            <p className="text-[11px] font-semibold text-ink-500">{t("Only opted-in leads with a phone number. Opt-outs are always excluded.")}</p>
          </>
        )}

        {step === 1 && (
          <>
            <Field label={t("Choose a template")}>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map(x => (
                  <button key={x.id} onClick={() => setBody(x.body)}
                    className={`rounded-xl border px-3 py-2.5 text-left transition-all ${body === x.body ? "border-gold-500/70 bg-gold-500/10" : "border-ink-600 bg-ink-900 hover:border-ink-500"}`}>
                    <span className={`block text-[12px] font-bold ${body === x.body ? "text-gold-300" : "text-ink-200"}`}>{x.name}</span>
                    <span className="mt-0.5 block truncate text-[10.5px] font-semibold text-ink-500">{x.body}</span>
                  </button>
                ))}
              </div>
            </Field>
            <Field label={t("Message preview — editable")}>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={5} className={`${inputCls} resize-none`} />
            </Field>
            <div className="flex items-center justify-between text-[11px] font-bold text-ink-500">
              <span>{tf("{n} chars · {s} SMS", { n: body.length, s: segs })}</span>
              <span className="num">{tf("{n} recipients match this segment", { n: audience.length })} × {segs} = <span className="text-gold-300">{audience.length * segs} SMS</span></span>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMode("now")} className={`rounded-xl border p-4 text-left transition-all ${mode === "now" ? "border-gold-500/70 bg-gold-500/10" : "border-ink-600 bg-ink-900 hover:border-ink-500"}`}>
                <I name="bolt" size={18} className={mode === "now" ? "text-gold-300" : "text-ink-500"} />
                <span className={`mt-1.5 block text-[13px] font-extrabold ${mode === "now" ? "text-gold-300" : "text-ink-200"}`}>{t("Send now")}</span>
              </button>
              <button onClick={() => setMode("later")} className={`rounded-xl border p-4 text-left transition-all ${mode === "later" ? "border-gold-500/70 bg-gold-500/10" : "border-ink-600 bg-ink-900 hover:border-ink-500"}`}>
                <I name="calendar" size={18} className={mode === "later" ? "text-gold-300" : "text-ink-500"} />
                <span className={`mt-1.5 block text-[13px] font-extrabold ${mode === "later" ? "text-gold-300" : "text-ink-200"}`}>{t("Schedule for later")}</span>
              </button>
            </div>
            {mode === "later" && (
              <Field label={t("Due date & time")}>
                <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} className={`${inputCls} num`} />
              </Field>
            )}
            <div className="rounded-xl border border-ink-700 bg-ink-850 p-4 text-[12px] font-semibold leading-relaxed text-ink-300">
              <span className="font-extrabold text-gold-300">{name || "—"}</span> → {audience.length} {t("Recipients").toLowerCase()} · {tf("{n} chars · {s} SMS", { n: body.length, s: segs })}
              {mode === "later" && <> · {fmtDT(new Date(when).toISOString())}</>}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="space-y-2.5">
              {[[t("Campaign name"), name || "—"], [t("Recipients"), String(audience.length)], [t("Message"), body], [t("Schedule"), mode === "now" ? t("Send now") : fmtDT(new Date(when).toISOString())]].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-ink-700 bg-ink-850 px-4 py-3">
                  <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-ink-500">{k}</div>
                  <div className="mt-0.5 text-[12.5px] font-bold leading-relaxed text-ink-100">{v}</div>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-lapis-500/40 bg-lapis-500/8 p-4 text-[12px] font-semibold text-lapis-400">
              Twilio Messaging Service · {tf("{n} recipients match this segment", { n: audience.length * segs }).split(" ")[0]} {audience.length * segs} SMS segments
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-ink-700 p-4">
        <Btn variant="outline" onClick={() => (step === 0 ? onClose() : setStep(s => s - 1))}>
          <I name="chevL" size={13} /> {step === 0 ? t("Cancel") : t("Prev")}
        </Btn>
        {step < 3 ? (
          <Btn variant="gold" disabled={step === 0 && (!name.trim() || audience.length === 0)} onClick={() => setStep(s => s + 1)}>
            {t("Next")} <I name="chevR" size={13} />
          </Btn>
        ) : (
          <Btn variant="gold" locked={!can("sms.campaign")} onClick={() => launch(mode === "later")}>
            <I name="send" size={14} /> {mode === "now" ? t("Send via Twilio") : t("Schedule")}
          </Btn>
        )}
      </div>
    </Drawer>
  );
}

export default function Campaigns() {
  const { campaigns, leads, sendCampaign, navigate, toast, guard } = useStore();
  useI18n();
  const [composer, setComposer] = useState(false);

  /* toast when a sending campaign finishes */
  useEffect(() => {
    const sent = campaigns.filter(c => c.status === "sent" && c.delivered + c.failed === c.total && c.total > 0);
    if (!sent.length) return;
    const timer = setTimeout(() => {
      const c = sent[sent.length - 1];
      if (Date.now() - +new Date(c.scheduledAt) < 120_000) toast(tf("Campaign “{name}” finished · {d} delivered", { name: c.name, d: c.delivered }), "success");
    }, 600);
    return () => clearTimeout(timer);
  }, [campaigns, toast]);

  return (
    <div className="space-y-5 animate-rise">
      <SectionTitle right={
        <Btn variant="gold" onClick={() => setComposer(true)}><I name="plus" size={14} /> {t("New Campaign")}</Btn>
      }>{t("SMS Campaigns")}</SectionTitle>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {campaigns.map(c => {
          const meta = STATUS_META[c.status];
          const pctDone = c.total ? Math.round(((c.delivered + c.failed) / c.total) * 100) : 0;
          return (
            <div key={c.id} className={`rounded-2xl border bg-ink-875 p-5 shadow-panel transition-all duration-200 hover:-translate-y-0.5 ${c.status === "sending" ? "border-gold-500/50" : "border-ink-700 hover:border-gold-500/40"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-extrabold text-ink-50">{c.name}</div>
                  <div className="num mt-0.5 text-[11px] font-semibold text-ink-400">
                    {c.segment.locationId === "all" ? t("All Studios") : studioById(c.segment.locationId)?.name}
                    {c.segment.status !== "all" && <> · {t(CALL_STATUS_META[c.segment.status].label)}</>}
                    {c.segment.platform !== "all" && <> · {t(PLATFORM_META[c.segment.platform].label)}</>}
                  </div>
                </div>
                <Pill color={meta.color} className={c.status === "sending" ? "animate-blink" : ""}>{t(meta.label)}</Pill>
              </div>

              <p className="mt-3 line-clamp-2 rounded-xl border border-ink-700 bg-ink-850 px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-ink-300">{c.body}</p>

              {(c.status === "sending" || c.status === "sent") && c.total > 0 && (
                <div className="mt-3.5">
                  <div className="mb-1.5 flex items-center justify-between text-[10.5px] font-bold">
                    <span className="uppercase tracking-[0.14em] text-ink-500">{t("Delivery progress")}</span>
                    <span className="num text-ink-300">{pctDone}%</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-ink-750">
                    <div className={`h-full rounded-full transition-all duration-500 ${c.status === "sending" ? "animate-pulse" : ""}`}
                      style={{ width: `${pctDone}%`, background: "linear-gradient(90deg, #fba200, #2fbf71)" }} />
                  </div>
                  <div className="num mt-2 grid grid-cols-4 gap-2 text-center">
                    {[[t("Recipients"), c.total, "#57534a"], [t("Delivered"), c.delivered, "#1e9e5c"], [t("Failed"), c.failed, "#d93a40"], [t("Replied"), c.replied, "#4c8dff"]].map(([k, v, col]) => (
                      <div key={String(k)} className="rounded-lg border border-ink-700 bg-ink-850 px-2 py-2">
                        <div className="text-[15px] font-extrabold" style={{ color: String(col) }}>{v as number}</div>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-ink-500">{k}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4 flex items-center justify-between border-t border-ink-750 pt-3">
                <span className="num text-[11px] font-semibold text-ink-500">
                  {c.status === "scheduled" ? `⏱ ${fmtDT(c.scheduledAt)}` : `${t("Created")} ${timeAgo(c.createdAt)}`}
                </span>
                <div className="flex gap-1.5">
                  {c.status === "draft" && (
                    <Btn size="sm" variant="gold" locked={matchSegment(leads, c.segment).length === 0}
                      onClick={() => {
                        if (!guard("sms.campaign")) return;
                        const n = matchSegment(leads, c.segment).length;
                        if (c.total !== n) void 0;
                        sendCampaign(c.id);
                        toast(tf("Campaign “{name}” queued via Twilio", { name: c.name }), "info");
                      }}>
                      <I name="send" size={12} /> {t("Send via Twilio")}
                    </Btn>
                  )}
                  {c.status === "scheduled" && (
                    <Btn size="sm" variant="outline" onClick={() => { if (!guard("sms.campaign")) return; sendCampaign(c.id); toast(tf("Campaign “{name}” queued via Twilio", { name: c.name }), "info"); }}>
                      <I name="bolt" size={12} /> {t("Send now")}
                    </Btn>
                  )}
                  {c.status === "sent" && (
                    <Btn size="sm" variant="ghost" onClick={() => navigate({ view: "sms" })}><I name="chat" size={12} /> {t("SMS Messenger")}</Btn>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* new campaign tile */}
        <button onClick={() => setComposer(true)}
          className="grid min-h-[220px] place-items-center rounded-2xl border-2 border-dashed border-ink-600 text-ink-500 transition-all duration-200 hover:-translate-y-0.5 hover:border-gold-500/60 hover:text-gold-300">
          <span className="flex flex-col items-center gap-2">
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-ink-600 bg-ink-850"><I name="plus" size={20} /></span>
            <span className="text-[13.5px] font-extrabold">{t("New Campaign")}</span>
            <span className="text-[11.5px] font-semibold">{t("Audience")} → {t("Message")} → {t("Schedule")}</span>
          </span>
        </button>
      </div>

      {composer && <CampaignComposer initial={null} onClose={() => setComposer(false)} />}
      <span className="hidden"><Avatar name="x" size={1} /></span>
    </div>
  );
}
