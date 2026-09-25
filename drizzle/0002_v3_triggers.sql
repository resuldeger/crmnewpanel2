-- ============================================================
-- v3 · triggers, guards and realtime fan-out
-- ============================================================

-- ── 1. updated_at ───────────────────────────────────────────
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
--> statement-breakpoint

do $$
declare t text;
begin
  foreach t in array array[
    'locations','staff','leads','appointments','customers','booking_sessions',
    'sms_conversations','translations','booking_step_options','integrations',
    'workspace_settings','staff_daily_stats','location_daily_stats',
    'funnel_daily_stats','attribution_daily_stats','demand_heatmap','message_templates'
  ] loop
    execute format(
      'drop trigger if exists trg_%1$s_updated_at on %1$I;
       create trigger trg_%1$s_updated_at before update on %1$I
       for each row execute function set_updated_at();', t);
  end loop;
end $$;
--> statement-breakpoint

-- ── 2. activity_log is append-only ──────────────────────────
-- Accountability is worthless if an operator can rewrite it.
create or replace function reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'activity_log is append-only (attempted %)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;
--> statement-breakpoint

drop trigger if exists trg_activity_log_immutable on activity_log;
--> statement-breakpoint
create trigger trg_activity_log_immutable
  before update or delete on activity_log
  for each row execute function reject_mutation();
--> statement-breakpoint

-- ── 3. realtime fan-out: row insert → NOTIFY ────────────────
-- The Socket.IO gateway LISTENs on 'cleo_realtime'. Payload is capped at
-- 8000 bytes by Postgres, so only the routing envelope travels; the gateway
-- re-reads the row when the body is large.
create or replace function notify_realtime() returns trigger
language plpgsql as $$
declare envelope text;
begin
  envelope := json_build_object(
    'id', new.id,
    'channel', new.channel,
    'topic', new.topic,
    'locationId', new.location_id,
    'staffId', new.staff_id,
    'perm', new.required_permission,
    'payload', case when pg_column_size(new.payload) < 6000 then new.payload else null end
  )::text;
  perform pg_notify('cleo_realtime', envelope);
  return new;
end;
$$;
--> statement-breakpoint

drop trigger if exists trg_realtime_notify on realtime_events;
--> statement-breakpoint
create trigger trg_realtime_notify
  after insert on realtime_events
  for each row execute function notify_realtime();
--> statement-breakpoint

-- ── 4. human-readable lead ids (LEAD-1042) ──────────────────
create sequence if not exists lead_id_seq start with 1000;
--> statement-breakpoint
create or replace function next_lead_id() returns text
language sql as $$ select 'LEAD-' || nextval('lead_id_seq')::text $$;
--> statement-breakpoint

create sequence if not exists bk_uuid_seq start with 1;
--> statement-breakpoint
create or replace function next_bk_uuid() returns text
language sql as $$ select 'BK-' || upper(substr(md5(nextval('bk_uuid_seq')::text || clock_timestamp()::text), 1, 8)) $$;
--> statement-breakpoint

-- ── 5. an appointment always blocks its own slot ────────────
-- Keeps availability_blocks authoritative without app-side bookkeeping.
create or replace function sync_appointment_block() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    delete from availability_blocks where appointment_id = old.id;
    return old;
  end if;

  if new.status in ('pending','confirmed','deposit_paid','completed') then
    insert into availability_blocks (location_id, artist_id, starts_at, ends_at, source, external_id, appointment_id)
    values (new.location_id, new.artist_id, new.starts_at, new.ends_at, 'appointment', 'appt:' || new.id, new.id)
    on conflict (source, external_id) do update
      set location_id = excluded.location_id,
          artist_id   = excluded.artist_id,
          starts_at   = excluded.starts_at,
          ends_at     = excluded.ends_at;
  else
    delete from availability_blocks where appointment_id = new.id;
  end if;
  return new;
end;
$$;
--> statement-breakpoint

drop trigger if exists trg_appointment_block on appointments;
--> statement-breakpoint
create trigger trg_appointment_block
  after insert or update of status, starts_at, ends_at, location_id, artist_id or delete
  on appointments
  for each row execute function sync_appointment_block();
--> statement-breakpoint

-- ── 6. opt-out is global per phone ──────────────────────────
create or replace function apply_unsubscribe() returns trigger
language plpgsql as $$
begin
  update sms_conversations
     set unsubscribed = true, unsubscribed_at = coalesce(unsubscribed_at, now())
   where phone_e164 = new.phone_e164;
  update leads
     set unsubscribed_at = coalesce(unsubscribed_at, now())
   where phone_e164 = new.phone_e164;
  update customers
     set unsubscribed_at = coalesce(unsubscribed_at, now())
   where phone_e164 = new.phone_e164;
  update scheduled_messages
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'opted_out'
   where to_e164 = new.phone_e164 and status = 'scheduled';
  return new;
end;
$$;
--> statement-breakpoint

drop trigger if exists trg_unsubscribe on unsubscribes;
--> statement-breakpoint
create trigger trg_unsubscribe
  after insert on unsubscribes
  for each row execute function apply_unsubscribe();
