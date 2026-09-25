/* ── Realtime gateway ──────────────────────────────────────────────────
 * A separate Node process: Next route handlers cannot hold a socket open.
 * It shares the database, authenticates with the console's own session
 * cookie, and pushes two kinds of traffic:
 *
 *   · rows appearing in realtime_events (Postgres NOTIFY)
 *   · a periodic snapshot of who is on the booking form
 *
 * Every payload is filtered per recipient. Nothing is broadcast that the
 * receiving user could not have fetched over HTTP.
 * ────────────────────────────────────────────────────────────────── */
import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { Client } from "pg";
import { pool } from "@/db/client";
import { authenticate, authorizeChannel, scopeOf, inScope, can, type SocketUser } from "./auth";
import { presenceSnapshot } from "./presence";
import { startCallPoller, type CallEvent } from "./callPoller";

interface SocketData { user: SocketUser | null; channels: Set<string>; ip: string }

/** Envelope the NOTIFY trigger sends. */
interface RealtimeEnvelope {
  id: number;
  channel: string;
  topic: string;
  locationId: number | null;
  staffId: number | null;
  perm: string | null;
  payload: Record<string, unknown> | null;
}

const PORT = Number(process.env.REALTIME_PORT ?? 4001);
const PRESENCE_INTERVAL_MS = Number(process.env.PRESENCE_INTERVAL_MS ?? 5_000);
/* How long a revoked account can keep receiving events. One minute is two
   queries per socket per hour — cheap enough to leave on, short enough that
   "I removed their access" is true by the time anyone checks. */
const REAUTH_INTERVAL_MS = Math.max(10_000, Number(process.env.REALTIME_REAUTH_MS ?? 60_000));

/** Origins allowed to open a socket. Same-origin in practice. */
function allowedOrigins(): string[] {
  const configured = (process.env.REALTIME_ALLOWED_ORIGINS ?? "")
    .split(",").map((o) => o.trim()).filter(Boolean);
  return configured.length > 0
    ? configured
    : ["http://localhost:3000", "http://127.0.0.1:3000"];
}

