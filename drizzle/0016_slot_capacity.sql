-- How many appointments may share one slot at a studio.
--
-- Two: one taken through our own booking form, one already in GetTimely.
-- Capacity was briefly derived from the artist roster, which gave a studio
-- with five artists five concurrent slots — far more than the chain
-- actually runs. This is a rule, not a headcount, so it is stored as one.
alter table locations
  add column if not exists slot_capacity smallint not null default 2;
--> statement-breakpoint

comment on column locations.slot_capacity is
  'Concurrent appointments per slot. 2 = one ours + one from GetTimely.';
