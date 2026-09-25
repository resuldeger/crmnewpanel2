-- ── Correcting a call's outcome by hand ───────────────────────────────
-- Vonage marks an outbound call that reached the customer's voicemail as
-- "Answered", because from the carrier's side the far end did pick up.
-- No field separates that from a real conversation, so the desk has to be
-- able to say so — and once they have, nothing may quietly undo it.
--
-- The five-minute Reports sync and both webhooks write `result` on every
-- pass. Without a flag they would overwrite the correction on the next
-- tick and the operator would watch their own edit disappear.
--
-- `result` stays the one column everything reads, so no existing query
-- changes; the flag only tells the writers to leave it alone.
alter table calls
  add column if not exists result_locked  boolean not null default false,
  add column if not exists result_set_by  integer references staff(id) on delete set null,
  add column if not exists result_set_at  timestamptz,
  add column if not exists result_was     text;

comment on column calls.result_locked is
  'A human set this outcome. Carrier syncs must not overwrite `result`.';
comment on column calls.result_was is
  'What the carrier had said before the correction, so it is not lost.';

create index if not exists idx_calls_result_locked
  on calls (result_locked) where result_locked;

-- ── The live board's own history ──────────────────────────────────────
-- The event stream on the call floor was held in a browser array of the
-- last twelve entries and written nowhere, so a reload emptied it and
-- there was never anything to report on. The poller's events now land
-- here. vonage_events already existed for exactly this and only the VIS
-- webhook was using it.
create index if not exists idx_vonage_events_occurred
  on vonage_events (occurred_at desc);
create index if not exists idx_vonage_events_type
  on vonage_events (event_type, occurred_at desc);
