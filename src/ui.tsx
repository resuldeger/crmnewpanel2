"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  CALL_STATUS_META, APPT_STATUS_META, PLATFORM_META, RESULT_META,
  initials, hueFor, fmtDur, timeAgo, fmtDT, prettyPhone, type CallStatus, type ApptStatus, type Platform, type CallResult,
} from "./data";
import { t, tf, useI18n } from "./i18n";
import { useStore } from "./store";
import { crmApi, type AssignableStaff, type CallContext, type CallNote, type RelatedCall } from "./services/crmApi";

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
/* ── Recording playback ────────────────────────────────────────────────
 * This was a mock. It had no <audio> element at all: it animated bars,
 * counted up to a hard-coded 127 seconds and printed "8 kHz · GSM" under
 * a call it knew nothing about. Opening it looked exactly like playback
 * failing on your machine.
 *
 * It now plays the call, through /api/crm/calls/{id}/recording so the
 * carrier's credentials stay on the server, and says plainly when there
 * is nothing to play.
 * ────────────────────────────────────────────────────────────────── */

/* Pressing Listen is asking to hear THIS call. Any recording already
   playing is stopped first — two conversations at once is never what was
   meant, and the second one starting quietly behind the first is worse
   than either. Module-level, so it holds across modals. */
let nowPlaying: HTMLAudioElement | null = null;
function claimPlayback(el: HTMLAudioElement) {
  if (nowPlaying && nowPlaying !== el) {
    nowPlaying.pause();
    try { nowPlaying.currentTime = 0; } catch { /* already gone */ }
  }
  nowPlaying = el;
}

/* ── The bar that actually follows the audio ───────────────────────────
 * The first version of this dialog drew forty bars from Math.sin() and
 * animated them whenever `playing` was true — decoration that moved at
 * the same speed for silence and for shouting. It was then replaced with
 * an honest progress bar, which is accurate and says nothing about the
 * sound.
 *
 * This reads the audio. A Web Audio analyser sits between the element and
 * the speakers and reports the live spectrum, so the bars rise on speech
 * and fall in the gaps — which is what makes it possible to see where the
 * silence is without listening to all of it.
 *
 * Drawn on a canvas rather than as divs: this runs every frame, and
 * re-rendering forty React nodes sixty times a second to move a few
 * pixels is a waste of the main thread.
 * ────────────────────────────────────────────────────────────── */
/* One context for the whole console, and one source node per element.
 *
 * Routing a media element through Web Audio is a one-way door: the element
 * stops feeding the speakers directly and feeds the graph instead.
 * createMediaElementSource() on the same element twice throws, and closing
 * the context leaves the element connected to nothing — it reports
 * readyState 4 and a real duration and plays silence. Which is what
 * happened: React runs effects twice in development, so the first pass
 * built a context and the cleanup closed it, and every recording after
 * that opened stopped.
 *
 * So the context is created once and never closed, the source is cached
 * per element, and teardown only unhooks the analyser. */
let meterCtx: AudioContext | null = null;
const meterSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

function audioGraph(el: HTMLMediaElement): { ctx: AudioContext; source: MediaElementAudioSourceNode } | null {
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    meterCtx ??= new Ctor();
    let source = meterSources.get(el);
    if (!source) {
      source = meterCtx.createMediaElementSource(el);
      meterSources.set(el, source);
    }
    return { ctx: meterCtx, source };
  } catch {
    /* No Web Audio, or this element is already wired to a context we did
       not make. Either way the element plays on its own and the meter
       falls back to showing progress only. */
    return null;
  }
}

/* ── The bar that actually follows the audio ───────────────────────────
 * The first version of this dialog drew forty bars from Math.sin() and
 * animated them whenever `playing` was true — decoration that moved at
 * the same speed for silence and for shouting. It was then replaced with
 * an honest progress bar, which is accurate and says nothing about the
 * sound.
 *
 * This reads the audio. A Web Audio analyser sits between the element and
 * the speakers and reports the live spectrum, so the bars rise on speech
 * and fall in the gaps — which is what makes it possible to see where the
 * silence is without listening to all of it.
 *
 * Drawn on a canvas rather than as divs: this runs every frame, and
 * re-rendering forty React nodes sixty times a second to move a few
 * pixels is a waste of the main thread.
 * ────────────────────────────────────────────────────────────── */
