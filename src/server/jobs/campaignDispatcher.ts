import { and, asc, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { campaigns, campaignRecipients, leads } from "@/db/schema";
import { sendSms } from "@/server/sms/send";
import type { Job, JobResult } from "./types";

/**
 * Sends queued campaigns.
 *
 * Throttled per studio: carriers police A2P throughput, and a burst is the
 * fastest way to get a messaging service suspended. Recipients are claimed
 * one batch at a time so two workers never double-send, and the counters
 * on the campaign row come from the real per-recipient outcome — they used
 * to be animated in the browser.
 */
const PER_TICK = 20;

export const campaignDispatcher: Job = {
  name: "campaign-dispatcher",
  integration: "twilio",
  everyMs: 60_000,

  async run(): Promise<JobResult> {
    const due = await db
      .select({ id: campaigns.id, name: campaigns.name, body: campaigns.body, bodies: campaigns.bodyTranslations })
      .from(campaigns)
      .where(and(eq(campaigns.status, "sending"), lte(campaigns.scheduledAt, new Date())))
      .orderBy(asc(campaigns.scheduledAt))
      .limit(5);

    if (due.length === 0) return { summary: "nothing queued", counts: { sent: 0 } };

    let sent = 0;
    let failed = 0;
    let finished = 0;

    for (const campaign of due) {
      const batch = await db.execute<{
        lead_id: string; to_e164: string; locale: string; location_id: number; name: string;
      }>(sql`
        update campaign_recipients cr
           set status = 'processing'
         where (cr.campaign_id, cr.lead_id) in (
           select r.campaign_id, r.lead_id
             from campaign_recipients r
            where r.campaign_id = ${campaign.id} and r.status = 'queued'
            limit ${PER_TICK}
              for update skip locked
         )
        returning cr.lead_id, cr.to_e164, cr.locale,
                  (select l.location_id from leads l where l.id = cr.lead_id) as location_id,
                  (select l.name from leads l where l.id = cr.lead_id) as name
      `);

      for (const r of batch.rows) {
        const body = campaign.bodies?.[r.locale] ?? campaign.body;
        const outcome = await sendSms({
          to: r.to_e164,
          locationId: r.location_id,
          body: body.replace(/\{name\}/g, (r.name ?? "").split(" ")[0] ?? ""),
          locale: r.locale,
          kind: "campaign",
          leadId: r.lead_id,
          campaignId: campaign.id,
          senderName: "Campaign",
        });

        if (outcome.ok) {
          sent += 1;
          await db
            .update(campaignRecipients)
            .set({ status: "sent", sentAt: new Date(), providerSid: outcome.sid || null })
            .where(and(eq(campaignRecipients.campaignId, campaign.id), eq(campaignRecipients.leadId, r.lead_id)));
        } else {
          failed += 1;
          await db
            .update(campaignRecipients)
            .set({ status: outcome.reason === "opted_out" ? "cancelled" : "failed", errorMessage: outcome.message })
            .where(and(eq(campaignRecipients.campaignId, campaign.id), eq(campaignRecipients.leadId, r.lead_id)));
        }

        // ~1 message per second per studio, the usual A2P ceiling.
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      await db.execute(sql`
        update campaigns c
           set sent   = (select count(*) from campaign_recipients r where r.campaign_id = c.id and r.status in ('sent','delivered')),
               failed = (select count(*) from campaign_recipients r where r.campaign_id = c.id and r.status in ('failed','undelivered')),
               status = case
                 when not exists (select 1 from campaign_recipients r where r.campaign_id = c.id and r.status in ('queued','processing'))
                 then 'sent'::campaign_status_t else c.status end,
               finished_at = case
                 when not exists (select 1 from campaign_recipients r where r.campaign_id = c.id and r.status in ('queued','processing'))
                 then now() else c.finished_at end
         where c.id = ${campaign.id}
      `);

      const [after] = await db.select({ status: campaigns.status }).from(campaigns).where(eq(campaigns.id, campaign.id)).limit(1);
      if (after?.status === "sent") finished += 1;
    }

    void leads;
    return { summary: `${due.length} campaign(s)`, counts: { sent, failed, finished } };
  },
};
