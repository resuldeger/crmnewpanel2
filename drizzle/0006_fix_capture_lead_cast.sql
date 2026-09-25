-- CASE returns text; the leads.call_status column is an enum. Cast it.
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
    (case when s.phone_e164 is null then 'no_pn' else 'not_called' end)::call_status_t,
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
