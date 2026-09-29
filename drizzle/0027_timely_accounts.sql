-- Timely, as it actually works: several accounts, each seeing some of the
-- studios. Timely's ids are not ours, so a studio and a member of staff are
-- matched ONCE and then left alone — re-guessing from a name on every sweep
-- is how a studio renamed over there quietly becomes a different studio here.
--
-- Written by hand from drizzle-kit's output: its journal only knows 12 of the
-- 31 migrations already applied, so it regenerated the whole history. Only
-- the four new tables are kept.

CREATE TABLE "timely_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"email" text NOT NULL,
	"password_enc" text,
	"cookies" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timely_accounts_email_unique" UNIQUE("email")
);;
CREATE TABLE "timely_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"timely_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"slug" text,
	"business_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"slot_minutes" integer,
	"location_id" integer,
	"linked_at" timestamp with time zone,
	"linked_by_name" text,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);;
CREATE TABLE "timely_staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"timely_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"status" integer DEFAULT 1 NOT NULL,
	"artist_id" integer,
	"linked_at" timestamp with time zone,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);;
CREATE TABLE "timely_staff_locations" (
	"staff_id" integer NOT NULL,
	"location_id" integer NOT NULL
);;
ALTER TABLE "timely_locations" ADD CONSTRAINT "timely_locations_account_id_timely_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."timely_accounts"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "timely_locations" ADD CONSTRAINT "timely_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;;
ALTER TABLE "timely_staff" ADD CONSTRAINT "timely_staff_account_id_timely_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."timely_accounts"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "timely_staff" ADD CONSTRAINT "timely_staff_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE set null ON UPDATE no action;;
ALTER TABLE "timely_staff_locations" ADD CONSTRAINT "timely_staff_locations_staff_id_timely_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."timely_staff"("id") ON DELETE cascade ON UPDATE no action;;
ALTER TABLE "timely_staff_locations" ADD CONSTRAINT "timely_staff_locations_location_id_timely_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."timely_locations"("id") ON DELETE cascade ON UPDATE no action;;
CREATE UNIQUE INDEX "uniq_timely_location" ON "timely_locations" USING btree ("account_id","timely_id");;
CREATE INDEX "idx_timely_location_mapped" ON "timely_locations" USING btree ("location_id");;
CREATE UNIQUE INDEX "uniq_timely_staff" ON "timely_staff" USING btree ("account_id","timely_id");;
CREATE UNIQUE INDEX "uniq_timely_staff_location" ON "timely_staff_locations" USING btree ("staff_id","location_id");;
