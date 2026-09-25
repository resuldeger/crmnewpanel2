"use client";

/* The success screen has always linked to /b/{uuid} and the dictionary has
 * always carried `manage_booking`, `add_to_calendar`, `view_on_map`,
 * `chat_with_us`, `help_text`, `or`… but the screen only ever used four of
 * them. The layout below is the one those keys were written for: brand
 * header, the appointment as a card with the three shortcut actions, then a
 * reschedule panel that stays collapsed until asked for, then cancel.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SiteShell } from "../shell/SiteShell";
import TimezoneSelect from "../components/TimezoneSelect";
import BookingCalendar from "../components/BookingCalendar";
import ConfirmDialog from "../components/ConfirmDialog";
import { useLocaleCtx } from "../lib/locale";
import { useBookingConfig, t } from "../hooks/useBookingConfig";
import { useAvailability } from "../hooks/useAvailability";
import { useLiveAvailability } from "../hooks/useLiveAvailability";
import { identifyInLiveChat, openLiveChat } from "../lib/analytics";
import { labelInZone } from "../lib/slotTime";
import { api } from "../lib/env";

interface BookingDetail {
  uuid: string;
  status: "pending" | "confirmed" | "deposit_paid" | "completed" | "cancelled" | "no_show" | "rescheduled";
  name: string;
  locationSlug: string;
  locationName: string;
  locationShortName: string;
  address: string | null;
  mapsUrl: string | null;
  branchPhone: string | null;
  preferredDate: string;
  preferredTime: string;
  displayTimezone: string;
  startsAt: string;
  endsAt: string;
  studioTimezone: string;
  purpose: string | null;
  style: string | null;
  canReschedule: boolean;
  canCancel: boolean;
}

/** BCP-47 tag for Intl. The dictionary keys are bare language codes. */
const INTL_LOCALE: Record<string, string> = {
  en: "en-GB", tr: "tr-TR", es: "es-ES", de: "de-DE",
};

/** "24 Eylül 2026 17:30", in whichever zone the reader has selected. */
function longDateTime(iso: string, zone: string, locale: string) {
  try {
    const d = new Date(iso);
    const date = new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? locale, {
      day: "numeric", month: "long", year: "numeric", timeZone: zone,
    }).format(d);
    return `${date} ${labelInZone(iso, zone)}`;
  } catch {
    return iso;
  }
}

