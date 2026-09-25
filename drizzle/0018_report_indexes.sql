-- Indexes the reporting and history screens were missing.
--
-- idx_appts_live only covers the open statuses, so the admin calendar
-- filtered to "completed" or "cancelled" — the two views used for revenue
-- and no-show reports — fell back to a sequential scan of the whole table.
create index if not exists idx_appts_location_date_status
  on appointments (location_id, preferred_date, status);
--> statement-breakpoint

-- A customer's call history is ordered by time. Without the composite,
-- Postgres found the customer's rows and then sorted them on every open.
create index if not exists idx_calls_customer_start
  on calls (customer_id, start_time desc)
  where customer_id is not null;
--> statement-breakpoint

-- Inbound routing looks a caller up by number; the webhook does this on
-- every ring, when latency is audible to the person calling.
create index if not exists idx_calls_phone_start
  on calls (from_number, start_time desc);
--> statement-breakpoint

-- The retention job scans by age.
create index if not exists idx_realtime_created
  on realtime_events (created_at);
