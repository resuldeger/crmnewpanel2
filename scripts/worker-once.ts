/** Drains the queue exactly once — handy in tests and from cron. */
import "./env";
import { pool } from "../src/db/client";
import { drainScheduledMessages } from "../src/server/sms/worker";

drainScheduledMessages()
  .then((r) => console.log(JSON.stringify(r)))
  .then(() => pool.end())
  .catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
