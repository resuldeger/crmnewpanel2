CREATE TYPE "public"."actor_kind_t" AS ENUM('user', 'system', 'webhook', 'worker', 'import');--> statement-breakpoint
CREATE TYPE "public"."appt_status_t" AS ENUM('pending', 'confirmed', 'deposit_paid', 'completed', 'cancelled', 'no_show', 'rescheduled', 'spam');--> statement-breakpoint
CREATE TYPE "public"."audit_action_t" AS ENUM('created', 'updated', 'deleted', 'status_change', 'converted', 'merged', 'note_added', 'sms_sent', 'call_logged', 'login', 'logout', 'exported', 'permission_change', 'assigned', 'viewed_pii');--> statement-breakpoint
CREATE TYPE "public"."audit_target_t" AS ENUM('lead', 'appointment', 'customer', 'task', 'call', 'campaign', 'location', 'staff', 'role', 'translation', 'step_option', 'session', 'message');--> statement-breakpoint
CREATE TYPE "public"."availability_source_t" AS ENUM('timely', 'manual', 'appointment', 'holiday');--> statement-breakpoint
CREATE TYPE "public"."booking_step_t" AS ENUM('welcome', 'purpose', 'style', 'story', 'body_area', 'size', 'timing', 'contact', 'address', 'success');--> statement-breakpoint
CREATE TYPE "public"."call_dir_t" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."call_result_t" AS ENUM('Answered', 'Missed', 'Voicemail', 'Attempted');--> statement-breakpoint
CREATE TYPE "public"."call_status_t" AS ENUM('not_called', 'no_answer', 'busy', 'interested', 'not_interested', 'callback_requested', 'appointment_made', 'already_scheduled', 'didnt_pick_up', 'wrong_number', 'double_lead', 'no_pn', 'spam', 'not_trusted');--> statement-breakpoint
CREATE TYPE "public"."campaign_status_t" AS ENUM('draft', 'scheduled', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."channel_t" AS ENUM('sms', 'mms', 'whatsapp', 'email');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_t" AS ENUM('new', 'contacted', 'qualified', 'done');--> statement-breakpoint
CREATE TYPE "public"."message_kind_t" AS ENUM('lead_recovery_5m', 'lead_recovery_2h', 'lead_recovery_24h', 'appointment_reminder_24h', 'appointment_reminder_3h', 'booking_confirmation', 'winback', 'campaign', 'manual');--> statement-breakpoint
CREATE TYPE "public"."notable_t" AS ENUM('lead', 'appointment', 'customer');--> statement-breakpoint
CREATE TYPE "public"."number_kind_t" AS ENUM('vonage', 'twilio', 'branch');--> statement-breakpoint
CREATE TYPE "public"."platform_t" AS ENUM('instagram', 'facebook', 'tiktok', 'google', 'webform', 'direct');--> statement-breakpoint
CREATE TYPE "public"."sms_status_t" AS ENUM('scheduled', 'queued', 'processing', 'sent', 'delivered', 'received', 'undelivered', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."step_key_t" AS ENUM('purpose', 'style', 'story', 'body_area', 'size', 'timing');--> statement-breakpoint
CREATE TYPE "public"."task_source_t" AS ENUM('callback', 'voicemail', 'manual', 'follow_up', 'sla_breach');--> statement-breakpoint
CREATE TYPE "public"."task_status_t" AS ENUM('open', 'done');--> statement-breakpoint
CREATE TABLE "location_scopes" (
	"staff_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	CONSTRAINT "location_scopes_staff_id_location_id_pk" PRIMARY KEY("staff_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"group_name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" text NOT NULL,
	"permission_id" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '#7d8590' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"role_id" text NOT NULL,
	"scope_all" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"avatar_url" text,
	"phone_e164" text,
	"vonage_extension" text,
	"vonage_username" text,
	"last_active_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "artist_locations" (
	"artist_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	CONSTRAINT "artist_locations_artist_id_location_id_pk" PRIMARY KEY("artist_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"id" serial PRIMARY KEY NOT NULL,
	"legacy_id" text,
	"name" text NOT NULL,
	"email" text,
	"phone_e164" text,
	"instagram" text,
	"specialties" text[] DEFAULT '{}' NOT NULL,
	"portfolio_urls" text[] DEFAULT '{}' NOT NULL,
	"avatar_url" text,
	"bio" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extensions" (
	"id" serial PRIMARY KEY NOT NULL,
	"extension" text NOT NULL,
	"display_name" text NOT NULL,
	"username" text,
	"phone_number" text,
	"email" text,
	"user_type" text DEFAULT 'END_USER' NOT NULL,
	"location_id" integer,
	"staff_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extensions_extension_unique" UNIQUE("extension")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"legacy_id" integer,
	"manager" text,
	"branch_phone" text,
	"email" text,
	"address" text,
	"city" text NOT NULL,
	"state" text,
	"country" text DEFAULT 'USA' NOT NULL,
	"country_code" text DEFAULT 'US' NOT NULL,
	"zip" text,
	"accent" text,
	"image_url" text,
	"gtm_country" text,
	"gtm_city_state" text,
	"maps_url" text,
	"lat" numeric(10, 7),
	"lng" numeric(11, 8),
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"timezone_friendly" text,
	"default_locale" text DEFAULT 'en' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"booking_interval_min" integer DEFAULT 30 NOT NULL,
	"booking_active" boolean DEFAULT true NOT NULL,
	"max_booking_days_ahead" integer DEFAULT 14 NOT NULL,
	"same_day_lead_hours" integer DEFAULT 2 NOT NULL,
	"vip_pickup_enabled" boolean DEFAULT false NOT NULL,
	"social" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"twilio" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"vonage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"smtp" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "locations_legacy_id_unique" UNIQUE("legacy_id")
);
--> statement-breakpoint
CREATE TABLE "numbers" (
	"id" serial PRIMARY KEY NOT NULL,
	"location_id" integer NOT NULL,
	"kind" "number_kind_t" NOT NULL,
	"label" text NOT NULL,
	"number_e164" text NOT NULL,
	"sms_capable" boolean DEFAULT false NOT NULL,
	CONSTRAINT "numbers_number_e164_unique" UNIQUE("number_e164")
);
--> statement-breakpoint
CREATE TABLE "availability_blocks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"location_id" integer NOT NULL,
	"artist_id" integer,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"source" "availability_source_t" NOT NULL,
	"external_id" text,
	"appointment_id" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"location_id" integer,
	"location_slug" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"current_step" "booking_step_t" DEFAULT 'welcome' NOT NULL,
	"current_step_index" smallint DEFAULT 0 NOT NULL,
	"max_step_reached" smallint DEFAULT 0 NOT NULL,
	"drop_off_step" "booking_step_t",
	"is_completed" boolean DEFAULT false NOT NULL,
	"full_name" text,
	"email" text,
	"phone_e164" text,
	"sms_consent" boolean DEFAULT false NOT NULL,
	"contact_first" boolean DEFAULT false NOT NULL,
	"step_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"platform" "platform_t" DEFAULT 'direct' NOT NULL,
	"utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"click_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extra_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"landing_url" text,
	"referrer" text,
	"ip" text,
	"ip_country" text,
	"user_agent" text,
	"device_type" text,
	"browser" text,
	"os" text,
	"user_timezone" text,
	"turnstile_passed" boolean DEFAULT false NOT NULL,
	"turnstile_token" text,
	"is_trusted" boolean DEFAULT true NOT NULL,
	"lead_id" text,
	"appointment_id" integer,
	"converted_at" timestamp with time zone,
	"recovery_scheduled_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_sessions_session_uuid_unique" UNIQUE("session_uuid")
);
--> statement-breakpoint
CREATE TABLE "booking_step_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"location_id" integer,
	"step_key" "step_key_t" NOT NULL,
	"option_key" text NOT NULL,
	"label_translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description_translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"image_url" text,
	"skips_steps" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locales" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"native_name" text NOT NULL,
	"fallback_code" text DEFAULT 'en' NOT NULL,
	"direction" text DEFAULT 'ltr' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_closures" (
	"id" serial PRIMARY KEY NOT NULL,
	"location_id" integer NOT NULL,
	"day" date NOT NULL,
	"all_day" boolean DEFAULT true NOT NULL,
	"from_time" time,
	"to_time" time,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "translations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"location_id" integer,
	"app" text DEFAULT 'booking' NOT NULL,
	"namespace" text NOT NULL,
	"key" text NOT NULL,
	"locale" text NOT NULL,
	"value" text NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" integer,
	"appointment_id" integer,
	"lead_id" text,
	"url" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"checksum" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"bk_uuid" text NOT NULL,
	"lead_id" text,
	"customer_id" uuid,
	"session_id" integer,
	"location_id" integer NOT NULL,
	"artist_id" integer,
	"name" text NOT NULL,
	"email" text,
	"phone_e164" text,
	"purpose" text,
	"style" text,
	"size" text,
	"story_type" text,
	"story" text,
	"body_areas" text[] DEFAULT '{}' NOT NULL,
	"reference_image_url" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"preferred_date" date NOT NULL,
	"preferred_time" time NOT NULL,
	"display_timezone" text NOT NULL,
	"user_timezone" text,
	"status" "appt_status_t" DEFAULT 'pending' NOT NULL,
	"cancel_reason" text,
	"rescheduled_from_id" integer,
	"assigned_staff_id" integer,
	"confirmed_by_staff_id" integer,
	"confirmed_at" timestamp with time zone,
	"completed_by_staff_id" integer,
	"completed_at" timestamp with time zone,
	"cancelled_by_staff_id" integer,
	"cancelled_at" timestamp with time zone,
	"estimated_price_cents" integer DEFAULT 0 NOT NULL,
	"deposit_cents" integer DEFAULT 0 NOT NULL,
	"deposit_paid" boolean DEFAULT false NOT NULL,
	"deposit_paid_at" timestamp with time zone,
	"final_price_cents" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"is_free_pick" boolean DEFAULT false NOT NULL,
	"address_street" text,
	"address_city" text,
	"address_state" text,
	"address_zip" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"platform" "platform_t" DEFAULT 'webform' NOT NULL,
	"campaign" text,
	"consent" boolean DEFAULT false NOT NULL,
	"turnstile_passed" boolean DEFAULT false NOT NULL,
	"is_trusted" boolean DEFAULT true NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_bk_uuid_unique" UNIQUE("bk_uuid")
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"vonage_call_uuid" text,
	"direction" "call_dir_t" NOT NULL,
	"from_number" text NOT NULL,
	"to_number" text NOT NULL,
	"from_name" text,
	"to_name" text,
	"customer_id" uuid,
	"lead_id" text,
	"appointment_id" integer,
	"location_id" integer,
	"staff_id" integer,
	"agent_name" text,
	"extension" text,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone,
	"ring_seconds" integer DEFAULT 0 NOT NULL,
	"duration" integer DEFAULT 0 NOT NULL,
	"result" "call_result_t" NOT NULL,
	"has_recording" boolean DEFAULT false NOT NULL,
	"recording_url" text,
	"recording_path" text,
	"initiated_from_console" boolean DEFAULT false NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calls_vonage_call_uuid_unique" UNIQUE("vonage_call_uuid")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_uid" text NOT NULL,
	"name" text,
	"email" text,
	"phone_e164" text,
	"location_id" integer,
	"locale" text DEFAULT 'en' NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"first_touch_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"merged_into" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_public_uid_unique" UNIQUE("public_uid")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" uuid,
	"session_id" integer,
	"location_id" integer NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone_e164" text,
	"platform" "platform_t" DEFAULT 'webform' NOT NULL,
	"lifecycle_status" "lifecycle_t" DEFAULT 'new' NOT NULL,
	"call_status" "call_status_t" DEFAULT 'not_called' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"assigned_staff_id" integer,
	"assigned_at" timestamp with time zone,
	"utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_called_at" timestamp with time zone,
	"first_called_by_staff_id" integer,
	"last_called_at" timestamp with time zone,
	"call_attempts" integer DEFAULT 0 NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"turnstile_passed" boolean DEFAULT false NOT NULL,
	"is_trusted" boolean DEFAULT true NOT NULL,
	"merged_into" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"notable_type" "notable_t" NOT NULL,
	"notable_id" text NOT NULL,
	"author_staff_id" integer,
	"author_name" text NOT NULL,
	"content" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"lead_id" text,
	"appointment_id" integer,
	"lead_name" text,
	"phone_e164" text,
	"location_id" integer,
	"assignee_staff_id" integer,
	"created_by_staff_id" integer,
	"due_at" timestamp with time zone NOT NULL,
	"status" "task_status_t" DEFAULT 'open' NOT NULL,
	"source" "task_source_t" DEFAULT 'manual' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"done_at" timestamp with time zone,
	"done_by_staff_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vonage_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_uuid" text,
	"call_uuid" text,
	"event_type" text NOT NULL,
	"location_id" integer,
	"staff_id" integer,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vonage_events_event_uuid_unique" UNIQUE("event_uuid")
);
--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"campaign_id" integer NOT NULL,
	"lead_id" text NOT NULL,
	"to_e164" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"status" "sms_status_t" DEFAULT 'queued' NOT NULL,
	"provider_sid" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"error_message" text,
	CONSTRAINT "campaign_recipients_provider_sid_unique" UNIQUE("provider_sid")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"body_translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"segment" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "campaign_status_t" DEFAULT 'draft' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"replied" integer DEFAULT 0 NOT NULL,
	"created_by_staff_id" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"channel" "channel_t" DEFAULT 'sms' NOT NULL,
	"location_id" integer,
	"body_translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"subject_translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"merge_fields" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" "message_kind_t" NOT NULL,
	"channel" "channel_t" DEFAULT 'sms' NOT NULL,
	"session_id" integer,
	"appointment_id" integer,
	"lead_id" text,
	"location_id" integer,
	"to_e164" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"template_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rendered_body" text,
	"status" "sms_status_t" DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"message_id" integer,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_conversations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"phone_e164" text NOT NULL,
	"customer_id" uuid,
	"lead_id" text,
	"location_id" integer,
	"customer_name" text,
	"channel" "channel_t" DEFAULT 'sms' NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"unsubscribed" boolean DEFAULT false NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"last_message_body" text,
	"last_message_at" timestamp with time zone,
	"last_direction" "call_dir_t",
	"assigned_staff_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_conversations_phone_e164_unique" UNIQUE("phone_e164")
);
--> statement-breakpoint
CREATE TABLE "sms_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"direction" "call_dir_t" NOT NULL,
	"channel" "channel_t" DEFAULT 'sms' NOT NULL,
	"from_number" text,
	"to_number" text,
	"body" text DEFAULT '' NOT NULL,
	"media_urls" text[] DEFAULT '{}' NOT NULL,
	"segments" integer DEFAULT 1 NOT NULL,
	"status" "sms_status_t" DEFAULT 'queued' NOT NULL,
	"kind" "message_kind_t" DEFAULT 'manual' NOT NULL,
	"sender_staff_id" integer,
	"sender_name" text,
	"campaign_id" integer,
	"provider_sid" text,
	"error_code" text,
	"error_message" text,
	"price_cents" integer,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_messages_provider_sid_unique" UNIQUE("provider_sid")
);
--> statement-breakpoint
CREATE TABLE "unsubscribes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"phone_e164" text NOT NULL,
	"customer_id" uuid,
	"reason" text,
	"source_keyword" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unsubscribes_phone_e164_unique" UNIQUE("phone_e164")
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_kind" "actor_kind_t" DEFAULT 'user' NOT NULL,
	"actor_staff_id" integer,
	"actor_name" text NOT NULL,
	"actor_role_id" text,
	"location_id" integer,
	"target_type" "audit_target_t" NOT NULL,
	"target_id" text NOT NULL,
	"target_label" text,
	"action" "audit_action_t" NOT NULL,
	"from_value" text,
	"to_value" text,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text,
	"ip" text,
	"user_agent" text,
	"request_id" text,
	"duration_ms" integer,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attribution_daily_stats" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"location_id" integer NOT NULL,
	"platform" text NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"sessions" integer DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"appointments" integer DEFAULT 0 NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"revenue_cents" integer DEFAULT 0 NOT NULL,
	"spend_cents" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demand_heatmap" (
	"id" serial PRIMARY KEY NOT NULL,
	"location_id" integer NOT NULL,
	"week_start" date NOT NULL,
	"dow" integer NOT NULL,
	"hour" integer NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"appointments" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnel_daily_stats" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"location_id" integer NOT NULL,
	"step_index" integer NOT NULL,
	"step_key" text NOT NULL,
	"reached" integer DEFAULT 0 NOT NULL,
	"dropped_here" integer DEFAULT 0 NOT NULL,
	"advanced" integer DEFAULT 0 NOT NULL,
	"avg_seconds_on_step" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_daily_stats" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"location_id" integer NOT NULL,
	"sessions_started" integer DEFAULT 0 NOT NULL,
	"sessions_completed" integer DEFAULT 0 NOT NULL,
	"sessions_abandoned" integer DEFAULT 0 NOT NULL,
	"recovered_from_abandon" integer DEFAULT 0 NOT NULL,
	"leads_new" integer DEFAULT 0 NOT NULL,
	"leads_called" integer DEFAULT 0 NOT NULL,
	"leads_converted" integer DEFAULT 0 NOT NULL,
	"appts_created" integer DEFAULT 0 NOT NULL,
	"appts_confirmed" integer DEFAULT 0 NOT NULL,
	"appts_completed" integer DEFAULT 0 NOT NULL,
	"appts_cancelled" integer DEFAULT 0 NOT NULL,
	"appts_no_show" integer DEFAULT 0 NOT NULL,
	"calls_total" integer DEFAULT 0 NOT NULL,
	"calls_answered" integer DEFAULT 0 NOT NULL,
	"calls_missed" integer DEFAULT 0 NOT NULL,
	"talk_seconds" integer DEFAULT 0 NOT NULL,
	"sms_outbound" integer DEFAULT 0 NOT NULL,
	"sms_inbound" integer DEFAULT 0 NOT NULL,
	"opt_outs" integer DEFAULT 0 NOT NULL,
	"revenue_cents" integer DEFAULT 0 NOT NULL,
	"deposit_cents" integer DEFAULT 0 NOT NULL,
	"no_show_cost_cents" integer DEFAULT 0 NOT NULL,
	"sla_0_5m" integer DEFAULT 0 NOT NULL,
	"sla_5_15m" integer DEFAULT 0 NOT NULL,
	"sla_15_60m" integer DEFAULT 0 NOT NULL,
	"sla_60m_plus" integer DEFAULT 0 NOT NULL,
	"sla_never_called" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rollup_checkpoints" (
	"name" text PRIMARY KEY NOT NULL,
	"last_processed_id" text,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"running" boolean DEFAULT false NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "staff_daily_stats" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"staff_id" integer NOT NULL,
	"location_id" integer,
	"calls_outbound" integer DEFAULT 0 NOT NULL,
	"calls_inbound" integer DEFAULT 0 NOT NULL,
	"calls_answered" integer DEFAULT 0 NOT NULL,
	"calls_missed" integer DEFAULT 0 NOT NULL,
	"talk_seconds" integer DEFAULT 0 NOT NULL,
	"avg_talk_seconds" real DEFAULT 0 NOT NULL,
	"leads_touched" integer DEFAULT 0 NOT NULL,
	"lead_status_changes" integer DEFAULT 0 NOT NULL,
	"leads_converted" integer DEFAULT 0 NOT NULL,
	"avg_speed_to_lead_seconds" real,
	"sla_met_count" integer DEFAULT 0 NOT NULL,
	"sla_breached_count" integer DEFAULT 0 NOT NULL,
	"appts_confirmed" integer DEFAULT 0 NOT NULL,
	"appts_completed" integer DEFAULT 0 NOT NULL,
	"appts_cancelled" integer DEFAULT 0 NOT NULL,
	"appts_no_show" integer DEFAULT 0 NOT NULL,
	"sms_sent" integer DEFAULT 0 NOT NULL,
	"notes_added" integer DEFAULT 0 NOT NULL,
	"tasks_completed" integer DEFAULT 0 NOT NULL,
	"revenue_cents" integer DEFAULT 0 NOT NULL,
	"deposit_cents" integer DEFAULT 0 NOT NULL,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_presence" (
	"staff_id" integer PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"active_location_id" integer,
	"current_call_id" integer,
	"current_route" text,
	"socket_id" text,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"location_id" integer,
	"label" text NOT NULL,
	"public_key" text,
	"secret_enc" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_status" text,
	"rotated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"severity" text DEFAULT 'info' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"bucket" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "realtime_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"topic" text NOT NULL,
	"location_id" integer,
	"staff_id" integer,
	"required_permission" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_sid" text NOT NULL,
	"event_type" text NOT NULL,
	"signature_valid" boolean DEFAULT false NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"default_date_range" text DEFAULT '30' NOT NULL,
	"auto_assign" boolean DEFAULT false NOT NULL,
	"auto_assign_strategy" text DEFAULT 'round_robin' NOT NULL,
	"sms_sound" boolean DEFAULT true NOT NULL,
	"daily_digest" boolean DEFAULT true NOT NULL,
	"sla_target_minutes" integer DEFAULT 15 NOT NULL,
	"sla_escalate_minutes" integer DEFAULT 60 NOT NULL,
	"default_locale" text DEFAULT 'en' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "location_scopes" ADD CONSTRAINT "location_scopes_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_scopes" ADD CONSTRAINT "location_scopes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_locations" ADD CONSTRAINT "artist_locations_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_locations" ADD CONSTRAINT "artist_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extensions" ADD CONSTRAINT "extensions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "numbers" ADD CONSTRAINT "numbers_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_sessions" ADD CONSTRAINT "booking_sessions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_step_options" ADD CONSTRAINT "booking_step_options_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_closures" ADD CONSTRAINT "location_closures_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translations" ADD CONSTRAINT "translations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translations" ADD CONSTRAINT "translations_locale_locales_code_fk" FOREIGN KEY ("locale") REFERENCES "public"."locales"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_session_id_booking_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."booking_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_assigned_staff_id_staff_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_confirmed_by_staff_id_staff_id_fk" FOREIGN KEY ("confirmed_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_completed_by_staff_id_staff_id_fk" FOREIGN KEY ("completed_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_by_staff_id_staff_id_fk" FOREIGN KEY ("cancelled_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_session_id_booking_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."booking_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_staff_id_staff_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_first_called_by_staff_id_staff_id_fk" FOREIGN KEY ("first_called_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_staff_id_staff_id_fk" FOREIGN KEY ("author_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_staff_id_staff_id_fk" FOREIGN KEY ("assignee_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_staff_id_staff_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_done_by_staff_id_staff_id_fk" FOREIGN KEY ("done_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_staff_id_staff_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_session_id_booking_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."booking_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_conversations" ADD CONSTRAINT "sms_conversations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_conversations" ADD CONSTRAINT "sms_conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_conversations" ADD CONSTRAINT "sms_conversations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_conversations" ADD CONSTRAINT "sms_conversations_assigned_staff_id_staff_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_conversation_id_sms_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."sms_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_sender_staff_id_staff_id_fk" FOREIGN KEY ("sender_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_staff_id_staff_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribution_daily_stats" ADD CONSTRAINT "attribution_daily_stats_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demand_heatmap" ADD CONSTRAINT "demand_heatmap_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_daily_stats" ADD CONSTRAINT "funnel_daily_stats_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_daily_stats" ADD CONSTRAINT "location_daily_stats_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_daily_stats" ADD CONSTRAINT "staff_daily_stats_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_daily_stats" ADD CONSTRAINT "staff_daily_stats_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_presence" ADD CONSTRAINT "staff_presence_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_presence" ADD CONSTRAINT "staff_presence_active_location_id_locations_id_fk" FOREIGN KEY ("active_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_events" ADD CONSTRAINT "realtime_events_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_auth_sessions_staff" ON "auth_sessions" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "idx_staff_role" ON "staff" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "idx_staff_extension" ON "staff" USING btree ("vonage_extension");--> statement-breakpoint
CREATE INDEX "idx_staff_active" ON "staff" USING btree ("active");--> statement-breakpoint
CREATE INDEX "idx_extensions_location" ON "extensions" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_extensions_username" ON "extensions" USING btree ("username");--> statement-breakpoint
CREATE INDEX "idx_locations_active" ON "locations" USING btree ("booking_active");--> statement-breakpoint
CREATE INDEX "idx_locations_order" ON "locations" USING btree ("display_order");--> statement-breakpoint
CREATE INDEX "idx_numbers_location" ON "numbers" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "idx_availability_range" ON "availability_blocks" USING btree ("location_id","starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_availability_external" ON "availability_blocks" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_location_created" ON "booking_sessions" USING btree ("location_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_sessions_created" ON "booking_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_sessions_phone" ON "booking_sessions" USING btree ("phone_e164");--> statement-breakpoint
CREATE INDEX "idx_sessions_abandoned" ON "booking_sessions" USING btree ("updated_at") WHERE "booking_sessions"."is_completed" = false and "booking_sessions"."phone_e164" is not null;--> statement-breakpoint
CREATE INDEX "idx_sessions_funnel" ON "booking_sessions" USING btree ("location_id","max_step_reached","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_step_option" ON "booking_step_options" USING btree (coalesce("location_id", 0),"step_key","option_key");--> statement-breakpoint
CREATE INDEX "idx_step_options_lookup" ON "booking_step_options" USING btree ("step_key","is_active","sort_order");--> statement-breakpoint
CREATE INDEX "idx_closures_day" ON "location_closures" USING btree ("location_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_translation" ON "translations" USING btree (coalesce("location_id", 0),"app","namespace","key","locale");--> statement-breakpoint
CREATE INDEX "idx_translations_lookup" ON "translations" USING btree ("app","locale","namespace");--> statement-breakpoint
CREATE INDEX "idx_translations_location" ON "translations" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "idx_uploads_session" ON "uploads" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_uploads_appointment" ON "uploads" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "idx_appts_location_starts" ON "appointments" USING btree ("location_id","starts_at");--> statement-breakpoint
CREATE INDEX "idx_appts_status" ON "appointments" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "idx_appts_lead" ON "appointments" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_appts_assigned" ON "appointments" USING btree ("assigned_staff_id","starts_at");--> statement-breakpoint
CREATE INDEX "idx_appts_artist" ON "appointments" USING btree ("artist_id","starts_at");--> statement-breakpoint
CREATE INDEX "idx_appts_live" ON "appointments" USING btree ("location_id","starts_at") WHERE "appointments"."status" in ('pending','confirmed','deposit_paid');--> statement-breakpoint
CREATE INDEX "idx_calls_start" ON "calls" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX "idx_calls_staff_start" ON "calls" USING btree ("staff_id","start_time");--> statement-breakpoint
CREATE INDEX "idx_calls_location_start" ON "calls" USING btree ("location_id","start_time");--> statement-breakpoint
CREATE INDEX "idx_calls_lead" ON "calls" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_calls_customer" ON "calls" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_calls_result" ON "calls" USING btree ("result","start_time");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_customers_phone" ON "customers" USING btree ("phone_e164") WHERE "customers"."merged_into" is null and "customers"."phone_e164" is not null;--> statement-breakpoint
CREATE INDEX "idx_customers_email" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_customers_location" ON "customers" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "idx_leads_active" ON "leads" USING btree ("location_id","call_status") WHERE "leads"."merged_into" is null;--> statement-breakpoint
CREATE INDEX "idx_leads_phone" ON "leads" USING btree ("phone_e164") WHERE "leads"."merged_into" is null and "leads"."phone_e164" is not null;--> statement-breakpoint
CREATE INDEX "idx_leads_sla" ON "leads" USING btree ("created_at") WHERE "leads"."call_status" = 'not_called' and "leads"."merged_into" is null;--> statement-breakpoint
CREATE INDEX "idx_leads_assigned" ON "leads" USING btree ("assigned_staff_id","call_status");--> statement-breakpoint
CREATE INDEX "idx_leads_created" ON "leads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_leads_customer" ON "leads" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_notes_target" ON "notes" USING btree ("notable_type","notable_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_tasks_open" ON "tasks" USING btree ("assignee_staff_id","due_at") WHERE "tasks"."status" = 'open';--> statement-breakpoint
CREATE INDEX "idx_tasks_lead" ON "tasks" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_task_auto" ON "tasks" USING btree ("lead_id","source") WHERE "tasks"."status" = 'open' and "tasks"."source" in ('follow_up','sla_breach');--> statement-breakpoint
CREATE INDEX "idx_vonage_events_call" ON "vonage_events" USING btree ("call_uuid","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_campaign_recipient" ON "campaign_recipients" USING btree ("campaign_id","lead_id");--> statement-breakpoint
CREATE INDEX "idx_campaign_recipients_queue" ON "campaign_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "idx_campaigns_status" ON "campaigns" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_template" ON "message_templates" USING btree (coalesce("location_id", 0),"key","channel");--> statement-breakpoint
CREATE INDEX "idx_scheduled_due" ON "scheduled_messages" USING btree ("scheduled_at") WHERE "scheduled_messages"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "idx_scheduled_session" ON "scheduled_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_scheduled_appointment" ON "scheduled_messages" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_scheduled_kind" ON "scheduled_messages" USING btree ("kind","to_e164","session_id","appointment_id") WHERE "scheduled_messages"."status" in ('scheduled','processing');--> statement-breakpoint
CREATE INDEX "idx_conv_recent" ON "sms_conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "idx_conv_unread" ON "sms_conversations" USING btree ("unread_count") WHERE "sms_conversations"."unread_count" > 0;--> statement-breakpoint
CREATE INDEX "idx_conv_location" ON "sms_conversations" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "idx_sms_conv_time" ON "sms_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_sms_staff" ON "sms_messages" USING btree ("sender_staff_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_sms_campaign" ON "sms_messages" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_activity_actor" ON "activity_log" USING btree ("actor_staff_id","at");--> statement-breakpoint
CREATE INDEX "idx_activity_target" ON "activity_log" USING btree ("target_type","target_id","at");--> statement-breakpoint
CREATE INDEX "idx_activity_location" ON "activity_log" USING btree ("location_id","at");--> statement-breakpoint
CREATE INDEX "idx_activity_at" ON "activity_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "idx_activity_action" ON "activity_log" USING btree ("action","at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_attribution_daily" ON "attribution_daily_stats" USING btree ("day","location_id","platform","utm_source","utm_medium","utm_campaign");--> statement-breakpoint
CREATE INDEX "idx_attribution_daily_day" ON "attribution_daily_stats" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_demand_cell" ON "demand_heatmap" USING btree ("location_id","week_start","dow","hour");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_funnel_daily" ON "funnel_daily_stats" USING btree ("day","location_id","step_index");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_location_daily" ON "location_daily_stats" USING btree ("day","location_id");--> statement-breakpoint
CREATE INDEX "idx_location_daily_day" ON "location_daily_stats" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_staff_daily" ON "staff_daily_stats" USING btree ("day","staff_id","location_id");--> statement-breakpoint
CREATE INDEX "idx_staff_daily_day" ON "staff_daily_stats" USING btree ("day");--> statement-breakpoint
CREATE INDEX "idx_staff_daily_staff" ON "staff_daily_stats" USING btree ("staff_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_integration" ON "integrations" USING btree ("provider",coalesce("location_id", 0));--> statement-breakpoint
CREATE INDEX "idx_notifications_unread" ON "notifications" USING btree ("staff_id","created_at") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "idx_realtime_channel" ON "realtime_events" USING btree ("channel","id");--> statement-breakpoint
CREATE INDEX "idx_realtime_created" ON "realtime_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_webhook_delivery" ON "webhook_deliveries" USING btree ("provider","external_sid");--> statement-breakpoint
CREATE INDEX "idx_webhook_unprocessed" ON "webhook_deliveries" USING btree ("received_at") WHERE "webhook_deliveries"."processed" = false;