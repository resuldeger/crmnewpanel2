# Cleopatra Ink CRM — Backend Blueprint

This document is the source of truth for the backend that powers the console in `/src`.
Stack assumption: **Supabase (Postgres + Auth + Edge Functions) · Vonage VBC · Twilio Programmable SMS · Timely**.
Schema: [`schema.sql`](./schema.sql) (single migration, transactional).

---

## 1. Architecture

```
┌──────────────┐   REST/RPC    ┌────────────────────┐      ┌───────────────┐
│  Console SPA │ ────────────► │  Supabase PostgREST │ ───► │  PostgreSQL   │
│  (this repo) │   (RLS)       │  + Edge Functions   │      │  schema.sql   │
└──────┬───────┘               └─────────┬──────────┘      └───────────────┘
       │                                 │  service-role
       │ pushState routing               ▼
       │                       ┌────────────────────┐   webhooks   ┌─────────┐
       └──── i18n dictionary ◄─┤  GET /i18n/:lang    │ ◄───────────┤ Vonage  │
                               │  (dictionary svc)   │             │ Events  │
                               └────────────────────┘             │ Twilio  │
                                                                  │ Meta CAPI│
      Workers (pg_cron → Edge Functions):                         └─────────┘
      · campaign dispatcher   · SLA monitor   · duplicate detector   · daily digest
```

**Rules**

- The SPA never talks to Vonage/Twilio directly — every side effect goes through an Edge Function with the `service_role` key.
- RLS is the authorization layer (`can(perm)` + `in_scope(loc)`); Edge Functions re-check permissions for mutations.
- All external ids (`vonage_call_uuid`, `twilio_sid`) are **unique columns** → webhooks are idempotent (retry-safe).

---

## 2. Entity map

```
roles ──< role_permissions >── permissions        profiles ──< location_scopes >── locations
                                                (auth.users 1:1 profiles)            │
locations ──< numbers                                                                    │
locations ──< artist_locations >── artists                                               │
locations ──< leads ─────────────┬──< calls                                              │
            │                    ├──< sms_conversations ──< sms_messages                  │
            │                    ├──< tasks                                               │
            │                    ├──< notes                                               │
            │                    └──< appointments ──< calls / sms / notes                │
            └──< campaigns ──< campaign_recipients >── leads
```

### 2.1 Frontend → table mapping (nothing skipped)

| Frontend type (`src/data.ts`) | Table | Notes |
|---|---|---|
| `Lead` + `LeadMeta` + `LeadAttr` | `leads` | `meta`/`utm` as JSONB; `lifecycle_status`, `merged_into` |
| `Appointment` | `appointments` | `reference_image_url`, `is_free_pick`, pricing cents |
| `CallLog` | `calls` | `+vonage_call_uuid`, `recording_url` |
| — (live call floor) | `vonage_events` | raw event stream → live feed |
| `Conversation` | `sms_conversations` | `unread_count`, `unsubscribed` |
| `SmsMessage` | `sms_messages` | `+segments`, `twilio_sid`, `campaign_id` |
| `Campaign` | `campaigns` + `campaign_recipients` | `segment` JSONB |
| `TaskItem` | `tasks` | `source`, denormalized `lead_name`/`phone_e164` |
| `Note` | `notes` | polymorphic `notable_type`/`notable_id` |
| `Studio` + `StudioConfig` + `DayHours` | `locations` | bundles as JSONB: `social`/`twilio`/`vonage`/`smtp`/`hours`; `accent`, `image_url` |
| `StudioNumber` | `numbers` | `number_kind` enum |
| `Artist` (+`locationIds`) | `artists` + `artist_locations` | |
| `Extension` | `extensions` | `location_id null` = callcenter pool |
| `Role` / `Permission` / matrix | `roles` / `permissions` / `role_permissions` | seeded to match `DEFAULT_MATRIX` |
| `StaffMember` (+`locationIds`) | `profiles` + `location_scopes` | `scope_all` ⇔ `"all"` |
| console prefs (Settings) | `workspace_settings` | single row |
| integration cards (Settings) | `integrations` | `secret_enc` encrypted |
| — (webhook idempotency) | `webhook_deliveries` | unique `(provider, external_sid)` |
| i18n dictionary (remote JSON) | `translations` | served by the i18n service |

**Key conventions**

- `leads.id` stays human-readable (`LEAD-1042`) — support staff quote it on the phone.
- `leads.merged_into` implements **soft merge**: merged rows keep history, all activity is reparented, `is_duplicate` is a generated column, every query filters `merged_into is null`.
- Money is integer cents (`deposit_cents`).
- Phones are stored **E.164** (`+14703440356`); formatted variants are derived in the client.
- Integration secrets live in `locations.{twilio,vonage,smtp}` JSONB — encrypt with `pgsodium` (column-level) or Supabase Vault before production; the console masks tokens client-side.

---

## 3. Auth & RBAC

