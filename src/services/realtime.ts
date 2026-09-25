"use client";

/* ── Console socket client ─────────────────────────────────────────────
 * One connection per tab, shared by every hook. Authentication rides on
 * the session cookie, so there is nothing to store and nothing to leak.
 * ────────────────────────────────────────────────────────────────── */
import { io, type Socket } from "socket.io-client";

export interface LiveVisitor {
  sessionUuid: string;
  locationId: number | null;
  studio: string | null;
  studioSlug: string | null;
  platform: string;
  utmSource: string | null;
  utmCampaign: string | null;
  step: string;
  stepIndex: number;
  maxStepReached: number;
  locale: string;
  deviceType: string | null;
  country: string | null;
  identified: boolean;
  contactFirst: boolean;
  startedAt: string;
  lastSeenAt: string;
  secondsOnSite: number;
}

export interface PresenceSnapshot {
  total: number;
  identified: number;
  byStudio: { locationId: number; studio: string; slug: string; count: number }[];
  bySource: { source: string; count: number }[];
  byStep: { step: string; stepIndex: number; count: number }[];
  visitors: LiveVisitor[];
  at: string;
}

export interface RealtimeEvent {
  channel: string;
  topic: string;
  payload: Record<string, unknown>;
}

let socket: Socket | null = null;

function url(): string {
  const configured = process.env.NEXT_PUBLIC_REALTIME_URL?.trim();
  if (configured) return configured;

  // Default to the SAME host the console is on, only a different port.
  // The gateway authenticates with the session cookie, and cookies are
  // per-host: a cookie set on 127.0.0.1 is never sent to "localhost".
  // Hardcoding either one breaks the socket for whoever used the other.
  if (typeof window === "undefined") return "";
  const port = process.env.NEXT_PUBLIC_REALTIME_PORT ?? "4001";
  return `${window.location.protocol}//${window.location.hostname}:${port}`;
}

export function getSocket(): Socket {
  if (socket) return socket;
  socket = io(url(), {
    path: "/realtime",
    withCredentials: true,          // the session cookie travels with it
    transports: ["websocket", "polling"],
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
  });
  return socket;
}

export function closeSocket(): void {
  socket?.close();
  socket = null;
}
