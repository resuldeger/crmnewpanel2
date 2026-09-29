-- Deleting someone who had invited a colleague failed with a 500.
--
-- staff_invites.invited_by had no delete rule, so Postgres refused the delete
-- and the panel showed "the server is down" for what is an ordinary removal.
-- The column is already nullable, and the right answer is the one the other
-- twenty authorship columns use: keep the invite, forget who sent it.
--
-- Reproduced before changing anything: create two staff, have one invite the
-- other, delete the inviter ->
--   ERROR: update or delete on table "staff" violates foreign key constraint
--          "staff_invites_invited_by_fkey" on table "staff_invites"
ALTER TABLE "staff_invites" DROP CONSTRAINT IF EXISTS "staff_invites_invited_by_fkey";
ALTER TABLE "staff_invites"
  ADD CONSTRAINT "staff_invites_invited_by_fkey"
  FOREIGN KEY ("invited_by") REFERENCES "staff"("id") ON DELETE SET NULL;