function LiveMeter({ audio, playing, progress }: {
  audio: RefObject<HTMLAudioElement | null>;
  playing: boolean;
  /** 0–1. Painted behind the bars so position is still readable. */
  progress: number;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const frame = useRef(0);
  const progressRef = useRef(progress);
  progressRef.current = progress;

  useEffect(() => {
    const el = audio.current;
    if (!el) return;

    const graph = audioGraph(el);
    if (graph) {
      const node = graph.ctx.createAnalyser();
      node.fftSize = 128;
      node.smoothingTimeConstant = 0.75;
      graph.source.disconnect();
      graph.source.connect(node);
      node.connect(graph.ctx.destination);
      analyser.current = node;
    }

    const bins = new Uint8Array(analyser.current?.frequencyBinCount ?? 0);
    const paint = () => {
      frame.current = requestAnimationFrame(paint);
      const c = canvas.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== w * dpr || c.height !== h * dpr) {
        c.width = w * dpr;
        c.height = h * dpr;
      }
      const g = c.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      // How far through the recording we are, underneath everything.
      g.fillStyle = "rgba(251,162,0,0.16)";
      g.fillRect(0, 0, w * Math.min(1, Math.max(0, progressRef.current)), h);

      const node = analyser.current;
      const count = 40;
      const gap = 2;
      const barW = Math.max(1, (w - gap * (count - 1)) / count);
      if (node) node.getByteFrequencyData(bins);

      for (let i = 0; i < count; i += 1) {
        /* Low frequencies carry speech, so the bins are read from the
           bottom of the range rather than spread across all of it. */
        const v = node ? (bins[Math.floor((i / count) * (bins.length * 0.7))] ?? 0) / 255 : 0;
        const barH = Math.max(2, v * h);
        const x = i * (barW + gap);
        g.fillStyle = (x + barW / 2) / w <= progressRef.current ? "#fba200" : "#d8d2c4";
        g.fillRect(x, (h - barH) / 2, barW, barH);
      }
    };
    frame.current = requestAnimationFrame(paint);

    return () => {
      cancelAnimationFrame(frame.current);
      /* Unhook the analyser and put the element back on the speakers. The
         context itself stays open — closing it would silence this element
         for good. */
      const node = analyser.current;
      analyser.current = null;
      if (graph && node) {
        node.disconnect();
        graph.source.disconnect();
        graph.source.connect(graph.ctx.destination);
      }
    };
  }, [audio]);

  /* An AudioContext starts suspended until something the user did lets it
     run. The click that opened this dialog counts, but the context may
     have been created after it, so it has to be told. */
  useEffect(() => {
    if (!playing) return;
    if (meterCtx?.state === "suspended") void meterCtx.resume();
  }, [playing]);

  return <canvas ref={canvas} className="h-14 w-full" aria-hidden />;
}

/* ── Handing a task to someone ─────────────────────────────────────────
 * Whoever is at their desk right now comes first: giving a callback to
 * someone who went home an hour ago is how it sits untouched until
 * tomorrow. But at nine in the evening nobody is online and the work
 * still has to go somewhere, so the list falls back to everyone and says
 * which of the two you are looking at.
 * ────────────────────────────────────────────────────────────── */
