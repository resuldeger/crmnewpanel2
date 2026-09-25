import "./env";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/client";

async function main() {
  const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from locations`);
  const t = await db.execute<{ n: number }>(sql`select count(*)::int as n from translations`);
  console.log(`DB OK — locations: ${r.rows[0].n} · translations: ${t.rows[0].n}`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(String(e)); await pool.end(); process.exit(1); });
