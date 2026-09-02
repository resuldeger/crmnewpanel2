import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CALL_STATUS_META, APPT_STATUS_META, PLATFORM_META, RESULT_META,
  initials, hueFor, fmtDur, fmtDT, type CallStatus, type ApptStatus, type Platform, type CallLog, type CallResult,
} from "../data/crm";

/* ─── Icon set (hand-drawn stroke SVGs) ─────────────────────────────────── */
const PATHS: Record<string, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7.5" height="9" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5"/><rect x="13.5" y="12" width="7.5" height="9" rx="1.5"/><rect x="3" y="15.5" width="7.5" height="5.5" rx="1.5"/></>,
  leads: <><circle cx="9" cy="8" r="3.4"/><path d="M2.8 20c.7-3.6 3.2-5.6 6.2-5.6s5.5 2 6.2 5.6"/><circle cx="17.3" cy="9.4" r="2.5"/><path d="M15.7 14.9c2.7.2 4.8 1.9 5.5 4.6"/></>,
  calendar: <><rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></>,
  chat: <><path d="M4 5.5h16v11H10l-4.5 4v-4H4z" strokeLinejoin="round"/><path d="M8 9.5h8M8 12.5h5"/></>,
  phone: <path d="M5.5 4h3l1.6 4.2-2.1 1.6a12.8 12.8 0 0 0 6.2 6.2l1.6-2.1L20 15.5v3a1.8 1.8 0 0 1-2 1.8C10.3 19.6 4.4 13.7 3.7 6a1.8 1.8 0 0 1 1.8-2z" strokeLinejoin="round"/>,
  chart: <><path d="M4 4v16h16"/><path d="M8 15l3.5-4.5 2.8 2.4L19 7.5"/><circle cx="19" cy="7.5" r="1.1" fill="currentColor" stroke="none"/></>,
  building: <><path d="M4 21V5.5L12 3l8 2.5V21"/><path d="M2.5 21h19M9 8.5h1.5M9 12h1.5M9 15.5h1.5M13.5 8.5H15M13.5 12H15M13.5 15.5H15M10.5 21v-3h3v3"/></>,
  artist: <><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 1.6-2-.5-1.4.2-2.5 1.9-2.5H17a4 4 0 0 0 4-4c0-5.2-4-9.5-9-9.5z"/><circle cx="8" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="10" r="1" fill="currentColor" stroke="none"/></>,
  gear: <><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8l1.2 2.4 2.6-.6 1 2.4 2.6.6-.6 2.6 2 1.8-2 1.8.6 2.6-2.6.6-1 2.4-2.6-.6L12 21.2l-1.2-2.4-2.6.6-1-2.4-2.6-.6.6-2.6-2-1.8 2-1.8-.6-2.6 2.6-.6 1-2.4 2.6.6z" strokeLinejoin="round"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></>,
  chevD: <path d="M6 9.5l6 6 6-6"/>,
  chevL: <path d="M14.5 6l-6 6 6 6"/>,
  chevR: <path d="M9.5 6l6 6-6 6"/>,
  x: <path d="M6 6l12 12M18 6L6 18"/>,
  check: <path d="M4.5 12.5l5 5L19.5 7"/>,
  checks: <><path d="M2.5 13l4 4L14 9.5"/><path d="M10.5 13.5l3.5 3.5L21.5 9.5"/></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 3h9A1.5 1.5 0 0 1 14.5 4.5V5"/></>,
  download: <><path d="M12 3v11M7.5 10L12 14.5 16.5 10"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17"/></>,
  play: <path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor" stroke="none"/>,
  pause: <><rect x="7" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.6" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none"/></>,
  note: <><path d="M5 4h11l3 3v13H5z" strokeLinejoin="round"/><path d="M16 4v3h3M8.5 11h7M8.5 14.5h7M8.5 18h4"/></>,
  convert: <><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12h7M12.5 9l3 3-3 3"/></>,
  filter: <path d="M4 5h16l-6.2 7.4V19l-3.6 1.8v-8.4z" strokeLinejoin="round"/>,
  clock: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/></>,
  globe: <><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.4 3.8 5.3 3.8 8.5s-1.3 6.1-3.8 8.5c-2.5-2.4-3.8-5.3-3.8-8.5s1.3-6.1 3.8-8.5z"/></>,
  mail: <><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 17.5l5-4.5 3.5 3 3-2.5 3.5 3"/></>,
  send: <path d="M20.5 3.5L3 10.8l6.5 2.7L12 20z M20.5 3.5L9.5 13.5" strokeLinejoin="round"/>,
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9z" strokeLinejoin="round"/>,
  external: <><path d="M9 5H5.5A1.5 1.5 0 0 0 4 6.5v12A1.5 1.5 0 0 0 5.5 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/><path d="M13 4h7v7M20 4l-9 9"/></>,
  upload: <><path d="M12 14V3M7.5 7L12 2.5 16.5 7"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17"/></>,
  alert: <><path d="M12 3.5L2.8 19.5h18.4z" strokeLinejoin="round"/><path d="M12 9.5v4.5M12 16.8v.4"/></>,
  spark: <path d="M12 2.5l2 6.5 6.5 2-6.5 2-2 6.5-2-6.5L3.5 11l6.5-2z" strokeLinejoin="round"/>,
  wave: <path d="M3 12h1.5M7 8v8M10.5 5v14M14 8.5v7M17.5 6.5v11M21 10.5v3" strokeLinecap="round"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></>,
  eyeOff: <><path d="M4 4l16 16M9.9 5.9A9.4 9.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.6 17.6 0 0 1-3 3.8M6.2 7.4A16.8 16.8 0 0 0 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></>,
  pin: <><path d="M12 21s-6.5-5.5-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.5 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.3"/></>,
  bolt: <path d="M13 2.5L4.5 13.5H11L10 21.5l8.5-11H12z" strokeLinejoin="round"/>,
  layers: <><path d="M12 3l9 4.5-9 4.5-9-4.5z" strokeLinejoin="round"/><path d="M3.5 12.5L12 16.7l8.5-4.2M3.5 16.5L12 20.7l8.5-4.2"/></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 3v4h-4"/></>,
  dot: <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>,
  menu: <path d="M4 6.5h16M4 12h16M4 17.5h10"/>,
};
export type IconName = keyof typeof PATHS;
export function I({ name, size = 16, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" className={`shrink-0 ${className}`} aria-hidden>
      {PATHS[name]}
    </svg>
  );
}