/** The list itself, usable before a task exists as well as after. */
export function StaffPicker({ current, label, onPick, disabled, locationId }: {
  current?: number | null;
  /** What the closed control reads. */
  label: ReactNode;
  onPick: (person: AssignableStaff | null, close: () => void) => void | Promise<void>;
  disabled?: boolean;
  /** The studio the work belongs to, so only people who can open it are
   *  offered. A Riverside callback handed to someone scoped to Panama is
   *  a task they cannot even read. */
  locationId?: number | null;
}) {
  const { session } = useStore();
  const [people, setPeople] = useState<AssignableStaff[] | null>(null);
  const [anyoneOnline, setAnyoneOnline] = useState(true);

  const load = useCallback(() => {
    if (people) return;
    crmApi.assignableStaff(locationId)
      .then((r) => { setPeople(r.staff); setAnyoneOnline(r.anyoneOnline); })
      .catch(() => setPeople([]));
  }, [people, locationId]);

  return (
    <Dropdown
      width={260}
      trigger={(open) => (
        /* Fetched when the menu opens rather than on every row: a list of
           fifty callbacks would otherwise ask who is online fifty times. */
        <button onClick={load} disabled={disabled}
          className="flex items-center gap-1.5 rounded-lg border border-ink-600 px-2 py-1 text-[11.5px] font-bold text-ink-300 transition-colors hover:border-gold-500/60 hover:text-gold-300 disabled:opacity-50">
          <I name="users" size={12} />
          {label}
          <I name="chevD" size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      )}
    >
      {(close) => (
        <div className="max-h-72 overflow-y-auto py-1">
          <div className="px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-500">
            {people === null ? t("Loading…") : anyoneOnline ? t("At their desk now") : t("Nobody is online — everyone")}
          </div>
          {(people ?? []).map((p) => (
            <button key={p.id} onClick={() => void onPick(p, close)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] font-bold transition-colors hover:bg-ink-800 ${
                p.id === current ? "text-gold-300" : "text-ink-200"
              }`}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: p.online ? "#2fbf71" : "#948d7d" }} />
              {p.name}
              {p.id === session?.id && <span className="text-[10.5px] text-ink-500">({t("you")})</span>}
              {p.id === current && <I name="check" size={12} className="ml-auto text-gold-400" />}
            </button>
          ))}
          {people?.length === 0 && (
            <div className="px-3 py-2 text-[12px] font-semibold text-ink-400">{t("No colleagues to assign to")}</div>
          )}
          {current != null && (
            <button onClick={() => void onPick(null, close)}
              className="mt-1 w-full border-t border-ink-750 px-3 py-2 text-left text-[12px] font-bold text-ink-400 hover:bg-ink-800 hover:text-ink-100">
              {t("Return to the pool")}
            </button>
          )}
        </div>
      )}
    </Dropdown>
  );
}

/* ── Handing a task to someone ─────────────────────────────────────────
 * Whoever is at their desk right now comes first: giving a callback to
 * someone who went home an hour ago is how it sits untouched until
 * tomorrow. But at nine in the evening nobody is online and the work
 * still has to go somewhere, so the list falls back to everyone and says
 * which of the two you are looking at.
 * ────────────────────────────────────────────────────────────── */
export function AssigneePicker({ taskId, current, currentName, locationId, onAssigned }: {
  taskId: number;
  current: number | null;
  currentName?: string | null;
  locationId?: number | null;
  onAssigned: (staffId: number | null, name: string | null) => void;
}) {
  const { guard, can } = useStore();
  const [busy, setBusy] = useState(false);

  if (!can("calls.manage")) {
    return <span className="text-[11.5px] font-semibold text-ink-400">{currentName ?? t("Unassigned")}</span>;
  }

  return (
    <StaffPicker
      current={current}
      locationId={locationId}
      disabled={busy}
      label={currentName ?? t("Unassigned")}
      onPick={async (person, close) => {
        if (!guard("calls.manage") || busy) return;
        setBusy(true);
        try {
          await crmApi.assignTask(taskId, person?.id ?? null);
          onAssigned(person?.id ?? null, person?.name ?? null);
          close();
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

const RESULTS: CallResult[] = ["Answered", "Missed", "Voicemail", "Attempted"];

/* ── Saying what the call actually was ─────────────────────────────────
 * Vonage reports an outbound leg that reached the customer's voicemail as
 * "Answered" — from the carrier's side the far end did pick up, and no
 * field separates the two. Eighteen seconds of leaving a message is
 * counted as a conversation, and every report built on that leans the
 * same way.
 *
 * Only someone listening can tell. So they say here, the dialog stays
 * open, and the carrier stops writing that column for this call.
 * ────────────────────────────────────────────────────────────── */
function OutcomePicker({ callId, current, onChange }: {
  callId: number;
  current: CallResult;
  onChange: (result: CallResult, locked: boolean) => void;
}) {
  const { can, guard } = useStore();
  const [busy, setBusy] = useState<CallResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!can("calls.manage")) return null;

  const set = async (result: CallResult) => {
    if (!guard("calls.manage") || busy) return;
    setBusy(result);
    try {
      const res = await crmApi.setCallResult(callId, result);
      onChange(res.result, res.resultLocked);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("The outcome could not be changed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Outcome")}</span>
      {RESULTS.map(r => (
        <button key={r} disabled={busy !== null} onClick={() => void set(r)}
          className="rounded-lg px-2.5 py-1 text-[12px] font-bold transition-all disabled:opacity-50"
          style={current === r
            ? { color: "#fffdf7", background: RESULT_META[r].color, border: `1px solid ${RESULT_META[r].color}` }
            : { color: RESULT_META[r].color, background: `${RESULT_META[r].color}10`, border: `1px solid ${RESULT_META[r].color}35` }}>
          {t(r)}
        </button>
      ))}
      {error && <span className="text-[11.5px] font-semibold text-ember-400">{error}</span>}
    </div>
  );
}

/* ── Who is on the other end ───────────────────────────────────────────
 * Listening to a call without knowing whose it is means leaving the
 * dialog, searching the number and losing your place in the recording.
 * Whether this person has called before, and what happened those times,
 * is the thing you want while the audio is playing.
 * ────────────────────────────────────────────────────────────── */
function CallerPanel({ callId, onOpenCall }: {
  callId: number;
  /** Switch the dialog to another of this caller's recordings. */
  onOpenCall: (call: RelatedCall) => void;
}) {
  const { navigate } = useStore();
  const [ctx, setCtx] = useState<CallContext | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    setCtx(null);
    crmApi.callContext(callId).then(c => { if (alive) setCtx(c); }).catch(() => undefined);
    return () => { alive = false; };
  }, [callId]);

  if (!ctx) return null;
  const shown = showAll ? ctx.others : ctx.others.slice(0, 3);

  return (
    <div className="border-t border-ink-700 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        {ctx.person ? (
          <button
            onClick={() => navigate(ctx.person!.kind === "customer"
              ? { view: "customer", id: ctx.person!.id }
              : { view: "lead", id: ctx.person!.id })}
            className="flex items-center gap-2 rounded-lg border border-gold-500/40 bg-gold-500/10 px-2.5 py-1.5 text-[12.5px] font-extrabold text-gold-300 transition-colors hover:bg-gold-500/20">
            <I name="eye" size={13} />
            {ctx.person.name}
            <span className="text-[10.5px] font-bold opacity-70">
              {ctx.person.kind === "customer" ? t("Customer") : t("Lead")}
            </span>
          </button>
        ) : (
          /* No record of them at all. Worth saying, because it is the
             difference between an unknown number and one we simply have
             not linked yet. */
          <span className="num rounded-lg border border-ink-600 px-2.5 py-1.5 text-[12.5px] font-bold text-ink-300">
            {prettyPhone(ctx.number ?? "")} · {t("not in the database")}
          </span>
        )}

        {ctx.isFirstCall ? (
          <Pill color="#2fbf71" dot={false}>{t("First call")}</Pill>
        ) : (
          <Pill color="#4c8dff" dot={false}>
            {tf("{n} calls · {a} answered", { n: ctx.totalCalls, a: ctx.answeredCalls })}
          </Pill>
        )}
      </div>

      {ctx.others.length > 0 && (
        <div className="mt-3 space-y-1">
          {shown.map(o => (
            <button key={o.id} onClick={() => onOpenCall(o)} disabled={!o.hasAudio}
              title={o.hasAudio ? t("Play this call") : t("No recording")}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                o.hasAudio ? "hover:bg-ink-800" : "opacity-60"
              }`}>
              <I name={o.hasAudio ? "play" : "phone"} size={11} className="shrink-0 text-ink-500" />
              <span className="num shrink-0 text-[11.5px] font-semibold text-ink-400">{fmtDT(o.startTime)}</span>
              <Pill color={o.direction === "inbound" ? "#2fbf71" : "#4c8dff"} dot={false} className="!text-[9.5px]">
                {t(o.direction === "inbound" ? "Incoming" : "Outgoing")}
              </Pill>
              <span className="truncate text-[11.5px] font-semibold text-ink-500">{o.agentName ?? "—"}</span>
              <span className="ml-auto shrink-0"><ResultPill r={o.result} duration={o.duration} /></span>
            </button>
          ))}
          {ctx.others.length > 3 && (
            <button onClick={() => setShowAll(v => !v)}
              className="px-2 text-[11.5px] font-bold text-ink-400 hover:text-gold-300">
              {showAll ? t("Show fewer") : tf("Show {n} more", { n: ctx.others.length - 3 })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NoteList({ callId, positionOf, seekTo }: {
  callId: number;
  positionOf: () => number | undefined;
  /** Jump the player to a moment a note points at. */
  seekTo: (seconds: number) => void;
}) {
  const { can, guard, session } = useStore();
  const [notes, setNotes] = useState<CallNote[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stamp, setStamp] = useState(true);

  useEffect(() => {
    let alive = true;
    crmApi.callNotes(callId)
      .then((n) => { if (alive) setNotes(n); })
      .catch(() => { if (alive) setError(t("Notes could not be loaded")); });
    return () => { alive = false; };
  }, [callId]);

  const add = async () => {
    const body = draft.trim();
    if (!body || !guard("calls.manage")) return;
    setBusy(true);
    try {
      /* The note is usually about a moment — "says here she wants the
         Thursday slot" — so where the player is sitting is offered as
         part of it, and can be left off. */
      const note = await crmApi.addCallNote(callId, body, stamp ? positionOf() : undefined);
      setNotes((n) => [...n, note]);
      setDraft("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("The note could not be saved"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await crmApi.deleteCallNote(callId, id);
      setNotes((n) => n.filter((x) => x.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("The note could not be removed"));
    }
  };

  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div className="border-t border-ink-700 px-5 py-4">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-400">{t("Notes")}</span>
        {notes.length > 0 && <span className="num text-[11px] font-semibold text-ink-500">{notes.length}</span>}
      </div>

      <div className="max-h-48 space-y-2 overflow-y-auto">
        {notes.map((n) => (
          <div key={n.id} className="group rounded-xl border border-ink-700 bg-ink-850 p-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[11px] font-extrabold text-gold-300">{n.author}</span>
              {n.atSeconds !== null && (
                /* The stamp is the point of the note — "he says it at
                   0:13" is only useful if 0:13 is one click away. */
                <button
                  onClick={() => seekTo(n.atSeconds!)}
                  title={t("Jump to this moment")}
                  className="num rounded bg-ink-800 px-1.5 text-[10px] font-bold text-ink-400 transition-colors hover:bg-gold-500 hover:text-ink-50">
                  {clock(n.atSeconds)}
                </button>
              )}
              <span className="num ml-auto text-[10.5px] text-ink-500">{timeAgo(n.createdAt)}</span>
              {(n.authorId === session?.id || session?.roleId === "super_admin") && (
                <button onClick={() => void remove(n.id)} aria-label={t("Delete")}
                  className="opacity-0 transition-opacity group-hover:opacity-100 text-ink-500 hover:text-ember-400">
                  <I name="x" size={12} />
                </button>
              )}
            </div>
            <p className="whitespace-pre-wrap text-[12.5px] font-semibold leading-relaxed text-ink-200">{n.body}</p>
          </div>
        ))}
        {notes.length === 0 && (
          <p className="py-2 text-[12px] font-semibold text-ink-500">{t("No notes on this recording yet.")}</p>
        )}
      </div>

      {error && <p className="mt-2 text-[11.5px] font-semibold text-ember-400">{error}</p>}

      {can("calls.manage") && (
        <div className="mt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void add(); }}
            rows={2}
            placeholder={t("What did you hear?")}
            className="w-full resize-none rounded-lg border border-ink-600 bg-ink-900/70 px-3 py-2 text-[12.5px] font-semibold text-ink-100 outline-none focus:border-gold-500/70"
          />
          <div className="mt-2 flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] font-bold text-ink-400">
              <input type="checkbox" checked={stamp} onChange={(e) => setStamp(e.target.checked)} className="h-3.5 w-3.5 accent-[#fba200]" />
              {t("Mark the current position")}
            </label>
            <Btn size="sm" variant="gold" disabled={!draft.trim() || busy} onClick={() => void add()}>
              <I name="plus" size={12} /> {t("Add note")}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

export function PlayerModal({ callId, title, subtitle, durationHint, result, onClose }: {
  callId: number;
  title: string;
  subtitle: string;
  /** What the call log says the call lasted. Used until the audio reports
   *  its own duration — and instead of it when the file never does. */
  durationHint?: number;
  /** The outcome on record, so it can be corrected from here. */
  result?: CallResult;
  onClose: () => void;
}) {
  /* The dialog can move to another of this caller's recordings without
     closing — you are comparing two calls from the same person, and
     shutting the window to open the next one loses the thread. */
  const [active, setActive] = useState({ callId, title, subtitle, durationHint, result });
  useEffect(() => { setActive({ callId, title, subtitle, durationHint, result }); }, [callId, title, subtitle, durationHint, result]);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const src = `/api/crm/calls/${active.callId}/recording`;

  /* The <audio> element reports a failure as a bare "error" event with no
     reason, so the reason is asked for separately — the endpoint answers
     in words, and the difference matters: a call nobody recorded is not
     the same as one we cannot reach. */
  const explain = useCallback(async () => {
    try {
      const res = await fetch(src, { credentials: "same-origin" });
      if (res.ok) return t("The recording could not be played in this browser");
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      return body?.message ?? `${t("The recording could not be loaded")} (${res.status})`;
    } catch {
      return t("The recording could not be loaded");
    }
  }, [src]);

  const start = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    claimPlayback(el);
    void el.play().catch(() => void explain().then(setError));
  }, [explain]);

  /* Pressing Listen means play it. Having to press play again inside the
     dialog that opened because you pressed play is a step nobody wants.
     Browsers block autoplay without a user gesture — the click that
     opened this is one, so it is allowed. */
  /* Play is asked for straight away rather than once the file has
     buffered — play() before any data has arrived is allowed, and the
     browser starts the moment it can, whereas waiting for "canplay" meant
     watching a stopped player while a recording downloaded.
     
     It is asked for on a timer of zero, which looks pointless and is not.
     React runs effects twice in development: mount, unmount, mount. The
     first pass called play(), the teardown called pause() before that
     promise had settled, and the dialog opened stopped. Scheduling the
     start means the first pass's attempt is cancelled by its own cleanup
     and only the surviving pass ever plays. */
  const autoStarted = useRef(false);
  const startOnce = useCallback(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    start();
  }, [start]);

  useEffect(() => {
    autoStarted.current = false;
    const kick = setTimeout(startOnce, 0);
    return () => {
      clearTimeout(kick);
      const current = audio.current;
      if (current) {
        current.pause();
        if (nowPlaying === current) nowPlaying = null;
      }
    };
  }, [active.callId, startOnce]);

  /* These recordings are CBR MP3 served without a duration frame, so the
     element reports Infinity until the whole file has been fetched — the
     scrub bar sat at "—:—" on a call the log already knew was 2m 26s.
     The log's own figure fills it. */
  const known = Number.isFinite(total) && total > 0 ? total : (active.durationHint ?? 0);

  /* A position of zero is a position, not an unknown — it reads 0:00. Only
     a duration we genuinely do not have gets the dashes. */
  const clock = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
  const fmtPos = (n: number) => (Number.isFinite(n) && n >= 0 ? clock(n) : "0:00");
  const fmtTotal = (n: number) => (Number.isFinite(n) && n > 0 ? clock(n) : "—:—");

  return (
    <Modal onClose={onClose} w={520}>
      <ModalHead title={active.title} sub={active.subtitle} onClose={onClose} />
      <div className="space-y-4 px-5 py-5">
        <audio
          ref={audio}
          src={src}
          preload="auto"
          onLoadStart={() => setLoading(true)}
          onLoadedMetadata={(e) => { setTotal(e.currentTarget.duration); setLoading(false); }}
          onDurationChange={(e) => setTotal(e.currentTarget.duration)}
          onCanPlay={() => { setLoading(false); startOnce(); }}
          onLoadedData={() => { setLoading(false); startOnce(); }}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
          onPlay={(e) => { claimPlayback(e.currentTarget); setPlaying(true); }}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => { setLoading(false); void explain().then(setError); }}
        />

        {error ? (
          <div className="rounded-xl border border-ink-700 bg-ink-850 px-4 py-6 text-center">
            <I name="phone" size={20} className="mx-auto mb-2 text-ink-500" />
            <p className="text-[12.5px] font-semibold text-ink-300">{error}</p>
          </div>
        ) : (
          <>
            <LiveMeter audio={audio} playing={playing} progress={known > 0 ? pos / known : 0} />
            <input
              type="range" min={0} max={known || 0} step={0.1} value={Math.min(pos, known || 0)}
              disabled={loading || known === 0}
              onChange={(e) => { const at = Number(e.target.value); setPos(at); if (audio.current) audio.current.currentTime = at; }}
              className="w-full accent-[#fba200] disabled:opacity-40"
              aria-label="Recording position"
            />
            <div className="flex items-center justify-between">
              <span className="num text-[11.5px] font-bold text-ink-400">{fmtPos(pos)} / {fmtTotal(known)}</span>
              <div className="flex items-center gap-2">
                <Btn variant="outline" size="sm" disabled={loading}
                  onClick={() => { if (audio.current) { audio.current.currentTime = 0; setPos(0); } }} title={t("Restart")}>
                  <I name="refresh" size={13} />
                </Btn>
                <button
                  disabled={loading}
                  onClick={() => {
                    const el = audio.current;
                    if (!el) return;
                    if (el.paused) start(); else el.pause();
                  }}
                  aria-label={playing ? "Pause" : "Play"}
                  className="grid h-11 w-11 place-items-center rounded-full bg-gold-500 text-ink-50 shadow-[0_4px_18px_-6px_rgba(251,162,0,0.6)] transition-transform hover:scale-105 active:scale-95 disabled:opacity-40">
                  <I name={playing ? "pause" : "play"} size={17} />
                </button>
              </div>
              <a href={src} download className="num text-[11.5px] font-bold text-ink-500 hover:text-gold-300">
                {loading ? "…" : t("download")}
              </a>
            </div>
          </>
        )}
      </div>
      {!error && active.result && (
        <div className="border-t border-ink-700 px-5 py-3">
          <OutcomePicker
            callId={active.callId}
            current={active.result}
            onChange={(r) => setActive(a => ({ ...a, result: r }))}
          />
        </div>
      )}

      <CallerPanel
        callId={active.callId}
        onOpenCall={(other) => setActive({
          callId: other.id,
          title: other.agentName ?? prettyPhone(""),
          subtitle: `${other.extension ? `#${other.extension} · ` : ""}${fmtDT(other.startTime)}`,
          durationHint: other.duration,
          result: other.result,
        })}
      />

      {!error && (
        <NoteList
          callId={active.callId}
          positionOf={() => audio.current?.currentTime}
          seekTo={(at) => {
            const el = audio.current;
            if (!el) return;
            el.currentTime = at;
            setPos(at);
            if (el.paused) start();
          }}
        />
      )}
    </Modal>
  );
}
