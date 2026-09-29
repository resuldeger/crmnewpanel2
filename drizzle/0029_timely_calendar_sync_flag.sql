-- Whether Timely's "Enable calendar sync" box is ticked for this staff member.
--
-- It decides whether the .ics address is real. With the box off, Timely still
-- prints a URL in the textarea, but it mints a NEW guid on every page load and
-- every one of them answers 404 — it is an offer, not an address. Ticking the
-- box and saving is what freezes one guid and makes it serve.
--
-- Measured on this account: sync on -> the URL is identical across loads and
-- returns 200; sync off -> the URL differs on each load and 404s, including a
-- guid fetched one second earlier.
--
-- Null means we have not read the staff page since this column existed.
ALTER TABLE "timely_staff" ADD COLUMN IF NOT EXISTS "calendar_sync_enabled" boolean;

-- The 30 URLs already stored from a page with the box off are dead guids.
-- Clearing them stops the sweep asking Timely for them every half hour.
UPDATE "timely_staff"
   SET "webhook_url" = NULL,
       "calendar_sync_enabled" = false,
       "webhook_error" = 'calendar sync is off in Timely'
 WHERE "webhook_error" = 'HTTP 404';