/* ─── Pills & badges ────────────────────────────────────────────────────── */
export function Pill({ color, children, dot = true, className = "" }: { color: string; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-[3px] text-[11px] font-bold tracking-wide whitespace-nowrap transition-colors ${className}`}
      style={{ color, background: `${color}17`, border: `1px solid ${color}3d` }}>
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      {children}
    </span>
  );
}
export const CallStatusPill = ({ s, className = "" }: { s: CallStatus; className?: string }) =>
  <Pill color={CALL_STATUS_META[s].color} className={className}>{CALL_STATUS_META[s].label}</Pill>;
export const ApptStatusPill = ({ s }: { s: ApptStatus }) =>
  <Pill color={APPT_STATUS_META[s].color}>{APPT_STATUS_META[s].label}</Pill>;
export const PlatformPill = ({ p }: { p: Platform }) =>
  <Pill color={PLATFORM_META[p].color}>{PLATFORM_META[p].label}</Pill>;
export const ResultPill = ({ r, duration }: { r: CallResult; duration?: number }) => (
  <Pill color={RESULT_META[r].color}>
    {r}{duration !== undefined && <span className="num font-medium opacity-80">· {fmtDur(duration)}</span>}
  </Pill>
);

export function Avatar({ name, size = 34, ring = false }: { name: string; size?: number; ring?: boolean }) {
  const hue = hueFor(name);
  return (
    <div className={`grid place-items-center rounded-full font-bold select-none ${ring ? "ring-2 ring-gold-500/60 ring-offset-2 ring-offset-ink-875" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.36, color: `hsl(${hue} 62% 74%)`, background: `linear-gradient(140deg, hsl(${hue} 32% 24%), hsl(${hue} 42% 13%))`, border: `1px solid hsl(${hue} 40% 34% / 0.6)` }}>
      {initials(name)}
    </div>
  );
}

/* ─── Buttons ───────────────────────────────────────────────────────────── */
export function Btn({ children, onClick, variant = "ghost", size = "md", className = "", title, disabled }: {
  children: ReactNode; onClick?: () => void; variant?: "gold" | "ghost" | "outline" | "danger";
  size?: "sm" | "md"; className?: string; title?: string; disabled?: boolean;
}) {
  const base = "inline-flex items-center justify-center gap-1.5 font-bold rounded-lg transition-all duration-150 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none";
  const sizes = { sm: "px-2.5 py-1.5 text-[12px]", md: "px-3.5 py-2 text-[13px]" };
  const variants = {
    gold: "bg-gold-500 text-ink-deep hover:bg-gold-400 shadow-[0_4px_18px_-6px_rgba(251,162,0,0.5)]",
    ghost: "text-ink-200 hover:text-gold-300 hover:bg-ink-750",
    outline: "border border-ink-600 text-ink-200 hover:border-gold-500/60 hover:text-gold-300 hover:bg-gold-500/5",
    danger: "border border-ember-500/40 text-ember-400 hover:bg-ember-500/10",
  };
  return <button title={title} disabled={disabled} onClick={onClick} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>{children}</button>;
}

