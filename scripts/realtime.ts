/**
 * Realtime gateway.
 *   npm run realtime
 */
import "./env";
import { startRealtimeServer } from "../src/server/realtime/server";

const stop = await startRealtimeServer();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n${signal} — closing sockets`);
    void stop().then(() => process.exit(0));
  });
}
