/**
 * Seeds a fresh database:
 *   · RBAC (roles, permissions, default matrix) — mirrors src/data.ts
 *   · locales + the live booking dictionary (4 languages, 20 namespaces)
 *   · 46 studios with CORRECTED timezones (see scripts/timezones.ts)
 *   · wizard step options
 *   · demo staff accounts
 *
 *   npx tsx scripts/fetch-live-seed.ts   # refresh seed/live-booking.json
 *   npm run db:seed
 */
import "./env";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, pool, schema } from "../src/db/client";
import { ROLES, PERMISSIONS, DEFAULT_MATRIX } from "../src/data";
import { resolveTimezone, TIMEZONE_LABEL } from "./timezones";
import { hashPassword } from "../src/server/auth/password";

const SEED_STAFF = [
  { id: 1, name: "Cleo Rivera", email: "cleo@cleopatraink.com", roleId: "super_admin", locationIds: "all" as const, active: true },
  { id: 2, name: "Dana Whitfield", email: "dana@cleopatraink.com", roleId: "branch_manager", locationIds: [1], active: true },
  { id: 3, name: "Marcus Hale", email: "marcus@cleopatraink.com", roleId: "hq_admin", locationIds: "all" as const, active: true },
  { id: 4, name: "Elif Aydın", email: "elif@cleopatraink.com", roleId: "branch_manager", locationIds: [5, 6], active: true },
  { id: 5, name: "Jonas Weber", email: "jonas@cleopatraink.com", roleId: "studio_admin", locationIds: [8], active: true },
  { id: 6, name: "Tara Singh", email: "tara@cleopatraink.com", roleId: "callcenter_agent", locationIds: "all" as const, active: true },
  { id: 7, name: "Owen Pierce", email: "owen@cleopatraink.com", roleId: "callcenter_agent", locationIds: "all" as const, active: true },
  { id: 8, name: "Sara Al-Farsi", email: "sara@cleopatraink.com", roleId: "viewer", locationIds: [10], active: false },
  { id: 9, name: "Maya Chen", email: "maya@cleopatraink.com", roleId: "studio_admin", locationIds: [2], active: true },
  { id: 10, name: "Ravi Patel", email: "ravi@cleopatraink.com", roleId: "viewer", locationIds: [1, 2, 3], active: true },
];

const {
  roles, permissions, rolePermissions, staff, locationScopes,
  locations, locales, translations, bookingStepOptions, workspaceSettings,
} = schema;

interface LiveSeed {
  fetchedAt: string;
  locations: { id: number; slug: string; name: string; address: string | null; timezone: string }[];
  translations: { namespace: string; key: string; locale: string; value: string }[];
  stepOptions: { stepKey: string; optionKey: string; imageUrl: string | null; sortOrder: number; labels: Record<string, string> }[];
}

const LOCALES = [
  { code: "en", name: "English", nativeName: "English", isDefault: true, sortOrder: 1 },
  { code: "tr", name: "Turkish", nativeName: "Türkçe", isDefault: false, sortOrder: 2 },
  { code: "es", name: "Spanish", nativeName: "Español", isDefault: false, sortOrder: 3 },
  { code: "de", name: "German", nativeName: "Deutsch", isDefault: false, sortOrder: 4 },
];

/** Options that collapse later wizard steps (piercing needs no size or placement). */
const SKIP_RULES: Record<string, string[]> = {
  "purpose|piercing": ["story", "body_area", "size"],
  "purpose|first": ["body_area"],
};

const DEFAULT_HOURS = {
  mon: { enabled: true, open: "10:00", close: "20:00" },
  tue: { enabled: true, open: "10:00", close: "20:00" },
  wed: { enabled: true, open: "10:00", close: "20:00" },
  thu: { enabled: true, open: "10:00", close: "20:00" },
  fri: { enabled: true, open: "10:00", close: "20:00" },
  sat: { enabled: true, open: "11:00", close: "19:00" },
  sun: { enabled: false, open: "12:00", close: "18:00" },
};

/**
 * Every account gets its OWN strong password, written once to a gitignored
 * file. The previous seed gave all ten accounts the literal password
 * "demo" and the login screen printed it on screen.
 */