export default function ManageBooking({ uuid }: { uuid: string }) {
  const { locale, setLocale, available, setAvailable } = useLocaleCtx();

  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [zone, setZone] = useState("");

  const { config } = useBookingConfig(booking?.locationSlug ?? "", locale);
  useEffect(() => {
    if (config?.supportedLocales?.length) setAvailable(config.supportedLocales);
  }, [config, setAvailable]);

  const tr = useCallback(
    (ns: string, key: string, fallback: string) => t(config?.translations, ns, key, fallback),
    [config],
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch(api(`/api/booking/appointments/${uuid}`));
      if (!res.ok) throw new Error(res.status === 404 ? "not_found" : `HTTP ${res.status}`);
      const data: BookingDetail = await res.json();
      setBooking(data);
      // The zone the booking was made in is the one the booker recognises.
      setZone((z) => z || data.displayTimezone || data.studioTimezone);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [uuid]);

  useEffect(() => { void load(); }, [load]);

  const [viewMonth, setViewMonth] = useState("");
  const month = useMemo(
    () => viewMonth || (newDate || booking?.preferredDate || "").slice(0, 7),
    [viewMonth, newDate, booking],
  );
  const { data: availability, loading: slotsLoading, refetch: refetchAvailability } = useAvailability(
    booking?.locationSlug ?? "", month, zone || booking?.displayTimezone,
  );

  // Same race on the reschedule panel as on the wizard's calendar.
  useLiveAvailability(config?.location.id ?? null, refetchAvailability);

  const slots = useMemo(
    () => (newDate ? availability?.availability?.[newDate]?.slots ?? [] : []),
    [availability, newDate],
  );

  const [confirmingCancel, setConfirmingCancel] = useState(false);

  async function submit(action: "reschedule" | "cancel") {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(api(`/api/booking/appointments/${uuid}`), {
        method: action === "cancel" ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: action === "cancel" ? undefined : JSON.stringify({ preferred_date: newDate, preferred_time: newTime }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
      setNotice(
        action === "cancel"
          ? tr("ui.messages", "cancel_success", "Appointment cancelled.")
          : tr("ui.messages", "reschedule_success", "Appointment updated successfully!"),
      );
      setNewDate(""); setNewTime(""); setRescheduling(false); setConfirmingCancel(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const shell = (children: React.ReactNode) => (
    <SiteShell locale={locale} availableLocales={available} onLocaleChange={setLocale} vignette>
      <main className="relative z-10 mx-auto w-full max-w-xl flex-grow px-4 pb-20 pt-20">{children}</main>
    </SiteShell>
  );

  if (error === "not_found") {
    return shell(
      <div className="text-center">
        <p className="serif-font text-5xl font-bold text-[#FFBE4E]">404</p>
        <p className="mt-4 text-sm text-zinc-400">No appointment matches this link.</p>
        <Link href="/" className="mt-8 inline-block rounded-full bg-[#FFBE4E] px-8 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-black">
          Choose a studio
        </Link>
      </div>,
    );
  }

  /* Skeleton, not a spinner: the shape of the answer is known, so the page
     does not reflow when it arrives. */
  if (!booking) {
    return shell(
      <div className="animate-pulse">
        <div className="mx-auto h-9 w-52 rounded-lg bg-zinc-900" />
        <div className="mx-auto mt-3 h-3 w-36 rounded bg-zinc-900/70" />
        <div className="mt-10 rounded-3xl border border-zinc-900 bg-zinc-900/30 p-6">
          <div className="h-3 w-28 rounded bg-zinc-900" />
          <div className="mt-5 h-7 w-56 rounded-lg bg-zinc-900" />
          <div className="mt-4 h-4 w-40 rounded bg-zinc-900/70" />
          <div className="mt-2 h-3 w-full rounded bg-zinc-900/70" />
          <div className="mt-6 space-y-3">
            <div className="h-14 rounded-full bg-zinc-900/70" />
            <div className="h-14 rounded-full bg-zinc-900/70" />
            <div className="h-14 rounded-full bg-zinc-900/70" />
          </div>
        </div>
      </div>,
    );
  }

  const cancelled = booking.status === "cancelled";
  const shownZone = zone || booking.displayTimezone;
  const studioLabel = longDateTime(booking.startsAt, booking.studioTimezone, locale);
  const visitorLabel = longDateTime(booking.startsAt, shownZone, locale);
  const inVisitorZone = visitorLabel === studioLabel ? null : visitorLabel;
  /* A real .ics download, not a Google Calendar hand-off: it works on iOS,
     Outlook and Android alike, carries the studio address and a two-hour
     alarm, and does not send the customer's booking to a third party. */
  const icsUrl = api(`/api/booking/appointments/${booking.uuid}/ics`);

  return shell(
    <>
      <header className="mb-8 text-center">
        <p className="serif-font text-3xl font-bold text-white md:text-4xl">Cleopatra Ink</p>
        <p className="mt-2 text-[10px] font-black uppercase tracking-[0.3em] text-[#FFBE4E]">
          {tr("ui.labels", "panel_subtitle", "Appointment Management")}
        </p>
      </header>

      {notice && (
        <p role="status" className="mb-6 rounded-2xl border border-[#FFBE4E]/40 bg-[#FFBE4E]/10 p-4 text-center text-sm text-[#FFBE4E]">
          {notice}
        </p>
      )}

      <section className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-6 backdrop-blur-md">
        <h2 className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
          {tr("ui.labels", "current_appointment", "Current Appointment")}
        </h2>

        {/* Studio wall-clock leads, because that is the time the studio will
            be expecting someone and the time on the confirmation. A booker in
            another country still needs their own clock, so it follows
            underneath — but only when the two actually differ. */}
        <p className={`mt-5 flex items-start gap-3 text-xl font-bold ${cancelled ? "text-zinc-600 line-through" : "text-white"}`}>
          <span aria-hidden>📅</span>
          <span>
            {longDateTime(booking.startsAt, booking.studioTimezone, locale)}
            {inVisitorZone && (
              <span className="mt-1 block text-xs font-medium text-zinc-500">
                {tr("ui.labels", "your_time", "Your time")}: {inVisitorZone}
              </span>
            )}
          </span>
        </p>

        <p className="mt-4 flex items-start gap-3 text-sm">
          <span aria-hidden>📍</span>
          <span>
            <span className="font-bold text-white">{booking.locationShortName}</span>
            {booking.address && <span className="mt-1 block text-xs leading-relaxed text-zinc-500">{booking.address}</span>}
          </span>
        </p>

        {cancelled && (
          <p className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-center text-[10px] font-black uppercase tracking-[0.2em] text-red-400">
            {tr("ui.messages", "cancel_success", "Appointment cancelled.")}
          </p>
        )}

        <div className="mt-6 space-y-3">
          {!cancelled && (
            <a
              href={icsUrl}
              download={`cleopatra-${booking.uuid}.ics`}
              className="flex w-full items-center justify-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/50 py-4 text-[10px] font-bold uppercase tracking-[0.1em] text-white transition-colors hover:bg-zinc-800 md:text-xs"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
              {tr("ui.buttons", "add_to_calendar", "Add to Calendar")}
            </a>
          )}

          {booking.mapsUrl && (
            <a
              href={booking.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/50 py-4 text-[10px] font-bold uppercase tracking-[0.1em] text-white transition-colors hover:bg-zinc-800 md:text-xs"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
              {tr("ui.buttons", "view_on_map", "View on Map")}
            </a>
          )}

          <button
            onClick={() => {
              identifyInLiveChat({
                name: booking.name,
                studio: booking.locationShortName,
                bookingRef: booking.uuid,
              });
              openLiveChat();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-full border-2 border-zinc-800 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300 transition-all hover:border-[#FFBE4E] hover:text-[#FFBE4E] md:text-xs"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            {tr("ui.buttons", "chat_with_us", "Chat with Us")}
          </button>
        </div>
      </section>

      {!cancelled && booking.canReschedule && (
        <section className="mt-6">
          {/* The heading describes the panel, so it appears with it. Above a
              closed button it announced a picker that was not on screen. */}
          {!rescheduling ? (
            <button
              onClick={() => setRescheduling(true)}
              className="h-14 w-full rounded-full border-2 border-zinc-800 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300 transition-all hover:border-[#FFBE4E] hover:text-[#FFBE4E]"
            >
              {tr("ui.buttons", "reschedule_button", "RESCHEDULE")}
            </button>
          ) : (
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-6 backdrop-blur-md">
              <h2 className="serif-font mb-5 text-center text-xl font-bold text-white">
                {tr("ui.labels", "new_date_label", "Pick a Date & Time")}
              </h2>

              <TimezoneSelect value={shownZone} onChange={setZone} translations={config?.translations} />

              <div className="mt-6">
                <BookingCalendar
                  value={newDate}
                  onChange={(day) => { setNewDate(day); setNewTime(""); }}
                  studioTimezone={booking.studioTimezone}
                  maxDaysAhead={config?.location.maxBookingDaysAhead ?? 14}
                  translations={config?.translations}
                  locale={locale}
                  onMonthChange={setViewMonth}
                />
              </div>

              {newDate && (
                <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {slotsLoading &&
                    Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="h-12 animate-pulse rounded-xl bg-zinc-900/60" />
                    ))}

                  {!slotsLoading && slots.length === 0 && (
                    <p className="col-span-full py-4 text-center text-xs text-zinc-600">
                      {tr("ui.messages", "no_slots", "NO AVAILABLE SLOTS")}
                    </p>
                  )}

                  {!slotsLoading && slots.map((slot) => {
                    // The grid is read in the selected zone, but the value
                    // sent back is always studio wall-clock — the API stores
                    // studio time, so sending the visitor's label would move
                    // the booking by the offset between them.
                    const shown = slot.startsAt ? labelInZone(slot.startsAt, shownZone) : slot.time;
                    return (
                      <button
                        key={slot.time}
                        disabled={slot.booked}
                        onClick={() => setNewTime(slot.time)}
                        className={`h-12 rounded-xl border text-xs font-bold transition-all ${
                          newTime === slot.time
                            ? "border-[#FFBE4E] bg-[#FFBE4E] text-black"
                            : slot.booked
                              ? "cursor-not-allowed border-zinc-900 text-zinc-700 line-through"
                              : "border-zinc-800 text-zinc-300 hover:border-[#FFBE4E]"
                        }`}
                      >
                        {shown}
                      </button>
                    );
                  })}
                </div>
              )}

              <button
                disabled={!newDate || !newTime || busy}
                onClick={() => submit("reschedule")}
                className="mt-6 h-14 w-full rounded-full bg-[#FFBE4E] text-[10px] font-black uppercase tracking-[0.2em] text-black transition-transform disabled:cursor-not-allowed disabled:bg-zinc-900 disabled:text-zinc-600 enabled:hover:scale-[1.02]"
              >
                {tr("ui.buttons", "update_button", "UPDATE APPOINTMENT")}
              </button>
            </div>
          )}
        </section>
      )}

      {!cancelled && booking.canCancel && (
        <>
          <div className="my-6 flex items-center gap-4">
            <div className="h-px flex-grow bg-zinc-900" />
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-700">
              {tr("ui.labels", "or", "OR")}
            </span>
            <div className="h-px flex-grow bg-zinc-900" />
          </div>

          <button
            disabled={busy}
            onClick={() => setConfirmingCancel(true)}
            className="h-14 w-full rounded-full border-2 border-red-500/40 text-[10px] font-black uppercase tracking-[0.2em] text-red-400 transition-colors hover:bg-red-500/10"
          >
            {tr("ui.buttons", "cancel_button", "CANCEL APPOINTMENT")}
          </button>
        </>
      )}

      {error && error !== "not_found" && (
        <p role="alert" className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center text-xs text-red-300">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirmingCancel}
        busy={busy}
        danger
        title={tr("ui.buttons", "cancel_button", "Cancel appointment")}
        body={tr("ui.messages", "cancel_confirm", "Are you sure you want to cancel?")}
        confirmLabel={tr("ui.buttons", "cancel_confirm_yes", "Yes, cancel it")}
        cancelLabel={tr("ui.buttons", "cancel_confirm_no", "Keep my appointment")}
        onConfirm={() => void submit("cancel")}
        onCancel={() => setConfirmingCancel(false)}
      />

      {booking.branchPhone && (
        <footer className="mt-12 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-600">
            {tr("ui.labels", "help_text", "NEED HELP?")}
          </p>
          <a
            /* A tel: URI must be dialable characters only — "+1 (253) 555-0100"
               is shown to the reader but some dialers refuse it. */
            href={`tel:${booking.branchPhone.replace(/[^\d+]/g, "")}`} className="mt-2 inline-block text-lg font-bold text-[#FFBE4E]">
            {booking.branchPhone}
          </a>
        </footer>
      )}
    </>,
  );
}