/* ─── Dropdown (generic popover) ────────────────────────────────────────── */
export function Dropdown({ trigger, children, align = "left", width = 224 }: {
  trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <div onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}>{trigger(open)}</div>
      {open && (
        <div className={`absolute z-40 mt-1.5 overflow-hidden rounded-xl border border-ink-600 bg-ink-800 shadow-pop animate-pop ${align === "right" ? "right-0" : "left-0"}`}
          style={{ width }} onClick={e => e.stopPropagation()}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
export const MenuItem = ({ onClick, children, active = false }: { onClick?: () => void; children: ReactNode; active?: boolean }) => (
  <button onClick={onClick}
    className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] font-semibold transition-colors ${active ? "text-gold-300 bg-gold-500/10" : "text-ink-200 hover:bg-ink-750 hover:text-ink-50"}`}>
    {children}
  </button>
);

/* ─── Modal & Drawer ────────────────────────────────────────────────────── */
export function Modal({ onClose, children, w = 620 }: { onClose: () => void; children: ReactNode; w?: number }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4 animate-fade" style={{ background: "rgba(38,28,10,0.52)", backdropFilter: "blur(4px)" }} onMouseDown={onClose}>
      <div className="max-h-[88vh] w-full overflow-y-auto rounded-2xl border border-ink-600 bg-ink-850 shadow-pop animate-pop"
        style={{ maxWidth: w }} onMouseDown={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
export function ModalHead({ title, sub, onClose }: { title: ReactNode; sub?: ReactNode; onClose: () => void }) {
  return (
    <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-ink-700 bg-ink-850/95 px-5 py-4 backdrop-blur">
      <div>
        <h3 className="font-display text-[17px] font-bold tracking-wide text-ink-50">{title}</h3>
        {sub && <div className="mt-0.5 text-[12px] text-ink-300">{sub}</div>}
      </div>
      <button onClick={onClose} className="rounded-lg p-1.5 text-ink-300 transition-colors hover:bg-ink-700 hover:text-ink-50"><I name="x" size={17} /></button>
    </div>
  );
}
export function Drawer({ onClose, children, w = 440 }: { onClose: () => void; children: ReactNode; w?: number }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] animate-fade" style={{ background: "rgba(38,28,10,0.42)" }} onMouseDown={onClose}>
      <div className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-ink-600 bg-ink-875 shadow-pop animate-drawer" style={{ maxWidth: w }} onMouseDown={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/* ─── Sparkline & bars ──────────────────────────────────────────────────── */
export function Sparkline({ values, color = "#d4af37", h = 34, w = 110 }: { values: number[]; color?: string; h?: number; w?: number }) {
  const max = Math.max(...values), min = Math.min(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 4 - ((v - min) / (max - min || 1)) * (h - 8)}`).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={color} opacity="0.09" />
    </svg>
  );
}

