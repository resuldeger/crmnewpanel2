-- ============================================================
-- LEAD → APPOINTMENT LIFECYCLE
--
-- The rule, stated once, enforced by the database:
--
--   1. Visitor opens the booking wizard
--        → booking_sessions row. NOT a lead. Nobody calls them.
--
--   2. Visitor types name / email / phone and does NOT finish
--        → capture_lead() creates a customer + a LEAD
--          source = 'abandoned_form', call_status = 'not_called'
--        → this is the call-centre pipeline. SLA clock starts.
--        → lead-recovery SMS (5m / 2h / 24h) is queued.
--
--   3. Visitor finishes the wizard
--        → an APPOINTMENT is inserted
--        → the trigger below LINKS it to the lead and CONVERTS the lead:
--             converted_at = now()  → the lead LEAVES the pipeline
--             call_status  = 'appointment_made'
--             lifecycle    = 'done'
--        → pending recovery SMS are cancelled (they already booked)
--
--   4. Someone who books in one sitting never sat in the pipeline, but a
--      lead row is still created (source = 'completed_form', already
--      converted) so the funnel and attribution reports stay complete.
--
-- A lead row is NEVER deleted. `converted_at IS NULL` is the only thing
-- that decides whether it is still pipeline work.
-- ============================================================

-- ── The pipeline. The console's Leads screen reads ONLY this. ──────────
create or replace view lead_pipeline as
select l.*
  from leads l
 where l.merged_into is null
   and l.converted_at is null;
--> statement-breakpoint

-- ── Identity resolution: one human, many submissions ──────────────────
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
    values (encode(gen_random_bytes(12), 'hex'), p_name, p_email, p_phone, p_location, p_locale)
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
--> statement-breakpoint

-- ── Step 2: abandoned form → lead ─────────────────────────────────────
-- Called by PUT /api/booking/sessions/{uuid}/step as soon as the visitor
-- has left enough contact detail to be worth calling. Idempotent: calling
-- it on every keystroke batch updates the same lead instead of duplicating.
create or replace function capture_lead(p_session_uuid uuid)
returns text
language plpgsql as $$
declare
  s          booking_sessions%rowtype;
  v_customer uuid;
  v_lead_id  text;
begin
  select * into s from booking_sessions where session_uuid = p_session_uuid;
  if not found then
    raise exception 'unknown booking session %', p_session_uuid;
  end if;

  -- Nothing to call and nothing to write to: not a lead yet.
  if s.phone_e164 is null and s.email is null then
    return null;
  end if;

  -- Already finished the wizard → the appointment path owns this session.
  if s.is_completed then
    return s.lead_id;
  end if;

  v_customer := resolve_customer(s.phone_e164, s.email, s.full_name, s.location_id, s.locale);

  -- One lead per session.
  if s.lead_id is not null then
    update leads
       set name       = coalesce(nullif(s.full_name, ''), name),
           email      = coalesce(s.email, email),
           phone_e164 = coalesce(s.phone_e164, phone_e164),
           meta       = s.step_data,
           updated_at = now()
     where id = s.lead_id;
    return s.lead_id;
  end if;

  v_lead_id := next_lead_id();

  insert into leads (
    id, customer_id, session_id, location_id, name, email, phone_e164,
    platform, source, lifecycle_status, call_status, locale,
    utm, meta, turnstile_passed, is_trusted, created_at
  ) values (
    v_lead_id, v_customer, s.id, s.location_id,
    coalesce(nullif(s.full_name, ''), 'Unnamed lead'), s.email, s.phone_e164,
    s.platform, 'abandoned_form', 'new',
    case when s.phone_e164 is null then 'no_pn' else 'not_called' end,
    s.locale,
    jsonb_build_object(
      'utmSource',   s.utm->>'source',
      'utmMedium',   s.utm->>'medium',
      'utmCampaign', s.utm->>'campaign',
      'utmTerm',     s.utm->>'term',
      'utmContent',  s.utm->>'content',
      'gclid',       s.click_ids->>'gclid',
      'fbclid',      s.click_ids->>'fbclid',
      'ttclid',      s.click_ids->>'ttclid',
      'landingPage', s.landing_url,
      'referrer',    s.referrer
    ),
    s.step_data, s.turnstile_passed, s.is_trusted, s.created_at
  );

  update booking_sessions set lead_id = v_lead_id, updated_at = now() where id = s.id;
  return v_lead_id;
