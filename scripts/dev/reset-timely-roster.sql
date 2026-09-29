-- Wipes the artist roster that came from the old Laravel database, so the
-- Timely scrape can rebuild it from scratch.
--
-- Everything here arrived in one batch on 2026-09-24 08:52 from
-- scripts/import-live.ts — 126 artists, their studio links, and the
-- availability blocks derived from their .ics feeds. No appointment
-- references an artist, so nothing else refers to any of it.
--
-- AFTER RUNNING THIS the booking engine has no busy blocks at all, so every
-- slot at every studio reads as free until the first successful Timely
-- scrape puts them back. Do not leave it in that state with bookings open.
--
--   docker exec -i cleo-postgres psql -U cleo -d cleopatra \
--     < scripts/dev/reset-timely-roster.sql

BEGIN;

-- Derived entirely from the .ics feeds; there is no other source for them.
DELETE FROM availability_blocks WHERE source = 'timely' OR artist_id IS NOT NULL;

DELETE FROM artist_locations;

-- Mappings point at artist rows that are about to go. The WHERE is only so
-- the printed count means something: without it every row is "updated" and a
-- second run reports 126 changes while changing nothing.
UPDATE timely_staff SET artist_id = NULL, linked_at = NULL WHERE artist_id IS NOT NULL;

DELETE FROM artists;

COMMIT;

SELECT
  (SELECT count(*) FROM artists)             AS artists,
  (SELECT count(*) FROM artist_locations)    AS links,
  (SELECT count(*) FROM availability_blocks) AS blocks,
  (SELECT count(*) FROM appointments)        AS appointments,
  (SELECT count(*) FROM locations)           AS studios,
  (SELECT count(*) FROM calls)               AS calls;
