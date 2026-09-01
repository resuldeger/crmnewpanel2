import { useMemo, useState } from "react";
import { useStore } from "../store";
import {
  Avatar, ApptStatusPill, Btn, CallStatusPill, Dropdown, EmptyState, Field, I, Modal, Pill, PlatformPill, SectionTitle,
} from "../components/ui";
import { CALL_STATUS_META, STORY_TYPES, fmtD, fmtDT, fmtDur, prettyPhone, studioById, timeAgo, type CallStatus } from "../data/crm";
import { CallHistoryModal, NotesDrawer } from "./Leads";

const TAB_ORDER: CallStatus[] = ["not_called", "no_answer", "busy", "interested", "not_interested", "callback_requested", "appointment_made", "already_scheduled", "didnt_pick_up", "wrong_number", "double_lead", "no_pn", "spam", "not_trusted"];

type Act = { t: number; kind: "call" | "note" | "sms"; title: string; sub: string };

export default function LeadDetail({ id }: { id: string }) {
  const { leads, appointments, callsFor, notesFor, convFor, updateLeadStatus, convertLead, navigate, toast } = useStore();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const lead = leads.find(l => l.id === id);
  const callsList = useMemo(() => (lead ? callsFor(lead.id) : []), [lead, callsFor]);
  const notesList = useMemo(() => (lead ? notesFor("lead", lead.id) : []), [lead, notesFor]);
  const conv = convFor(lead?.id ?? null);
  const appt = appointments.find(a => a.customerId === id);

  const copy = (text: string, label: string) => {
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => undefined);
    toast(`${label} copied to clipboard`, "info");
  };

  const acts = useMemo<Act[]>(() => {
    const out: Act[] = [];
    callsList.forEach(c => out.push({
      t: +new Date(c.startTime), kind: "call",
      title: `${c.direction === "inbound" ? "Inbound call" : "Outbound call"} · ${c.result}`,
      sub: `${c.fromName} → ${c.toName}${c.duration ? ` · ${fmtDur(c.duration)}` : ""}`,
    }));
    notesList.forEach(n => out.push({
      t: +new Date(n.createdAt), kind: "note", title: `Note by ${n.author}`,
      sub: n.content.length > 92 ? n.content.slice(0, 92) + "…" : n.content,
    }));
    conv?.messages.slice(-6).forEach(m => out.push({
      t: +new Date(m.at), kind: "sms",
      title: m.direction === "inbound" ? "SMS received" : "SMS sent",
      sub: m.body.length > 92 ? m.body.slice(0, 92) + "…" : m.body,
    }));
    return out.sort((a, b) => b.t - a.t).slice(0, 12);
  }, [callsList, notesList, conv]);

  if (!lead) {
    return (
      <div className="space-y-4 animate-rise">
        <EmptyState icon="leads" title="Lead not found" hint="This record may have been merged or purged. Head back to the pipeline." />
        <Btn variant="outline" onClick={() => navigate({ view: "leads" })}><I name="chevL" size={14} /> Back to Leads Pipeline</Btn>
      </div>
    );
  }

  const studio = studioById(lead.locationId);
  const dial = () => {
    if (!lead.formattedPhone) { toast("No phone number on this lead — status set to No Phone", "error"); return; }
    toast(`Dialing ${prettyPhone(lead.formattedPhone)} via Vonage VBC…`, "info");
  };

  const CopyRow = ({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) => (
    <div className="group flex items-center justify-between gap-3 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 transition-colors hover:border-ink-600">
      <div className="min-w-0">
        <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-ink-400">{label}</div>
        <div className="num truncate text-[12px] font-semibold text-ink-200">{value}</div>
      </div>
      <button onClick={onCopy} title={`Copy ${label}`}
        className="rounded-md border border-ink-600 p-1.5 text-ink-400 opacity-60 transition-all hover:border-gold-500/60 hover:text-gold-300 group-hover:opacity-100">
        <I name="copy" size={12} />
      </button>
    </div>
  );

  return (
    <div className="space-y-4 animate-rise">
      <button onClick={() => navigate({ view: "leads" })}
        className="flex items-center gap-1.5 text-[12.5px] font-bold text-ink-400 transition-colors hover:text-gold-300">
        <I name="chevL" size={14} /> Leads Pipeline
      </button>

      {/* header card */}
      <div className="relative overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gold-500/8 blur-3xl" />
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={lead.name} size={62} ring />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-[23px] font-bold tracking-wide text-ink-50">{lead.name}</h2>
              {lead.isDuplicate && <Pill color="#9b6bff">Duplicate</Pill>}
              {lead.unsubscribedAt && <Pill color="#e5484d">SMS Opt-Out</Pill>}
            </div>
            <div className="num mt-1 text-[11.5px] text-ink-400">{lead.id} · created {timeAgo(lead.createdAt)} · {fmtDT(lead.createdAt)}</div>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <Dropdown width={236} trigger={open => (
                <button className="flex items-center gap-1.5 transition-transform" style={{ transform: open ? "scale(1.03)" : undefined }}>
                  <CallStatusPill s={lead.callStatus} />
                  <I name="chevD" size={12} className={`text-ink-500 transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
              )}>
                {close => (
                  <div className="max-h-72 overflow-y-auto py-1">
                    {TAB_ORDER.map(s => (
                      <button key={s} onClick={() => { updateLeadStatus(lead.id, s); toast(`${lead.name} → ${CALL_STATUS_META[s].label}`); close(); }}
                        className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[12.5px] font-bold transition-colors hover:bg-ink-750 ${lead.callStatus === s ? "text-gold-300" : "text-ink-200"}`}>
                        <span className="h-2 w-2 rounded-full" style={{ background: CALL_STATUS_META[s].color }} />
                        {CALL_STATUS_META[s].label}
                        {lead.callStatus === s && <I name="check" size={12} className="ml-auto text-gold-400" />}
                      </button>
                    ))}
                  </div>
                )}
              </Dropdown>
              <PlatformPill p={lead.attr.platform} />
              <Pill color="#63637a">{studio?.name ?? "—"}</Pill>
              <Pill color="#4c8dff" dot={false}>{lead.meta.language.toUpperCase()}</Pill>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Btn variant="outline" onClick={dial}><I name="phone" size={14} /> Call</Btn>
            <Btn variant="outline" disabled={!conv} onClick={() => conv && navigate({ view: "sms", id: conv.id })} title={conv ? "Open SMS thread" : "No SMS thread yet"}>
              <I name="chat" size={14} /> Message
            </Btn>
            <Btn variant="outline" onClick={() => setNotesOpen(true)}><I name="note" size={14} /> Notes <span className="num opacity-70">{notesList.length}</span></Btn>
            <Btn variant="gold" disabled={!!appt}
              onClick={() => { const aid = convertLead(lead.id); if (aid) { toast(`${lead.name} converted to appointment`); navigate({ view: "appointment", id: aid }); } }}>
              <I name="convert" size={14} /> {appt ? "Converted" : "Convert to Booking"}
            </Btn>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* left column */}
        <div className="space-y-4 xl:col-span-3">
          {/* tattoo request */}
          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle right={<Pill color="#d4af37" dot={false}>{lead.status} intake form</Pill>}>Tattoo Request</SectionTitle>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Field label="Purpose"><div className="text-[13px] font-bold text-ink-100">{lead.meta.purpose}</div></Field>
              <Field label="Style"><div className="text-[13px] font-bold text-ink-100">{lead.meta.style}</div></Field>
              <Field label="Story Type"><div className="text-[13px] font-bold text-ink-100">{STORY_TYPES[lead.meta.storyType] ?? lead.meta.storyType}</div></Field>
              <Field label="Size"><div className="text-[13px] font-bold text-ink-100">{lead.meta.size}</div></Field>
            </div>
            <div className="mt-4">
              <Field label="Body Areas">
                <div className="mt-0.5 flex flex-wrap gap-1.5">
                  {lead.meta.bodyAreas.map(a => <Pill key={a} color="#8b8ba0" dot={false}>{a}</Pill>)}
                </div>
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Client Story">
                {lead.meta.story
                  ? <p className="mt-1 rounded-xl border border-ink-700 bg-ink-900 px-4 py-3 text-[13px] font-medium italic leading-relaxed text-ink-200">“{lead.meta.story}”</p>
                  : <p className="mt-1 text-[12.5px] font-semibold text-ink-500">No story provided — intake form left incomplete.</p>}
              </Field>
            </div>
            {lead.meta.referenceImages.length > 0 && (
              <div className="mt-4">
                <Field label={`Reference Images · ${lead.meta.referenceImages.length}`}>
                  <div className="mt-1.5 flex gap-2.5">
                    {lead.meta.referenceImages.map((img, i) => (
                      <button key={i} onClick={() => setLightbox(img)}
                        className="group relative h-24 w-24 overflow-hidden rounded-xl border border-ink-600 transition-all hover:scale-[1.04] hover:border-gold-500/60">
                        <img src={img} alt={`reference ${i + 1}`} className="h-full w-full object-cover" />
                        <span className="absolute inset-0 grid place-items-center bg-ink-950/60 opacity-0 transition-opacity group-hover:opacity-100">
                          <I name="eye" size={18} className="text-gold-300" />
                        </span>
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            )}
            <div className="mt-4 flex items-center gap-2 border-t border-ink-750 pt-3.5">
              <I name={lead.meta.consent ? "check" : "alert"} size={14} className={lead.meta.consent ? "text-jade-400" : "text-ember-400"} />
              <span className="text-[12px] font-bold text-ink-300">
                Marketing consent {lead.meta.consent ? "granted" : "not granted"} · GDPR-compliant intake
              </span>
            </div>
          </div>

          {/* attribution */}
          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle right={<Pill color="#4c8dff" dot={false}>attribution</Pill>}>Source & Tracking</SectionTitle>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Field label="Platform"><div className="mt-0.5"><PlatformPill p={lead.attr.platform} /></div></Field>
              <Field label="UTM Source"><div className="num text-[13px] font-bold text-ink-100">{lead.attr.utmSource ?? "—"}</div></Field>
              <Field label="UTM Medium"><div className="num text-[13px] font-bold text-ink-100">{lead.attr.utmMedium ?? "—"}</div></Field>
              <Field label="UTM Content"><div className="num text-[13px] font-bold text-ink-100">{lead.attr.utmContent ?? "—"}</div></Field>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2.5 md:grid-cols-2">
              <CopyRow label="Campaign" value={lead.attr.utmCampaign ?? "organic / untagged"} onCopy={() => copy(lead.attr.utmCampaign ?? "", "Campaign")} />
              <CopyRow label="Landing URL" value={lead.attr.landingUrl} onCopy={() => copy(lead.attr.landingUrl, "Landing URL")} />
              {lead.attr.gclid && <CopyRow label="Google Click ID" value={lead.attr.gclid} onCopy={() => copy(lead.attr.gclid!, "gclid")} />}
              {lead.attr.fbclid && <CopyRow label="Meta Click ID" value={lead.attr.fbclid} onCopy={() => copy(lead.attr.fbclid!, "fbclid")} />}
              {lead.attr.ttclid && <CopyRow label="TikTok Click ID" value={lead.attr.ttclid} onCopy={() => copy(lead.attr.ttclid!, "ttclid")} />}
              <CopyRow label="Referrer" value={lead.attr.referer ?? "direct visit"} onCopy={() => copy(lead.attr.referer ?? "direct", "Referrer")} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-5">
              <Field label="Device"><div className="text-[12.5px] font-bold capitalize text-ink-100">{lead.attr.deviceType}</div></Field>
              <Field label="Browser"><div className="text-[12.5px] font-bold text-ink-100">{lead.attr.browser}</div></Field>
              <Field label="OS"><div className="text-[12.5px] font-bold text-ink-100">{lead.attr.os}</div></Field>
              <Field label="IP Country"><div className="num text-[12.5px] font-bold text-ink-100">{lead.attr.ipCountry}</div></Field>
              <Field label="Timezone"><div className="num truncate text-[12.5px] font-bold text-ink-100">{lead.attr.userTimezone}</div></Field>
            </div>
          </div>

          {/* call history */}
          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle right={
              <Btn size="sm" variant="outline" onClick={() => setHistOpen(true)}><I name="phone" size={13} /> Full history · {callsList.length}</Btn>
            }>Recent Calls</SectionTitle>
            {callsList.length === 0 ? (
              <EmptyState icon="phone" title="No calls yet" hint="This lead hasn't been dialed. Use the Call button to start a Vonage call." />
            ) : (
              <div className="divide-y divide-ink-750">
                {callsList.slice(0, 4).map(c => (
                  <div key={c.id} className="row-live flex items-center gap-3 px-1 py-2.5">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${c.direction === "inbound" ? "border-lapis-500/35 bg-lapis-500/10 text-lapis-400" : "border-gold-500/35 bg-gold-500/10 text-gold-400"}`}>
                      <I name="phone" size={14} className={c.direction === "outbound" ? "-scale-x-100" : ""} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-bold text-ink-100">{c.fromName} <span className="text-ink-500">→</span> {c.toName}</div>
                      <div className="num text-[11px] text-ink-400">{fmtDT(c.startTime)} · ext #{c.ext}</div>
                    </div>
                    <Pill color={c.result === "Answered" ? "#2fbf71" : c.result === "Missed" ? "#e5484d" : c.result === "Voicemail" ? "#9b6bff" : "#8b8ba0"}>
                      {c.result}{c.duration > 0 && <span className="num opacity-75">· {fmtDur(c.duration)}</span>}
                    </Pill>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* right column */}
        <div className="space-y-4 xl:col-span-2">
          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle>Contact</SectionTitle>
            <div className="space-y-2.5">
              <CopyRow label="Email" value={lead.email} onCopy={() => copy(lead.email, "Email")} />
              {lead.formattedPhone
                ? <CopyRow label="Phone (E.164)" value={prettyPhone(lead.formattedPhone)} onCopy={() => copy(lead.formattedPhone, "Phone")} />
                : <div className="flex items-center gap-2 rounded-lg border border-ember-500/35 bg-ember-500/8 px-3 py-2.5 text-[12.5px] font-bold text-ember-400">
                    <I name="alert" size={14} /> No phone on file — lead can't be called
                  </div>}
              {lead.unsubscribedAt && (
                <div className="flex items-center gap-2 rounded-lg border border-ember-500/35 bg-ember-500/8 px-3 py-2.5 text-[12.5px] font-bold text-ember-400">
                  <I name="x" size={14} /> Unsubscribed from SMS {timeAgo(lead.unsubscribedAt)}
                </div>
              )}
            </div>
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-900 p-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg border border-ink-600 bg-ink-800 text-gold-400"><I name="building" size={15} /></span>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-bold text-ink-100">{studio?.name}</div>
                <div className="text-[11px] font-semibold text-ink-400">{studio?.city}, {studio?.country} · {studio?.manager}</div>
              </div>
            </div>
          </div>

          {/* linked appointment */}
          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle>Linked Booking</SectionTitle>
            {appt ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 rounded-xl border border-gold-500/30 bg-gold-500/6 p-3.5">
                  <div>
                    <div className="num text-[13px] font-bold text-gold-300">{appt.uuid}</div>
                    <div className="mt-0.5 text-[11.5px] font-semibold text-ink-300">{fmtD(appt.preferredDate)} · {appt.preferredTime}</div>
                  </div>
                  <ApptStatusPill s={appt.status} />
                </div>
                <Btn variant="outline" className="w-full" onClick={() => navigate({ view: "appointment", id: appt.id })}>
                  Open appointment <I name="chevR" size={14} />
                </Btn>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-ink-600 bg-ink-900/60 p-4 text-center">
                <div className="text-[12.5px] font-bold text-ink-300">No booking linked yet</div>
                <div className="mt-0.5 text-[11.5px] text-ink-500">Convert this lead once the call goes well.</div>
              </div>
            )}
          </div>

          {/* activity feed */}
          <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
            <SectionTitle>Activity Timeline</SectionTitle>
            {acts.length === 0 ? (
              <EmptyState icon="clock" title="No activity yet" hint="Calls, SMS and notes will appear here as the team works the lead." />
            ) : (
              <ol className="relative ml-3 space-y-4 border-l border-ink-700 pl-5">
                {acts.map((a, i) => (
                  <li key={i} className="relative">
                    <span className={`absolute -left-[27px] top-0.5 grid h-5 w-5 place-items-center rounded-full border ${a.kind === "call" ? "border-lapis-500/50 bg-lapis-500/15 text-lapis-400" : a.kind === "sms" ? "border-jade-500/50 bg-jade-500/15 text-jade-400" : "border-iris-500/50 bg-iris-500/15 text-iris-400"}`}>
                      <I name={a.kind === "call" ? "phone" : a.kind === "sms" ? "chat" : "note"} size={10} />
                    </span>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[12.5px] font-extrabold text-ink-100">{a.title}</span>
                      <span className="num shrink-0 text-[10.5px] text-ink-500">{timeAgo(new Date(a.t).toISOString())}</span>
                    </div>
                    <p className="mt-0.5 text-[12px] font-medium leading-snug text-ink-400">{a.sub}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>

      {lightbox && (
        <Modal onClose={() => setLightbox(null)} w={760}>
          <img src={lightbox} alt="Reference full size" className="w-full rounded-2xl" />
        </Modal>
      )}
      {histOpen && <CallHistoryModal leadName={lead.name} phone={lead.formattedPhone} calls={callsList} onClose={() => setHistOpen(false)} />}
      {notesOpen && <NotesDrawer type="lead" id={lead.id} title={lead.name} onClose={() => setNotesOpen(false)} />}
    </div>
  );
}
