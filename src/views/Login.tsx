import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Avatar, I, LiveClock } from "../ui";
import { ROLES, type Role } from "../data";
import { t, tf, useI18n } from "../i18n";

function BrandPanel() {
  const { studios } = useStore();
  const showcase = useMemo(() => studios.filter(s => s.image).slice(0, 3), [studios]);
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
            <svg width="22" height="22" viewBox="0 0 32 32"><path d="M16 4 L28 27 H4 Z" fill="none" stroke="#fba200" strokeWidth="2.6" /><circle cx="16" cy="20" r="3" fill="#fba200" /></svg>
          </div>
          <div>
            <div className="font-display text-[16px] font-extrabold tracking-[0.2em] text-[#f6f3ec]">CLEOPATRA</div>
            <div className="text-[10px] font-bold tracking-[0.32em] text-gold-400">INK · {t("CRM Console").toUpperCase()}</div>
          </div>
        </div>

        <div className="mt-14 max-w-md">
          <h1 className="font-display text-[34px] font-bold leading-tight tracking-wide text-[#f6f3ec]">
            {t("Every branch.")}<br />
            <span className="text-gold-400">{t("One console.")}</span>
          </h1>
          <p className="mt-4 text-[14px] font-medium leading-relaxed text-[#c9c2b0]">
            {t("Leads, bookings, calls and SMS across all locations — routed, tracked and reported in real time.")}
          </p>
        </div>

        {/* live branch clocks */}
        <div className="mt-10 grid grid-cols-3 gap-3">
          {showcase.map(s => (
            <div key={s.id} className="rounded-xl border border-[#3b372f] bg-[#241f16]/80 p-3.5 backdrop-blur">
              <div className="flex items-center gap-1.5 text-[11px] font-extrabold text-[#e7e2d6]">
                <I name="pin" size={12} className="text-gold-400" />{s.city}
              </div>
              <div className="num mt-1.5 text-[15px] font-bold text-gold-300"><LiveClock tz={s.config.ianaTimezone} /></div>
              <div className="mt-1 flex items-end gap-[3px]">
                <span className="eq-bar h-3 w-[3px] rounded bg-gold-500/70" />
                <span className="eq-bar h-4 w-[3px] rounded bg-gold-500/50" />
                <span className="eq-bar h-2.5 w-[3px] rounded bg-gold-500/60" />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-auto flex items-center gap-5 pt-10 text-[11px] font-semibold text-[#77715f]">
          <span className="flex items-center gap-1.5"><I name="phone" size={13} className="text-gold-400" />{t("Vonage VBC")}</span>
          <span className="flex items-center gap-1.5"><I name="chat" size={13} className="text-gold-400" />{t("Twilio SMS")}</span>
          <span className="flex items-center gap-1.5"><I name="calendar" size={13} className="text-gold-400" />{t("Timely Booking")}</span>
        </div>
      </div>
    </div>
  );
}

function RoleCard({ role, selected, onSelect }: {
  role: Role; selected: boolean; onSelect: () => void;
}) {
  return (
    <button onClick={onSelect}
      className={`group relative flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all duration-150 active:scale-[0.98] ${selected
        ? "border-transparent bg-ink-850 shadow-[0_0_0_1.5px_var(--ring),0_8px_24px_-12px_rgba(25,21,16,0.25)]"
        : "border-ink-700 bg-ink-875 hover:border-ink-600 hover:bg-ink-850"}`}
      style={{ ["--ring" as string]: role.color }}>
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border" style={{ borderColor: `${role.color}55`, background: `${role.color}12`, color: role.color }}>
        <I name="shield" size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-ink-100">
          {role.name}
          {selected && <I name="check" size={12} className="text-gold-400" />}
        </span>
        <span className="mt-0.5 block truncate text-[10.5px] font-semibold text-ink-400">{role.desc}</span>
      </span>
    </button>
  );
}

export default function Login() {
  const { login, authError, toast } = useStore();
  useI18n();
  const [roleId, setRoleId] = useState("super_admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  /* The cards describe what each role can do. They used to pick a demo
     account out of the fixtures and fill its address into the email box,
     which meant anyone who opened the sign-in page could click through the
     roles and collect real staff addresses — the first half of a
     credential-stuffing attempt, handed over before signing in.
     They select nothing now; the person types their own address. */
  const pickRole = (rid: string) => {
    setRoleId(roleId === rid ? "" : rid);
    setError("");
  };

  const submit = async () => {
    if (busy) return;
    const trimmed = email.trim();
    if (!trimmed || !password) {
      setError(t("Enter your email and password."));
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
      setError(authError ?? t("Email or password is incorrect."));
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
        <div key={shake} className={`relative z-10 w-full max-w-[440px] ${shake > 0 ? "animate-[shake_0.4s_ease]" : ""}`}>
          <style>{`@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(7px)}60%{transform:translateX(-5px)}80%{transform:translateX(4px)}}`}</style>

          <div className="lg:hidden mb-8 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-gold-500/50 bg-ink-50">
              <svg width="20" height="20" viewBox="0 0 32 32"><path d="M16 4 L28 27 H4 Z" fill="none" stroke="#fba200" strokeWidth="2.6" /><circle cx="16" cy="20" r="3" fill="#fba200" /></svg>
            </div>
            <div>
              <div className="font-display text-[15px] font-extrabold tracking-[0.18em] text-ink-50">CLEOPATRA</div>
              <div className="text-[10px] font-bold tracking-[0.3em] text-gold-500">INK · {t("CRM Console").toUpperCase()}</div>
            </div>
          </div>

          <h2 className="font-display text-[24px] font-bold tracking-wide text-ink-50">{t("Sign in to the console")}</h2>
          <p className="mt-1.5 text-[13px] font-semibold text-ink-400">{t("Pick a role to preview the console with its exact permissions and branch scope.")}</p>

          <div className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {ROLES.map(r => <RoleCard key={r.id} role={r} selected={roleId === r.id} onSelect={() => pickRole(r.id)} />)}
          </div>

          <div className="mt-6 space-y-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-ink-500">{t("Email")}</label>
              <div className="flex items-center gap-2.5 rounded-xl border border-ink-600 bg-ink-875 px-3.5 py-2.5 transition-colors focus-within:border-gold-500/60">
                <I name="mail" size={15} className="text-ink-400" />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@cleopatraink.com"
                  autoComplete="email" autoCapitalize="none" spellCheck={false}
                  className="w-full bg-transparent text-[13.5px] font-semibold text-ink-100 outline-none placeholder:font-medium placeholder:text-ink-500" />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-ink-500">{t("Password")}</label>
              <div className="flex items-center gap-2.5 rounded-xl border border-ink-600 bg-ink-875 px-3.5 py-2.5 transition-colors focus-within:border-gold-500/60">
                <I name="lock" size={15} className="text-ink-400" />
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
                  autoComplete="current-password"
                  onKeyDown={e => { if (e.key === "Enter") void submit(); }}
                  className="w-full bg-transparent text-[13.5px] font-semibold text-ink-100 outline-none placeholder:font-medium placeholder:text-ink-500" />
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-ember-500/40 bg-ember-500/8 px-3.5 py-2.5 text-[12.5px] font-bold text-ember-400 animate-pop">
              <I name="alert" size={14} />{error}
            </div>
          )}

          <button onClick={() => void submit()} disabled={busy}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gold-500 py-3 text-[14px] font-extrabold text-ink-50 shadow-[0_8px_28px_-8px_rgba(251,162,0,0.7)] transition-all duration-150 hover:bg-gold-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60">
            <I name="logOut" size={16} className="rotate-180" />
            {busy ? t("Signing in…") : t("Sign in")}
          </button>

          <p className="mt-4 text-center text-[11px] font-semibold text-ink-500">
            {t("Accounts are issued by your administrator.")}
          </p>
        </div>
      </div>
    </div>
  );
}
