"use client";

/* ── Live channel subscription ─────────────────────────────────────────
 * The gateway has been publishing appointment, lead and call events since
 * the webhooks were written, but nothing in the console listened: only the
 * presence board used the socket. A booking a customer moved overnight, or
 * a lead that just landed, showed up only when somebody reloaded.
 *
 * Handlers are kept in a ref so a caller can pass an inline function
 * without re-subscribing on every render — resubscribing per keystroke
 * would churn rooms on the gateway.
 * ────────────────────────────────────────────────────────────────── */
import { useEffect, useRef } from "react";
import { getSocket, type RealtimeEvent } from "../services/realtime";

export type RealtimeStatus = "connecting" | "live" | "offline";

export function useRealtimeChannels(
  channels: string[],
  onEvent: (event: RealtimeEvent) => void,
  enabled = true,
): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  // A stable key so re-ordering the same channels does not resubscribe.
  const key = [...channels].sort().join("|");

  useEffect(() => {
    if (!enabled || key === "") return;
    const list = key.split("|");
    const socket = getSocket();

    const subscribeAll = () => list.forEach((c) => socket.emit("subscribe", c));
    const onIncoming = (event: RealtimeEvent) => {
      // The gateway fans out per room, but a socket may hold several rooms;
      // ignore anything this caller did not ask for.
      if (list.includes(event.channel)) handler.current(event);
    };

    /* Re-subscribe on every connect, not just the first: after a drop the
       gateway has forgotten the rooms, and without this the console goes
       quiet for the rest of the shift while still looking connected. */
    socket.on("connect", subscribeAll);
    socket.on("event", onIncoming);
    if (socket.connected) subscribeAll();

    return () => {
      socket.off("connect", subscribeAll);
      socket.off("event", onIncoming);
      list.forEach((c) => socket.emit("unsubscribe", c));
    };
  }, [key, enabled]);
}
