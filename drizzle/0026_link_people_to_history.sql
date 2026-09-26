-- ── A person's history follows them ───────────────────────────────────
-- Calls, texts and bookings are all linked to a customer at the moment
-- they are written — and only then. Nothing links backwards.
--
-- Which is the wrong way round for how this data actually arrives. The
-- call log fills up first: 10,924 calls are on file and not one of them
-- is attached to anybody, because there is nobody to attach them to yet.
-- The customers arrive later, from a CSV import or from their first
-- booking, and when they do, every conversation we have already had with
-- them stays orphaned. The customer's own screen shows no history at all
-- while the call log holds twenty calls from their number.
--
-- So the link is made when either side appears. A number is matched on
-- its digits, because the same person is stored as "+14045550101" in one
-- table and "+1 (404) 555-0101" in another.

create or replace function digits_of(raw text) returns text
  language sql immutable parallel safe as
$$ select regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g') $$;

-- Equality on the digits, which is what the linking asks. The existing
-- trigram indexes serve `like '%…%'` searching and cannot answer this.
create index if not exists idx_calls_from_digits
  on calls (digits_of(from_number)) where direction = 'inbound';
create index if not exists idx_calls_to_digits
  on calls (digits_of(to_number)) where direction = 'outbound';
create index if not exists idx_sms_conv_digits
  on sms_conversations (digits_of(phone_e164));

/* Attaches everything already on file for one number.
 *
 * Only ever fills a blank: a link made by the code that wrote the row
 * knows more than this does, and a call already attached to someone is
 * not re-pointed because a lead turned up with the same number. */
create or replace function link_history_to_person(
  p_phone       text,
  p_customer_id uuid,
  p_lead_id     text
) returns integer language plpgsql as $$
declare
  v_digits text := digits_of(p_phone);
  v_calls  integer := 0;
  v_convs  integer := 0;
begin
  -- Below seven digits it is an extension or a short code, not a person.
  if length(v_digits) < 7 then return 0; end if;

  update calls c
     set customer_id = coalesce(c.customer_id, p_customer_id),
         lead_id     = coalesce(c.lead_id, p_lead_id)
   where (c.customer_id is null or c.lead_id is null)
     and digits_of(case when c.direction = 'inbound' then c.from_number else c.to_number end) = v_digits;
  get diagnostics v_calls = row_count;

  update sms_conversations s
     set customer_id = coalesce(s.customer_id, p_customer_id),
         lead_id     = coalesce(s.lead_id, p_lead_id)
   where (s.customer_id is null or s.lead_id is null)
     and digits_of(s.phone_e164) = v_digits;
  get diagnostics v_convs = row_count;

  return v_calls + v_convs;
end;
$$;

/* Fired when a customer or lead appears, or their number changes. */
create or replace function on_person_identified() returns trigger
  language plpgsql as $$
declare
  v_customer uuid;
  v_lead     text;
begin
  if tg_table_name = 'customers' then
    v_customer := new.id;
    v_lead     := null;
  else
    v_customer := new.customer_id;
    v_lead     := new.id;
  end if;

  perform link_history_to_person(new.phone_e164, v_customer, v_lead);
  return new;
end;
$$;

drop trigger if exists trg_customer_links_history on customers;
create trigger trg_customer_links_history
  after insert or update of phone_e164, merged_into on customers
  for each row when (new.merged_into is null and new.phone_e164 is not null)
  execute function on_person_identified();

drop trigger if exists trg_lead_links_history on leads;
create trigger trg_lead_links_history
  after insert or update of phone_e164, customer_id, merged_into on leads
  for each row when (new.merged_into is null and new.phone_e164 is not null)
  execute function on_person_identified();

-- Everyone already on file, for the rows that predate the triggers.
do $$
declare r record;
begin
  for r in select id, phone_e164 from customers where merged_into is null and phone_e164 is not null loop
    perform link_history_to_person(r.phone_e164, r.id, null);
  end loop;
  for r in select id, phone_e164, customer_id from leads where merged_into is null and phone_e164 is not null loop
    perform link_history_to_person(r.phone_e164, r.customer_id, r.id);
  end loop;
end $$;
