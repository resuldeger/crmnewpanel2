import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { Btn, I, Pill, SearchableSelect, SectionTitle, inputCls } from "../ui";
import { t, tf, useI18n } from "../i18n";
import DialerBrowser from "./DialerBrowser";

/* ── Dialling from the browser ─────────────────────────────────────────
 * SPIKE (spike/web-dialer). A screen to find out what the Telephony API
 * really does, with the choice made in the open rather than inferred.
 *
 * "Call back" on the floor already dials, but it picks the line itself and
 * shows a toast. When it does not ring, there is nothing to look at. Here
 * the line is chosen, the number is typed, and whatever Vonage answers is
 * printed.
 * ────────────────────────────────────────────────────────────────── */

interface Line {
  extension: string;
  displayName: string;
  did: string | null;
  userType: string;
  locationId: number | null;
  studio: string | null;
}

interface Result {
  placed: boolean;
  callId: number;
  externalCallId: string | null;
  line: { extension: string; displayName: string; did: string | null };
  to: string;
  elapsedMs: number;
  vonage: { status: number; detail: string | null };
}

/** The same rule the server applies, so the preview cannot disagree with it. */
function normalise(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

const pretty = (did: string | null): string => {
  if (!did) return "—";
  const d = did.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? `+1 (${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : `+${d}`;
};

type Mode = "desk" | "browser";

export default function Dialer() {
  const { can } = useStore();
  useI18n();
  const [mode, setMode] = useState<Mode>("desk");

  if (!can("calls.manage")) {
    return (
      <div className="rounded-2xl border border-ink-700 bg-ink-875 p-8 text-center text-[13px] font-semibold text-ink-400">
        {t("This screen needs permission to manage calls.")}
      </div>
    );
  }

  return (
    <div className="max-w-[640px] space-y-4 animate-rise">
      <SectionTitle right={<Pill color="#e8a33d" dot={false}>{t("Experiment")}</Pill>}>
        {t("Web Dialer")}
      </SectionTitle>

      {/* Two genuinely different things, on two different Vonage accounts.
          A toggle rather than one screen that tries to be both, because
          where the audio comes out is the whole difference and it should be
          chosen, not discovered. */}
      <div className="flex gap-1 rounded-xl border border-ink-600 bg-ink-875 p-1">
        {([
          ["desk", t("Ring my desk phone"), "phone"],
          ["browser", t("Talk in this browser"), "chat"],
        ] as const).map(([id, label, icon]) => (
          <button key={id} onClick={() => setMode(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-extrabold transition-all duration-150 ${mode === id ? "bg-gold-500 text-ink-50" : "text-ink-400 hover:text-ink-100"}`}>
            <I name={icon} size={13} /> {label}
          </button>
        ))}
      </div>

      {mode === "browser" ? <DialerBrowser /> : <DeskMode />}
    </div>
  );
}

/* ── Ringing a desk phone ──────────────────────────────────────────────
 * The original mode. Vonage rings the chosen extension and dials the
 * customer when it is answered; no audio passes through the browser.
 * ────────────────────────────────────────────────────────────────── */
