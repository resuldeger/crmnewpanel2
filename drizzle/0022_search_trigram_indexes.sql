-- ── Making the console's search box indexable ─────────────────────────
-- The list views now search in the database rather than over the hundred
-- rows a browser happened to hold. That search is `ilike '%term%'`, and a
-- leading wildcard cannot use a btree index at all — every keystroke, past
-- the debounce, becomes a sequential scan of the table.
--
-- Measured on 9,302 calls: 16 ms, reading every row to return 36. That is
-- survivable now and will not be. These studios log ~9,800 calls in a
-- single five-minute reconciliation window, and the count query runs
-- beside the list query, so the cost is paid twice per keystroke.
--
-- pg_trgm indexes the three-character sequences in a string, which is
-- exactly what a substring match needs. GIN over those makes `%term%` an
-- index lookup.
--
-- Phone columns get a second, expression index over the digits alone: the
-- search strips separators from what the operator typed and compares it
-- against the stored number stripped the same way, and an expression index
-- has to match that expression to be used.

create extension if not exists pg_trgm;

-- calls: from/to numbers, agent name, extension
create index if not exists idx_calls_from_trgm
  on calls using gin (from_number gin_trgm_ops);
create index if not exists idx_calls_to_trgm
  on calls using gin (to_number gin_trgm_ops);
create index if not exists idx_calls_agent_trgm
  on calls using gin (agent_name gin_trgm_ops);
create index if not exists idx_calls_digits_trgm
  on calls using gin (regexp_replace(from_number || to_number, '[^0-9]', '', 'g') gin_trgm_ops);

-- leads: name, email, phone, id
create index if not exists idx_leads_name_trgm
  on leads using gin (name gin_trgm_ops);
create index if not exists idx_leads_email_trgm
  on leads using gin (email gin_trgm_ops);
create index if not exists idx_leads_phone_trgm
  on leads using gin (phone_e164 gin_trgm_ops);
create index if not exists idx_leads_digits_trgm
  on leads using gin (regexp_replace(coalesce(phone_e164, ''), '[^0-9]', '', 'g') gin_trgm_ops);

-- appointments: name, email, phone, booking reference
create index if not exists idx_appts_name_trgm
  on appointments using gin (name gin_trgm_ops);
create index if not exists idx_appts_email_trgm
  on appointments using gin (email gin_trgm_ops);
create index if not exists idx_appts_phone_trgm
  on appointments using gin (phone_e164 gin_trgm_ops);
create index if not exists idx_appts_bkuuid_trgm
  on appointments using gin (bk_uuid gin_trgm_ops);
create index if not exists idx_appts_digits_trgm
  on appointments using gin (regexp_replace(coalesce(phone_e164, ''), '[^0-9]', '', 'g') gin_trgm_ops);

-- The tab counters group by status across the filtered set on every
-- keystroke. calls already has (result, start_time) and leads has a
-- partial index on (location_id, call_status); appointments had neither
-- for the created_at window the pipeline reads by.
create index if not exists idx_appts_location_created_status
  on appointments (location_id, created_at, status);
