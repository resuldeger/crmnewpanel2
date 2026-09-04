-- ============================================================
-- Cleopatra Ink CRM — PostgreSQL schema v2 (Supabase-compatible)
-- Migration 0002 · complete rebuild · run inside a transaction
--
-- Maps EVERY frontend entity (src/data.ts) 1:1. Nothing skipped.
--   Lead / Appointment / CallLog / Conversation / SmsMessage / Note
--   Studio(+Config) / StudioNumber / Artist / Extension / Role /
--   Permission / StaffMember / Campaign / TaskItem / console prefs /
--   integrations / i18n dictionary
-- ============================================================
begin;

create extension if not exists pgcrypto;      -- gen_random_uuid()
create extension if not exists citext;        -- case-insensitive email/slug

-- ────────────────────────────────────────────────────────────
-- 0. Enums (mirror src/data.ts union types exactly)
-- ────────────────────────────────────────────────────────────
create type platform_t     as enum ('instagram','facebook','tiktok','google','webform');
create type call_status_t  as enum (
  'not_called','no_answer','busy','interested','not_interested','callback_requested',
  'appointment_made','already_scheduled','didnt_pick_up','wrong_number',
  'double_lead','no_pn','spam','not_trusted');
create type lifecycle_t    as enum ('new','contacted','done');      -- Lead.status
create type appt_status_t  as enum ('pending','confirmed','deposit_paid','completed','cancelled','no_show','rescheduled');
create type call_result_t  as enum ('Answered','Missed','Voicemail','Attempted');
create type call_dir_t     as enum ('inbound','outbound');
create type number_kind_t  as enum ('vonage','twilio','branch');
create type sms_status_t   as enum ('queued','sent','delivered','undelivered','failed','received');
create type campaign_status_t as enum ('draft','scheduled','sending','sent','failed');
create type task_source_t  as enum ('callback','voicemail','manual');
create type task_status_t  as enum ('open','done');

-- ────────────────────────────────────────────────────────────
-- 1. RBAC (Role / Permission / StaffMember)
-- ────────────────────────────────────────────────────────────
create table roles (
  id          text primary key,               -- super_admin | hq_admin | branch_manager | studio_admin | callcenter_agent | viewer
  name        text not null,
  description text,
  color       text,                           -- UI accent, e.g. #fba200
  is_system   boolean not null default false  -- super_admin locked by policy
);

create table permissions (
  id    text primary key,                     -- leads.edit | sms.send | …
  label text not null,
  grp   text not null                         -- Leads | SMS | Calls | Studios | Staff | Settings
);

