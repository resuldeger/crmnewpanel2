-- The real Timely integration, from the live database: each staff member
-- has an iCalendar feed on webhooks.gettimely.com, and a studio's busy
-- hours are the union of its artists' feeds. The job written before this
-- assumed a REST API that does not exist for this account.
alter table locations add column if not exists timely_id bigint;
--> statement-breakpoint
create unique index if not exists uniq_locations_timely on locations (timely_id) where timely_id is not null;
--> statement-breakpoint

-- Timely's staff are our artists; the feed is how we learn when they are busy.
alter table artists add column if not exists calendar_feed_url text;
--> statement-breakpoint
alter table artists add column if not exists feed_checked_at timestamptz;
--> statement-breakpoint
alter table artists add column if not exists feed_error text;
--> statement-breakpoint
create index if not exists idx_artists_feed on artists (feed_checked_at) where calendar_feed_url is not null;
