import { useState } from "react";
import { useStore } from "../store";
import { Btn, Field, I, Modal, ModalHead, Pill } from "./ui";
import { SMS_TEMPLATES, fmtD, prettyPhone, studioById } from "../data/crm";

/**
 * Template-driven SMS composer. Pick a template → merge fields auto-fill
 * ({customer_name}, {location_name}, {appointment_date}) → edit preview →
 * send through Twilio. Works from a lead id or a raw contact (walk-in bookings).
 */
export default function SmsCompose({ leadId, phone, name, locationId, dateOverride, onSent, onClose }: {
  leadId?: string; phone?: string; name?: string; locationId?: number;
  dateOverride?: string; onSent?: () => void; onClose: () => void;
}) {
  const { leads, appointments, sendLeadSms, sendSmsTo, toast, navigate } = useStore();
  const lead = leadId ? leads.find(l => l.id === leadId) : undefined;

  const cName = lead?.name ?? name ?? "Client";
  const cPhone = lead?.formattedPhone ?? phone ?? "";
  const cLoc = lead?.locationId ?? locationId ?? 1;
  const cOptOut = !!lead?.unsubscribedAt;

  const [tpl, setTpl] = useState<number>(0);
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const [jump, setJump] = useState(true);

  const studio = studioById(cLoc);
  const appt = lead ? appointments.find(a => a.customerId === lead.id) : undefined;
  const dateStr = dateOverride ?? (appt ? `${fmtD(appt.preferredDate)} at ${appt.preferredTime}` : "a slot this week");

  const filled = (body: string) =>
    body
      .replace(/\{customer_name\}/g, cName.split(" ")[0])
      .replace(/\{location_name\}/g, studio?.name ?? "our studio")
      .replace(/\{appointment_date\}/g, dateStr);

  const body = touched ? text : filled(SMS_TEMPLATES[tpl].body);
  const len = body.length;
  const segments = len === 0 ? 0 : len <= 160 ? 1 : Math.ceil(len / 153);

  const send = () => {
    const convId = lead
      ? sendLeadSms(lead.id, body.trim())
      : sendSmsTo(cPhone, cName, cLoc, body.trim());
    toast(`SMS queued to ${cName.split(" ")[0]} via Twilio`, "success");
    onSent?.();
    onClose();
    if (jump && convId > 0) navigate({ view: "sms", id: convId });
  };

  return (
    <Modal onClose={onClose} w={640}>
      <ModalHead
        title="Send SMS"
        sub={<span className="num">To {cName} · {prettyPhone(cPhone) || "no phone"} · from {studio?.twilioNumber ?? "Twilio sender"}</span>}
        onClose={onClose}
      />
      <div className="space-y-4 px-5 py-5">
        {!cPhone && (
          <div className="flex items-center gap-2.5 rounded-xl border border-ember-500/35 bg-ember-500/10 px-3.5 py-3 text-[12.5px] font-bold text-ember-400">
            <I name="alert" size={15} /> No phone number on this record — SMS can't be delivered.
          </div>
        )}
        {cOptOut && (
          <div className="flex items-center gap-2.5 rounded-xl border border-ember-500/35 bg-ember-500/10 px-3.5 py-3 text-[12.5px] font-bold text-ember-400">
            <I name="alert" size={15} /> Client opted out of marketing SMS — transactional only (A2P 10DLC).
          </div>
        )}

        <Field label="Choose a template">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SMS_TEMPLATES.map((t, i) => (
              <button key={t.name} onClick={() => { setTpl(i); setTouched(false); }}
                className={`rounded-xl border px-3.5 py-2.5 text-left transition-all duration-150 ${tpl === i && !touched
                  ? "border-gold-500/70 bg-gold-500/10 shadow-[0_0_0_1px_rgba(212,175,55,0.3)]"
                  : "border-ink-600 bg-ink-900 hover:border-ink-500"}`}>
                <span className={`flex items-center gap-1.5 text-[12px] font-extrabold ${tpl === i && !touched ? "text-gold-300" : "text-ink-100"}`}>
                  <I name="note" size={12} className={tpl === i && !touched ? "text-gold-400" : "text-ink-400"} />
                  {t.name}
                </span>
                <span className="mt-1 block truncate text-[10.5px] font-semibold text-ink-400">{t.body}</span>
              </button>
            ))}
            <button onClick={() => { setTpl(0); setText(""); setTouched(true); }}
              className={`rounded-xl border border-dashed px-3.5 py-2.5 text-left text-[12px] font-extrabold transition-all ${touched
                ? "border-gold-500/70 bg-gold-500/10 text-gold-300"
                : "border-ink-600 text-ink-300 hover:border-ink-500 hover:text-ink-100"}`}>
              <I name="plus" size={12} className="mr-1 inline" />Blank message
            </button>
          </div>
        </Field>

        <Field label="Message preview — editable">
          <div className="relative">
            <textarea
              value={body}
              onChange={e => { setText(e.target.value); setTouched(true); }}
              rows={5}
              placeholder="Write your message… merge fields fill automatically."
              className="w-full resize-none rounded-xl border border-ink-600 bg-ink-900 px-3.5 py-3 text-[13px] font-semibold leading-relaxed text-ink-100 outline-none transition-colors placeholder:font-medium placeholder:text-ink-500 focus:border-gold-500/70"
            />
            <span className={`num absolute bottom-2.5 right-3 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${len > 320 ? "bg-ember-500/15 text-ember-400" : "bg-ink-750 text-ink-400"}`}>
              {len} chars · {segments} SMS
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Pill color="#8b8ba0" dot={false} className="!text-[9.5px]">{"{customer_name}"} → {cName.split(" ")[0]}</Pill>
            <Pill color="#8b8ba0" dot={false} className="!text-[9.5px]">{"{location_name}"} → {studio?.slug ?? "—"}</Pill>
            <Pill color="#8b8ba0" dot={false} className="!text-[9.5px]">{"{appointment_date}"} → {dateStr}</Pill>
          </div>
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-700 pt-4">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] font-bold text-ink-300">
            <input type="checkbox" checked={jump} onChange={e => setJump(e.target.checked)} className="accent-[#d4af37]" />
            Open thread after sending
          </label>
          <div className="flex items-center gap-2">
            <Btn variant="outline" onClick={onClose}>Cancel</Btn>
            <Btn variant="gold" disabled={!body.trim() || !cPhone} onClick={send}>
              <I name="send" size={14} /> Send via Twilio
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}
