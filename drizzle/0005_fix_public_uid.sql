-- gen_random_bytes lives in pgcrypto; gen_random_uuid() is core in PG13+.
-- Avoid the extension dependency entirely.
create or replace function resolve_customer(
  p_phone   text,
  p_email   text,
  p_name    text,
  p_location int,
  p_locale  text default 'en'
) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  if p_phone is not null then
    select id into v_id from customers
     where phone_e164 = p_phone and merged_into is null limit 1;
  end if;

  if v_id is null and p_email is not null then
    select id into v_id from customers
     where lower(email) = lower(p_email) and merged_into is null limit 1;
  end if;

  if v_id is null then
    insert into customers (public_uid, name, email, phone_e164, location_id, locale)
    values (substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
            p_name, p_email, p_phone, p_location, p_locale)
    returning id into v_id;
  else
    update customers
       set name           = coalesce(nullif(p_name, ''), name),
           email          = coalesce(email, p_email),
           phone_e164     = coalesce(phone_e164, p_phone),
           last_active_at = now()
     where id = v_id;
  end if;

  return v_id;
end;
$$;
