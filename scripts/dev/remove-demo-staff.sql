-- Removes the nine seeded demo staff, keeping the super admin.
--
-- Real people are created by hand in the console now. Demo accounts stop
-- being harmless once a real team uses the panel: they hold real roles, real
-- branch scopes and real sign-ins, and nobody can tell which name in the
-- list is a colleague.
--
-- scripts/seed.ts no longer creates them, so this does not come back.
--
--   docker exec -i cleo-postgres psql -U cleo -d cleopatra \
--     < scripts/dev/remove-demo-staff.sql

BEGIN;

-- Anything they owned goes back to the pool rather than to a missing row.
UPDATE tasks  SET assignee_staff_id = NULL WHERE assignee_staff_id  IN (SELECT id FROM staff WHERE role_id <> 'super_admin');
UPDATE tasks  SET created_by_staff_id = NULL WHERE created_by_staff_id IN (SELECT id FROM staff WHERE role_id <> 'super_admin');
UPDATE tasks  SET done_by_staff_id = NULL WHERE done_by_staff_id    IN (SELECT id FROM staff WHERE role_id <> 'super_admin');
UPDATE calls  SET staff_id = NULL WHERE staff_id IN (SELECT id FROM staff WHERE role_id <> 'super_admin');
UPDATE extensions SET staff_id = NULL WHERE staff_id IN (SELECT id FROM staff WHERE role_id <> 'super_admin');

DELETE FROM location_scopes WHERE staff_id IN (SELECT id FROM staff WHERE role_id <> 'super_admin');
DELETE FROM staff_presence  WHERE staff_id IN (SELECT id FROM staff WHERE role_id <> 'super_admin');
DELETE FROM auth_sessions   WHERE staff_id IN (SELECT id FROM staff WHERE role_id <> 'super_admin');
DELETE FROM staff_invites   WHERE staff_id IN (SELECT id FROM staff WHERE role_id <> 'super_admin');

DELETE FROM staff WHERE role_id <> 'super_admin';

COMMIT;

SELECT id, name, email, role_id FROM staff ORDER BY id;