end;
$$;
--> statement-breakpoint

-- ── Step 3: appointment created → lead leaves the pipeline ────────────
create or replace function on_appointment_created() returns trigger
language plpgsql as $$
declare
  s         booking_sessions%rowtype;
  v_lead    text;
  v_cust    uuid;
begin
  if new.session_id is not null then
    select * into s from booking_sessions where id = new.session_id;
  end if;

  -- 1. identity
  v_cust := coalesce(
    new.customer_id,
    resolve_customer(new.phone_e164, new.email, new.name, new.location_id, new.locale)
  );

  -- 2. find the lead this booking belongs to
  v_lead := new.lead_id;
  if v_lead is null and s.lead_id is not null then
    v_lead := s.lead_id;
  end if;
  if v_lead is null and new.phone_e164 is not null then
    select id into v_lead from leads
     where phone_e164 = new.phone_e164
       and location_id = new.location_id
       and merged_into is null
       and converted_at is null
     order by created_at desc limit 1;
  end if;

  -- 3. no lead existed → booked in one sitting. Still record it, already
  --    converted, so funnel + attribution reports are not missing a row.
  if v_lead is null then
    v_lead := next_lead_id();
    insert into leads (
      id, customer_id, session_id, location_id, name, email, phone_e164,
      platform, source, lifecycle_status, call_status, locale,
      converted_at, converted_appointment_id, created_at
    ) values (
      v_lead, v_cust, new.session_id, new.location_id,
      new.name, new.email, new.phone_e164,
      new.platform, 'completed_form', 'done', 'appointment_made', new.locale,
      now(), new.id, new.created_at
    );
  else
    update leads
       set converted_at             = coalesce(converted_at, now()),
           converted_appointment_id = new.id,
           call_status              = 'appointment_made',
           lifecycle_status         = 'done',
           customer_id              = coalesce(customer_id, v_cust),
           updated_at               = now()
     where id = v_lead;
  end if;

  update appointments
     set lead_id = v_lead, customer_id = v_cust
   where id = new.id and (lead_id is null or customer_id is null);

  -- 4. the session is done chasing
  if s.id is not null then
    update booking_sessions
       set is_completed   = true,
           converted_at   = now(),
           appointment_id = new.id,
           lead_id        = v_lead,
           drop_off_step  = null,
           updated_at     = now()
     where id = s.id;
  end if;

  -- 5. stop the recovery chase — they booked.
  update scheduled_messages
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'booked'
   where status = 'scheduled'
     and kind in ('lead_recovery_5m','lead_recovery_2h','lead_recovery_24h')
     and (session_id = new.session_id or to_e164 = new.phone_e164);

  return new;
end;
$$;
--> statement-breakpoint

drop trigger if exists trg_appointment_created on appointments;
--> statement-breakpoint
create trigger trg_appointment_created
  after insert on appointments
  for each row execute function on_appointment_created();
--> statement-breakpoint

-- ── Abandonment bookkeeping ───────────────────────────────────────────
-- Whenever a session moves without completing, remember how far it got.
create or replace function track_session_dropoff() returns trigger
language plpgsql as $$
begin
  if new.current_step_index > new.max_step_reached then
    new.max_step_reached := new.current_step_index;
  end if;
  if not new.is_completed then
    new.drop_off_step := new.current_step;
  end if;
  new.last_seen_at := now();
  return new;
end;
$$;
--> statement-breakpoint

drop trigger if exists trg_session_dropoff on booking_sessions;
--> statement-breakpoint
create trigger trg_session_dropoff
  before update on booking_sessions
  for each row execute function track_session_dropoff();
