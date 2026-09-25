"use client";

/* ── Slots going while you look at them ────────────────────────────────
 * Availability was fetched once and cached, so two people picking the same
 * time both saw it free: the second only learned otherwise at submit, after
 * filling in the whole form, with "That slot was just taken".
 *
 * The visitor has no account, so this rides the one public channel the
 * gateway serves — it carries a studio id and a timestamp, nothing more,
 * and is only a nudge to refetch.
 * ────────────────────────────────────────────────────────────────── */
import { useEffect, useRef } from "react";

interface Incoming {
  channel: string;
  topic: string;
  payload: { locationId?: number; startsAt?: string };
}

export function useLiveAvailability(locationId: number | null, onChange: () => void): void {
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    if (!locationId) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;
    // Coalesce: one Timely sync can free or take dozens of blocks at once,
    // and each arrives as its own event.
    let timer: ReturnType<typeof setTimeout> | undefined;

    /* Loaded on demand rather than imported: socket.io-client is ~40 KB and
       the booking bundle should not carry it for the steps before the
       calendar, or at all for a visitor who never reaches it. */
    void import("socket.io-client").then(({ io }) => {
      if (cancelled) return;

      const port = process.env.NEXT_PUBLIC_REALTIME_PORT ?? "4001";
      const url =
        process.env.NEXT_PUBLIC_REALTIME_URL?.trim() ||
        `${window.location.protocol}//${window.location.hostname}:${port}`;

      const channel = `availability:location:${locationId}`;
      const socket = io(url, {
        path: "/realtime",
        transports: ["websocket", "polling"],
        reconnectionDelay: 2_000,
        reconnectionDelayMax: 30_000,
      });

      const subscribe = () => socket.emit("subscribe", channel);
      const onEvent = (event: Incoming) => {
        if (event.channel !== channel) return;
        clearTimeout(timer);
        timer = setTimeout(() => handler.current(), 500);
      };

      // Re-subscribe on reconnect; the gateway forgets rooms on a drop.
      socket.on("connect", subscribe);
      socket.on("event", onEvent);
      if (socket.connected) subscribe();

      cleanup = () => {
        socket.off("connect", subscribe);
        socket.off("event", onEvent);
        socket.close();
      };
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      cleanup?.();
    };
  }, [locationId]);
}
