/* ── Wipe the operational data, keep the configuration ─────────────────
 * Clears everything the system produced while being tested — bookings,
 * leads, customers, messages, calls, sessions — and keeps everything that
 * was imported or configured: studios, their numbers and credentials,
 * artists and their Timely calendars, staff accounts, translations.
 *
 * activity_log is append-only, so its trigger is suspended for the one
 * statement that empties it and restored immediately after. That is the
 * only way to reset it, and it is deliberate rather than a side effect of
 * some other delete.
 * ────────────────────────────────────────────────────────────────── */
import "./env";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

async function main() {
  if (process.env.NODE_ENV === "production" && process.argv[2] !== "--yes-really") {
    console.error("Refusing to wipe a production database without --yes-really");
    process.exit(1);
  }

  const before = await db.execute<{ t: string; n: number }>(sql`
    select 'appointments' as t, count(*)::int as n from appointments
    union all select 'leads', count(*)::int from leads
    union all select 'customers', count(*)::int from customers
  `).then(r => r.rows);

  await db.execute(sql`
    begin;

    -- Children first: the tables below reference these rows.
    delete from sms_messages;
    delete from sms_conversations;
    delete from scheduled_messages;
    delete from calls;
    delete from tasks;
    delete from notes;
    delete from uploads;
    delete from realtime_events;
    delete from webhook_deliveries;

    -- Slot blocks that came from OUR bookings. Timely's stay: they are a
    -- copy of the studios' real diaries, not test data.
    delete from availability_blocks where source <> 'timely';

    delete from appointments;
    delete from leads;
    delete from customers;
    delete from booking_sessions;

    -- Daily rollups are derived; they rebuild from whatever comes next.
    delete from location_daily_stats;
    delete from staff_daily_stats;

    commit;
  `);

  /* The audit trail refuses UPDATE and DELETE by design. Emptying it is a
     deliberate act, so the guard comes off for exactly one statement. */
  await db.execute(sql`alter table activity_log disable trigger trg_activity_log_immutable`);
  await db.execute(sql`delete from activity_log`);
  await db.execute(sql`alter table activity_log enable trigger trg_activity_log_immutable`);

  const after = await db.execute<{ t: string; n: number }>(sql`
    select 'locations' as t, count(*)::int as n from locations
    union all select 'artists', count(*)::int from artists
    union all select 'staff', count(*)::int from staff
    union all select 'numbers', count(*)::int from numbers
    union all select 'timely_blocks', count(*)::int from availability_blocks where source = 'timely'
    union all select 'appointments', count(*)::int from appointments
    union all select 'leads', count(*)::int from leads
    union all select 'customers', count(*)::int from customers
  `).then(r => r.rows);

  console.log("silindi:", before.map(r => `${r.t}=${r.n}`).join(" "));
  console.log("kalan  :", after.map(r => `${r.t}=${r.n}`).join(" "));
  process.exit(0);
}

void main();
