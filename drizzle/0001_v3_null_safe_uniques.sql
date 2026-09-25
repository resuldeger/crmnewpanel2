DROP INDEX "uniq_task_auto";--> statement-breakpoint
DROP INDEX "uniq_scheduled_kind";--> statement-breakpoint
DROP INDEX "uniq_attribution_daily";--> statement-breakpoint
DROP INDEX "uniq_staff_daily";--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_task_auto" ON "tasks" USING btree (coalesce("lead_id", ''),"source") WHERE "tasks"."status" = 'open' and "tasks"."source" in ('follow_up','sla_breach');--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_scheduled_kind" ON "scheduled_messages" USING btree ("kind","to_e164",coalesce("session_id", 0),coalesce("appointment_id", 0)) WHERE "scheduled_messages"."status" in ('scheduled','processing');--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_attribution_daily" ON "attribution_daily_stats" USING btree ("day","location_id","platform",coalesce("utm_source", ''),coalesce("utm_medium", ''),coalesce("utm_campaign", ''));--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_staff_daily" ON "staff_daily_stats" USING btree ("day","staff_id",coalesce("location_id", 0));