import { useCallback, useEffect, useRef, useState } from "react";
import { Btn, I, Pill } from "../ui";
import { t, tf, useI18n } from "../i18n";

/* ── Talking in the browser ────────────────────────────────────────────
 * SPIKE (spike/web-dialer).
 *
 * The other mode on this screen rings a desk phone. This one puts the call
 * in the tab: the microphone is the handset and the audio comes out of the
 * speakers.
 *
 * It is a different Vonage product to everything else here — the Voice API
 * on the developer account, not VBC — so it has its own credentials, its
 * own number and its own setup, and it can be completely unconfigured
 * while the rest of the console works perfectly. That state is the normal
 * one until someone has done the setup, so it is explained rather than
 * shown as a failure.
 * ────────────────────────────────────────────────────────────────── */

interface TokenResponse {
  configured: boolean;
  reason?: string;
  error?: string;
  token?: string;
  user?: string;
  from?: string;
  allowed?: string[];
}

type Phase = "idle" | "connecting" | "ready" | "calling" | "on-call" | "ended";

/* The SDK is browser-only and pulls in a WebRTC stack. Loaded when someone
   actually opens this mode, so the rest of the console does not carry it. */
type Client = {
  createSession(token: string): Promise<string>;
  serverCall(context?: Record<string, unknown>): Promise<string>;
  hangup(callId: string): Promise<void>;
  getPeerConnection(id: string): RTCPeerConnection | undefined;
  on(event: string, cb: (...args: unknown[]) => void): symbol;
};