| Step | Detail |
|---|---|
| Sign-in | Supabase Auth magic link → `auth.users` |
| Profile | `handle_new_user()` trigger creates `profiles` row (default role `viewer`, inactive until an admin activates) |
| Roles | `super_admin` (locked, implicit full access), `hq_admin`, `branch_manager`, `studio_admin`, `callcenter_agent`, `viewer` |
| Grants | `role_permissions` — the console's *Permission Matrix* edits this table via `rpc('set_role_grant')` (audited) |
| Scope | `profiles.scope_all = true` or rows in `location_scopes` — enforced by `in_scope(loc)` in every RLS policy |
| Preview | The console's "role preview" switch is **client-only**; the server always uses the real role |

---

## 4. API surface

### 4.1 Direct table access (PostgREST + RLS)

| Resource | Read | Write |
|---|---|---|
| `GET /leads?select=*,locations(city)` | `leads.view` + scope | status via `PATCH` (`leads.edit`), filtered by scope |
| `GET /appointments` | `appts.view` + scope | status via `PATCH` (`appts.edit`) |
| `GET /calls` | `calls.view` | insert only via webhooks (service role) |
| `GET /sms_conversations?select=*,sms_messages(*)` | `sms.view` | — |
| `GET /tasks` / `PATCH /tasks` | `calls.view` / `calls.manage` | due-date, status |
| `GET /locations` / `PATCH /locations` | scope / `studios.edit` | aggregate save = one `PATCH` with the whole config object |
| `GET /campaigns` | `sms.view` | only via RPC below |

### 4.2 RPC functions (Edge Functions / Postgres)

| RPC | Permission | Notes |
|---|---|---|
| `convert_lead(lead_id, date, time)` | `leads.edit` + `leads.convert` | atomic; writes `appointments`, closes SLA clock, audit row |
| `merge_leads(primary, others[], take)` | `leads.merge` | transactional reparenting + audit (§6.5) |
| `send_sms(lead_id \| phone, body)` | `sms.send` | resolves location → Twilio Messaging Service; blocks `unsubscribed`; creates conversation/message rows with `status='queued'` |
| `create_campaign(segment, body, scheduled_at)` | `sms.campaign` | materializes `campaign_recipients` (active leads, has phone, not opted out, dedup by phone) |
| `queue_campaign(id)` | `sms.campaign` | flips to `sending`; dispatcher worker picks it up |
| `log_callback(lead_id)` | `calls.manage` | outbound click-to-call via Vonage; creates `calls` row `Attempted` → updated by webhook |
| `set_role_grant(role_id, perm_id, on)` | `settings.manage` | super_admin only; audit row |
| `test_smtp(location_id)` | `studios.edit` | Edge Function opens SMTP `EHLO` + `STARTTLS`; returns latency/error |

### 4.3 Webhook receivers (Edge Functions, signature-verified)

| Endpoint | Source | Behavior |
|---|---|---|
| `POST /webhooks/vonage/event` | Vonage Events API | `answered` → upsert `calls` (by `vonage_call_uuid`, start time, agent from NCCO); `completed` → duration + recording URL; `failed/timeout` → result `Missed`; if missed & lead matched → auto-create `tasks(kind='callback', due=now()+2h)` |
| `POST /webhooks/vonage/recording` | Vonage | stores signed URL on the call row |
| `POST /webhooks/twilio/inbound` | Twilio (Messaging Service) | matches `sms_conversations` by `From`+location (Messaging Service → location map); body `STOP` → sets `unsubscribed` (+ lead.unsubscribed_at); else inserts `received` message, bumps `last_message_at`, increments unread counter |
| `POST /webhooks/twilio/status` | Twilio | updates `sms_messages.status` by `twilio_sid` (`sent/delivered/undelivered/failed`); campaign rows increment counters; `delivered`→`campaigns.delivered++` |
| `POST /webhooks/meta/lead` | Meta Lead Ads | lead intake (§6.1) |
| `POST /webhooks/timely/event` | Timely | booking confirmations/cancellations sync into `appointments` |

All webhooks verify signatures (`X-Twilio-Email-Event-Webhook-Signature`, Vonage signed webhooks, Meta `X-Hub-Signature-256`) and respond `200` fast — heavy work is queued.

---

## 5. Workers (pg_cron → Edge Functions)

| Worker | Schedule | Job |
|---|---|---|
| `campaign-dispatcher` | every 1 min | picks `campaigns.status='sending'`; sends via Twilio with per-location Messaging Service at ≤ 1 msg/s (A2P throughput); per-recipient upsert by `(campaign_id, lead_id)`; marks `sent` when all recipients terminal |
| `sla-monitor` | every 5 min | `leads.call_status='not_called' AND created_at < now() - interval '15 min'` → inserts `tasks(kind='follow_up')` once (dedup index) + notifies branch manager (in-app + optional email) |
| `duplicate-detector` | nightly | groups by normalized phone / lowercase email / `name+location`; sets `leads.is_duplicate` flags for the console's Duplicate Merge queue |
| `winback` | daily 09:00 local | `appointments.status='cancelled' AND updated_at ≈ 30d ago` → enqueues win-back template via `send_sms` (respects opt-out) |
| `daily-digest` | 08:00 per location tz | KPI rollup → SMTP via location config → `profiles` with `hq_admin`+ |