function DeskMode() {
  const { toast } = useStore();
  useI18n();
  const [lines, setLines] = useState<Line[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/crm/dialer/lines", { credentials: "same-origin" })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { lines: Line[] }) => { if (alive) setLines(d.lines); })
      .catch((e: Error) => alive && setLoadError(e.message));
    return () => { alive = false; };
  }, []);

  const normalised = useMemo(() => normalise(to), [to]);
  const line = useMemo(() => lines.find(l => l.extension === from) ?? null, [lines, from]);
  const tooShort = normalised !== null && normalised.replace(/\D/g, "").length < 10;
  const ready = Boolean(line && normalised && !tooShort);

  const dial = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setResult(null);
    setFailure(null);
    try {
      const res = await fetch("/api/crm/dialer/call", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_extension: from, to: normalised }),
      });
      const body = (await res.json()) as Result & { message?: string };
      if (res.status === 201) {
        setResult(body);
        toast(tf("Ringing extension {ext}", { ext: from }), "success");
      } else if (body.vonage) {
        setResult(body);
        toast(t("Vonage refused the call"), "error");
      } else {
        setFailure(body.message ?? `HTTP ${res.status}`);
        toast(body.message ?? t("Could not place the call"), "error");
      }
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Said once, plainly. Everyone who opens this expects the call to come
          out of their laptop; in this mode it does not, and finding that out
          by watching a desk phone ring across the room is a poor way to
          learn it. */}
      <div className="rounded-2xl border border-lapis-500/40 bg-lapis-500/6 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <I name="alert" size={15} className="mt-0.5 shrink-0 text-lapis-400" />
          <p className="text-[12px] font-semibold leading-relaxed text-ink-300">
            {t("The browser only starts the call. Vonage rings the extension you pick first — a desk phone or the VBC app — and dials the number when that is answered. No audio goes through this tab, and closing it will not end the call.")}
          </p>
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
        <div>
          <label className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-ink-500">
            {t("Call from")}
          </label>
          <SearchableSelect
            value={from}
            onChange={v => setFrom(String(v))}
            placeholder={loadError ? t("Lines could not be loaded") : t("Pick a line…")}
            searchPlaceholder={t("Search by extension, name or studio…")}
            disabled={lines.length === 0}
            options={lines.map(l => ({
              value: l.extension,
              label: `${l.extension} · ${l.displayName}`,
              sub: [pretty(l.did), l.studio ?? t("call centre")].join(" · "),
              badge: l.userType === "CALL_CENTRE" ? t("shared") : l.studio ?? undefined,
            }))}
          />
          {line && (
            <p className="num mt-1.5 text-[11px] font-semibold text-ink-400">
              {/* With from.type = extension, the line's DID is what the
                  customer sees and what they call back. */}
              {tf("They will see {did}", { did: pretty(line.did) })}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-ink-500">
            {t("Number to call")}
          </label>
          <input
            value={to}
            onChange={e => { setTo(e.target.value); setConfirming(false); }}
            placeholder="+1 555 010 0000"
            inputMode="tel"
            autoComplete="off"
            spellCheck={false}
            className={`${inputCls} num`}
          />
          {normalised && (
            <p className={`num mt-1.5 text-[11px] font-bold ${tooShort ? "text-ember-400" : "text-ink-400"}`}>
              {tooShort
                ? tf("{n} is too short to be a phone number", { n: normalised })
                : tf("Dialling {n}", { n: normalised })}
            </p>
          )}
        </div>

        {/* Two presses, because the first one costs money and rings a real
            telephone. The confirmation names both ends, so a mistyped digit
            has somewhere to be caught. */}
        {!confirming ? (
          <Btn variant="gold" disabled={!ready || busy} onClick={() => setConfirming(true)}>
            <I name="phone" size={14} /> {t("Place the call")}
          </Btn>
        ) : (
          <div className="rounded-xl border border-gold-500/40 bg-gold-500/6 p-3.5">
            <div className="text-[12.5px] font-extrabold text-ink-100">
              {tf("Ring extension {ext} and dial {n}?", { ext: from, n: normalised ?? "" })}
            </div>
            <div className="mt-0.5 text-[11.5px] font-semibold text-ink-400">
              {t("This is a real call and it is billed.")}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Btn variant="gold" disabled={busy} onClick={() => void dial()}>
                <I name="phone" size={14} /> {busy ? t("Placing…") : t("Yes, call")}
              </Btn>
              <Btn variant="outline" onClick={() => setConfirming(false)}>{t("Cancel")}</Btn>
            </div>
          </div>
        )}
      </div>

      {failure && (
        <div className="rounded-2xl border border-ember-500/40 bg-ember-500/8 px-4 py-3 text-[12.5px] font-bold text-ember-400">
          {failure}
        </div>
      )}

      {result && (
        <div className={`overflow-hidden rounded-2xl border shadow-panel ${result.placed ? "border-jade-500/40 bg-jade-500/5" : "border-ember-500/40 bg-ember-500/5"}`}>
          <div className="flex items-center gap-2.5 px-4 py-3">
            <I name={result.placed ? "check" : "alert"} size={16} className={result.placed ? "text-jade-400" : "text-ember-400"} />
            <span className="text-[13px] font-extrabold text-ink-100">
              {result.placed ? t("Vonage accepted it") : t("Vonage refused it")}
            </span>
            <span className="num ml-auto text-[11px] font-semibold text-ink-500">{result.elapsedMs}ms</span>
          </div>
          <dl className="divide-y divide-ink-750 border-t border-ink-750">
            {[
              [t("Line"), `${result.line.extension} · ${result.line.displayName}`],
              [t("Caller ID"), pretty(result.line.did)],
              [t("Dialled"), result.to],
              [t("Our call row"), `#${result.callId}`],
              [t("Vonage call id"), result.externalCallId ?? "—"],
              [t("HTTP"), String(result.vonage.status)],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-3 px-4 py-2">
                <dt className="w-32 shrink-0 text-[10.5px] font-bold uppercase tracking-wider text-ink-500">{k}</dt>
                <dd className="num min-w-0 flex-1 break-all text-[12px] font-bold text-ink-200">{v}</dd>
              </div>
            ))}
          </dl>
          {result.vonage.detail && (
            <pre className="num max-h-40 overflow-y-auto whitespace-pre-wrap break-all border-t border-ink-750 bg-ink-900/60 px-4 py-3 text-[11px] leading-relaxed text-ink-300">
              {result.vonage.detail}
            </pre>
          )}
          <div className="border-t border-ink-750 px-4 py-2.5 text-[11px] font-semibold text-ink-400">
            {t("The outcome and the recording arrive later, from the carrier — watch the call on the floor, or open it in the Call Center.")}
          </div>
        </div>
      )}
    </div>
  );
}