const normalise = (raw: string): string | null => {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function DialerBrowser() {
  useI18n();
  const [info, setInfo] = useState<TokenResponse | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [to, setTo] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const client = useRef<Client | null>(null);
  const callId = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/crm/dialer/webrtc", { credentials: "same-origin" })
      .then(r => r.json())
      .then((d: TokenResponse) => { if (alive) setInfo(d); })
      .catch((e: Error) => alive && setFailure(e.message));
    return () => { alive = false; };
  }, []);

  /* Ticks only while a call is up, and is reset by the transition into it
     rather than by a timer of its own. */
  useEffect(() => {
    if (phase !== "on-call") return;
    const i = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(i);
  }, [phase]);

  const connect = useCallback(async () => {
    if (!info?.token) return;
    setPhase("connecting");
    setFailure(null);
    try {
      /* Asking for the microphone BEFORE opening the session, so the
         browser's permission prompt is attached to a button the person just
         pressed. Deferred until the call, it appears at the moment they are
         trying to speak. */
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const mod = await import("@vonage/client-sdk");
      const VonageClient = (mod as unknown as { default: new () => Client }).default;
      const c = new VonageClient();

      c.on("callHangup", (...args: unknown[]) => {
        const reason = args[2];
        setNote(tf("Call ended ({reason})", { reason: String(reason ?? "hangup") }));
        callId.current = null;
        setPhase("ready");
      });
      c.on("legStatusUpdate", (...args: unknown[]) => {
        const status = String(args[2] ?? "");
        setNote(status);
        if (status.toLowerCase().includes("answer")) {
          setSeconds(0);
          setPhase("on-call");
        }
      });
      c.on("callMediaError", (...args: unknown[]) => setFailure(String(args[1] ?? "media error")));

      await c.createSession(info.token);
      client.current = c;
      setPhase("ready");
      setNote(tf("Signed in as {user}", { user: info.user ?? "" }));
    } catch (e) {
      setPhase("idle");
      const msg = (e as Error).message;
      setFailure(
        /NotAllowed|Permission/i.test(msg)
          ? t("The browser refused the microphone. Allow it for this site and try again.")
          : msg,
      );
    }
  }, [info]);

  const dial = useCallback(async () => {
    const c = client.current;
    const number = normalise(to);
    if (!c || !number) return;
    setFailure(null);
    setPhase("calling");
    setNote(t("Ringing…"));
    try {
      callId.current = await c.serverCall({ to: number });
    } catch (e) {
      setPhase("ready");
      setFailure((e as Error).message);
    }
  }, [to]);

  const hangUp = useCallback(async () => {
    const c = client.current;
    if (!c || !callId.current) return;
    try {
      await c.hangup(callId.current);
    } finally {
      callId.current = null;
      setPhase("ready");
    }
  }, []);

  /* The SDK has no mute for an ordinary call, so the microphone track is
     switched off directly on the peer connection it exposes. */
  const toggleMute = useCallback(() => {
    const c = client.current;
    if (!c || !callId.current) return;
    const pc = c.getPeerConnection(callId.current);
    const senders = pc?.getSenders() ?? [];
    const next = !muted;
    for (const s of senders) if (s.track?.kind === "audio") s.track.enabled = !next;
    setMuted(next);
  }, [muted]);

  if (!info) {
    return <div className="p-8 text-center text-[12.5px] font-semibold text-ink-400">{t("Checking…")}</div>;
  }

  /* The expected state until the setup has been done once — and the setup
     is not something this screen can do for you, so it says what is missing
     instead of pretending to be broken. */
  if (!info.configured) {
    return (
      <div className="space-y-3 rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
        <div className="flex items-center gap-2">
          <I name="alert" size={16} className="text-[#e8a33d]" />
          <h3 className="text-[13.5px] font-extrabold text-ink-100">{t("Not set up yet")}</h3>
        </div>
        <p className="text-[12px] font-semibold leading-relaxed text-ink-400">{info.reason}</p>
        <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-3.5">
          <p className="mb-2 text-[11.5px] font-semibold leading-relaxed text-ink-300">
            {t("Talking in the browser uses the Vonage Voice API, which is a different product from the VBC account the rest of the console runs on — its own credentials, its own number.")}
          </p>
          <ol className="num space-y-1.5 text-[11.5px] font-semibold text-ink-400">
            <li>1. {t("Put VONAGE_API_KEY and VONAGE_API_SECRET from dashboard.vonage.com into .env.local")}</li>
            <li>2. <code className="text-gold-300">npm run tunnel</code></li>
            <li>3. <code className="text-gold-300">npm run vonage:voice:setup -- https://…ngrok-free.app</code></li>
            <li>4. {t("Add the three lines it prints, then restart the dev server")}</li>
          </ol>
        </div>
      </div>
    );
  }

  const number = normalise(to);
  const barred = Boolean(number && info.allowed?.length && !info.allowed.includes(number));
  const live = phase === "calling" || phase === "on-call";

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-2xl border border-ink-700 bg-ink-875 p-5 shadow-panel">
        <div className="flex flex-wrap items-center gap-2">
          <Pill color={phase === "on-call" ? "#2fbf71" : phase === "ready" ? "#2f6fe4" : "#948d7d"} dot={live}>
            {phase === "idle" ? t("Not connected")
              : phase === "connecting" ? t("Connecting…")
              : phase === "on-call" ? tf("On call · {t}", { t: mmss(seconds) })
              : phase === "calling" ? t("Ringing…")
              : t("Ready")}
          </Pill>
          {info.from && (
            <span className="num text-[11px] font-semibold text-ink-400">
              {tf("They will see {did}", { did: info.from })}
            </span>
          )}
        </div>

        {phase === "idle" ? (
          <>
            <p className="text-[12px] font-semibold leading-relaxed text-ink-400">
              {t("Connecting asks for your microphone. The call runs in this tab — closing it ends the call.")}
            </p>
            <Btn variant="gold" onClick={() => void connect()}>
              <I name="phone" size={14} /> {t("Connect the softphone")}
            </Btn>
          </>
        ) : (
          <>
            <div>
              <label className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-ink-500">
                {t("Number to call")}
              </label>
              <input
                value={to}
                onChange={e => setTo(e.target.value)}
                placeholder="+1 555 010 0000"
                inputMode="tel"
                disabled={live}
                className="num w-full rounded-lg border border-ink-600 bg-ink-900/70 px-3 py-2 text-[13px] font-semibold text-ink-100 outline-none transition-colors placeholder:font-medium placeholder:text-ink-500 focus:border-gold-500/70 disabled:opacity-50"
              />
              {/* The allow-list is on the server and it is what actually
                  decides. Printing it here means a barred number is obvious
                  before the call rather than after it fails. */}
              {info.allowed && info.allowed.length > 0 && (
                <p className={`num mt-1.5 text-[11px] font-semibold ${barred ? "text-ember-400" : "text-ink-500"}`}>
                  {barred
                    ? tf("{n} is not on the allow-list", { n: number ?? "" })
                    : tf("Allowed while this is an experiment: {list}", { list: info.allowed.join(", ") })}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!live ? (
                <Btn variant="gold" disabled={!number || barred} onClick={() => void dial()}>
                  <I name="phone" size={14} /> {t("Call")}
                </Btn>
              ) : (
                <>
                  <Btn variant="danger" onClick={() => void hangUp()}>
                    <I name="x" size={14} /> {t("Hang up")}
                  </Btn>
                  <Btn variant="outline" onClick={toggleMute}>
                    <I name={muted ? "eyeOff" : "chat"} size={14} /> {muted ? t("Unmute") : t("Mute")}
                  </Btn>
                </>
              )}
            </div>
          </>
        )}

        {note && <p className="num text-[11.5px] font-semibold text-ink-400">{note}</p>}
        {failure && (
          <div className="rounded-xl border border-ember-500/40 bg-ember-500/8 px-3.5 py-2.5 text-[12px] font-bold text-ember-400">
            {failure}
          </div>
        )}
      </div>
    </div>
  );
}
