/* ── Import the live Laravel database ──────────────────────────────────
 * Reads the JSON produced by scripts/parse-live-dump.py and fills in what
 * the seed could only guess at: per-studio Twilio credentials, Vonage
 * extensions, GTM segmentation, map links, opening hours, timezones, and
 * the Timely artist calendar feeds the availability engine needs.
 *
 * Matching is by slug, which is stable across both systems and is also the
 * public booking URL. A studio in the dump that we do not have is reported
 * rather than created: a new branch needs a decision, not an import.
 *
 * Secrets are never printed. Counts only.
 * ────────────────────────────────────────────────────────────────── */
import "./env";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { artistLocations, artists, locations, numbers } from "../src/db/schema";

interface TimelyLocation {
  id: string;
  timely_id: string | null;
  name: string | null;
  slug: string | null;
  booking_active: string | null;
  sort_order: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  vonage_phone_number: string | null;
  vonage_extension: string | null;
  twilio_sid: string | null;
  twilio_auth_token: string | null;
  twilio_from_number: string | null;
  twilio_phone_number: string | null;
  sms_enabled: string | null;
  mail_automation_enabled: string | null;
  mail_sender_address: string | null;
  mail_sender_name: string | null;
  smtp_host: string | null;
  smtp_port: string | null;
  smtp_username: string | null;
  smtp_password: string | null;
  gtm_country: string | null;
  gtm_city: string | null;
  map_link: string | null;
  latitude: string | null;
  longitude: string | null;
  business_hours: string | null;
  appointment_interval: string | null;
  timezone: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  tiktok_url: string | null;
  twitter_url: string | null;
  youtube_url: string | null;
}

interface TimelyStaff {
  id: string;
  timely_id: string | null;
  name: string | null;
  email: string | null;
  status: string | null;
  webhook_url: string | null;
}

interface StaffLink {
  timely_location_id: string;
  timely_staff_id: string;
}

interface Dump {
  timely_locations: TimelyLocation[];
  timely_staffs: TimelyStaff[];
  timely_location_staff: StaffLink[];
}

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" || t.toLowerCase() === "null" ? null : t;
};

/** E.164 from whatever the live system stored. */
function e164(raw: string | null): string | null {
  const v = clean(raw);
  if (!v) return null;
  const digits = v.replace(/[^\d+]/g, "");
  const normalised = digits.startsWith("+") ? digits : `+${digits.replace(/^00/, "")}`;
  return /^\+[1-9]\d{6,14}$/.test(normalised) ? normalised : null;
}

/* Live format: {"monday":{"open":"1","start":"10:30","end":"19:30"}}
   Ours:        {"mon":{"enabled":true,"open":"10:30","close":"19:30"}}
   The keys matter — availability looks days up by the three-letter name
   Intl produces, so a long key silently closes the studio that day. */
const DAY_MAP: Record<string, string> = {
  monday: "mon", tuesday: "tue", wednesday: "wed",
  thursday: "thu", friday: "fri", saturday: "sat", sunday: "sun",
};

