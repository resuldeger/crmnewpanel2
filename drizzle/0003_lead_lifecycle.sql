CREATE TYPE "public"."lead_source_t" AS ENUM('abandoned_form', 'completed_form', 'meta_lead_ad', 'inbound_call', 'manual', 'import');--> statement-breakpoint
DROP INDEX "idx_leads_active";--> statement-breakpoint
DROP INDEX "idx_leads_sla";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "source" "lead_source_t" DEFAULT 'abandoned_form' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "converted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "converted_appointment_id" integer;--> statement-breakpoint
CREATE INDEX "idx_leads_active" ON "leads" USING btree ("location_id","call_status") WHERE "leads"."merged_into" is null and "leads"."converted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_leads_sla" ON "leads" USING btree ("created_at") WHERE "leads"."call_status" = 'not_called' and "leads"."merged_into" is null and "leads"."converted_at" is null;