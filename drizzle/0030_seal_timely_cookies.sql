-- Timely session cookies, sealed the same way the password is.
--
-- The password was encrypted and the session cookie beside it was not, which
-- is a distinction Timely does not make: the cookie IS a signed-in session,
-- and anyone who can read this table could paste it into a browser and be
-- inside the account without ever knowing the password. Sealing one and not
-- the other only protects the credential that is harder to use.
--
-- The old column is dropped rather than migrated. Its contents are a session,
-- not a record — the next sweep signs in again and the cost is one request.
ALTER TABLE "timely_accounts" ADD COLUMN IF NOT EXISTS "cookies_enc" text;
ALTER TABLE "timely_accounts" DROP COLUMN IF EXISTS "cookies";
