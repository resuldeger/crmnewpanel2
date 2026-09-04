import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { Avatar, Btn, EmptyState, I, Pill, inputCls } from "../ui";
import { fmtDT, prettyPhone, studioById, timeAgo, type Conversation } from "../data";
import { t, tf, useI18n } from "../i18n";

type Filter = "all" | "unread" | "needs_reply" | "read" | "optout";

const lastInbound = (c: Conversation) => c.messages.length > 0 && c.messages[c.messages.length - 1].direction === "inbound";

export default function Sms({ convId }: { convId?: number }) {
  const { conversations, sendSms, markRead, simulateReply, navigate, guard, can } = useStore();
  useI18n();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState("");
  const [shown, setShown] = useState(15);
  useEffect(() => setShown(15), [q, filter]);
  const listRef = useRef<HTMLDivElement>(null);

  const activeId = convId ?? conversations[0]?.id;
  const conv = conversations.find(c => c.id === activeId);

  /* mark the open thread read (also while it is on screen and new mail lands) */
  useEffect(() => {
    const c = conversations.find(x => x.id === activeId);
    if (c && c.unreadCount > 0) markRead(c.id);
  }, [activeId, conversations, markRead]);

  /* keep the latest message in view — scroll the message pane only, never the page */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [conv?.messages.length, activeId]);

  const searched = useMemo(() => {
    const query = q.trim().toLowerCase();
    return [...conversations]
      .sort((a, b) => +new Date(b.messages[b.messages.length - 1]?.at ?? 0) - +new Date(a.messages[a.messages.length - 1]?.at ?? 0))
      .filter(c => !query || c.customerName.toLowerCase().includes(query) || c.phone.includes(query));
  }, [conversations, q]);

  const filterCounts = useMemo(() => ({
    all: searched.length,
    unread: searched.filter(c => c.unreadCount > 0).length,
    needs_reply: searched.filter(lastInbound).length,
    read: searched.filter(c => c.unreadCount === 0 && c.messages.length > 0).length,
    optout: searched.filter(c => c.unsubscribed).length,
  }), [searched]);

  const filtered = useMemo(() => searched.filter(c =>
    filter === "all" ? true :
    filter === "unread" ? c.unreadCount > 0 :
    filter === "needs_reply" ? lastInbound(c) :
    filter === "read" ? c.unreadCount === 0 && c.messages.length > 0 :
    c.unsubscribed), [searched, filter]);

  const send = () => {
    if (!conv || !draft.trim() || conv.unsubscribed) return;
    if (!guard("sms.send")) return;
    sendSms(conv.id, draft.trim());
    setDraft("");
    setTimeout(() => simulateReply(conv.id), 300);
  };

  const FILTERS: { k: Filter; label: string; color: string }[] = [
    { k: "all", label: t("All"), color: "#fba200" },
    { k: "unread", label: t("Unread"), color: "#e5484d" },
    { k: "needs_reply", label: t("Needs reply"), color: "#4c8dff" },
    { k: "read", label: t("Read"), color: "#2fbf71" },
    { k: "optout", label: t("Opted-out"), color: "#948d7d" },
  ];

  return (
    <div className="animate-rise">
      <div className="grid h-[calc(100dvh-262px)] min-h-[460px] grid-cols-1 overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel lg:h-[calc(100dvh-178px)] lg:min-h-[540px] lg:grid-cols-[360px_1fr]">
        {/* thread list */}
        <div className="flex min-h-0 max-h-[38vh] flex-col border-b border-ink-700 lg:max-h-none lg:border-b-0 lg:border-r">
          <div className="space-y-2.5 border-b border-ink-700 p-3.5">
            <div className="relative">
              <I name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("Search conversations…")} className={`${inputCls} pl-9`} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {FILTERS.map(f => (
                <button key={f.k} onClick={() => setFilter(f.k)}
                  className="rounded-lg px-2.5 py-1 text-[11.5px] font-bold transition-all"
                  style={filter === f.k
                    ? { color: "#fffdf7", background: f.color, border: `1px solid ${f.color}` }
                    : { color: f.color, background: `${f.color}10`, border: `1px solid ${f.color}35` }}>
                  {f.label} <span className="num opacity-75">· {filterCounts[f.k]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 divide-y divide-ink-750 overflow-y-auto">
            {filtered.slice(0, shown).map(c => {
              const last = c.messages[c.messages.length - 1];
              const active = c.id === activeId;
              return (
                <button key={c.id} onClick={() => navigate({ view: "sms", id: c.id })}
                  className={`flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors ${active ? "bg-gold-500/10" : "hover:bg-ink-850"}`}>
                  <Avatar name={c.customerName} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-extrabold text-ink-100">{c.customerName}</span>
                      {last && <span className="num shrink-0 text-[10px] text-ink-500">{timeAgo(last.at)}</span>}
                    </span>
                    <span className={`mt-0.5 block truncate text-[11.5px] font-semibold ${c.unreadCount > 0 ? "text-ink-100" : "text-ink-500"}`}>
                      {last ? `${last.direction === "outbound" ? t("You: ") : ""}${last.body}` : t("No messages yet")}
                    </span>
                    <span className="mt-1 flex items-center gap-1.5">
                      {c.unsubscribed && <Pill color="#e5484d" dot={false} className="!text-[9px]">{t("OPT-OUT")}</Pill>}
                      {lastInbound(c) && <Pill color="#4c8dff" dot={false} className="!text-[9px]">{t("Needs reply")}</Pill>}
                    </span>
                  </span>
                  {c.unreadCount > 0 && <span className="num grid h-5 min-w-[20px] place-items-center rounded-full bg-ember-500 px-1 text-[10px] font-bold text-white">{c.unreadCount}</span>}
                </button>
              );
            })}
            {filtered.length === 0 && <div className="p-6"><EmptyState title={t("No leads match these filters")} /></div>}
            {filtered.length > shown && (
              <button onClick={() => setShown(s => s + 15)}
                className="w-full px-3 py-3 text-center text-[12px] font-extrabold text-gold-300 transition-colors hover:bg-gold-500/8">
                {tf("Show {n} more", { n: Math.min(15, filtered.length - shown) })} · <span className="num">{filtered.length - shown}</span> {t("left")}
              </button>
            )}
          </div>
        </div>

        {/* thread view */}
        {conv ? (
          <div className="flex min-h-0 flex-col">
            <div className="flex items-center gap-3 border-b border-ink-700 px-5 py-3.5">
              <Avatar name={conv.customerName} size={38} ring />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-extrabold text-ink-50">{conv.customerName}</div>
                <div className="num text-[11px] font-semibold text-ink-400">{prettyPhone(conv.phone)} · {studioById(conv.locationId)?.name}</div>
              </div>
              {conv.unsubscribed && <Pill color="#e5484d">{t("SMS Opt-Out")}</Pill>}
              <Pill color="#4c8dff" dot={false}>Twilio</Pill>
            </div>
            <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-ink-900/40 p-5">
              {conv.messages.map(m => (
                <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"} animate-pop`}>
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 shadow-panel ${m.direction === "outbound"
                    ? "rounded-br-md border border-gold-500/40 bg-gold-500/12 text-ink-100"
                    : "rounded-bl-md border border-ink-600 bg-ink-875 text-ink-100"}`}>
                    <p className="text-[13px] font-semibold leading-relaxed">{m.body}</p>
                    <div className={`num mt-1 flex items-center gap-1 text-[10px] font-bold ${m.direction === "outbound" ? "justify-end text-gold-300/70" : "text-ink-500"}`}>
                      {fmtDT(m.at)}
                      {m.direction === "outbound" && <I name={m.status === "delivered" ? "checks" : "check"} size={12} className={m.status === "delivered" ? "text-jade-400" : "text-ink-500"} />}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-ink-700 p-4">
              {conv.unsubscribed ? (
                <div className="flex items-center gap-2.5 rounded-xl border border-ember-500/40 bg-ember-500/8 px-4 py-3 text-[12.5px] font-bold text-ember-400">
                  <I name="alert" size={15} /> {t("Client opted out — sending blocked (A2P 10DLC).")}
                </div>
              ) : (
                <div className="flex items-end gap-2">
                  <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={1}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder={t("Type a message… (merge fields supported)")}
                    className={`${inputCls} min-h-[38px] flex-1 resize-none`} />
                  <Btn variant="gold" onClick={send} disabled={!draft.trim()} locked={!can("sms.send")} className="h-[38px]">
                    <I name="send" size={15} /> {t("Send")}
                  </Btn>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid place-items-center p-10">
            <div className="text-center">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-ink-600 bg-ink-850 text-gold-400"><I name="chat" size={22} /></span>
              <div className="mt-3 text-[15px] font-extrabold text-ink-200">{t("Select a conversation")}</div>
              <div className="mt-1 text-[12.5px] font-semibold text-ink-400">{t("Pick a thread from the list to start messaging.")}</div>
            </div>
          </div>
        )}
      </div>
      <span className="hidden">{tf("{n} chars · {s} SMS", { n: 0, s: 0 })}</span>
    </div>
  );
}