---

## 6. End-to-end flows

### 6.1 Lead intake → first call (SLA)

```
Meta Lead Ads ──webhook──► insert leads (status not_called)
                              │
                    ◄── console badge "SLA · 12m" ticks (client)
                              │
            sla-monitor (>15 min, still not_called)
                              │
                              ▼
                   tasks(kind=follow_up) + manager notify
                              │
                  agent opens Lead 360° → click-to-call
                              ▼
              Vonage outbound → webhook answered ──► calls row
                              │
                              ▼
              PATCH leads.call_status (interested | no_answer | …)
```

### 6.2 Inbound call routing (Vonage)

```
caller dials location DID (+14703440356)
        │
Vonage NCCO: DID → extension (locations.vonage.extension)
        │
event answered ──► upsert calls (lead matched by caller-id ↔ leads.phone_e164)
event completed ─► duration + recording_url
missed ──────────► calls.result=Missed + auto callback task
```

Location resolution for outbound attribution: **incoming DID → `numbers.number_e164` (kind=vonage) → `locations.id`**. The console's live floor subscribes to the same events over a Realtime channel (`vonage_live`).

### 6.3 Lead → booking

```
Lead 360° "Convert" ──► rpc convert_lead()
        │  (transaction: appointments insert + leads.appointment_made)
        ▼
sms automation ON? ──► send_sms(booking_confirmation template)
        ▼
Timely two-way sync (webhooks/timely keeps statuses aligned)
        ▼
deposit link (S-next: Twilio Pay / Stripe) ──► deposit_paid=true, status=deposit_paid
```

### 6.4 SMS automation & compliance

```
send_sms() ──► location.twilio.messaging_sid (or specific_phone)
        │  guard: conversations.unsubscribed = false
        ▼
Twilio status callback ──► sms_messages.status (queued→sent→delivered)
inbound reply ──► conversation thread; "STOP" → opt-out everywhere
campaign send ──► dispatcher throttled 1/s per location, recipient-level idempotency
```

A2P 10DLC: one Messaging Service per location, brand registration per country (US/CA/EU); opt-out state is **global per phone**, not per conversation.

### 6.5 Duplicate merge

```
duplicate-detector (nightly) flags groups → console "Duplicate Merge" queue
merge_leads(primary, others[], take{…}) in ONE transaction:
  · leads.merged_into = primary            (soft delete, auditable)
  · reparent calls / conversations / tasks / appointments
  · notes stay on both (audit trail)       · audit_log row with diff
```

### 6.6 Callback queue → task → done

```
missed call / voicemail (webhook) ──► tasks(kind in callback|voicemail, due +2h)
console Tasks: "Done" ──► rpc log_callback() ──► Vonage outbound
        answered ──► calls row + lead status update
        no answer ──► due_at += 4h (max 3 retries, then manager escalation)
```

---

## 7. i18n dictionary service

The console fetches translations at boot:

```
GET https://i18n.cleopatra.ink/api/v1/locales/{lang}.json?app=crm-console&v=<build>
→ 200 { "messages": { "English key": "Çeviri", … } }   cache-control: public, max-age=300
→ 404/5xx → console falls back to localStorage cache → embedded snapshot
```

No JSON files live in the repo for runtime consumption; the embedded snapshot in `src/i18n.tsx` exists **only** as the offline fallback and schema reference. Add keys by deploying the dictionary service; the console picks them up within 5 minutes (ETag-aware).

---

## 8. Security checklist

- [ ] RLS enabled on every table (§7 of schema) — console uses `anon` key + JWT only
- [ ] `service_role` key exists **only** in Edge Function env (webhooks/workers)
- [ ] Twilio Auth Tokens & SMTP passwords encrypted at rest (`pgsodium`) — never returned to the client in clear (mask server-side too)
- [ ] Webhook signature verification on all four receivers
- [ ] Vonage recordings served via short-lived signed URLs (`recording_url` TTL 10 min)
- [ ] `audit_log` append-only (no UPDATE/DELETE grants, even for super_admin)
- [ ] Rate limits: `send_sms` 5/min/user, campaign dispatch 1 msg/s/location
- [ ] PII export (`leads.export`) writes an audit row with actor + row count

## 9. Environment (Edge Functions)

```
SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
VONAGE_API_KEY / VONAGE_API_SECRET / VONAGE_APPLICATION_ID
TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN
META_LEAD_WEBHOOK_SECRET / TIMELY_PARTNER_KEY
I18N_SERVICE_URL
```

## 10. Migration plan

1. `supabase db push` (schema.sql) — greenfield, no data
2. Seed `roles`/`permissions` (console list is the mirror; keep ids identical)
3. Import locations from Timely export → map DIDs into `numbers`
4. Backfill historical leads/calls from the legacy sheet (ids preserved)
5. Point Vonage Events API + Twilio webhooks at the Edge Functions
6. Flip console `VITE_API_URL` from mock store to Supabase — the store layer in `src/store.tsx` is the single swap point (every mutation already funnels through it)
