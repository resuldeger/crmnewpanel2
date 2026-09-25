ALTER TABLE "calls" ADD COLUMN "provider" text DEFAULT 'vonage' NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "external_call_id" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "forwarded_to" text;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_call_external" ON "calls" USING btree ("provider","external_call_id");