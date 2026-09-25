-- ── Halting a failing integration until a human says otherwise ─────────
--
-- A job that retries a refused credential on a timer does not merely fail:
-- with Vonage it locks the account, and the lockout counts from the LAST
-- attempt, so a five-minute poller keeps a locked account locked forever.
-- That happened here — a worker left running made roughly ninety-five
-- failed logins over eight hours and nobody could see why login failed.
--
-- `enabled` is the operator's own switch and is left alone; these columns
-- record that the SYSTEM stopped something, so clearing one is a
-- deliberate act by a named person rather than a side effect of a restart.

ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS halted_at        timestamptz,
  ADD COLUMN IF NOT EXISTS halt_reason      text,
  ADD COLUMN IF NOT EXISTS halt_detail      text,
  ADD COLUMN IF NOT EXISTS failure_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_failed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_failed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS cleared_at       timestamptz,
  ADD COLUMN IF NOT EXISTS cleared_by       integer,
  ADD COLUMN IF NOT EXISTS cleared_by_name  text;

-- The banner asks "is anything halted?" on most page loads, so make that
-- one index lookup rather than a scan of every provider row.
CREATE INDEX IF NOT EXISTS idx_integrations_halted
  ON integrations (halted_at) WHERE halted_at IS NOT NULL;

-- A provider we have never stored a row for still needs somewhere to
-- record a halt. Seed the global ones we actually talk to.
INSERT INTO integrations (provider, label, enabled)
SELECT v.provider, v.label, true
FROM (VALUES
  ('vonage', 'Vonage VBC'),
  ('twilio', 'Twilio'),
  ('timely', 'GetTimely'),
  ('smtp',   'SMTP')
) AS v(provider, label)
WHERE NOT EXISTS (
  SELECT 1 FROM integrations i
  WHERE i.provider = v.provider AND i.location_id IS NULL
);