/* ─── Count-up hook ─────────────────────────────────────────────────────── */
export function useCountUp(target: number, ms = 750) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/* ─── Live timezone clock ───────────────────────────────────────────────── */
export function LiveClock({ tz, className = "" }: { tz: string; className?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className={`num ${className}`}>{now.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>;
}

/* ─── Fake waveform audio player ────────────────────────────────────────── */
export function usePlayer(duration: number) {
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setPos(p => {
        const n = p + 0.25 * speed;
        if (n >= duration) { setPlaying(false); return duration; }
        return n;
      });
    }, 250);
    return () => clearInterval(t);
  }, [playing, speed, duration]);
  return { playing, setPlaying, pos, setPos, speed, setSpeed };
}
const waveHeights = (seed: number, n = 52) => {
  let a = seed; const out: number[] = [];
  for (let i = 0; i < n; i++) {
    a = (a * 9301 + 49297) % 233280;
    out.push(0.18 + (a / 233280) * 0.82);
  }
  return out;
};
export function PlayerModal({ call, title, onClose }: { call: CallLog; title: string; onClose: () => void }) {
  const dur = Math.max(call.duration, 1);
  const { playing, setPlaying, pos, setPos, speed, setSpeed } = usePlayer(dur);
  const bars = useRef(waveHeights(call.id * 7 + 13)).current;
  const pct = pos / dur;
  return (
    <Modal onClose={onClose} w={560}>
      <ModalHead title="Call Recording" sub={title} onClose={onClose} />
      <div className="px-6 py-6">
        <div className="mb-2 flex items-center justify-between text-[12px] text-ink-300">
          <span className="flex items-center gap-2">
            <span className={`grid h-8 w-8 place-items-center rounded-full ${playing ? "bg-gold-500 text-ink-950" : "bg-ink-700 text-gold-400"}`}>
              {playing && <span className="flex h-3 items-end gap-[2px]"><span className="eq-bar w-[3px] rounded-sm bg-ink-950" /><span className="eq-bar w-[3px] rounded-sm bg-ink-950" /><span className="eq-bar w-[3px] rounded-sm bg-ink-950" /></span>}
            </span>
            <span className="font-semibold text-ink-200">Vonage VBC · on-demand stream</span>
          </span>
          <span className="num text-gold-300">{fmtDur(Math.floor(pos))} / {fmtDur(call.duration)}</span>
        </div>
        <div className="flex h-20 cursor-pointer items-center gap-[2.5px] rounded-xl border border-ink-700 bg-ink-900 px-4"
          onClick={e => {
            const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            setPos(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur);
          }}>
          {bars.map((bh, i) => {
            const played = i / bars.length <= pct;
            return <div key={i} className="flex-1 rounded-full transition-colors duration-150" style={{ height: `${bh * 100}%`, background: played ? "#d4af37" : "#2d2d3b" }} />;
          })}
        </div>
        <div className="mt-5 flex items-center justify-between">
          <button onClick={() => { if (pos >= dur) setPos(0); setPlaying(p => !p); }}
            className="grid h-12 w-12 place-items-center rounded-full bg-gold-500 text-ink-950 shadow-[0_6px_24px_-6px_rgba(212,175,55,0.7)] transition-transform hover:scale-105 active:scale-95">
            <I name={playing ? "pause" : "play"} size={20} />
          </button>
          <div className="flex items-center gap-2">
            {[1, 1.5, 2].map(s => (
              <button key={s} onClick={() => setSpeed(s)}
                className={`num rounded-lg px-2.5 py-1.5 text-[12px] font-bold transition-colors ${speed === s ? "bg-gold-500/15 text-gold-300 border border-gold-500/40" : "text-ink-300 border border-ink-600 hover:text-ink-100"}`}>
                {s}×
              </button>
            ))}
            <button className="ml-2 grid h-9 w-9 place-items-center rounded-lg border border-ink-600 text-ink-300 transition-colors hover:border-gold-500/50 hover:text-gold-300" title="Restart">
              <I name="refresh" size={15} />
            </button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-ink-700 pt-4 text-[12px]">
          <div><div className="text-ink-400">Direction</div><div className="mt-0.5 font-bold capitalize text-ink-100">{call.direction}</div></div>
          <div><div className="text-ink-400">Result</div><div className="mt-0.5"><ResultPill r={call.result} /></div></div>
          <div><div className="text-ink-400">Started (UTC)</div><div className="num mt-0.5 font-semibold text-ink-100">{fmtDT(call.startTime)}</div></div>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Misc ──────────────────────────────────────────────────────────────── */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-[19px] font-bold tracking-wide text-ink-50">{children}</h2>
        <span className="title-rule" />
      </div>
      {right}
    </div>
  );
}
export function EmptyState({ icon = "search", title, hint }: { icon?: IconName; title: string; hint?: string }) {
  return (
    <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-ink-600 bg-ink-900/50 px-6 py-14 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full border border-ink-600 bg-ink-800 text-ink-400"><I name={icon} size={19} /></span>
      <div className="text-[14px] font-bold text-ink-200">{title}</div>
      {hint && <div className="max-w-sm text-[12px] text-ink-400">{hint}</div>}
    </div>
  );
}
export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button onClick={onChange} disabled={disabled} role="switch" aria-checked={on}
      className={`relative h-[22px] w-[40px] rounded-full border transition-colors duration-200 ${on ? "border-gold-500/60 bg-gold-500/90" : "border-ink-600 bg-ink-700"} disabled:opacity-40`}>
      <span className={`absolute top-[2px] h-4 w-4 rounded-full transition-all duration-200 ${on ? "left-[19px] bg-ink-950" : "left-[3px] bg-ink-300"}`} />
    </button>
  );
}
export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-ink-400">{label}</div>
    {children}
  </div>
);
export const inputCls = "w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-[13px] font-semibold text-ink-100 placeholder:font-medium placeholder:text-ink-500 outline-none transition-colors focus:border-gold-500/70 focus:bg-ink-875";
