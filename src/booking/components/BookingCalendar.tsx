"use client";

/* ── The month grid ────────────────────────────────────────────────────
 * The wizard and the /b/{uuid} manage screen show the same calendar, so it
 * lives here instead of being written twice. The manage screen used to fall
 * back to a native <input type="date">, which on a phone opened the OS
 * picker — a different interaction, and no way to see which days are shut.
 *
 * "Today" and the booking horizon are computed in the STUDIO's timezone.
 * Taken from the browser clock they drift by a day for anyone booking from
 * another country: an Istanbul visitor booking Tacoma had tomorrow greyed
 * out as "past" and lost the last bookable day off the end.
 * ────────────────────────────────────────────────────────────────── */
import { useMemo, useState } from "react";
import { t } from "../hooks/useBookingConfig";
import { dateInZone } from "../lib/slotTime";

type Dict = Parameters<typeof t>[0];

/** Calendar cells for a month, Monday-first, with leading blanks. */
function monthGrid(view: Date): (Date | null)[] {
  const year = view.getFullYear();
  const month = view.getMonth();
  const last = new Date(year, month + 1, 0).getDate();
  let start = new Date(year, month, 1).getDay();
  start = start === 0 ? 6 : start - 1; // Sunday closes the week here
  const days: (Date | null)[] = Array.from({ length: start }, () => null);
  for (let i = 1; i <= last; i += 1) days.push(new Date(year, month, i));
  return days;
}

/** Local Y-M-D of a calendar cell — never toISOString, which shifts to UTC. */
const cellKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Y-M-D arithmetic without touching the clock. */
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export interface BookingCalendarProps {
  /** Selected day as YYYY-MM-DD, or "" for none. */
  value: string;
  onChange: (day: string) => void;
  /** IANA zone of the studio — defines "today" and the horizon. */
  studioTimezone: string;
  /** How far ahead this studio takes bookings. */
  maxDaysAhead: number;
  translations?: Dict;
  locale: string;
  /** Called when the visible month changes, as YYYY-MM. */
  onMonthChange?: (month: string) => void;
}

export default function BookingCalendar({
  value,
  onChange,
  studioTimezone,
  maxDaysAhead,
  translations,
  locale,
  onMonthChange,
}: BookingCalendarProps) {
  const today = dateInZone(new Date().toISOString(), studioTimezone);
  const lastBookable = addDays(today, maxDaysAhead);

  const [view, setView] = useState(() => {
    const [y, m] = (value || today).split("-").map(Number);
    return new Date(y, m - 1, 1);
  });

  const days = useMemo(() => monthGrid(view), [view]);
  const viewMonth = `${view.getFullYear()}-${String(view.getMonth() + 1).padStart(2, "0")}`;
  const atFirstMonth = viewMonth <= today.slice(0, 7);

  function step(offset: number) {
    const next = new Date(view.getFullYear(), view.getMonth() + offset, 1);
    setView(next);
    onMonthChange?.(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
  }

  const dayNames = (["mo", "tu", "we", "th", "fr", "sa", "su"] as const).map((k) =>
    t(translations, "calendar.days", k, k.toUpperCase()),
  );

  return (
    <div className="mx-auto max-w-[320px] space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/20 p-2 shadow-2xl backdrop-blur-sm md:p-3">
      <div className="flex items-center justify-between px-1">
        <h3 className="serif-font text-sm font-bold tracking-tight text-[#FFBE4E] md:text-base">
          {view.toLocaleString(locale, { month: "long", year: "numeric" })}
        </h3>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={atFirstMonth}
            aria-label={t(translations, "ui.buttons", "prev_month", "Previous month")}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-zinc-800 transition-colors hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={t(translations, "ui.buttons", "next_month", "Next month")}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-zinc-800 transition-colors hover:bg-zinc-900"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px text-center">
        {dayNames.map((day) => (
          <div key={day} className="py-1 text-[8px] font-black tracking-[0.1em] text-zinc-700">{day}</div>
        ))}

        {days.map((date, i) => {
          if (!date) return <div key={`blank-${i}`} className="aspect-square" />;

          const key = cellKey(date);
          const selected = value === key;
          const isToday = key === today;
          const past = key < today;
          const beyond = key > lastBookable;
          const disabled = past || beyond;

          return (
            <div key={key} className={`group/day relative ${disabled ? "cursor-not-allowed" : ""}`}>
              <button
                type="button"
                aria-disabled={disabled}
                aria-current={isToday ? "date" : undefined}
                aria-pressed={selected}
                onClick={() => { if (!disabled) onChange(key); }}
                className={`flex aspect-square w-full items-center justify-center rounded-sm border text-[9px] font-bold transition-all duration-300 ${
                  selected
                    ? "z-10 scale-[1.03] border-[#FFBE4E] bg-[#FFBE4E] text-black shadow-md shadow-[#FFBE4E]/20"
                    : disabled
                      ? "pointer-events-none border-transparent text-zinc-800 group-hover/day:pointer-events-auto"
                      : "border-transparent text-zinc-500 hover:border-zinc-800 hover:bg-zinc-900/50 hover:text-white"
                }`}
              >
                {date.getDate()}
                {isToday && !selected && <div className="absolute bottom-0.5 h-0.5 w-0.5 rounded-full bg-[#FFBE4E]" />}
              </button>

              {beyond && (
                <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-50 w-48 shrink-0 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 p-3 opacity-0 shadow-xl transition-opacity group-hover/day:opacity-100">
                  <p className="whitespace-normal break-words text-left text-[10px] leading-snug text-zinc-300">
                    <span className="font-bold text-white">{t(translations, "ui.messages", "unavailable", "Unavailable")}</span>
                    {" - "}
                    {t(translations, "step.calendar", "max_14_days", "Please select a date within 14 days from today.")}
                  </p>
                  <div className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-zinc-700 bg-zinc-900" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
