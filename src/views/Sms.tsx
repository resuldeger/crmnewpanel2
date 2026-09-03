import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { Avatar, Btn, Dropdown, EmptyState, I, Pill, inputCls } from "../components/ui";
import { SMS_TEMPLATES, fmtD, prettyPhone, studioById, timeAgo, type Conversation } from "../data/crm";
import { t, tf, useI18n } from "../services/i18n";

type ThreadFilter = "all" | "unread" | "needs_reply" | "read" | "optout" | "media";
const FILTERS: { id: ThreadFilter; label: string; color: string }[] = [
  { id: "all", label: "All", color: "#d4af37" },
  { id: "unread", label: "Unread", color: "#e5484d" },
  { id: "needs_reply", label: "Needs reply", color: "#e8a33d" },
  { id: "read", label: "Read", color: "#2fbf71" },
  { id: "optout", label: "Opted-out", color: "#f0716b" },
  { id: "media", label: "Has media", color: "#9b6bff" },
];
const lastInbound = (c: Conversation) => c.messages.length > 0 && c.messages[c.messages.length - 1].direction === "inbound";

export default function Sms({ convId }: { convId?: number }) {
  const { conversations, appointments, sendSms, markRead, simulateReply, navigate, unreadTotal } = useStore();
  useI18n();
  const [selId, setSelId] = useState<number | null>(convId ?? conversations[0]?.id ?? null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<ThreadFilter>("all");
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (convId) setSelId(convId); }, [convId]);

  const conv = conversations.find(c => c.id === selId) ?? null;

  useEffect(() => {
    if (conv && conv.unreadCount > 0) markRead(conv.id);
  }, [conv, markRead]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selId, conv?.messages.length]);

  const searched = useMemo(() => {
    const query = q.trim().toLowerCase();
    const sorted = [...conversations].sort((a, b) => {
      const la = +new Date(a.messages[a.messages.length - 1]?.at ?? 0);
      const lb = +new Date(b.messages[b.messages.length - 1]?.at ?? 0);
      return lb - la;
    });
    if (!query) return sorted;
    return sorted.filter(c => c.customerName.toLowerCase().includes(query) || c.phone.includes(query.replace(/[^0-9+]/g, "")));
  }, [conversations, q]);

  const filterCounts = useMemo(() => ({
    all: searched.length,
    unread: searched.filter(c => c.unreadCount > 0).length,
    needs_reply: searched.filter(lastInbound).length,
    read: searched.filter(c => c.unreadCount === 0 && c.messages.length > 0).length,
    optout: searched.filter(c => c.unsubscribed).length,
    media: searched.filter(c => c.messages.some(m => m.mediaUrl)).length,
  }), [searched]);

  const filtered = useMemo(() => searched.filter(c =>
    filter === "all" ? true :
    filter === "unread" ? c.unreadCount > 0 :
    filter === "needs_reply" ? lastInbound(c) :
    filter === "read" ? c.unreadCount === 0 && c.messages.length > 0 :
    filter === "optout" ? c.unsubscribed :
    c.messages.some(m => m.mediaUrl)), [searched, filter]);

  const send = () => {
    if (!conv || !draft.trim() || conv.unsubscribed) return;
    sendSms(conv.id, draft.trim());
    setDraft("");
    simulateReply(conv.id);
  };

  const applyTemplate = (body: string) => {
    if (!conv) return;
    const appt = appointments.find(a => a.customerId === conv.customerId);
    const dateStr = appt ? `${fmtD(appt.preferredDate)} at ${appt.preferredTime}` : t("your next visit");
    setDraft(body
      .replace(/\{customer_name\}/g, conv.customerName.split(" ")[0])
      .replace(/\{location_name\}/g, studioById(conv.locationId)?.name ?? t("our studio"))
      .replace(/\{appointment_date\}/g, dateStr));
  };

  const segments = Math.max(1, Math.ceil(draft.length / 153));

  return (
    <div className="animate-rise">
      <div className="grid h-[calc(100vh-170px)] min-h-[560px] grid-cols-1 gap-4 lg:grid-cols-[330px_1fr]">
        {/* conversation list */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
          <div className="border-b border-ink-700 p-3.5">
            <div className="mb-2.5 flex items-center justify-between">
              <h3 className="font-display text-[15px] font-bold tracking-wide text-ink-50">{t("Threads")}</h3>
              {unreadTotal > 0 && <Pill color="#e5484d">{tf("{n} unread", { n: unreadTotal })}</Pill>}
            </div>
            <div className="relative">
              <I name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("Search name or phone…")} className={`${inputCls} pl-9`} />
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {FILTERS.map(f => {
                const active = filter === f.id;
                return (
                  <button key={f.id} onClick={() => setFilter(active ? "all" : f.id)}
                    className="rounded-lg px-2 py-1 text-[11px] font-bold transition-all"
                    style={active
                      ? { color: "#0a0a0e", background: f.color, border: `1px solid ${f.color}` }
                      : { color: f.color, background: `${f.color}10`, border: `1px solid ${f.color}35` }}>
                    {t(f.label)} <span className="num opacity-75">· {filterCounts[f.id]}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="min-h-0 flex-1 divide-y divide-ink-750 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="p-6">
                <EmptyState icon="chat" title={q || filter !== "all" ? t("No threads match") : t("No threads")}
                  hint={q || filter !== "all" ? t("Clear the search or pick another filter.") : t("Send an SMS from a lead to start a thread.")} />
              </div>
            )}
            {filtered.map(c => {
              const last = c.messages[c.messages.length - 1];
              const active = c.id === selId;
              const hasMedia = c.messages.some(m => m.mediaUrl);
              return (
                <button key={c.id} onClick={() => setSelId(c.id)}
                  className={`flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors ${active ? "bg-gold-500/8 shadow-[inset_2.5px_0_0_var(--color-gold-500)]" : "hover:bg-ink-800"}`}>
                  <div className="relative">
                    <Avatar name={c.customerName} size={36} />
                    {c.unreadCount > 0 && (
                      <span className="num absolute -right-1 -top-1 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-ember-500 px-1 text-[9.5px] font-bold text-white">{c.unreadCount}</span>
                    )}
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className={`flex items-baseline justify-between gap-2 ${c.unreadCount > 0 ? "text-ink-50" : "text-ink-100"}`}>
                      <span className="truncate text-[13px] font-extrabold">{c.customerName}</span>
                      {last && <span className="num shrink-0 text-[10px] text-ink-500">{timeAgo(last.at)}</span>}
                    </span>
                    <span className={`mt-0.5 block truncate text-[11.5px] ${c.unreadCount > 0 ? "font-bold text-ink-200" : "font-medium text-ink-400"}`}>
                      {last ? `${last.direction === "outbound" ? t("You: ") : ""}${last.body}` : t("No messages yet")}
                    </span>
                    <span className="mt-1 flex items-center gap-1.5">
                      <Pill color="#63637a" dot={false} className="!text-[9.5px]">{studioById(c.locationId)?.slug}</Pill>
                      {c.unsubscribed && <Pill color="#e5484d" dot={false} className="!text-[9.5px]">{t("OPT-OUT")}</Pill>}
                      {hasMedia && <Pill color="#9b6bff" dot={false} className="!text-[9.5px]"><I name="image" size={9} /> {t("MEDIA")}</Pill>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-ink-700 px-4 py-2.5 text-[10.5px] font-bold tracking-wide text-ink-500">
            {t("TWILIO PROGRAMMABLE SMS · A2P 10DLC REGISTERED")}
          </div>
        </div>

        {/* thread pane */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
          {!conv ? (
            <div className="grid flex-1 place-items-center p-8">
              <EmptyState icon="chat" title={t("Pick a conversation")} hint={t("Select a thread on the left to read and reply.")} />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 border-b border-ink-700 px-4 py-3">
                <Avatar name={conv.customerName} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[14px] font-extrabold text-ink-50">
                    {conv.customerName}
                    {conv.unsubscribed && <Pill color="#e5484d">{t("Opted out")}</Pill>}
                  </div>
                  <div className="num text-[11px] text-ink-400">{prettyPhone(conv.phone)} · {studioById(conv.locationId)?.name}</div>
                </div>
                <Pill color="#8b8ba0" dot={false}>
                  <span className="num">{conv.messages.length}</span>&nbsp;{t("messages")}
                </Pill>
                {conv.customerId && (
                  <Btn size="sm" variant="outline" onClick={() => navigate({ view: "lead", id: conv.customerId! })}>
                    <I name="leads" size={13} /> {t("360° Record")}
                  </Btn>
                )}
              </div>

              <div ref={listRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-ink-900/40 px-4 py-4">
                {conv.messages.map(m => (
                  <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[76%] animate-pop rounded-xl border px-3.5 py-2.5 ${m.direction === "outbound"
                      ? "rounded-br-sm border-gold-500/35 bg-gold-500/12"
                      : "rounded-bl-sm border-ink-600 bg-ink-800"}`}>
                      {m.mediaUrl && (
                        <img src={m.mediaUrl} alt="attached reference" className="mb-2 max-h-44 w-full rounded-lg border border-ink-600 object-cover" />
                      )}
                      <p className="text-[13px] font-medium leading-relaxed text-ink-100">{m.body}</p>
                      <div className="num mt-1 flex items-center justify-end gap-1 text-[9.5px] text-ink-500">
                        {new Date(m.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        {m.direction === "outbound" && (
                          <I name={m.status === "delivered" ? "checks" : "check"} size={11}
                            className={m.status === "delivered" ? "text-jade-400" : "text-ink-400"} />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-ink-700 p-3.5">
                {conv.unsubscribed && (
                  <div className="mb-2.5 flex items-center gap-2 rounded-lg border border-ember-500/40 bg-ember-500/10 px-3 py-2 text-[12px] font-bold text-ember-400">
                    <I name="alert" size={14} /> {t("This number opted out — outbound SMS is blocked by Twilio compliance.")}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <Dropdown width={300} align="left" trigger={() => (
                    <button className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-lg border border-ink-600 text-ink-300 transition-colors hover:border-gold-500/60 hover:text-gold-300" title={t("Insert template")}>
                      <I name="note" size={16} />
                    </button>
                  )}>
                    {close => (
                      <div className="py-1">
                        <div className="px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-400">{t("SMS Templates")}</div>
                        {SMS_TEMPLATES.map(tp => (
                          <button key={tp.name} onClick={() => { applyTemplate(tp.body); close(); }}
                            className="block w-full px-3.5 py-2 text-left transition-colors hover:bg-ink-750">
                            <span className="block text-[12.5px] font-bold text-gold-300">{t(tp.name)}</span>
                            <span className="mt-0.5 block truncate text-[11px] text-ink-400">{tp.body}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </Dropdown>
                  <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2} disabled={conv.unsubscribed}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder={conv.unsubscribed ? t("Messaging disabled for this number") : t("Reply via Twilio… (Enter to send, Shift+Enter for newline)")}
                    className={`${inputCls} min-h-[38px] flex-1 resize-none disabled:opacity-50`} />
                  <Btn variant="gold" onClick={send} disabled={!draft.trim() || conv.unsubscribed} className="h-[38px]">
                    <I name="send" size={15} /> {t("Send")}
                  </Btn>
                </div>
                <div className="num mt-1.5 flex items-center justify-between text-[10px] font-semibold text-ink-500">
                  <span>{tf("{n} chars · {s} segment(s)", { n: draft.length, s: segments })}</span>
                  <span>{t("sender ID: CLEOPATRA")}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
