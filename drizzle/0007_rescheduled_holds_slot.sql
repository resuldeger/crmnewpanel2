-- A rescheduled appointment still occupies its (new) slot. The original
-- status list left 'rescheduled' out, so moving a booking deleted its block
-- and handed the time back to the public calendar while the customer still
-- held it — two people could book the same hour.
create or replace function sync_appointment_block() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    delete from availability_blocks where appointment_id = old.id;
    return old;
  end if;

  if new.status in ('pending','confirmed','deposit_paid','completed','rescheduled') then
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
