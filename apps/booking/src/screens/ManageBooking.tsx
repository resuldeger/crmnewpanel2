/* The success screen has always linked to /b/{uuid} and the dictionary has
 * always carried `manage_booking`, `reschedule_button`, `cancel_button`,
 * `cancel_confirm`… but the screen itself was never built: the link 404'd.
 * This is that screen. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { SiteShell } from "../shell/SiteShell";
import { useLocaleCtx } from "../lib/locale";
import { useBookingConfig, t } from "../hooks/useBookingConfig";
import { useAvailability } from "../hooks/useAvailability";
import { api } from "../lib/env";

interface BookingDetail {
  uuid: string;
  status: "pending" | "confirmed" | "deposit_paid" | "completed" | "cancelled" | "no_show" | "rescheduled";
  name: string;
  locationSlug: string;
  locationName: string;
  preferredDate: string;
  preferredTime: string;
  displayTimezone: string;
  purpose: string | null;
  style: string | null;
  canReschedule: boolean;
  canCancel: boolean;
}

export default function ManageBooking() {
  const { uuid = "" } = useParams();
  const { locale, setLocale, available, setAvailable } = useLocaleCtx();

  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");

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
      setBooking(await res.json());
    } catch (e) {
      setError((e as Error).message);
    }
  }, [uuid]);

  useEffect(() => { void load(); }, [load]);

  const month = useMemo(() => (newDate || booking?.preferredDate || "").slice(0, 7), [newDate, booking]);
  const { data: availability } = useAvailability(booking?.locationSlug ?? "", month, booking?.displayTimezone);

  const slots = useMemo(
    () => (newDate ? availability?.availability?.[newDate]?.slots ?? [] : []),
    [availability, newDate],
  );

  async function submit(action: "reschedule" | "cancel") {
    if (action === "cancel" && !window.confirm(tr("ui.messages", "cancel_confirm", "Are you sure you want to cancel?"))) return;
    setBusy(true);
    setNotice(null);
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
      setNewDate(""); setNewTime("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const shell = (children: React.ReactNode) => (
    <SiteShell locale={locale} availableLocales={available} onLocaleChange={setLocale} vignette>
      <main className="relative z-10 mx-auto w-full max-w-xl flex-grow px-4 pb-20 pt-24">{children}</main>
    </SiteShell>
  );

  if (error === "not_found") {
    return shell(
      <div className="text-center">
        <p className="serif-font text-5xl font-bold text-[#FFBE4E]">404</p>
        <p className="mt-4 text-sm text-zinc-400">No appointment matches this link.</p>
        <Link to="/" className="mt-8 inline-block rounded-full bg-[#FFBE4E] px-8 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-black">
          Choose a studio
        </Link>
      </div>,
    );
  }

  if (!booking) {
    return shell(<div className="h-64 animate-pulse rounded-2xl border border-zinc-900 bg-zinc-900/30" />);
  }

  const cancelled = booking.status === "cancelled";

  return shell(
    <>
      <header className="mb-8 text-center">
        <h1 className="serif-font text-4xl font-bold text-white md:text-5xl">
          {tr("ui.buttons", "manage_booking", "Manage Appointment")}
        </h1>
        <p className="mt-2 text-[10px] font-black uppercase tracking-[0.3em] text-[#FFBE4E]">
          {tr("ui.labels", "panel_subtitle", "Appointment Management")}
        </p>
      </header>

      {notice && (
        <p role="status" className="mb-6 rounded-2xl border border-[#FFBE4E]/40 bg-[#FFBE4E]/10 p-4 text-center text-sm text-[#FFBE4E]">
          {notice}
        </p>
      )}

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6 backdrop-blur-md">
        <h2 className="mb-4 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
          {tr("ui.labels", "current_appointment", "Current Appointment")}
        </h2>
        <dl className="space-y-3 text-sm">
          <Row label="Reference" value={booking.uuid} mono />
          <Row label="Studio" value={booking.locationName} />
          <Row label={tr("ui.labels", "preferred_time", "Preferred Time")}
               value={`${booking.preferredDate} · ${booking.preferredTime}`} />
          <Row label="Status" value={
            <span className={cancelled ? "text-red-400" : "text-[#FFBE4E]"}>{booking.status}</span>
          } />
        </dl>
      </section>

      {!cancelled && booking.canReschedule && (
        <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6 backdrop-blur-md">
          <h2 className="mb-4 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">
            {tr("ui.labels", "new_date_label", "Pick a Date & Time")}
          </h2>

          <input
            type="date"
            value={newDate}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => { setNewDate(e.target.value); setNewTime(""); }}
            className="h-14 w-full rounded-xl border-2 border-zinc-800 bg-black/40 px-4 text-white focus:border-[#FFBE4E] focus:outline-none"
          />

          {newDate && (
            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.length === 0 && (
                <p className="col-span-full py-4 text-center text-xs text-zinc-600">
                  {tr("ui.messages", "no_slots", "NO AVAILABLE SLOTS")}
                </p>
              )}
              {slots.map((slot) => (
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
                  {slot.time}
                </button>
              ))}
            </div>
          )}

          <button
            disabled={!newDate || !newTime || busy}
            onClick={() => submit("reschedule")}
            className="mt-6 h-14 w-full rounded-full bg-[#FFBE4E] text-[10px] font-black uppercase tracking-[0.2em] text-black transition-transform disabled:cursor-not-allowed disabled:bg-zinc-900 disabled:text-zinc-600 enabled:hover:scale-[1.02]"
          >
            {tr("ui.buttons", "update_button", "UPDATE APPOINTMENT")}
          </button>
        </section>
      )}

      {!cancelled && booking.canCancel && (
        <button
          disabled={busy}
          onClick={() => submit("cancel")}
          className="mt-6 h-14 w-full rounded-full border-2 border-red-500/40 text-[10px] font-black uppercase tracking-[0.2em] text-red-400 transition-colors hover:bg-red-500/10"
        >
          {tr("ui.buttons", "cancel_button", "CANCEL APPOINTMENT")}
        </button>
      )}

      {error && error !== "not_found" && (
        <p role="alert" className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center text-xs text-red-300">
          {error}
        </p>
      )}
    </>,
  );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-zinc-900 pb-3 last:border-0 last:pb-0">
      <dt className="text-[10px] font-black uppercase tracking-widest text-zinc-600">{label}</dt>
      <dd className={`text-right text-sm text-white ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
