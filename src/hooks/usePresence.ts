"use client";

import { useEffect, useState } from "react";
import { getSocket, type PresenceSnapshot } from "../services/realtime";

export type PresenceState =
  | { status: "connecting"; snapshot: null; error: null }
  | { status: "live"; snapshot: PresenceSnapshot; error: null }
  | { status: "error"; snapshot: PresenceSnapshot | null; error: string };

/**
 * Live view of who is on the booking form.
 *
 * The gateway re-checks permission and branch scope on every push, so the
 * snapshot this returns is already narrowed to what the signed-in user is
 * allowed to see.
 */
export function usePresence(enabled = true): PresenceState {
  const [state, setState] = useState<PresenceState>({ status: "connecting", snapshot: null, error: null });

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();

    const onPresence = (snapshot: PresenceSnapshot) =>
      setState({ status: "live", snapshot, error: null });

    const subscribe = () =>
      socket.emit("subscribe", "presence", (r: { ok: boolean; reason?: string }) => {
        if (!r?.ok) setState((s) => ({ status: "error", snapshot: s.snapshot, error: r?.reason ?? "refused" }));
      });

    const onError = (err: Error) =>
      setState((s) => ({ status: "error", snapshot: s.snapshot, error: err.message }));

    socket.on("presence", onPresence);
    socket.on("ready", subscribe);
    socket.on("connect_error", onError);
    if (socket.connected) subscribe();

    return () => {
      socket.off("presence", onPresence);
      socket.off("ready", subscribe);
      socket.off("connect_error", onError);
      socket.emit("unsubscribe", "presence");
    };
  }, [enabled]);

  return state;
}
