import { useState } from "react";
import { useStore } from "../store";
import { I, LangSwitch } from "../ui";
import { t, useI18n } from "../i18n";

/* ── Signing in ────────────────────────────────────────────────────────
 * This screen carried a grid of role cards and the line "pick a role to
 * preview the console with its exact permissions and branch scope". Both
 * were left over from the demo. The cards had already been stripped of the
 * thing that made them work — they used to fill in a real staff member's
 * email address, which handed anyone who opened the page half a
 * credential-stuffing attempt — and what remained selected nothing, sent
 * nothing and changed nothing. A person reasonably read them as "choose how
 * you are signing in", clicked one, and learned it made no difference.
 *
 * The role comes from the account. It always did.
 *
 * The brand panel also drew three live branch clocks from the studio list,
 * which is fetched by the bootstrap call — behind authentication. On this
 * screen that list is always empty, so it was three blank tiles.
 * ────────────────────────────────────────────────────────────────── */

function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <path d="M16 4 L28 27 H4 Z" fill="none" stroke="#fba200" strokeWidth="2.6" />
      <circle cx="16" cy="20" r="3" fill="#fba200" />
    </svg>
  );
}

function BrandPanel() {
  useI18n();
  return (
    <div className="relative hidden overflow-hidden bg-ink-deep lg:flex lg:flex-col">
      {/* ambient gold wash */}
      <div className="pointer-events-none absolute inset-0" style={{
        background: "radial-gradient(900px 500px at 20% -10%, rgba(251,162,0,0.16), transparent 60%), radial-gradient(700px 500px at 110% 110%, rgba(212,175,55,0.10), transparent 60%)",
      }} />
      <div className="ambient-grain pointer-events-none absolute inset-0" />
      <div className="relative z-10 flex flex-1 flex-col p-10">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl border border-gold-500/50 bg-ink-50 shadow-[0_0_28px_-6px_rgba(251,162,0,0.7)]">
            <Mark />
          </div>
          <div>
            <div className="font-display text-[16px] font-extrabold tracking-[0.2em] text-[#f6f3ec]">CLEOPATRA</div>
            <div className="text-[10px] font-bold tracking-[0.32em] text-gold-400">INK · {t("CRM Console").toUpperCase()}</div>
          </div>
        </div>

        <div className="mt-auto max-w-md pt-16">
          <h1 className="font-display text-[34px] font-bold leading-tight tracking-wide text-[#f6f3ec]">
            {t("Every branch.")}<br />
            <span className="text-gold-400">{t("One console.")}</span>
          </h1>
          <p className="mt-4 text-[14px] font-medium leading-relaxed text-[#c9c2b0]">
            {t("Leads, bookings, calls and SMS across all locations — routed, tracked and reported in real time.")}
          </p>
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 pt-10 text-[11px] font-semibold text-[#77715f]">
          <span className="flex items-center gap-1.5"><I name="phone" size={13} className="text-gold-400" />{t("Vonage VBC")}</span>
          <span className="flex items-center gap-1.5"><I name="chat" size={13} className="text-gold-400" />{t("Twilio SMS")}</span>
          <span className="flex items-center gap-1.5"><I name="calendar" size={13} className="text-gold-400" />{t("Timely Booking")}</span>
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  const { login, authError, toast } = useStore();
  useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  /* The KEY, not the translated sentence. Translating at the moment the
     error happens freezes it: switch the language afterwards and the whole
     screen turns over except the one line the person is stuck on. t() hands
     back anything it has no translation for, so a message from the server
     passes through unchanged. */
  const submit = async () => {
    if (busy) return;
    const trimmed = email.trim();
    if (!trimmed || !password) {
      setError("Enter your email and password.");
      setShake(x => x + 1);
      return;
    }
    setBusy(true);
    setError("");
    // The server decides. It answers with one message for a bad email and a
    // bad password alike, so this screen cannot be used to discover accounts.
    const ok = await login(trimmed, password);
    setBusy(false);
    if (!ok) {
      setPassword("");
      setError(authError ?? "Email or password is incorrect.");
      setShake(x => x + 1);
      return;
    }
    toast(t("Signed in"), "success");
  };

  return (
    <div className="ambient-bg ambient-lines grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />
      <div className="relative flex items-center justify-center px-5 py-10">
        <div className="ambient-grain pointer-events-none absolute inset-0" />

        {/* Above the form, and on the sign-in screen rather than only inside
            the console: someone who cannot read this form cannot get past it
            to find the switch on the other side. */}
        <div className="absolute right-5 top-5 z-20">
          <LangSwitch />
        </div>

        <div key={shake} className={`relative z-10 w-full max-w-[400px] ${shake > 0 ? "animate-[shake_0.4s_ease]" : ""}`}>
          <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(7px)}60%{transform:translateX(-5px)}80%{transform:translateX(4px)}}`}</style>

          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-gold-500/50 bg-ink-50">
              <Mark size={20} />
            </div>
            <div>
              <div className="font-display text-[15px] font-extrabold tracking-[0.18em] text-ink-50">CLEOPATRA</div>
              <div className="text-[10px] font-bold tracking-[0.3em] text-gold-500">INK · {t("CRM Console").toUpperCase()}</div>
            </div>
          </div>

          <h2 className="font-display text-[24px] font-bold tracking-wide text-ink-50">{t("Sign in to the console")}</h2>
          <p className="mt-1.5 text-[13px] font-semibold text-ink-400">
            {t("Your studios and permissions come from your account.")}
          </p>

          {/* A real form, so a password manager offers to fill it and Enter
              submits it without a keydown handler of our own. */}
          <form
            className="mt-7 space-y-3"
            onSubmit={e => { e.preventDefault(); void submit(); }}
          >
            <div>
              <label htmlFor="login-email" className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-ink-500">{t("Email")}</label>
              <div className="flex items-center gap-2.5 rounded-xl border border-ink-600 bg-ink-875 px-3.5 py-2.5 transition-colors focus-within:border-gold-500/60">
                <I name="mail" size={15} className="text-ink-400" />
                <input id="login-email" name="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="name@cleopatraink.com" autoComplete="username" autoCapitalize="none" spellCheck={false}
                  autoFocus
                  className="w-full bg-transparent text-[13.5px] font-semibold text-ink-100 outline-none placeholder:font-medium placeholder:text-ink-500" />
              </div>
            </div>
            <div>
              <label htmlFor="login-password" className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-ink-500">{t("Password")}</label>
              <div className="flex items-center gap-2.5 rounded-xl border border-ink-600 bg-ink-875 px-3.5 py-2.5 transition-colors focus-within:border-gold-500/60">
                <I name="lock" size={15} className="text-ink-400" />
                <input id="login-password" name="password" type={reveal ? "text" : "password"} value={password}
                  onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password"
                  className="w-full bg-transparent text-[13.5px] font-semibold text-ink-100 outline-none placeholder:font-medium placeholder:text-ink-500" />
                {/* Typing a long password blind into a console you cannot see
                    is how the third attempt locks the account. */}
                <button type="button" onClick={() => setReveal(r => !r)}
                  aria-label={reveal ? t("Hide password") : t("Show password")}
                  className="shrink-0 rounded-md p-1 text-ink-400 transition-colors hover:text-gold-300">
                  <I name={reveal ? "eyeOff" : "eye"} size={15} />
                </button>
              </div>
            </div>

            {error && (
              <div role="alert" className="flex items-center gap-2 rounded-xl border border-ember-500/40 bg-ember-500/8 px-3.5 py-2.5 text-[12.5px] font-bold text-ember-400 animate-pop">
                <I name="alert" size={14} />{t(error)}
              </div>
            )}

            <button type="submit" disabled={busy}
              className="!mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gold-500 py-3 text-[14px] font-extrabold text-ink-50 shadow-[0_8px_28px_-8px_rgba(251,162,0,0.7)] transition-all duration-150 hover:bg-gold-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">
              <I name="logOut" size={16} className="rotate-180" />
              {busy ? t("Signing in…") : t("Sign in")}
            </button>
          </form>

          <p className="mt-4 text-center text-[11px] font-semibold text-ink-500">
            {t("Accounts are issued by your administrator.")}
          </p>
        </div>
      </div>
    </div>
  );
}