create table role_permissions (
  role_id       text not null references roles(id)       on delete cascade,
  permission_id text not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- StaffMember  (id, name, email, roleId, locationIds: "all" | number[], active, lastActiveAt)
create table profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text not null,
  email          citext not null unique,
  role_id        text not null default 'viewer' references roles(id),
  scope_all      boolean not null default false,      -- true  ⇔ locationIds = "all"
  active         boolean not null default true,
  last_active_at timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- locationIds: number[]  (only when scope_all = false)
create table location_scopes (
  profile_id  uuid not null references profiles(id) on delete cascade,
  location_id int  not null,                          -- FK added after locations
  primary key (profile_id, location_id)
);

-- ────────────────────────────────────────────────────────────
-- 2. Workspace settings & integrations  (Settings view)
-- ────────────────────────────────────────────────────────────
-- Console Preferences: autoAssign / smsSound / digest / default date range
create table workspace_settings (
  id                int primary key default 1 check (id = 1),   -- single row
  auto_assign_leads boolean not null default true,
  sms_sound         boolean not null default true,
  daily_digest      boolean not null default false,
  default_range     text    not null default '30'               -- today|7|30|all
      check (default_range in ('today','7','30','all')),
  updated_at        timestamptz not null default now()
);
insert into workspace_settings (id) values (1);

-- Integration cards: vonage / twilio / timely / meta / google / tiktok
create table integrations (
  key         text primary key,                -- vonage | twilio | timely | meta | google | tiktok
  name        text not null,
  enabled     boolean not null default false,
  key_label   text not null,                   -- "API Secret", "Auth Token" …
  secret_enc  bytea,                           -- pgp_sym_encrypt at rest (service role only)
  last_sync_at timestamptz,
  updated_at  timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────
-- 3. Locations (Studio + StudioConfig) & routable numbers
-- ────────────────────────────────────────────────────────────
create table locations (
  id                  serial primary key,
  name                text not null,                       -- "Cleopatra Ink Atlanta"
  slug                citext not null unique,              -- public URL  /{slug}/book
  manager             text,
  branch_phone        text,                                -- public / WhatsApp line
  email               text,
  address             text,
  city                text not null,
  state               text,
  country             text not null default 'USA',
  accent              text,                                -- brand accent hex (UI)
  image_url           text,                                -- generated interior photo
  -- General card
  gtm_country         text,
  gtm_city_state      text,                                -- e.g. Georgia_111590
  maps_url            text,
  lat                 numeric(10,7),                       -- geocoded from address
  lng                 numeric(10,7),
  timezone_friendly   text,                                -- "Eastern Standard Time"
  timezone_iana       text not null default 'America/New_York',
  display_order       int not null default 0,
  booking_interval_min int not null default 30,
  booking_active      boolean not null default true,       -- Enable Online Booking
  -- integration bundles (secrets encrypted — see README §Security)
  social              jsonb not null default '{}',         -- {instagram,facebook,tiktok,twitter,youtube}
  twilio              jsonb not null default '{}',         -- {account_sid,auth_token,messaging_sid,specific_phone,sms_automation}
  vonage              jsonb not null default '{}',         -- {did,extension}
  smtp                jsonb not null default '{}',         -- {enabled,sender_name,sender_email,host,port,username,password}
  hours               jsonb not null default '{}',         -- {mon:{enabled,open,close},…sun:{…}} local-time strings
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table location_scopes
  add constraint fk_location_scopes_location
  foreign key (location_id) references locations(id) on delete cascade;

-- StudioNumber  (id, studioId, kind, label, number, smsCapable)
create table numbers (
  id          serial primary key,
  location_id int not null references locations(id) on delete cascade,
  kind        number_kind_t not null,
  label       text not null,
  number_e164 text not null,
  sms_capable boolean not null default false,
  unique (number_e164)
);

-- ────────────────────────────────────────────────────────────
-- 4. CRM core: Lead / Artist / Appointment
-- ────────────────────────────────────────────────────────────
create table leads (
  id               text primary key,              -- LEAD-1042 (human-readable)
  location_id      int not null references locations(id),
  name             text not null,
  email            citext,
  phone_e164       text,                          -- normalized; null allowed (no_pn)
  platform         platform_t not null default 'webform',
  lifecycle_status lifecycle_t not null default 'new',   -- Lead.status
  call_status      call_status_t not null default 'not_called',
  utm              jsonb not null default '{}',   -- {source,medium,campaign,gclid,fbclid,ttclid,landing_page}
  meta             jsonb not null default '{}',   -- {purpose,style,story_type,story,size,body_areas[],reference_images[],language,consent}
  first_called_at  timestamptz,                   -- SLA anchor (first call ≤ 15 min)
  last_called_at   timestamptz,
  unsubscribed_at  timestamptz,                   -- A2P opt-out
  merged_into      text references leads(id),     -- set by merge RPC; rows kept for audit
  is_duplicate     boolean generated always as (merged_into is not null) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index idx_leads_active  on leads (location_id, call_status) where merged_into is null;
create index idx_leads_phone   on leads (phone_e164) where merged_into is null and phone_e164 is not null;
create index idx_leads_sla     on leads (created_at) where call_status = 'not_called' and merged_into is null;
create index idx_leads_created on leads (created_at desc);

create table artists (
  id          serial primary key,
  name        text not null,
  instagram   text,
  specialties text[] not null default '{}',
  bio         text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Artist.locationIds: number[]
create table artist_locations (
  artist_id   int not null references artists(id)   on delete cascade,
  location_id int not null references locations(id) on delete cascade,
  primary key (artist_id, location_id)
);

create table appointments (
  id                  uuid primary key default gen_random_uuid(),
  bk_uuid             text not null unique,           -- BK-XXXXXXXX (public ref)
  lead_id             text references leads(id),      -- customerId
  location_id         int not null references locations(id),
  artist_id           int references artists(id),
  name                text not null,
  email               citext,
  phone_e164          text,
  purpose             text, style text, size text,
  story_type          text, story text,
  body_areas          text[] not null default '{}',
  reference_image_url text,                           -- Appointment.referenceImage
  is_free_pick        boolean not null default false,
  preferred_date      date not null,
  preferred_time      time not null,
  status              appt_status_t not null default 'pending',
  -- revenue tracking (Reports 2.0 / S-next) — money as integer cents
  estimated_price_cents int not null default 0,
  deposit_cents         int not null default 0,
  deposit_paid          boolean not null default false,
  final_price_cents     int,
  language            text,
  platform            platform_t not null default 'webform',
  campaign            text,
  consent             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_appts_location_date on appointments (location_id, preferred_date);
create index idx_appts_status        on appointments (status);
create index idx_appts_lead          on appointments (lead_id);

-- ────────────────────────────────────────────────────────────
-- 5. Calls (CallLog) + raw Vonage event log (live floor feed)
-- ────────────────────────────────────────────────────────────
create table calls (
  id               bigserial primary key,
  direction        call_dir_t not null,
  from_number      text, to_number text,
  from_name        text, to_name   text,
  lead_id          text references leads(id),
  appointment_id   uuid references appointments(id),
  location_id      int references locations(id),
  started_at       timestamptz not null,
  duration_s       int not null default 0,
  result           call_result_t not null,
  has_recording    boolean not null default false,
  recording_url    text,                              -- signed Vonage recording URL
  agent            text, ext text,
  vonage_call_uuid uuid unique,                       -- idempotency for event webhooks
  created_at       timestamptz not null default now()
);

create index idx_calls_lead     on calls (lead_id, started_at desc);
create index idx_calls_location on calls (location_id, started_at desc);
create index idx_calls_result   on calls (result, started_at desc);

-- raw Vonage Events stream → powers the live floor, event sidebar & replays
create table vonage_events (
  id            bigserial primary key,
  event_uuid    uuid unique,                          -- idempotency
  kind          text not null,                        -- answer|queue|end|voicemail|miss|ringing
  conversation_id uuid,
  payload       jsonb not null default '{}',
  occurred_at   timestamptz not null default now()
);
create index idx_vonage_events_time on vonage_events (occurred_at desc);

-- ────────────────────────────────────────────────────────────
-- 6. Messaging: Conversation / SmsMessage / Campaign
-- ────────────────────────────────────────────────────────────
create table sms_conversations (
  id              bigserial primary key,
  location_id     int not null references locations(id),
  lead_id         text references leads(id),          -- customerId (nullable)
  phone_e164      text not null,
  customer_name   text not null,
  unread_count    int not null default 0,             -- Conversation.unreadCount
  unsubscribed    boolean not null default false,
  last_message_at timestamptz,
  unique (phone_e164, location_id)
);

create table sms_messages (
  id              bigserial primary key,
  conversation_id bigint not null references sms_conversations(id) on delete cascade,
  direction       call_dir_t not null,
  body            text not null,
  segments        int not null default 1,
  media_url       text,
  status          sms_status_t not null default 'queued',
  twilio_sid      text unique,                        -- idempotency for status callbacks
  campaign_id     bigint,                             -- set when sent by a campaign
  created_at      timestamptz not null default now()
);

create index idx_sms_conv_time on sms_messages (conversation_id, created_at);

create table campaigns (
  id           bigserial primary key,
  name         text not null,
  body         text not null,
  segment      jsonb not null default '{}',           -- {location_id?, call_status?, platform?}  ("all" = null)
  scheduled_at timestamptz not null default now(),
  status       campaign_status_t not null default 'draft',
  total        int not null default 0,
  delivered    int not null default 0,
  failed       int not null default 0,
  replied      int not null default 0,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now()
);

create table campaign_recipients (
  campaign_id  bigint not null references campaigns(id) on delete cascade,
  lead_id      text   not null references leads(id),
  status       sms_status_t not null default 'queued',
  twilio_sid   text unique,
  sent_at      timestamptz,
  delivered_at timestamptz,
  replied_at   timestamptz,
  primary key (campaign_id, lead_id)
);

-- ────────────────────────────────────────────────────────────
-- 7. Tasks / Notes / Extensions / Audit / Webhooks / i18n
-- ────────────────────────────────────────────────────────────
-- TaskItem (title, leadId, leadName, phone, locationId, assignee, dueAt, status, source)
create table tasks (
  id          bigserial primary key,
  title       text not null,
  source      task_source_t not null default 'manual',   -- callback|voicemail|manual
  lead_id     text references leads(id),
  lead_name   text,                                      -- denormalized (manual tasks may lack a lead)
  phone_e164  text,
  location_id int references locations(id),
  assignee    text,                                      -- extension, e.g. 401
  due_at      timestamptz not null,
  status      task_status_t not null default 'open',
  done_at     timestamptz,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now()
);

create index idx_tasks_open on tasks (due_at) where status = 'open';

-- Extension (extension, displayName, username, phoneNumber, locationId: null = callcenter pool)
create table extensions (
  id           serial primary key,
  extension    text not null unique,               -- 401, 404, 486 …
  display_name text not null,
  username     text not null unique,               -- Cleo.Callcenter1
  phone_number text,
  location_id  int references locations(id)
);

create table notes (
  id           bigserial primary key,
  notable_type text not null check (notable_type in ('lead','appointment')),
  notable_id   text not null,                      -- lead id (text) or appointment uuid::text
  author_id    uuid references profiles(id),
  content      text not null,
  created_at   timestamptz not null default now()
);

create index idx_notes_target on notes (notable_type, notable_id, created_at desc);

create table audit_log (
  id          bigserial primary key,
  actor_id    uuid references profiles(id),
  actor_role  text,
  action      text not null,                       -- lead.converted | lead.merged | appt.status_changed | studio.updated | campaign.sent | matrix.grant …
  entity_type text not null,
  entity_id   text not null,
  diff        jsonb,
  created_at  timestamptz not null default now()
);

create index idx_audit_entity on audit_log (entity_type, entity_id, created_at desc);

-- idempotent webhook inbox (Twilio/Vonage retries are safe)
create table webhook_deliveries (
  id           bigserial primary key,
  provider     text not null,                      -- twilio | vonage
  external_sid text not null,                      -- Twilio MessageSid / Vonage event uuid
  event_type   text not null,
  payload      jsonb not null default '{}',
  processed    boolean not null default false,
  received_at  timestamptz not null default now(),
  unique (provider, external_sid)
);

-- i18n dictionary (served to the console as the remote JSON)
create table translations (
  locale     text not null,                        -- tr | en | …
  key        text not null,                        -- English source string
  value      text not null,
  updated_at timestamptz not null default now(),
  primary key (locale, key)
);

-- ────────────────────────────────────────────────────────────
-- 8. Triggers & helpers
-- ────────────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger trg_locations_updated before update on locations    for each row execute function set_updated_at();
create trigger trg_leads_updated     before update on leads        for each row execute function set_updated_at();
create trigger trg_appts_updated     before update on appointments for each row execute function set_updated_at();
create trigger trg_settings_updated  before update on workspace_settings for each row execute function set_updated_at();

-- console permission check (used by RLS + edge functions)
create or replace function can(perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    join role_permissions rp on rp.role_id = p.role_id
    where p.id = auth.uid() and p.active and rp.permission_id = perm
  )
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role_id = 'super_admin');
$$;

create or replace function in_scope(loc int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.scope_all)
  or exists (select 1 from location_scopes ls where ls.profile_id = auth.uid() and ls.location_id = loc);
$$;

-- Lead → appointment (atomic; closes the SLA clock, writes audit)
create or replace function convert_lead(p_lead_id text, p_date date, p_time time)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l leads%rowtype; v_appt uuid;
begin
  if not can('leads.convert') then raise exception 'forbidden: leads.convert'; end if;
  select * into strict l from leads where id = p_lead_id and merged_into is null;
  if not in_scope(l.location_id) then raise exception 'forbidden: out of scope'; end if;

  insert into appointments (bk_uuid, lead_id, location_id, name, email, phone_e164,
    purpose, style, size, story_type, story, body_areas, reference_image_url,
    preferred_date, preferred_time, platform, campaign, language, consent)
  values ('BK-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
    l.id, l.location_id, l.name, l.email, l.phone_e164,
    l.meta->>'purpose', l.meta->>'style', l.meta->>'size', l.meta->>'story_type', l.meta->>'story',
    coalesce(array(select jsonb_array_elements_text(l.meta->'body_areas')), '{}'),
    l.meta->'reference_images'->>0,
    p_date, p_time, l.platform, l.utm->>'campaign', l.meta->>'language',
    coalesce((l.meta->>'consent')::boolean, false))
  returning id into v_appt;

  update leads set call_status = 'appointment_made', lifecycle_status = 'done', last_called_at = now()
   where id = p_lead_id;
  insert into audit_log (actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'console', 'lead.converted', 'lead', p_lead_id, jsonb_build_object('appointment_id', v_appt));
  return v_appt;
end $$;

-- Duplicate merge (transactional; keeps history, reparents all activity)
create or replace function merge_leads(p_primary text, p_others text[], p_take jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can('leads.merge') then raise exception 'forbidden: leads.merge'; end if;
  update leads set merged_into = p_primary where id = any (p_others);
  update leads set
    name        = coalesce(p_take->>'name', name),
    email       = coalesce(p_take->>'email', email),
    phone_e164  = coalesce(p_take->>'phone_e164', phone_e164),
    call_status = coalesce((p_take->>'call_status')::call_status_t, call_status)
  where id = p_primary;
  update calls             set lead_id = p_primary where lead_id = any (p_others);
  update sms_conversations set lead_id = p_primary where lead_id = any (p_others);
  update tasks             set lead_id = p_primary where lead_id = any (p_others);
  update appointments      set lead_id = p_primary where lead_id = any (p_others);
  insert into audit_log (actor_id, actor_role, action, entity_type, entity_id, diff)
  values (auth.uid(), 'console', 'lead.merged', 'lead', p_primary, jsonb_build_object('merged', p_others));
end $$;

-- ────────────────────────────────────────────────────────────
-- 9. Row Level Security
-- ────────────────────────────────────────────────────────────
alter table leads               enable row level security;
alter table appointments        enable row level security;
alter table calls               enable row level security;
alter table sms_conversations   enable row level security;
alter table sms_messages        enable row level security;
alter table campaigns           enable row level security;
alter table campaign_recipients enable row level security;
alter table tasks               enable row level security;
alter table notes               enable row level security;
alter table locations           enable row level security;
alter table numbers             enable row level security;
alter table audit_log           enable row level security;
alter table workspace_settings  enable row level security;
alter table integrations        enable row level security;

create policy leads_read  on leads for select using (merged_into is null and in_scope(location_id) and can('leads.view'));
create policy leads_write on leads for update using (in_scope(location_id) and can('leads.edit'));

create policy appts_read  on appointments for select using (in_scope(location_id) and can('appts.view'));
create policy appts_write on appointments for update using (in_scope(location_id) and can('appts.edit'));

create policy calls_read on calls for select
  using ((location_id is null or in_scope(location_id)) and can('calls.view'));

create policy sms_conv_read on sms_conversations for select using (in_scope(location_id) and can('sms.view'));
create policy sms_msg_read  on sms_messages for select
  using (exists (select 1 from sms_conversations c
                 where c.id = conversation_id and in_scope(c.location_id) and can('sms.view')));

create policy campaigns_read  on campaigns          for select using (can('sms.view'));
create policy campaigns_write on campaigns          for all    using (can('sms.campaign'));
create policy recipients_rw   on campaign_recipients for all   using (can('sms.campaign'));

create policy tasks_read  on tasks for select using (can('calls.view'));
create policy tasks_write on tasks for all    using (can('calls.manage')) with check (can('calls.manage'));

create policy notes_read  on notes for select using (can('leads.view'));
create policy notes_write on notes for insert with check (can('leads.edit'));

create policy locations_read  on locations for select using (in_scope(id));
create policy locations_write on locations for all    using (can('studios.edit'));
create policy numbers_rw      on numbers   for all    using (can('studios.edit'));

create policy audit_read    on audit_log          for select using (can('settings.manage'));
create policy settings_read on workspace_settings for select using (true);
create policy settings_write on workspace_settings for update using (can('settings.manage'));
create policy integrations_rw on integrations     for all    using (can('settings.manage'));

-- service role bypasses RLS: used by webhooks & workers ONLY.

-- ────────────────────────────────────────────────────────────
-- 10. Reference seed (roles, permissions, default matrix)
--     mirrors src/data.ts ROLES / PERMISSIONS / DEFAULT_MATRIX
-- ────────────────────────────────────────────────────────────
insert into roles (id, name, description, color, is_system) values
  ('super_admin',      'Super Admin',      'Full access to every module and studio.',        '#fba200', true),
  ('hq_admin',         'HQ Admin',         'Headquarters operations across all studios.',    '#4c8dff', false),
  ('branch_manager',   'Branch Manager',   'Own studio: leads, bookings, staff, numbers.',   '#2fbf71', false),
  ('studio_admin',     'Studio Admin',     'Studio day-to-day: schedule, notes, SMS.',       '#5fd6c9', false),
  ('callcenter_agent', 'Callcenter Agent', 'Calling floor: lead status, tasks, SMS.',        '#e8a33d', false),
  ('viewer',           'Viewer',           'Read-only dashboards and reports.',              '#948d7d', false);

insert into permissions (id, label, grp) values
  ('leads.view',      'View leads',              'Leads'),
  ('leads.edit',      'Edit lead status',        'Leads'),
  ('leads.convert',   'Convert lead to booking', 'Leads'),
  ('leads.merge',     'Merge duplicates',        'Leads'),
  ('leads.export',    'Export CSV',              'Leads'),
  ('appts.view',      'View appointments',       'Appointments'),
  ('appts.edit',      'Edit appointments',       'Appointments'),
  ('sms.view',        'View SMS threads',        'SMS'),
  ('sms.send',        'Send SMS',                'SMS'),
  ('sms.campaign',    'Run SMS campaigns',       'SMS'),
  ('calls.view',      'View call log',           'Calls'),
  ('calls.manage',    'Manage calls & tasks',    'Calls'),
  ('studios.edit',    'Edit studios & numbers',  'Studios'),
  ('staff.manage',    'Manage staff & roles',    'Staff'),
  ('settings.manage', 'Manage settings & keys',  'Settings');

-- default grants per role
insert into role_permissions (role_id, permission_id)
select 'hq_admin', id from permissions;

insert into role_permissions (role_id, permission_id) values
  ('branch_manager','leads.view'),('branch_manager','leads.edit'),('branch_manager','leads.convert'),
  ('branch_manager','leads.merge'),('branch_manager','leads.export'),
  ('branch_manager','appts.view'),('branch_manager','appts.edit'),
  ('branch_manager','sms.view'),('branch_manager','sms.send'),('branch_manager','sms.campaign'),
  ('branch_manager','calls.view'),('branch_manager','calls.manage'),
  ('branch_manager','studios.edit'),('branch_manager','staff.manage'),
  ('studio_admin','leads.view'),('studio_admin','leads.edit'),('studio_admin','leads.convert'),
  ('studio_admin','appts.view'),('studio_admin','appts.edit'),
  ('studio_admin','sms.view'),('studio_admin','sms.send'),
  ('studio_admin','calls.view'),
  ('callcenter_agent','leads.view'),('callcenter_agent','leads.edit'),
  ('callcenter_agent','sms.view'),('callcenter_agent','sms.send'),
  ('callcenter_agent','calls.view'),('callcenter_agent','calls.manage'),
  ('viewer','leads.view'),('viewer','appts.view'),('viewer','sms.view'),('viewer','calls.view');

commit;