function convertHours(rawJson: string | null): Record<string, { enabled: boolean; open: string; close: string }> | null {
  const raw = clean(rawJson);
  if (!raw) return null;
  let parsed: Record<string, { open?: string; start?: string; end?: string }>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const out: Record<string, { enabled: boolean; open: string; close: string }> = {};
  for (const [longName, value] of Object.entries(parsed)) {
    const key = DAY_MAP[longName.toLowerCase()] ?? longName.slice(0, 3).toLowerCase();
    const start = clean(value?.start ?? null) ?? "10:00";
    const end = clean(value?.end ?? null) ?? "19:00";
    out[key] = {
      // "open" is the live system's 0/1 flag, not a time.
      enabled: String(value?.open ?? "0") === "1",
      open: start.slice(0, 5),
      close: end.slice(0, 5),
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

function validTimezone(raw: string | null): string | null {
  const tz = clean(raw);
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

async function main() {
  const path = process.argv[2] ?? "/tmp/claude-501/live.json";
  const dump = JSON.parse(readFileSync(path, "utf8")) as Dump;

  const ours = await db.select().from(locations);
  const bySlug = new Map(ours.map((l) => [l.slug, l]));

  const report = {
    studiosUpdated: 0,
    studiosMissing: [] as string[],
    timezoneSkipped: [] as string[],
    twilio: 0,
    vonage: 0,
    maps: 0,
    gtm: 0,
    hours: 0,
    numbersWritten: 0,
    artistsUpserted: 0,
    artistLinks: 0,
    feeds: 0,
  };

  /* Eight slugs appear twice in the dump: an ACTIVE row with no timely_id
     and an INACTIVE one that has it. Processed in file order the inactive
     row won and switched those studios off. Merged per slug instead —
     every field takes the first non-empty value, and a studio counts as
     taking bookings if ANY of its rows says so. */
  const merged = new Map<string, TimelyLocation>();
  for (const row of dump.timely_locations) {
    const slug = clean(row.slug);
    if (!slug) continue;
    const existing = merged.get(slug);
    if (!existing) {
      merged.set(slug, { ...row });
      continue;
    }
    const target = existing as unknown as Record<string, string | null>;
    for (const [key, value] of Object.entries(row) as [string, string | null][]) {
      if (clean(value) && !clean(target[key])) target[key] = value;
    }
    if (String(row.booking_active) === "1") existing.booking_active = "1";
  }

  for (const row of merged.values()) {
    const slug = clean(row.slug)!;
    const mine = bySlug.get(slug);
    if (!mine) {
      if (String(row.booking_active) === "1") report.studiosMissing.push(slug);
      continue;
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };

    /* Timezone is deliberately NOT imported. The live database has 21 of
       the 46 studios on America/New_York regardless of where they are —
       Denver, Spokane and Detroit among them — which is the bug the
       correction map in scripts/timezones.ts exists to fix. Taking the
       live value back would move a Denver booking by two hours and a
       Spokane one by three. */
    const tz = validTimezone(row.timezone);
    if (tz && tz !== mine.timezone) {
      report.timezoneSkipped.push(`${slug}: live has ${tz}, we have ${mine.timezone}`);
    }

    const timelyId = clean(row.timely_id);
    if (timelyId) patch.timelyId = Number(timelyId);

    const address = clean(row.address);
    if (address) patch.address = address;

    const email = clean(row.email);
    if (email) patch.email = email;

    const branchPhone = e164(row.phone) ?? e164(row.vonage_phone_number);
    if (branchPhone) patch.branchPhone = branchPhone;

    const map = clean(row.map_link);
    if (map && /^https?:\/\//i.test(map)) {
      patch.mapsUrl = map;
      report.maps += 1;
    }

    const gtmCountry = clean(row.gtm_country);
    const gtmCity = clean(row.gtm_city);
    if (gtmCountry) patch.gtmCountry = gtmCountry;
    if (gtmCity) patch.gtmCityState = gtmCity;
    if (gtmCountry || gtmCity) report.gtm += 1;

    if (clean(row.latitude)) patch.lat = clean(row.latitude);
    if (clean(row.longitude)) patch.lng = clean(row.longitude);

    const interval = Number(clean(row.appointment_interval) ?? "0");
    if (Number.isInteger(interval) && interval >= 5 && interval <= 240) {
      patch.bookingIntervalMin = interval;
    }

    const hours = convertHours(row.business_hours);
    if (hours) {
      patch.hours = hours;
      report.hours += 1;
    }

    const sortOrder = Number(clean(row.sort_order) ?? "");
    if (Number.isInteger(sortOrder)) patch.displayOrder = sortOrder;

    patch.bookingActive = String(row.booking_active) === "1";

    /* Twilio. One account and one messaging service are shared across the
       chain; the DID is what differs per studio. twilio_from_number holds
       the Messaging Service SID (MG…), which is what sending uses. */
    const accountSid = clean(row.twilio_sid);
    const authToken = clean(row.twilio_auth_token);
    const messagingSid = clean(row.twilio_from_number);
    const did = e164(row.twilio_phone_number);
    if (accountSid || authToken || messagingSid || did) {
      patch.twilio = {
        accountSid: accountSid ?? "",
        authToken: authToken ?? "",
        messagingSid: messagingSid?.startsWith("MG") ? messagingSid : "",
        specificPhone: did ?? "",
        smsAutomation: String(row.sms_enabled) === "1",
      };
      report.twilio += 1;
    }

    const vonageDid = e164(row.vonage_phone_number);
    const extension = clean(row.vonage_extension);
    if (vonageDid || extension) {
      patch.vonage = { did: vonageDid ?? "", extension: extension ?? "" };
      report.vonage += 1;
    }

    const smtpHost = clean(row.smtp_host);
    if (smtpHost) {
      patch.smtp = {
        enabled: String(row.mail_automation_enabled) === "1",
        host: smtpHost,
        port: Number(clean(row.smtp_port) ?? "587") || 587,
        username: clean(row.smtp_username) ?? "",
        password: clean(row.smtp_password) ?? "",
        senderEmail: clean(row.mail_sender_address) ?? "",
        senderName: clean(row.mail_sender_name) ?? "",
      };
    }

    const social = {
      instagram: clean(row.instagram_url) ?? "",
      facebook: clean(row.facebook_url) ?? "",
      tiktok: clean(row.tiktok_url) ?? "",
      twitter: clean(row.twitter_url) ?? "",
      youtube: clean(row.youtube_url) ?? "",
    };
    if (Object.values(social).some(Boolean)) patch.social = social;

    await db.update(locations).set(patch).where(eq(locations.id, mine.id));
    report.studiosUpdated += 1;

    /* The numbers table is what the inbound webhooks resolve a studio by,
       so every DID has to be registered there as well as on the studio. */
    for (const entry of [
      did ? { kind: "twilio" as const, label: "Twilio DID", number: did, smsCapable: true } : null,
      vonageDid ? { kind: "vonage" as const, label: "Vonage DID", number: vonageDid, smsCapable: false } : null,
      branchPhone ? { kind: "branch" as const, label: "Branch line", number: branchPhone, smsCapable: false } : null,
    ]) {
      if (!entry) continue;
      const existing = await db
        .select({ id: numbers.id })
        .from(numbers)
        .where(eq(numbers.numberE164, entry.number))
        .limit(1);
      if (existing.length > 0) continue;
      await db.insert(numbers).values({
        locationId: mine.id,
        kind: entry.kind,
        label: entry.label,
        numberE164: entry.number,
        smsCapable: entry.smsCapable,
      });
      report.numbersWritten += 1;
    }
  }

  /* ── Artists and their Timely calendar feeds ─────────────────────── */
  const locationByLiveId = new Map<string, number>();
  for (const row of dump.timely_locations) {
    const mine = bySlug.get(clean(row.slug) ?? "");
    if (mine) locationByLiveId.set(row.id, mine.id);
  }

  const artistByLiveId = new Map<string, number>();

  for (const staff of dump.timely_staffs) {
    const name = clean(staff.name);
    if (!name) continue;
    const legacyId = clean(staff.timely_id);
    const feed = clean(staff.webhook_url);

    const [existing] = legacyId
      ? await db.select({ id: artists.id }).from(artists).where(eq(artists.legacyId, legacyId)).limit(1)
      : [];

    const values = {
      legacyId,
      name,
      email: clean(staff.email),
      active: String(staff.status) === "1",
      calendarFeedUrl: feed,
    };

    let artistId: number;
    if (existing) {
      await db.update(artists).set(values).where(eq(artists.id, existing.id));
      artistId = existing.id;
    } else {
      const [created] = await db.insert(artists).values(values).returning({ id: artists.id });
      artistId = created.id;
    }
    artistByLiveId.set(staff.id, artistId);
    report.artistsUpserted += 1;
    if (feed) report.feeds += 1;
  }

  for (const link of dump.timely_location_staff) {
    const locationId = locationByLiveId.get(link.timely_location_id);
    const artistId = artistByLiveId.get(link.timely_staff_id);
    if (!locationId || !artistId) continue;
    await db
      .insert(artistLocations)
      .values({ artistId, locationId })
      .onConflictDoNothing();
    report.artistLinks += 1;
  }

  console.log("── Import ──────────────────────────────────");
  console.log(`  studios updated    : ${report.studiosUpdated}`);
  console.log(`  twilio config      : ${report.twilio}`);
  console.log(`  vonage config      : ${report.vonage}`);
  console.log(`  map links          : ${report.maps}`);
  console.log(`  gtm fields         : ${report.gtm}`);
  console.log(`  opening hours      : ${report.hours}`);
  console.log(`  numbers registered : ${report.numbersWritten}`);
  console.log(`  artists            : ${report.artistsUpserted}  (feeds: ${report.feeds})`);
  console.log(`  artist↔studio links: ${report.artistLinks}`);
  if (report.timezoneSkipped.length > 0) {
    console.log(`\n  timezone NOT imported — the live value is wrong (${report.timezoneSkipped.length}):`);
    for (const line of report.timezoneSkipped) console.log(`    ${line}`);
  }
  if (report.studiosMissing.length > 0) {
    console.log(`\n  active studios we do not have (${report.studiosMissing.length}): ${report.studiosMissing.join(", ")}`);
  }
  void sql;
  process.exit(0);
}

void main();
