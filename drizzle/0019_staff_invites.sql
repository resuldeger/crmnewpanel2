-- Inviting a colleague without ever handling their password.
--
-- The alternative was to create the account with a password the admin
-- chooses and then reads out — which means a real credential travels
-- through chat or a sticky note, and the admin knows it afterwards. Here
-- the admin only ever sees a one-time link; the person sets their own
-- password and nobody else ever learns it.
--
-- Only the HASH of the token is stored, exactly as sessions are: a leaked
-- database must not hand out working invites.
create table if not exists staff_invites (
  id           bigserial primary key,
  token_hash   text not null unique,
  staff_id     integer not null references staff(id) on delete cascade,
  invited_by   integer references staff(id),
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  created_at   timestamptz not null default now()
);
--> statement-breakpoint

create index if not exists idx_staff_invites_open
  on staff_invites (staff_id) where accepted_at is null;
