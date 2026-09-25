-- The audit trail was making its own subjects undeletable.
--
-- activity_log is append-only: reject_mutation() raises on any UPDATE. But
-- it also carried ON DELETE SET NULL foreign keys to staff and locations,
-- and a SET NULL *is* an UPDATE — so deleting a studio or a staff member
-- fired the cascade, hit the trigger and aborted. A branch created by
-- mistake could never be removed, because creating it had written an audit
-- row about itself.
--
-- The columns stay, as plain ids. The trail already denormalises what it
-- needs to stay readable — actor_name, target_label — so a row whose
-- subject is gone still says who did what to which studio. That is the
-- normal shape for an audit table: it must not depend on the present state
-- of the thing it describes.
alter table activity_log drop constraint if exists activity_log_actor_staff_id_staff_id_fk;
--> statement-breakpoint
alter table activity_log drop constraint if exists activity_log_location_id_locations_id_fk;
