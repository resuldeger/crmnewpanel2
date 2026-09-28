-- A Timely staff member's private calendar URL, and how the last read went.
--
-- Its own migration rather than an edit to 0027: that one is already applied
-- here, the runner checksums what it applied, and a database that ran the old
-- 0027 would never have gained these columns.
ALTER TABLE "timely_staff" ADD COLUMN IF NOT EXISTS "webhook_url" text;
ALTER TABLE "timely_staff" ADD COLUMN IF NOT EXISTS "webhook_checked_at" timestamp with time zone;
ALTER TABLE "timely_staff" ADD COLUMN IF NOT EXISTS "webhook_error" text;
