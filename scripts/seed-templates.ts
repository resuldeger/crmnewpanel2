/* Moves the built-in message templates into the database so they can be
 * edited without a deploy.
 *
 * They already exist in four languages and the sending path already picks
 * by the recipient's locale — but only for automated messages. The console
 * had its own hardcoded, English-only list, so an operator picking
 * "Booking Confirmation" for a Turkish customer sent English. */
import "./env";
import { eq, isNull, and } from "drizzle-orm";
import { db } from "../src/db/client";
import { messageTemplates } from "../src/db/schema";
import { DEFAULT_TEMPLATES } from "../src/server/sms/templates";

/** Placeholders each template understands, for the editor to show. */
const MERGE_FIELDS: Record<string, string[]> = {
  lead_recovery_5m: ["name", "studio", "link"],
  lead_recovery_2h: ["name", "studio", "link"],
  lead_recovery_24h: ["name", "studio", "link"],
  appointment_reminder_24h: ["name", "studio", "date", "time"],
  appointment_reminder_3h: ["name", "studio", "time"],
  booking_confirmation: ["name", "studio", "date", "time", "link"],
  winback: ["name", "studio", "link"],
};

async function main() {
  let created = 0;
  let kept = 0;

  for (const [key, bodies] of Object.entries(DEFAULT_TEMPLATES)) {
    const existing = await db
      .select({ id: messageTemplates.id })
      .from(messageTemplates)
      .where(and(eq(messageTemplates.key, key), isNull(messageTemplates.locationId)))
      .limit(1);

    // Never overwrite wording someone has already edited.
    if (existing.length > 0) { kept += 1; continue; }

    await db.insert(messageTemplates).values({
      key,
      channel: "sms",
      locationId: null,
      bodyTranslations: bodies,
      subjectTranslations: {},
      mergeFields: MERGE_FIELDS[key] ?? [],
      isActive: true,
    });
    created += 1;
  }

  const langs = new Set<string>();
  for (const bodies of Object.values(DEFAULT_TEMPLATES)) Object.keys(bodies).forEach(l => langs.add(l));

  console.log(`${created} sablon eklendi, ${kept} korundu · diller: ${[...langs].sort().join(", ")}`);
  process.exit(0);
}

void main();
