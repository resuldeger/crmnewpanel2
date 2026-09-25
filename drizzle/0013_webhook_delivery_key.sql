-- One provider id covers MANY deliveries: a call sends ringing, answered
-- and completed under the same uuid, and an SMS sends queued, sent and
-- delivered under the same SID. The old key allowed one row per id, so the
-- second event of any call crashed with a duplicate-key error and the
-- webhook was lost.
--
-- Twilio's status handler worked around it by baking the status into the
-- id ("sms-status:SM123:delivered"), which made external_sid useless for
-- looking a message up. Widening the key fixes both: genuine retries of
-- the SAME event still collapse into one row.
drop index if exists uniq_webhook_delivery;
--> statement-breakpoint
create unique index uniq_webhook_delivery
  on webhook_deliveries (provider, external_sid, event_type);
