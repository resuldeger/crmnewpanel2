-- ── Live availability for the booking screen ──────────────────────────
-- Two visitors picking the same slot only found out at submit time, when
-- the loser got "That slot was just taken" after filling the whole form.
--
-- This notifies directly instead of writing a realtime_events row: a Timely
-- sync can touch hundreds of blocks in one pass, and each would otherwise
-- become an audit row nobody reads. The payload carries no personal data —
-- only which studio changed and when — because the channel is readable
-- without signing in.
create or replace function notify_availability() returns trigger
language plpgsql as $$
declare
  loc int;
  moment timestamptz;
begin
  if tg_op = 'DELETE' then
    loc := old.location_id; moment := old.starts_at;
  else
    loc := new.location_id; moment := new.starts_at;
  end if;

  perform pg_notify('cleo_realtime', json_build_object(
    'channel', 'availability:location:' || loc,
    'topic',   'availability.changed',
    -- null: the channel name already names the studio, and this feed is
    -- public, so there is no scope to filter against.
    'locationId', null,
    'staffId', null,
    'perm', null,
    'payload', json_build_object('locationId', loc, 'startsAt', moment)
  )::text);

  return coalesce(new, old);
end;
$$;
--> statement-breakpoint

drop trigger if exists trg_availability_notify on availability_blocks;
--> statement-breakpoint
create trigger trg_availability_notify
  after insert or update of starts_at, ends_at, location_id or delete
  on availability_blocks
  for each row execute function notify_availability();