export async function startRealtimeServer() {
  const http = createServer((_req, res) => {
    // The gateway serves sockets only; nothing here answers plain HTTP.
    res.writeHead(404).end();
  });

  const io = new Server(http, {
    path: "/realtime",
    serveClient: false,
    cors: { origin: allowedOrigins(), credentials: true },
    // Keep an idle socket from lingering forever.
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 1e5, // clients send tiny control messages only
  });

  /* An anonymous socket may only ever hold public channels, so it costs
     one connection and nothing else. Still capped per address: the booking
     page is open to the internet and a single host should not be able to
     hold thousands of sockets open. */
  const anonPerIp = new Map<string, number>();
  const ANON_MAX_PER_IP = Number(process.env.REALTIME_ANON_MAX_PER_IP ?? 20);

  const addressOf = (socket: Socket): string => {
    const forwarded = socket.handshake.headers["x-forwarded-for"];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return (raw?.split(",")[0] ?? socket.handshake.address ?? "unknown").trim();
  };

  /* ── 1. Identify before the connection is accepted ─────────────────── */
  io.use(async (socket, next) => {
    const data = socket.data as SocketData;
    const user = await authenticate(socket.handshake.headers.cookie);
    const ip = addressOf(socket);

    if (!user) {
      /* Not rejected outright any more: a visitor on the booking page has
         no account and still needs to see a slot go when someone else
         takes it. authorizeChannel() keeps them to the public feeds. */
      const held = anonPerIp.get(ip) ?? 0;
      if (held >= ANON_MAX_PER_IP) return next(new Error("too many connections"));
      anonPerIp.set(ip, held + 1);
    }

    data.user = user;
    data.ip = ip;
    data.channels = new Set();
    next();
  });

  io.on("connection", (socket: Socket) => {
    const data = socket.data as SocketData;
    const user = data.user;

    socket.emit("ready", user
      ? { user: { id: user.id, name: user.name, roleId: user.roleId }, scopeAll: user.scopeAll }
      : { user: null, scopeAll: false });

    /* ── 2. Every subscription is checked, every time ───────────────── */
    socket.on("subscribe", (channel: unknown, ack?: (r: unknown) => void) => {
      if (typeof channel !== "string" || channel.length > 64) {
        ack?.({ ok: false, reason: "bad channel" });
        return;
      }
      /* A socket cannot hoard subscriptions. The cap is per socket, not per
         account: opening the console in several tabs or on a second device
         is normal and each gets its own connection. An anonymous one needs
         far fewer — a visitor watches the studio they are booking. */
      if (data.channels.size >= (user ? 64 : 3)) {
        ack?.({ ok: false, reason: "too many subscriptions" });
        return;
      }

      const verdict = authorizeChannel(user, channel);
      if (!verdict.ok) {
        ack?.({ ok: false, reason: verdict.reason });
        return;
      }

      data.channels.add(channel);
      void socket.join(channel);
      ack?.({ ok: true });

      if (channel === "presence" && user) void sendPresence(socket, user);

      /* A console that has just opened has missed every diff so far, so it
         gets the calls in progress right away — the same courtesy presence
         extends. Filtered by the subscriber's own studio scope. */
      if (channel === "calls:live" && user && callPoller) {
        const live = callPoller
          .snapshot()
          .filter((c) => c.locationId === null || inScope(user, c.locationId));
        socket.emit("event", {
          channel: "calls:live",
          topic: "call.snapshot",
          payload: { calls: live },
        });
      }
    });

    socket.on("unsubscribe", (channel: unknown) => {
      if (typeof channel !== "string") return;
      data.channels.delete(channel);
      void socket.leave(channel);
    });

    socket.on("disconnect", () => {
      data.channels.clear();
      if (!user) {
        const held = (anonPerIp.get(data.ip) ?? 1) - 1;
        if (held <= 0) anonPerIp.delete(data.ip);
        else anonPerIp.set(data.ip, held);
      }
    });
  });

  /* ── 3. Database events → subscribers ──────────────────────────────── */
  const listener = new Client({ connectionString: process.env.DATABASE_URL });
  await listener.connect();
  await listener.query("listen cleo_realtime");

  listener.on("notification", async (msg) => {
    if (!msg.payload) return;
    let envelope: RealtimeEnvelope;
    try {
      envelope = JSON.parse(msg.payload) as RealtimeEnvelope;
    } catch {
      return;
    }

    const room = io.sockets.adapter.rooms.get(envelope.channel);
    if (!room || room.size === 0) return;

    for (const socketId of room) {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) continue;
      const user = (socket.data as SocketData).user;

      /* Re-check on delivery, not only on subscribe: permissions and
         studio scope can change while a socket is open. An anonymous
         socket is only ever in a public room, but anything carrying a
         permission, a studio scope or a staff target is refused outright
         rather than relying on that. */
      if (!user) {
        if (envelope.perm || envelope.locationId !== null || envelope.staffId !== null) continue;
      } else {
        if (envelope.perm && !can(user, envelope.perm)) continue;
        if (envelope.locationId !== null && !inScope(user, envelope.locationId)) continue;
        if (envelope.staffId !== null && envelope.staffId !== user.id) continue;
      }

      socket.emit("event", {
        channel: envelope.channel,
        topic: envelope.topic,
        payload: envelope.payload ?? {},
      });
    }
  });

  listener.on("error", (err) => {
    console.error("realtime: LISTEN connection error —", err.message);
    process.exit(1); // let the supervisor restart us with a fresh connection
  });

  /* ── 4. Live-visitor board ─────────────────────────────────────────── */
  async function sendPresence(socket: Socket, user: SocketUser) {
    try {
      socket.emit("presence", await presenceSnapshot(scopeOf(user)));
    } catch (err) {
      console.error("realtime: presence failed —", err instanceof Error ? err.message : err);
    }
  }

  /* ── 5. Calls in progress ──────────────────────────────────────────
   * One poller for the whole deployment, not one per browser. Its events
   * go straight to the sockets: the permanent record of a call comes from
   * the Reports sync, so writing these to realtime_events would only add
   * rows nobody reads. */
  const callPoller = process.env.VONAGE_TELEPHONY_ENABLED === "0"
    ? null
    : startCallPoller((event: CallEvent) => {
        const room = io.sockets.adapter.rooms.get("calls:live");
        if (!room || room.size === 0) return; // nobody watching — say nothing

        const call = event.type === "call.ended" ? event.call : event.call;
        const payload =
          event.type === "call.updated"
            ? { call, from: event.from, to: event.to }
            : event.type === "call.ended"
              ? { callId: event.callId, call }
              : { call };

        for (const socketId of room) {
          const socket = io.sockets.sockets.get(socketId);
          if (!socket) continue;
          const viewer = (socket.data as SocketData).user;
          /* Re-checked on delivery, not just at subscribe: a call belongs
             to a studio, and someone scoped to two branches must not see
             the third one's phones. */
          if (!viewer) continue;
          if (!can(viewer, "calls.view")) continue;
          if (call.locationId !== null && !inScope(viewer, call.locationId)) continue;
          socket.emit("event", { channel: "calls:live", topic: event.type, payload });
        }
      });

  const presenceTimer = setInterval(() => {
    const room = io.sockets.adapter.rooms.get("presence");
    if (!room || room.size === 0) return; // nobody watching — do no work

    // One query per distinct scope, not one per socket.
    const byScope = new Map<string, { scope: number[] | null; sockets: Socket[] }>();
    for (const socketId of room) {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) continue;
      // Anonymous sockets cannot reach this room, but the loop must not
      // assume it — a null here would be a crash, not a refusal.
      const presenceUser = (socket.data as SocketData).user;
      if (!presenceUser) continue;
      const scope = scopeOf(presenceUser);
      const key = scope === null ? "*" : scope.slice().sort((a, b) => a - b).join(",");
      const entry = byScope.get(key) ?? { scope, sockets: [] };
      entry.sockets.push(socket);
      byScope.set(key, entry);
    }

    for (const { scope, sockets } of byScope.values()) {
      void presenceSnapshot(scope)
        .then((snapshot) => sockets.forEach((s) => s.emit("presence", snapshot)))
        .catch((err) => console.error("realtime: presence failed —", err?.message ?? err));
    }
  }, PRESENCE_INTERVAL_MS);

  /* ── Re-checking who is still allowed to listen ────────────────────
   * The user was resolved once, in the handshake, and then never looked at
   * again. A socket outlives the reason it was opened: the console is left
   * open on a desk for a shift, so signing someone out, deactivating them,
   * changing their role or narrowing their branches did nothing to the
   * feed already streaming to that tab. The session could expire outright
   * and the events kept coming.
   *
   * Worse, auth.ts said in its own header that "deactivating an account or
   * signing out kills the socket too" — a security property the code did
   * not have and that someone would have relied on.
   *
   * So every open socket is re-resolved on a timer, from the same cookie
   * it connected with. Gone means disconnected; changed means the new
   * permissions apply immediately and any channel they no longer cover is
   * dropped from under them.
   * ────────────────────────────────────────────────────────────────── */
  const reauthTimer = setInterval(() => {
    void (async () => {
      for (const socket of io.sockets.sockets.values()) {
        const data = socket.data as SocketData;
        // An anonymous socket has nothing to re-check; it holds only the
        // public feeds and authorizeChannel already keeps it there.
        if (!data.user) continue;

        const fresh = await authenticate(socket.handshake.headers.cookie);

        if (!fresh) {
          socket.emit("signed_out", { reason: "session ended" });
          socket.disconnect(true);
          continue;
        }

        const before = JSON.stringify([fresh.roleId, fresh.scopeAll, fresh.locationIds, fresh.permissions]);
        const after = JSON.stringify([
          data.user.roleId, data.user.scopeAll, data.user.locationIds, data.user.permissions,
        ]);
        if (before === after) continue;

        data.user = fresh;

        /* Their access narrowed while they were subscribed. Leaving them
           in the room until they happen to resubscribe is the same hole
           in a slower form. */
        for (const channel of [...data.channels]) {
          if (!authorizeChannel(fresh, channel).ok) {
            data.channels.delete(channel);
            void socket.leave(channel);
            socket.emit("unsubscribed", { channel, reason: "access changed" });
          }
        }
      }
    })().catch((err) => console.error("realtime: re-auth failed —", err?.message ?? err));
  }, REAUTH_INTERVAL_MS);

  http.listen(PORT, () => {
    console.log(`realtime gateway on :${PORT}${"  origins: " + allowedOrigins().join(", ")}`);
  });

  return async function stop() {
    callPoller?.stop();
    clearInterval(presenceTimer);
    clearInterval(reauthTimer);
    await listener.end().catch(() => undefined);
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await pool.end().catch(() => undefined);
  };
}
