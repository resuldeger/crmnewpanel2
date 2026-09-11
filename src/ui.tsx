"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  CALL_STATUS_META, APPT_STATUS_META, PLATFORM_META, RESULT_META,
  initials, hueFor, fmtDur, type CallStatus, type ApptStatus, type Platform, type CallResult,
} from "./data";
import { t, useI18n } from "./i18n";

/* ─── Icon set (hand-drawn stroke SVGs) ─────────────────────────────────── */
const PATHS: Record<string, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7.5" height="9" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5" /><rect x="13.5" y="12" width="7.5" height="9" rx="1.5" /><rect x="3" y="15.5" width="7.5" height="5.5" rx="1.5" /></>,
  users: <><circle cx="9" cy="7" r="3.5" /><path d="M2.5 19c.6-3.2 2.8-5 6.5-5s5.9 1.8 6.5 5" /><circle cx="17" cy="8.5" r="2.8" /><path d="M15.5 14c2.5.3 4.2 1.8 4.8 4.3" /></>,
  leads: <><circle cx="9" cy="8" r="3.4" /><path d="M2.8 20c.7-3.6 3.2-5.6 6.2-5.6s5.5 2 6.2 5.6" /><circle cx="17.3" cy="9.4" r="2.5" /><path d="M15.7 14.9c2.7.2 4.8 1.9 5.5 4.6" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  chat: <><path d="M4 5.5h16v11H10l-4.5 4v-4H4z" strokeLinejoin="round" /><path d="M8 9.5h8M8 12.5h5" /></>,
  phone: <path d="M5.5 4h3l1.6 4.2-2.1 1.6a12.8 12.8 0 0 0 6.2 6.2l1.6-2.1L20 15.5v3a1.8 1.8 0 0 1-2 1.8C10.3 19.6 4.4 13.7 3.7 6a1.8 1.8 0 0 1 1.8-2z" strokeLinejoin="round" />,
  chart: <><path d="M4 4v16h16" /><path d="M8 15l3.5-4.5 2.8 2.4L19 7.5" /><circle cx="19" cy="7.5" r="1.1" fill="currentColor" stroke="none" /></>,
  building: <><path d="M4 21V5.5L12 3l8 2.5V21" /><path d="M2.5 21h19M9 8.5h1.5M9 12h1.5M9 15.5h1.5M13.5 8.5H15M13.5 12H15M13.5 15.5H15M10.5 21v-3h3v3" /></>,
  artist: <><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 1.6-2-.5-1.4.2-2.5 1.9-2.5H17a4 4 0 0 0 4-4c0-5.2-4-9.5-9-9.5z" /><circle cx="8" cy="10" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" /><circle cx="16" cy="10" r="1" fill="currentColor" stroke="none" /></>,
  gear: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8l1.2 2.4 2.6-.6 1 2.4 2.6.6-.6 2.6 2 1.8-2 1.8.6 2.6-2.6.6-1 2.4-2.6-.6L12 21.2l-1.2-2.4-2.6.6-1-2.4-2.6-.6.6-2.6-2-1.8 2-1.8-.6-2.6 2.6-.6 1-2.4 2.6.6z" strokeLinejoin="round" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21" /></>,
  chevD: <path d="M6 9.5l6 6 6-6" />,
  chevL: <path d="M14.5 6l-6 6 6 6" />,
  chevR: <path d="M9.5 6l6 6-6 6" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M4.5 12.5l5 5L19.5 7" />,
  checks: <><path d="M2.5 13l4 4L14 9.5" /><path d="M10.5 13.5l3.5 3.5L21.5 9.5" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 3h9A1.5 1.5 0 0 1 14.5 4.5V5" /></>,
  download: <><path d="M12 3v11M7.5 10L12 14.5 16.5 10" /><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" /></>,
  play: <path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor" stroke="none" />,
  pause: <><rect x="7" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="13.6" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none" /></>,
  note: <><path d="M5 4h11l3 3v13H5z" strokeLinejoin="round" /><path d="M16 4v3h3M8.5 11h7M8.5 14.5h7M8.5 18h4" /></>,
  convert: <><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12h7M12.5 9l3 3-3 3" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.2 2" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.4 3.8 5.3 3.8 8.5s-1.3 6.1-3.8 8.5c-2.5-2.4-3.8-5.3-3.8-8.5s1.3-6.1 3.8-8.5z" /></>,
  mail: <><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3.5 7l8.5 6 8.5-6" /></>,
  send: <path d="M20.5 3.5L3 10.8l6.5 2.7L12 20z M20.5 3.5L9.5 13.5" strokeLinejoin="round" />,
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9z" strokeLinejoin="round" />,
  plus: <path d="M12 5v14M5 12h14" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M4 4l16 16M9.9 5.9A9.4 9.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.6 17.6 0 0 1-3 3.8M6.2 7.4A16.8 16.8 0 0 0 2.5 12S6 18.5 12 18.5a9.3 9.3 0 0 0 4-.9" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  pin: <><path d="M12 21s-6.5-5.5-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.5 12 21 12 21z" /><circle cx="12" cy="10.5" r="2.3" /></>,
  bolt: <path d="M13 2.5L4.5 13.5H11L10 21.5l8.5-11H12z" strokeLinejoin="round" />,
  layers: <><path d="M12 3l9 4.5-9 4.5-9-4.5z" strokeLinejoin="round" /><path d="M3.5 12.5L12 16.7l8.5-4.2M3.5 16.5L12 20.7l8.5-4.2" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 3v4h-4" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  logOut: <><path d="M14 4h4a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 18 20h-4" /><path d="M10 8l-4 4 4 4M6 12h10" /></>,
  shield: <><path d="M12 3l7.5 3v5.5c0 4.6-3 7.8-7.5 9.5-4.5-1.7-7.5-4.9-7.5-9.5V6z" /><path d="M9 12l2 2 4-4.5" /></>,
  merge: <><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="12" r="2.5" /><path d="M8.5 6.5c5 1 7 2.5 7 5.5M8.5 17.5c5-1 7-2.5 7-5.5" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4.5c3-1.8 6 1.8 9 0 2-1.2 4-1 5-.3v8c-1-.7-3-.9-5 .3-3 1.8-6-1.8-9 0" strokeLinejoin="round" /></>,
  alert: <><path d="M12 3.5L2.8 19.5h18.4z" strokeLinejoin="round" /><path d="M12 9.5v4.5M12 16.8v.4" /></>,
  spark: <path d="M12 2.5l2 6.5 6.5 2-6.5 2-2 6.5-2-6.5L3.5 11l6.5-2z" strokeLinejoin="round" />,
  table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M10 4v16M16 10v10" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
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
export const CallStatusPill = ({ s, className = "" }: { s: CallStatus; className?: string }) => {
  useI18n();
  return <Pill color={CALL_STATUS_META[s].color} className={className}>{t(CALL_STATUS_META[s].label)}</Pill>;
};
export const ApptStatusPill = ({ s }: { s: ApptStatus }) => {
  useI18n();
  return <Pill color={APPT_STATUS_META[s].color}>{t(APPT_STATUS_META[s].label)}</Pill>;
};
export const PlatformPill = ({ p }: { p: Platform }) => {
  useI18n();
  return <Pill color={PLATFORM_META[p].color}>{t(PLATFORM_META[p].label)}</Pill>;
};
export const ResultPill = ({ r, duration }: { r: CallResult; duration?: number }) => {
  useI18n();
  return (
    <Pill color={RESULT_META[r].color}>
      {t(r)}{duration !== undefined && duration > 0 && <span className="num font-medium opacity-80">· {fmtDur(duration)}</span>}
    </Pill>
  );
};

