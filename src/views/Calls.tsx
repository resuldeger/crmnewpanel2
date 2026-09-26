import { useEffect, useMemo, useState } from "react";
import { useStore, type LiveCall } from "../store";
import { Avatar, Btn, EmptyState, I, Modal, ModalHead, Pagination, Pill, PlayerModal, ResultPill, SectionTitle, inputCls, StaffPicker } from "../ui";
import { fmtDT, fmtDur, prettyPhone, studioById, timeAgo, type CallLog, type CallResult } from "../data";
import { t, tf, useI18n } from "../i18n";
import { useServerTable } from "../hooks/useServerTable";
import { crmApi, exportUrl } from "../services/crmApi";

const RESULT_ORDER: CallResult[] = ["Answered", "Missed", "Voicemail", "Attempted"];
const RESULT_COLORS: Record<CallResult, string> = { Answered: "#2fbf71", Missed: "#e5484d", Voicemail: "#e8a33d", Attempted: "#948d7d" };

/** A small group of mutually exclusive choices, as one control. */
function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { v: T; label: string }[];
}) {
  return (
    <div className="flex shrink-0 overflow-hidden rounded-lg border border-ink-600">
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className={`px-2.5 py-1.5 text-[12px] font-bold transition-colors ${
            value === o.v ? "bg-ink-700 text-gold-300" : "text-ink-400 hover:text-ink-100"
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** What each event kind is, in one word. Through the dictionary like
 *  everything else — these were the last literals left on this screen. */
const LABELS: Record<string, string> = {
  queue: "ringing", answer: "connected", end: "ended", miss: "missed", voicemail: "voicemail",
};
const dotFor = (kind: string) =>
  kind === "answer" || kind === "end" ? RESULT_COLORS.Answered
  : kind === "queue" ? RESULT_COLORS.Attempted
  : kind === "voicemail" ? RESULT_COLORS.Voicemail
  : RESULT_COLORS.Missed;

function LiveTimer({ startedAt, ringing }: { startedAt: number; ringing: boolean }) {
  const [, force] = useState(0);
  useEffect(() => { const i = setInterval(() => force(x => x + 1), 1000); return () => clearInterval(i); }, []);
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return (
    <span className={`num text-[15px] font-extrabold ${ringing ? "text-ember-400 animate-blink" : "text-jade-400"}`}>
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

export default function Calls() {
  const { calls, tasks, liveCallsArr, liveEvents, logCallback, addTask, toast, navigate, can, guard, session } = useStore();
  useI18n();
  const [play, setPlay] = useState<CallLog | null>(null);
  /* The call awaiting confirmation before it is cut off, if any. */
  const [hangup, setHangup] = useState<LiveCall | null>(null);
  const [hangingUp, setHangingUp] = useState(false);

  /* The log is the studio's whole call history — nine thousand rows and
     growing — so the search, the result tabs, the ordering and the export
     are all resolved in the database. They used to run over whatever the
     store had loaded, which was the most recent hundred: a customer who
     rang last month simply could not be found, and the tab counts said so
     with confidence. */
  /* Two axes the log had no way to separate. The call centre and the
     branches are run as different operations — one measured on volume,
     the other on its own shop — and inbound and outbound answer
     completely different questions about a branch. */
  const [desk, setDesk] = useState<"all" | "callcenter" | "branch">("all");
  const [direction, setDirection] = useState<"all" | "inbound" | "outbound">("all");

  const log = useServerTable<CallLog>({
    fetch: crmApi.calls,
    pageSize: 12,
    defaultSort: "start",
    extra: { desk, direction },
  });

  /* ── Who still needs calling back ────────────────────────────────
   * Missed and voicemail calls, minus the ones already dealt with. The
   * list used to only deduplicate: a number stayed on it after somebody
   * had rung them back, so the queue never went down and the same
   * customer was called twice by two people.
   *
   * Dealt with means either of two things, and both are what an operator
   * would call "done": someone rang them after the missed call, or
   * somebody raised a task for them and it is still open — that task is
   * now where the work lives, and leaving it here as well is the same
   * duplicate by another route.
   * ────────────────────────────────────────────────────────────── */
  const callbackQueue = useMemo(() => {
    const digits = (n: string) => n.replace(/\D/g, "");

    /* The most recent outbound attempt per number. A callback is only a
       callback if it came AFTER the call being answered for. */
    const calledBackAt = new Map<string, number>();
    for (const c of calls) {
      if (c.direction !== "outbound") continue;
      const key = digits(c.toNumber);
      if (!key) continue;
      const at = +new Date(c.startTime);
      if (at > (calledBackAt.get(key) ?? 0)) calledBackAt.set(key, at);
    }

    const chased = new Set(
      tasks.filter(t => t.status === "open" && t.phone).map(t => digits(t.phone)),
    );

    const seen = new Set<string>();
    return calls
      .filter(c => c.result === "Missed" || c.result === "Voicemail")
      .filter(c => {
        const key = digits(c.fromNumber);
        if (!key) return false;
        if (chased.has(key)) return false;
        if ((calledBackAt.get(key) ?? 0) > +new Date(c.startTime)) return false;
        return true;
      })
      .filter(c => {
        const key = c.customerId ?? digits(c.fromNumber);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
  }, [calls, tasks]);

  /* One block per call rather than one row per state change. A single
     call produces "ringing", "connected" and "ended", and stacked in a
     flat list they read as three separate calls — which is what made this
     column unreadable on a busy floor. */
  const eventGroups = useMemo(() => {
    const order: string[] = [];
    const byCall = new Map<string, { key: string; who?: string; ext?: string; steps: { id: number; kind: string; at: string; text: string; label: string }[] }>();
    for (const e of liveEvents) {
      // Events with no call id cannot be grouped; each stands alone.
      const key = e.callId ?? `single-${e.id}`;
      if (!byCall.has(key)) {
        byCall.set(key, { key, who: e.who, ext: e.ext, steps: [] });
        order.push(key);
      }
      byCall.get(key)!.steps.push({ id: e.id, kind: e.kind, at: e.at, text: e.text, label: t(LABELS[e.kind] ?? e.kind) });
    }
    return order.map(k => byCall.get(k)!);
  }, [liveEvents]);

  const createTask = (
    name: string, phone: string, customerId: string | null, locationId: number,
    source: "callback" | "voicemail",
    assignee?: { id: number; name: string } | null,
  ) => {
    if (!guard("calls.manage")) return;
    addTask({
      assigneeStaffId: assignee?.id ?? null,
      title: source === "voicemail" ? tf("Callback · {name}", { name }) + " (VM)" : tf("Callback · {name}", { name }),
      leadId: customerId, leadName: name, phone, locationId,
      /* Left to the server, which assigns it to whoever pressed the
         button. This was a fixed string that named an agent who may not
         exist and was never sent anywhere. */
      dueAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
      source,
    });
    toast(
      assignee
        ? tf("Task created for {name} · due {ago}", { name: assignee.name, ago: "+2h" })
        : tf("Task created · due {ago}", { ago: "+2h" }),
      "success",
    );
  };

  return (
    <div className="space-y-5 animate-rise">
      {/* live floor */}
      <div>
        <SectionTitle right={
          <span className="flex items-center gap-2 text-[11px] font-bold text-jade-400">
            <span className="relative flex h-2 w-2"><span className="absolute h-2 w-2 animate-ping rounded-full bg-jade-400 opacity-60" /><span className="h-2 w-2 rounded-full bg-jade-400" /></span>
            {t("Live active calls on the Vonage VBC floor")}
          </span>
        }>{t("Live Floor")}</SectionTitle>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {liveCallsArr.map(c => (
            <div key={c.id} className={`rounded-2xl border bg-ink-875 p-4 shadow-panel transition-all ${c.ringing ? "border-ember-500/50" : "border-jade-500/40"}`}>
              <div className="flex items-center gap-3">
                {/* Two parties, said as two things. The line under the name
                    used to read "+1 304 881 5042 · #418" with nothing to say
                    which was whose — one is the customer, the other is the
                    desk that has them. And when the carrier returned no
                    caller name, our own extension's title was printed where
                    the customer's name goes. */}
                <Avatar name={c.name || c.phone} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-extrabold text-ink-50">
                    {c.name || prettyPhone(c.phone) || t("Unknown caller")}
                  </div>
                  <div className="num truncate text-[10.5px] font-semibold text-ink-400">
                    {c.name ? `${prettyPhone(c.phone)} · ` : ""}
                    {c.agent || `#${c.ext}`}{c.agent && c.ext ? ` · #${c.ext}` : ""}
                  </div>
                </div>
                <LiveTimer startedAt={c.startedAt} ringing={c.ringing} />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Pill color={c.direction === "inbound" ? "#2fbf71" : "#4c8dff"} dot={false}>{t(c.direction === "inbound" ? "Incoming" : "Outgoing")}</Pill>
                  {c.ringing
                    ? <Pill color="#e5484d" dot={false} className="animate-blink">{t("Ringing")}</Pill>
                    : <span className="flex h-4 items-end gap-[2.5px]">{[0, 1, 2].map(i => <span key={i} className="eq-bar w-[3px] rounded-full bg-jade-500" style={{ height: "100%" }} />)}</span>}
                </div>
                {/* There used to be an "End" button here. It only removed
                    the row from this browser's state — the call carried on,
                    and now that the board is driven by the Telephony poller
                    the row reappears two seconds later. Hanging up for real
                    is possible (each call carries an actions_uri) but that
                    disconnects a live customer, so it is not wired to a
                    button nobody asked for. The floor reflects the phones;
                    it does not command them.

                    The line the customer dialled or sees goes here instead:
                    the direction is already on the pill beside it, and which
                    branch number a call came in on is not shown anywhere
                    else. */}
                <div className="flex items-center gap-2.5">
                  {c.did && (
                    <span className="num text-[10.5px] font-semibold text-ink-500" title={t("The line the customer sees")}>
                      {prettyPhone(c.did)}
                    </span>
                  )}
                  {/* Only a super admin, and only behind a dialog. This cuts
                      off a conversation that is happening, which no amount of
                      undo brings back. */}
                  {session?.roleId === "super_admin" && (
                    <Btn size="sm" variant="ghost" title={t("End this call")} onClick={() => setHangup(c)}>
                      <I name="x" size={12} />
                    </Btn>
                  )}
                </div>
              </div>
            </div>
          ))}
          {liveCallsArr.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-ink-600 p-6 text-center text-[12.5px] font-semibold text-ink-400">
              {t("No open tasks — the floor is clear.")}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        {/* event stream */}
        <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel xl:col-span-2">
          <SectionTitle right={<Pill color="#4c8dff" dot={false}>{t("Real-time events from the Vonage Events API")}</Pill>}>{t("Event Stream")}</SectionTitle>
          {/* Bounded, and scrolls. A busy floor produces an event every few
              seconds; unbounded, this column grew until the page was metres
              long and the callback queue beside it was pushed off-screen. */}
          <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {eventGroups.map(g => (
              <div key={g.key} className="rounded-lg border border-ink-700 bg-ink-900/70 px-3 py-2 animate-pop">
                <div className="flex items-center gap-2.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dotFor(g.steps[0].kind) }} />
                  <span className="num min-w-0 flex-1 truncate text-[12px] font-bold text-ink-100">
                    {g.who ?? g.steps[0].text}
                  </span>
                  {g.ext && <span className="num shrink-0 text-[10.5px] font-bold text-ink-400">#{g.ext}</span>}
                  <span className="num shrink-0 text-[10px] text-ink-500">{timeAgo(g.steps[0].at)}</span>
                </div>
                {/* The call's own progression, under one heading. Read as a
                    flat list these three lines looked like three calls. */}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-4">
                  {[...g.steps].reverse().map(st => (
                    <span key={st.id} className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: dotFor(st.kind) }}>
                      <span className="h-1 w-1 rounded-full" style={{ background: dotFor(st.kind) }} />
                      {st.label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {eventGroups.length === 0 && <div className="py-6 text-center text-[12px] font-semibold text-ink-400">…</div>}
          </div>
        </div>

        {/* callback queue */}
        <div className="rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel xl:col-span-3">
          <SectionTitle right={<Pill color="#e5484d" dot={false}>{t("Missed & voicemail, deduplicated per lead")}</Pill>}>{t("Needs a Callback")}</SectionTitle>
          <div className="max-h-[28rem] divide-y divide-ink-750 overflow-y-auto pr-1">
            {callbackQueue.map(c => {
              const name = c.direction === "inbound" ? c.fromName : c.toName;
              return (
                <div key={c.id} className="row-live flex flex-wrap items-center gap-3 py-3">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${c.result === "Voicemail" ? "border-[#e8a33d]/40 bg-[#e8a33d]/10 text-[#e8a33d]" : "border-ember-500/40 bg-ember-500/10 text-ember-400"}`}>
                    <I name={c.result === "Voicemail" ? "note" : "phone"} size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-extrabold text-ink-100">{name}</div>
                    <div className="num text-[11px] font-semibold text-ink-500">{prettyPhone(c.direction === "inbound" ? c.fromNumber : c.toNumber)} · {studioById(c.locationId)?.slug} · {timeAgo(c.startTime)}</div>
                  </div>
                  <ResultPill r={c.result} />
                  <div className="flex gap-1.5">
                    <Btn size="sm" variant="outline" locked={!can("calls.manage")}
                      onClick={() => {
                        void logCallback({ name, phone: c.direction === "inbound" ? c.fromNumber : c.toNumber, customerId: c.customerId, locationId: c.locationId });
                      }}>
                      <I name="phone" size={12} /> {t("Call back")}
                    </Btn>
                    {/* The task and the person it is for, in one action.
                        It used to make an unowned task and leave you to
                        find it on another screen to say whose it was. */}
                    {can("calls.manage") && (
                      <StaffPicker
                        locationId={c.locationId}
                        label={<><I name="checks" size={12} /> {t("Task")}</>}
                        onPick={(person, close) => {
                          createTask(
                            name,
                            c.direction === "inbound" ? c.fromNumber : c.toNumber,
                            c.customerId, c.locationId,
                            c.result === "Voicemail" ? "voicemail" : "callback",
                            person,
                          );
                          close();
                        }}
                      />
                    )}
                    {c.customerId && <Btn size="sm" variant="ghost" title={t("Open 360° view")} onClick={() => navigate({ view: "lead", id: c.customerId! })}><I name="eye" size={13} /></Btn>}
                  </div>
                </div>
              );
            })}
            {callbackQueue.length === 0 && <div className="p-6"><EmptyState title={t("No open tasks — the floor is clear.")} /></div>}
          </div>
        </div>
      </div>

      {/* call log */}
      <div>
        <SectionTitle right={
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative min-w-[190px]">
              <I name="search" size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
              <input value={log.q} onChange={e => log.setQ(e.target.value)}
                placeholder={t("Search number, agent, extension…")}
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                className={`${inputCls} h-8 pl-8 text-[12px]`} />
            </div>
            <Segmented
              value={desk}
              onChange={setDesk}
              options={[
                { v: "all", label: t("All desks") },
                { v: "callcenter", label: t("Call centre") },
                { v: "branch", label: t("Branch") },
              ]}
            />
            <Segmented
              value={direction}
              onChange={setDirection}
              options={[
                { v: "all", label: t("Both ways") },
                { v: "inbound", label: t("Incoming") },
                { v: "outbound", label: t("Outgoing") },
              ]}
            />
            <button onClick={() => log.setStatus("all")} className={`rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition-colors ${log.status === "all" ? "bg-gold-500 text-ink-50" : "border border-ink-600 text-ink-300"}`}>
              {t("All")} · <span className="num">{log.counts.all ?? 0}</span>
            </button>
            {RESULT_ORDER.map(r => (
              <button key={r} onClick={() => log.setStatus(log.status === r ? "all" : r)}
                className="rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition-all"
                style={log.status === r
                  ? { color: "#fffdf7", background: RESULT_COLORS[r], border: `1px solid ${RESULT_COLORS[r]}` }
                  : { color: RESULT_COLORS[r], background: `${RESULT_COLORS[r]}10`, border: `1px solid ${RESULT_COLORS[r]}35` }}>
                {t(r)} · <span className="num">{log.counts[r] ?? 0}</span>
              </button>
            ))}
            {/* Exports the filter on screen, resolved server-side — not the
                page the operator happens to be looking at. */}
            <a href={exportUrl("calls", log.query)} download
              className="flex items-center gap-1.5 rounded-lg border border-ink-600 px-2.5 py-1.5 text-[12px] font-bold text-ink-300 transition-colors hover:border-gold-500/60 hover:text-gold-300">
              <I name="download" size={13} /> CSV
            </a>
          </div>
        }>{t("Call Log")}</SectionTitle>
        <div className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-875 shadow-panel">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-700 bg-ink-850">
                  {[t("Created"), t("Direction"), t("Client"), t("Studio"), t("Agent"), t("Status"), ""].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-750">
                {log.rows.map(c => {
                  const name = c.direction === "inbound" ? c.fromName : c.toName;
                  return (
                    <tr key={c.id} className="row-live">
                      <td className="num px-4 py-3 text-[11.5px] font-semibold text-ink-400">{fmtDT(c.startTime)}</td>
                      <td className="px-4 py-3"><Pill color={c.direction === "inbound" ? "#2fbf71" : "#4c8dff"} dot={false}>{t(c.direction === "inbound" ? "Incoming" : "Outgoing")}</Pill></td>
                      <td className="px-4 py-3">
                        <button onClick={() => c.customerId && navigate({ view: "lead", id: c.customerId })} disabled={!c.customerId}
                          className={`text-left text-[13px] font-extrabold ${c.customerId ? "text-ink-100 hover:text-gold-300" : "text-ink-300"}`}>
                          {name}
                          <span className="num block text-[10.5px] font-semibold text-ink-500">{prettyPhone(c.direction === "inbound" ? c.fromNumber : c.toNumber)}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3"><Pill color="#948d7d" dot={false}>{studioById(c.locationId)?.slug ?? "—"}</Pill></td>
                      <td className="num px-4 py-3 text-[11.5px] font-semibold text-ink-300">{c.agent} · #{c.ext}</td>
                      <td className="px-4 py-3"><ResultPill r={c.result} duration={c.duration} /></td>
                      <td className="px-4 py-3 text-right">
                        {/* Three states, not two. Almost every call in the
                            log says it was recorded and has no link to the
                            audio, and offering "Listen" on those is what
                            made playback look broken. */}
                        {c.recordingAvailable
                          ? <Btn size="sm" variant="outline" onClick={() => setPlay(c)}><I name="play" size={12} /> {t("Listen")}</Btn>
                          : c.hasRecording
                            ? <span className="text-[11px] font-semibold text-ink-500" title={t("The carrier recorded this call but has not given us a link to it")}>{t("Recording not retrieved")}</span>
                            : <span className="text-[11px] font-semibold text-ink-500">{t("No recording")}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {log.error && (
            <div className="p-6"><EmptyState title={t("Could not load the call log")} hint={log.error} /></div>
          )}
          {!log.error && log.rows.length === 0 && (
            <div className="p-6">
              <EmptyState
                title={log.loading ? t("Loading…") : t("No calls match these filters")}
                hint={log.loading ? undefined : t("Try widening the date range, clearing the search, or picking another result.")}
              />
            </div>
          )}
          {log.total > 0 && (
            <Pagination total={log.total} page={log.page - 1} pageSize={log.pageSize}
              onPage={p => log.setPage(p + 1)} unit={t("Calls").toLowerCase()} />
          )}
        </div>
      </div>

      {/* Ending a live call is irreversible and lands on a customer

          mid-sentence, so it is stated plainly and confirmed rather than

          fired from a single click on a crowded board. */}

      {hangup && (

        <Modal onClose={() => !hangingUp && setHangup(null)} w={460}>

          <ModalHead

            title={t("End this call?")}

            sub={t("The customer will be disconnected immediately.")}

            onClose={() => !hangingUp && setHangup(null)}

          />

          <div className="space-y-3 p-5">

            <div className="rounded-xl border border-ink-700 bg-ink-850 p-4">

              <div className="text-[13px] font-extrabold text-ink-100">{hangup.name}</div>

              <div className="num mt-1 text-[11.5px] font-semibold text-ink-400">

                {prettyPhone(hangup.phone)} · #{hangup.ext} ·{" "}

                {t(hangup.direction === "inbound" ? "Incoming" : "Outgoing")}

              </div>

            </div>

            <p className="text-[12px] font-semibold text-ink-300">

              {t("This cannot be undone. The call ends for both sides at once.")}

            </p>

          </div>

          <div className="flex items-center justify-end gap-2 border-t border-ink-700 p-4">

            <Btn variant="outline" disabled={hangingUp} onClick={() => setHangup(null)}>{t("Cancel")}</Btn>

            <Btn

              variant="danger"

              disabled={hangingUp}

              onClick={async () => {

                setHangingUp(true);

                try {

                  const res = await fetch(`/api/crm/calls/live/${encodeURIComponent(hangup.callId)}/hangup`, {

                    method: "POST",

                    credentials: "same-origin",

                  });

                  if (res.ok) {

                    toast(t("Call ended"), "success");

                    setHangup(null);

                  } else {

                    /* Vonage's own words, not a generic failure: if it

                       refused, the operator needs to know the call is

                       still up. */

                    const b = (await res.json().catch(() => ({}))) as { message?: string; detail?: string };

                    toast(b.detail ?? b.message ?? t("Could not end the call"), "error");

                  }

                } finally {

                  setHangingUp(false);

                }

              }}

            >

              <I name="x" size={13} /> {hangingUp ? t("Ending…") : t("End the call")}

            </Btn>

          </div>

        </Modal>

      )}


      {play && <PlayerModal callId={play.id} durationHint={play.duration} result={play.result} title={play.direction === "inbound" ? play.fromName : play.toName} subtitle={`#${play.ext} · ${fmtDT(play.startTime)} · ${fmtDur(play.duration)}`} onClose={() => setPlay(null)} />}
    </div>
  );
}
