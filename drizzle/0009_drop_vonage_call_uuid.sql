ALTER TABLE "calls" DROP CONSTRAINT "calls_vonage_call_uuid_unique";--> statement-breakpoint
ALTER TABLE "calls" DROP COLUMN "vonage_call_uuid";