export function Avatar({ name, size = 34, ring = false }: { name: string; size?: number; ring?: boolean }) {
  const hue = hueFor(name);
  return (
    <div className={`grid place-items-center rounded-full font-bold select-none ${ring ? "ring-2 ring-gold-500/50 ring-offset-2 ring-offset-ink-900" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.36, color: `hsl(${hue} 62% 34%)`, background: `linear-gradient(140deg, hsl(${hue} 55% 88%), hsl(${hue} 45% 74%))`, border: `1px solid hsl(${hue} 40% 62% / 0.7)` }}>
      {initials(name)}
    </div>
  );
}

/* ─── Buttons ───────────────────────────────────────────────────────────── */
export function Btn({ children, onClick, variant = "ghost", size = "md", className = "", title, disabled, locked }: {
  children: ReactNode; onClick?: () => void; variant?: "gold" | "ghost" | "outline" | "danger";
  size?: "sm" | "md"; className?: string; title?: string; disabled?: boolean; locked?: boolean;
}) {
  const base = "inline-flex items-center justify-center gap-1.5 font-bold rounded-lg transition-all duration-150 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none";
  const sizes = { sm: "px-2.5 py-1.5 text-[12px]", md: "px-3.5 py-2 text-[13px]" };
  const variants = {
    gold: "bg-gold-500 text-ink-50 hover:bg-gold-400 shadow-[0_4px_18px_-6px_rgba(251,162,0,0.55)]",
    ghost: "text-ink-300 hover:text-gold-300 hover:bg-ink-800",
    outline: "border border-ink-600 text-ink-200 hover:border-gold-500/60 hover:text-gold-300 hover:bg-gold-500/5",
    danger: "border border-ember-500/40 text-ember-400 hover:bg-ember-500/10",
  };
  return (
    <button title={locked ? `${title ?? ""} · ${t("locked")}`.trim() : title} disabled={disabled || locked}
      aria-label={title ? `${title}${locked ? ` (${t("locked")})` : ""}` : undefined}
      onClick={onClick} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {locked && <I name="lock" size={12} className="opacity-70" />}
      {children}
    </button>
  );
}

export const inputCls = "w-full rounded-lg border border-ink-600 bg-ink-900/70 px-3 py-2 text-[13px] font-semibold text-ink-100 outline-none transition-colors placeholder:font-medium placeholder:text-ink-500 focus:border-gold-500/70 focus:bg-ink-875";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] font-medium text-ink-500">{hint}</span>}
    </label>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-display text-[19px] font-bold tracking-wide text-ink-50">{children}</h2>
      {right}
    </div>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} role="switch" aria-checked={on}
      className={`relative h-5.5 w-10 shrink-0 rounded-full border transition-all duration-200 ${on ? "border-gold-500/60 bg-gold-500/90" : "border-ink-600 bg-ink-750"}`}
      style={{ height: 22 }}>
      <span className={`absolute top-[2px] h-4 w-4 rounded-full shadow transition-all duration-200 ${on ? "left-[21px] bg-ink-50" : "left-[2px] bg-ink-500"}`} />
    </button>
  );
}

/* ─── Overlays ──────────────────────────────────────────────────────────── */
export function Modal({ children, onClose, w = 560 }: { children: ReactNode; onClose: () => void; w?: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", h);
    };
  }, [onClose]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-ink-50/50 p-4 backdrop-blur-[4px] animate-fade" onMouseDown={onClose}>
      <div className="my-6 w-full rounded-2xl border border-ink-700 bg-ink-875 shadow-pop animate-pop" style={{ maxWidth: w }} onMouseDown={e => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
export function ModalHead({ title, sub, onClose }: { title: string; sub?: ReactNode; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between border-b border-ink-700 px-5 py-4">
      <div>
        <h3 className="font-display text-[17px] font-bold tracking-wide text-ink-50">{title}</h3>
        {sub && <div className="mt-0.5 text-[12px] text-ink-400">{sub}</div>}
      </div>
      <button onClick={onClose} aria-label={t("Close")} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100"><I name="x" size={17} /></button>
    </div>
  );
}

export function Drawer({ children, onClose, w = 440 }: { children: ReactNode; onClose: () => void; w?: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", h);
    };
  }, [onClose]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-ink-50/50 backdrop-blur-[4px] animate-fade" onMouseDown={onClose}>
      <div className="absolute inset-y-0 right-0 flex h-full w-full flex-col border-l border-ink-700 bg-ink-875 shadow-pop animate-drawer" style={{ maxWidth: w }} onMouseDown={e => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* Portal + fixed positioning: menus never get clipped by scrollable table
   wrappers, and they flip upward when there is no room below the trigger. */
export function Dropdown({ trigger, children, width = 220, align = "left" }: {
  trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; width?: number; align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const compute = useCallback((menuH: number) => {
    const el = wrapRef.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const up = below < menuH + 16 && r.top > below;
    let left = align === "right" ? r.right - width : r.left;
    left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - width - 8));
    const top = up ? Math.max(8, r.top - menuH - 6) : r.bottom + 6;
    return { top, left, up };
  }, [align, width]);

  useEffect(() => {
    if (!open) return;
    setPos(compute(296) ?? null);
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onMove = () => setPos(p => (p ? compute(menuRef.current?.offsetHeight ?? 296) ?? p : p));
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, compute]);

  /* exact re-measure once the real menu height is known (upward flip accuracy) */
  useLayoutEffect(() => {
    if (open && pos && menuRef.current) {
      const p = compute(menuRef.current.offsetHeight);
      if (p && Math.abs(p.top - pos.top) > 1) setPos(p);
    }
  }, [open, pos, compute]);

  return (
    <div className="relative inline-block" ref={wrapRef}>
      <div onClick={() => setOpen(o => !o)}>{trigger(open)}</div>
      {open && pos && createPortal(
        <div ref={menuRef} role="menu"
          className="fixed z-[90] overflow-hidden rounded-xl border border-ink-600 bg-ink-875 py-1 shadow-pop animate-pop"
          style={{ width, top: pos.top, left: pos.left }}>
          {children(() => setOpen(false))}
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ─── Searchable Select / Combobox ─────────────────────────────────────── */
export interface SelectOption<T = string | number> {
  value: T;
  label: string;
  sub?: string;
  icon?: IconName | ReactNode;
  badge?: string | ReactNode;
  badgeColor?: string;
}

export function SearchableSelect<T extends string | number = string | number>({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = t("Search…"),
  className = "",
  disabled = false,
  clearable = false,
  emptyText = t("No results found"),
}: {
  value: T | "" | undefined | null;
  onChange: (val: T) => void;
  options: (SelectOption<T> | T)[];
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  disabled?: boolean;
  clearable?: boolean;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null);
  const [mounted, setMounted] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const normOptions: SelectOption<T>[] = useMemo(() => {
    return options.map(opt => {
      if (typeof opt === "object" && opt !== null && "value" in opt) {
        return opt as SelectOption<T>;
      }
      return { value: opt as T, label: String(opt) };
    });
  }, [options]);

  const selectedOpt = useMemo(() => {
    return normOptions.find(o => o.value === value);
  }, [normOptions, value]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return normOptions;
    return normOptions.filter(o =>
      o.label.toLowerCase().includes(q) || (o.sub && o.sub.toLowerCase().includes(q))
    );
  }, [normOptions, search]);

  const visibleList = useMemo(() => filtered.slice(0, 50), [filtered]);

  const compute = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const menuH = 310;
    const below = window.innerHeight - r.bottom;
    const up = below < menuH + 16 && r.top > below;
    const width = Math.max(r.width, 240);
    let left = r.left;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    const top = up ? Math.max(8, r.top - menuH - 6) : r.bottom + 6;
    return { top, left, width, up };
  }, []);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setHighlightIdx(0);
      return;
    }
    setPos(compute());
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onMove = () => setPos(compute());
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    setTimeout(() => inputRef.current?.focus(), 25);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, compute]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx(i => Math.min(i + 1, visibleList.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (visibleList[highlightIdx]) {
        onChange(visibleList[highlightIdx].value);
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className={`relative ${className}`} ref={wrapRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        onKeyDown={handleKeyDown}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border border-ink-600 bg-ink-900/70 px-3 py-2 text-[13px] font-semibold text-ink-100 outline-none transition-colors hover:border-gold-500/50 focus:border-gold-500/70 focus:bg-ink-875 disabled:opacity-40 disabled:pointer-events-none ${open ? "border-gold-500/70 bg-ink-875 ring-1 ring-gold-500/40" : ""}`}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {selectedOpt ? (
            <>
              {selectedOpt.icon && (typeof selectedOpt.icon === "string" ? <I name={selectedOpt.icon as IconName} size={14} className="text-gold-400 shrink-0" /> : selectedOpt.icon)}
              <span className="truncate font-bold text-ink-100">{selectedOpt.label}</span>
              {selectedOpt.sub && <span className="num truncate text-[11px] font-medium text-ink-400">· {selectedOpt.sub}</span>}
              {selectedOpt.badge && (
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={selectedOpt.badgeColor ? { color: selectedOpt.badgeColor, background: `${selectedOpt.badgeColor}18` } : { background: "#eeebe1", color: "#57534a" }}>
                  {selectedOpt.badge}
                </span>
              )}
            </>
          ) : (
            <span className="font-medium text-ink-500">{placeholder}</span>
          )}
        </span>
        <span className="flex items-center gap-1 shrink-0 text-ink-400">
          {clearable && selectedOpt && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onChange("" as unknown as T); }}
              className="rounded p-0.5 hover:bg-ink-750 hover:text-ink-100"
            >
              <I name="x" size={12} />
            </span>
          )}
          <I name="chevD" size={14} className={`transition-transform duration-150 ${open ? "rotate-180 text-gold-400" : ""}`} />
        </span>
      </button>

      {open && pos && mounted && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          className="fixed z-[105] flex max-h-[320px] flex-col overflow-hidden rounded-xl border border-ink-600 bg-ink-875 shadow-pop animate-pop"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          {/* Search bar inside select dropdown */}
          <div className="border-b border-ink-700 p-2">
            <div className="flex items-center gap-2 rounded-lg border border-ink-600 bg-ink-900/80 px-2.5 py-1.5 focus-within:border-gold-500/70">
              <I name="search" size={13} className="shrink-0 text-ink-400" />
              <input
                ref={inputRef}
                value={search}
                onChange={e => { setSearch(e.target.value); setHighlightIdx(0); }}
                onKeyDown={handleKeyDown}
                placeholder={searchPlaceholder}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="w-full bg-transparent text-[12.5px] font-semibold text-ink-100 outline-none placeholder:text-ink-500"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} className="text-ink-400 hover:text-ink-100">
                  <I name="x" size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Options list */}
          <div ref={listRef} className="max-h-[240px] flex-1 overflow-y-auto p-1">
            {visibleList.length === 0 ? (
              <div className="p-4 text-center text-[12px] font-semibold text-ink-400">{emptyText}</div>
            ) : (
              visibleList.map((opt, idx) => {
                const isSelected = opt.value === value;
                const isHighlighted = idx === highlightIdx;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => { onChange(opt.value); setOpen(false); }}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    className={`flex w-full items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-left text-[12.5px] transition-colors ${isSelected ? "bg-gold-500/15 font-extrabold text-gold-300" : isHighlighted ? "bg-ink-800 font-semibold text-ink-100" : "font-medium text-ink-200 hover:bg-ink-800"}`}
                  >
                    <span className="flex min-w-0 items-center gap-2 truncate">
                      {opt.icon && (typeof opt.icon === "string" ? <I name={opt.icon as IconName} size={14} className="shrink-0 text-gold-400" /> : opt.icon)}
                      <span className="truncate">{opt.label}</span>
                      {opt.sub && <span className="num truncate text-[11px] text-ink-400 opacity-80">· {opt.sub}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {opt.badge && (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={opt.badgeColor ? { color: opt.badgeColor, background: `${opt.badgeColor}18` } : { background: "#eeebe1", color: "#57534a" }}>
                          {opt.badge}
                        </span>
                      )}
                      {isSelected && <I name="check" size={13} className="text-gold-400" />}
                    </span>
                  </button>
                );
              })
            )}
            {filtered.length > 50 && (
              <div className="border-t border-ink-700/60 px-3 py-1.5 text-center text-[10.5px] font-semibold text-ink-500">
                +{filtered.length - 50} {t("more — type to filter")}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ─── Shared pagination footer ──────────────────────────────────────────── */
export function Pagination({ total, page, pageSize, onPage, unit }: {
  total: number; page: number; pageSize: number; onPage: (p: number) => void; unit?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(Math.max(0, page), pages - 1);
  const from = total === 0 ? 0 : cur * pageSize + 1;
  const to = Math.min(total, (cur + 1) * pageSize);
  const nums = useMemo(() => {
    const start = Math.max(0, Math.min(cur - 2, pages - 5));
    return Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
  }, [cur, pages]);
  const btn = "grid h-8 min-w-[32px] place-items-center rounded-lg border text-[12px] font-bold transition-all duration-150 active:scale-95 disabled:opacity-35 disabled:pointer-events-none";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-700 px-4 py-3">
      <span className="num text-[12px] font-semibold text-ink-400">
        {from}–{to} · {total}{unit ? ` ${unit}` : ""}
      </span>
      <div className="flex items-center gap-1.5">
        <button className={`${btn} border-ink-600 text-ink-300 hover:border-gold-500/60 hover:text-gold-300`} disabled={cur === 0} onClick={() => onPage(cur - 1)} aria-label="Previous page">
          <I name="chevL" size={14} />
        </button>
        {nums.map(n => (
          <button key={n} onClick={() => onPage(n)}
            className={`${btn} num ${n === cur ? "border-gold-500 bg-gold-500 text-ink-50 shadow-[0_2px_10px_-3px_rgba(251,162,0,0.6)]" : "border-ink-600 text-ink-300 hover:border-gold-500/60 hover:text-gold-300"}`}>
            {n + 1}
          </button>
        ))}
        <button className={`${btn} border-ink-600 text-ink-300 hover:border-gold-500/60 hover:text-gold-300`} disabled={cur >= pages - 1} onClick={() => onPage(cur + 1)} aria-label="Next page">
          <I name="chevR" size={14} />
        </button>
      </div>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 py-8 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-xl border border-ink-600 bg-ink-850 text-ink-400"><I name="search" size={18} /></span>
      <div className="text-[13.5px] font-extrabold text-ink-200">{title}</div>
      {hint && <div className="max-w-sm text-[12px] font-semibold text-ink-400">{hint}</div>}
    </div>
  );
}

/* ─── Live helpers ──────────────────────────────────────────────────────── */
export function LiveClock({ tz }: { tz: string }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i); }, []);
  let out = "";
  try { out = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: tz.includes("/") ? tz : undefined }); }
  catch { out = now.toLocaleTimeString("en-GB"); }
  return <>{out}</>;
}

