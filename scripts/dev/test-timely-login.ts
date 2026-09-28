/* Does the real session actually sign in? Prints no secrets. */
import "../env";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { timelyAccounts } from "../../src/db/schema";
import { TimelySession, type TimelyAccountRow } from "../../src/server/timely/client";

const accounts = await db.select().from(timelyAccounts).where(eq(timelyAccounts.active, true));
if (accounts.length === 0) throw new Error("no active Timely account on file");

for (const acct of accounts) {
  const session = new TimelySession(acct as TimelyAccountRow);
  const started = Date.now();
  const res = await session.login();
  console.log(`${acct.email.padEnd(28)} ${res.ok ? "SIGNED IN" : "FAILED"}  ${Date.now() - started}ms`);
  if (!res.ok) console.log(`  ${res.detail}`);
  else console.log(`  session still valid on a second check: ${await session.isLoggedIn()}`);
}
process.exit(0);