function generatePassword(): string {
  // Unambiguous alphabet: no O/0, no l/1/I.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(20);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** "45 Moreland Avenue SE, suite 100, Fulton County, GA, 30316" → city guess */
function cityFrom(name: string): string {
  return name.replace(/^Cleopatra Ink\s+/i, "").trim() || name;
}

async function main() {
  const live: LiveSeed = JSON.parse(readFileSync(resolve("seed/live-booking.json"), "utf8"));
  console.log(`seed source captured ${live.fetchedAt}`);

  /* ── 1. RBAC ──────────────────────────────────────────────────────── */
  await db.insert(roles).values(
    ROLES.map((r, i) => ({
      id: r.id, name: r.name, description: r.desc, color: r.color,
      isSystem: Boolean(r.system), sortOrder: i,
    })),
  ).onConflictDoNothing();

  await db.insert(permissions).values(
    PERMISSIONS.map((p, i) => ({ id: p.id, label: p.label, groupName: p.group, sortOrder: i })),
  ).onConflictDoNothing();

  const grants = Object.entries(DEFAULT_MATRIX).flatMap(([roleId, perms]) =>
    perms.map((permissionId) => ({ roleId, permissionId })),
  );
  await db.insert(rolePermissions).values(grants).onConflictDoNothing();
  console.log(`✓ RBAC — ${ROLES.length} roles · ${PERMISSIONS.length} permissions · ${grants.length} grants`);

  /* ── 2. Locales ───────────────────────────────────────────────────── */
  await db.insert(locales).values(
    LOCALES.map((l) => ({ ...l, fallbackCode: "en", direction: "ltr", isActive: true })),
  ).onConflictDoNothing();
  console.log(`✓ locales — ${LOCALES.map((l) => l.code).join(", ")}`);

  /* ── 3. Studios, with the timezone bug fixed ──────────────────────── */
  let corrected = 0;
  const locationRows = live.locations
    .sort((a, b) => a.id - b.id)
    .map((l, i) => {
      const { timezone, state } = resolveTimezone(l.slug, l.address);
      if (timezone !== l.timezone) corrected++;
      return {
        name: l.name.startsWith("Cleopatra Ink") ? l.name : `Cleopatra Ink ${l.name}`,
        slug: l.slug,
        legacyId: l.id,
        address: l.address,
        city: cityFrom(l.name),
        state,
        country: "USA",
        countryCode: "US",
        timezone,
        timezoneFriendly: TIMEZONE_LABEL[timezone] ?? timezone,
        displayOrder: i,
        bookingActive: l.slug !== "test-branch",
        defaultLocale: "en",
        hours: DEFAULT_HOURS,
      };
    });

  await db.insert(locations).values(locationRows).onConflictDoNothing();
  console.log(`✓ studios — ${locationRows.length} inserted · ${corrected} timezones corrected`);

  /* ── 4. Booking dictionary (global rows; per-studio overrides later) ── */
  const activeCodes = new Set(LOCALES.map((l) => l.code));
  const dictRows = live.translations
    .filter((t) => activeCodes.has(t.locale))
    .map((t) => ({ locationId: null, app: "booking", namespace: t.namespace, key: t.key, locale: t.locale, value: t.value }));

  for (let i = 0; i < dictRows.length; i += 500) {
    await db.insert(translations).values(dictRows.slice(i, i + 500)).onConflictDoNothing();
  }
  const namespaces = new Set(dictRows.map((r) => r.namespace)).size;
  console.log(`✓ translations — ${dictRows.length} rows · ${namespaces} namespaces · ${activeCodes.size} locales`);

  /* ── 5. Wizard step options ───────────────────────────────────────── */
  const stepRows = live.stepOptions.map((o) => ({
    locationId: null,
    stepKey: o.stepKey as "purpose" | "style" | "story" | "body_area" | "size" | "timing",
    optionKey: o.optionKey,
    labelTranslations: o.labels,
    descriptionTranslations: {},
    imageUrl: o.imageUrl,
    skipsSteps: SKIP_RULES[`${o.stepKey}|${o.optionKey}`] ?? [],
    isActive: true,
    sortOrder: o.sortOrder,
  }));
  await db.insert(bookingStepOptions).values(stepRows).onConflictDoNothing();
  console.log(`✓ step options — ${stepRows.length}`);

  /* ── 6. Console preferences ───────────────────────────────────────── */
  await db.insert(workspaceSettings).values({ id: 1 }).onConflictDoNothing();

  /* ── 7. Staff accounts ────────────────────────────────────────────── */
  const slugById = new Map(locationRows.map((l, i) => [i + 1, l.slug]));
  const credentials: { name: string; email: string; role: string; password: string }[] = [];

  const staffRows = await Promise.all(
    SEED_STAFF.map(async (m) => {
      const password = generatePassword();
      credentials.push({ name: m.name, email: m.email, role: m.roleId, password });
      return {
        name: m.name,
        email: m.email,
        passwordHash: await hashPassword(password),
        roleId: m.roleId,
        scopeAll: m.locationIds === "all",
        active: m.active,
        locale: "en",
      };
    }),
  );

  const inserted = await db.insert(staff).values(staffRows)
    .onConflictDoNothing().returning({ id: staff.id, email: staff.email });

  const idByEmail = new Map(inserted.map((r) => [r.email, r.id]));
  const scopeRows = SEED_STAFF.flatMap((m) => {
    if (m.locationIds === "all") return [];
    const staffId = idByEmail.get(m.email);
    if (!staffId) return [];
    return (m.locationIds as number[])
      .filter((locId) => slugById.has(locId))
      .map((locationId) => ({ staffId, locationId }));
  });
  if (scopeRows.length) await db.insert(locationScopes).values(scopeRows).onConflictDoNothing();

  // Written once, gitignored, chmod 600. This is the only place the
  // plaintext exists — the database stores scrypt hashes.
  if (inserted.length > 0) {
    const file = resolve("seed/credentials.txt");
    const lines = [
      "Cleopatra v3 — console accounts",
      `generated ${new Date().toISOString()}`,
      "KEEP THIS FILE PRIVATE. It is gitignored. Delete it once the passwords are stored elsewhere.",
      "",
      ...credentials.map((c) => `${c.role.padEnd(18)} ${c.email.padEnd(34)} ${c.password}   (${c.name})`),
      "",
    ];
    writeFileSync(file, lines.join("\n"), { mode: 0o600 });
    console.log(`✓ staff — ${inserted.length} accounts · ${scopeRows.length} branch scopes`);
    console.log(`  passwords written to ${file} (chmod 600, gitignored)`);
  }

  const counts = await db.execute(sql`
    select
      (select count(*) from locations)            as studios,
      (select count(*) from translations)         as translations,
      (select count(*) from booking_step_options) as step_options,
      (select count(*) from staff)                as staff,
      (select count(*) from role_permissions)     as grants
  `);
  console.log("\nfinal counts:", counts.rows[0]);
}

main()
  .then(() => pool.end())
  .catch(async (err) => { console.error(err); await pool.end(); process.exit(1); });