export function useCountUp(target: number, dur = 700) {
  const [v, setV] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    const from = ref.current; ref.current = target;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setV(Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return v;
}

export function Sparkline({ values, color, w = 84, h = 28 }: { values: number[]; color: string; w?: number; h?: number }) {
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`).join(" ");
  return (
    <svg width={w} height={h} className="opacity-90">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx={w} cy={h - (values[values.length - 1] / max) * (h - 4) - 2} r="2.4" fill={color} />
    </svg>
  );
}

/* ─── SLA badge ─────────────────────────────────────────────────────────── */
export function SlaBadge({ createdAt, called, className = "" }: { createdAt: string; called: boolean; className?: string }) {
  const { lang } = useI18n();
  const [, setTick] = useState(0);
  useEffect(() => { const i = setInterval(() => setTick(x => x + 1), 30_000); return () => clearInterval(i); }, []);
  if (called) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - +new Date(createdAt)) / 60_000));
  const fmt = minutes < 60
    ? (lang === "tr" ? `${minutes}dk` : `${minutes}m`)
    : (lang === "tr" ? `${Math.floor(minutes / 60)}sa ${minutes % 60}dk` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`);
  const kind = minutes <= 15 ? "ok" : minutes <= 60 ? "warn" : "breach";
  const color = kind === "ok" ? "#2fbf71" : kind === "warn" ? "#e8a33d" : "#e5484d";
  const label = kind === "ok" ? `SLA · ${fmt}` : kind === "warn"
    ? (lang === "tr" ? `SLA riski · ${fmt}` : `SLA risk · ${fmt}`)
    : (lang === "tr" ? `SLA ihlali · ${fmt}` : `SLA breach · ${fmt}`);
  return (
    <span title={t("First call SLA: 15 minutes")}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${kind === "breach" ? "animate-blink" : ""} ${className}`}
      style={{ color, background: `${color}14`, border: `1px solid ${color}40` }}>
      <I name="clock" size={10} /> {label}
    </span>
  );
}

/* ─── Fake recording player ─────────────────────────────────────────────── */
export function PlayerModal({ title, subtitle, onClose }: { title: string; subtitle: string; onClose: () => void }) {
  const [playing, setPlaying] = useState(true);
  const [pos, setPos] = useState(18);
  const total = 127;
  useEffect(() => {
    if (!playing) return;
    const i = setInterval(() => setPos(p => (p >= total ? 0 : p + 1)), 1000);
    return () => clearInterval(i);
  }, [playing]);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <Modal onClose={onClose} w={460}>
      <ModalHead title={title} sub={subtitle} onClose={onClose} />
      <div className="space-y-4 px-5 py-5">
        <div className="flex h-16 items-end justify-center gap-[3px]">
          {Array.from({ length: 48 }, (_, i) => {
            const hgt = 20 + Math.abs(Math.sin(i * 1.7)) * 70 + (i % 5) * 4;
            const past = (i / 48) * total <= pos;
            return <span key={i} className={`w-[4px] rounded-full transition-colors ${playing ? "eq-bar" : ""}`}
              style={{ height: `${hgt}%`, background: past ? "#fba200" : "#dbd5c6", animationDelay: `${i * 0.04}s` }} />;
          })}
        </div>
        <input type="range" min={0} max={total} value={pos} onChange={e => setPos(Number(e.target.value))}
          className="w-full accent-[#fba200]" aria-label="Recording position" />
        <div className="flex items-center justify-between">
          <span className="num text-[11.5px] font-bold text-ink-400">{fmt(pos)} / {fmt(total)}</span>
          <div className="flex items-center gap-2">
            <Btn variant="outline" size="sm" onClick={() => setPos(0)} title="Restart"><I name="refresh" size={13} /></Btn>
            <button onClick={() => setPlaying(p => !p)} aria-label={playing ? "Pause" : "Play"}
              className="grid h-11 w-11 place-items-center rounded-full bg-gold-500 text-ink-50 shadow-[0_4px_18px_-6px_rgba(251,162,0,0.6)] transition-transform hover:scale-105 active:scale-95">
              <I name={playing ? "pause" : "play"} size={17} />
            </button>
          </div>
          <span className="num text-[11.5px] font-bold text-ink-500">8 kHz · GSM</span>
        </div>
      </div>
    </Modal>
  );
}
