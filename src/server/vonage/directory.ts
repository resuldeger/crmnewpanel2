import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { extensions, locations } from "@/db/schema";
import { vonageAccessToken } from "./token";
import { vonageEndpoints } from "./endpoints";
import type { DirectoryEntry } from "./telephony";

/* ── Who owns which extension ──────────────────────────────────────────
 * Provisioning is the source of truth for extension → user → branch → DID.
 * It changes when staff join or leave, which is to say rarely, so it is
 * fetched on startup and refreshed on a long timer — never on the call
 * poller's two-second tick.
 *
 * The account holds 84 extensions across 17 pages; our own table had 34,
 * which is why call-centre agents were arriving with no studio attached.
 * ────────────────────────────────────────────────────────────────── */

const PAGE_SIZE = 100;

interface ProvisionedExtension {
  extension_number?: string;
  user?: { id?: number; email?: string; login_name?: string; first_name?: string; last_name?: string };
  /** Vonage's own location id — NOT one of ours. */
  location_id?: number;
  caller_id?: string;
  dids?: { phone_number?: string; custom_tag?: string }[];
  extension_handsets?: { sip_id?: string }[];
}

interface ProvisioningPage {
  _embedded?: { extensions?: ProvisionedExtension[] };
  page?: number;
  total_pages?: number;
  total_items?: number;
}

/** Digits only, so "12067612651" and "+1 206 761 2651" compare equal. */
const digits = (v: string | undefined | null): string => (v ?? "").replace(/\D/g, "");

/** A call-centre seat rather than a branch line. */
const isCallcentre = (name: string): boolean => /call\s*cent(er|re)/i.test(name);

/**
 * Reduces a studio or extension name to something comparable.
 *
 * Vonage names an extension "Cleopatra Ink Bradenton" and we call the
 * studio the same thing, so once the chain name and the punctuation are
 * gone the two agree. Matching on the DID alone left thirty-three branch
 * extensions attached to no studio, because our own records hold a
 * branch phone for only some of them.
 */
const nameKey = (value: string | null | undefined): string =>
  (value ?? "")
    .toLowerCase()
    .replace(/cleopatra\s*ink/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * The same name with every separator removed.
 *
 * Vonage writes "Cleopatra Ink Sanfrancisco" where we write "San
 * Francisco"; as slugs those differ, as bare letters they agree. Tried
 * only after the exact key, so it cannot pull two genuinely different
 * studios together.
 */
const compactKey = (value: string | null | undefined): string => nameKey(value).replace(/-/g, "");

export interface Directory {
  byExtension: Map<string, DirectoryEntry>;
  fetchedAt: Date;
  total: number;
}

let cache: Directory | null = null;

export const cachedDirectory = (): Directory | null => cache;

/** Pulls every page of the extension list. */
async function fetchProvisioned(): Promise<ProvisionedExtension[]> {
  const accountId = process.env.VONAGE_ACCOUNT_ID;
  if (!accountId) throw new Error("VONAGE_ACCOUNT_ID is not set");

  const token = await vonageAccessToken();
  if (!token) throw new Error("no access token");

  const out: ProvisionedExtension[] = [];

  for (let page = 1; page <= 20; page++) {
    const qs = new URLSearchParams({ page_size: String(PAGE_SIZE), page: String(page) });
    const res = await fetch(
      `${vonageEndpoints.extensions(accountId)}?${qs}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    );
    if (!res.ok) throw new Error(`provisioning HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const body = (await res.json()) as ProvisioningPage;
    const rows = body._embedded?.extensions ?? [];
    out.push(...rows);

    if (rows.length === 0 || (body.total_pages !== undefined && page >= body.total_pages)) break;
  }

  return out;
}

/**
 * Rebuilds the extension directory from Vonage and returns it.
 *
 * Studios are matched on the DID rather than Vonage's `location_id`, which
 * is an id in their numbering and means nothing in ours — treating the two
 * as interchangeable would file calls against arbitrary studios.
 */
export async function refreshDirectory(): Promise<Directory> {
  const provisioned = await fetchProvisioned();

  const [ourNumbers, ourExtensions] = await Promise.all([
    db.select({ id: locations.id, phone: locations.branchPhone, name: locations.name, slug: locations.slug, city: locations.city })
      .from(locations),
    db.select({ ext: extensions.extension, locationId: extensions.locationId, staffId: extensions.staffId })
      .from(extensions),
  ]);

  const byNumber = new Map<string, number>();
  const byName = new Map<string, number>();
  const byCompact = new Map<string, number>();
  for (const loc of ourNumbers) {
    const d = digits(loc.phone);
    if (d) byNumber.set(d, loc.id);
    // First writer wins, so a slug is never shadowed by a similar city.
    for (const key of [loc.slug, nameKey(loc.name), nameKey(loc.city)]) {
      if (key && !byName.has(key)) byName.set(key, loc.id);
    }
    for (const key of [compactKey(loc.name), compactKey(loc.city), loc.slug?.replace(/-/g, "")]) {
      if (key && !byCompact.has(key)) byCompact.set(key, loc.id);
    }
  }

  /* Our own table keeps the human decisions — which member of staff sits on
     an extension, which studio a call-centre seat answers for. Vonage knows
     nothing about either, so those are carried over rather than overwritten. */
  const ourByExt = new Map(ourExtensions.map((e) => [e.ext, e]));

  const byExtension = new Map<string, DirectoryEntry>();

  for (const row of provisioned) {
    const ext = row.extension_number?.trim();
    if (!ext) continue;

    const name = [row.user?.first_name, row.user?.last_name].filter(Boolean).join(" ").trim() || null;
    const dids = (row.dids ?? [])
      .map((d) => d.phone_number)
      .filter((n): n is string => Boolean(n));

    const known = ourByExt.get(ext);
    let locationId = known?.locationId ?? null;
    if (locationId === null) {
      for (const did of [...dids, row.caller_id ?? ""]) {
        const match = byNumber.get(digits(did));
        if (match !== undefined) { locationId = match; break; }
      }
    }
    /* Falling back to the name catches the branches whose DID we never
       recorded. A personal extension ("Hakan Goncu") matches nothing and
       stays unattached, which is the right answer for it. */
    if (locationId === null && name && !isCallcentre(name)) {
      locationId = byName.get(nameKey(name)) ?? byCompact.get(compactKey(name)) ?? null;
    }

    byExtension.set(ext, {
      extension: ext,
      name,
      locationId,
      staffId: known?.staffId ?? null,
      dids,
      category: isCallcentre(name ?? "") ? "callcenter" : "branch",
    });
  }

  cache = { byExtension, fetchedAt: new Date(), total: byExtension.size };
  return cache;
}

/** The cached directory, fetching it once if nothing has yet. */
export async function getDirectory(): Promise<Directory> {
  if (cache) return cache;
  return refreshDirectory();
}

/**
 * Writes the directory back to our `extensions` table.
 *
 * Kept apart from refreshDirectory so the poller never writes to the
 * database on a two-second tick. `staffId` is never touched: it is set by
 * a person in the console and Vonage has no opinion about it.
 */
export async function syncExtensionsTable(dir: Directory): Promise<{ added: number; updated: number }> {
  /* Read the table once rather than once per extension. Eighty-four
     extensions meant eighty-four selects to discover what is almost always
     "nothing has changed". */
  const existing = await db
    .select({
      id: extensions.id,
      extension: extensions.extension,
      displayName: extensions.displayName,
      locationId: extensions.locationId,
      phoneNumber: extensions.phoneNumber,
    })
    .from(extensions);
  const byExt = new Map(existing.map((e) => [e.extension, e]));

  const toInsert: {
    extension: string;
    displayName: string;
    phoneNumber: string | null;
    locationId: number | null;
    userType: string;
  }[] = [];
  const toUpdate: { id: number; patch: Record<string, unknown> }[] = [];

  for (const entry of dir.byExtension.values()) {
    const row = byExt.get(entry.extension);

    if (!row) {
      toInsert.push({
        extension: entry.extension,
        displayName: entry.name ?? entry.extension,
        phoneNumber: entry.dids[0] ?? null,
        locationId: entry.locationId,
        userType: entry.category === "callcenter" ? "CALL_CENTRE" : "END_USER",
      });
      continue;
    }

    /* Only fill gaps. An operator who assigned a studio by hand has more
       context than a DID match does, so their choice stands. */
    const patch: Record<string, unknown> = {};
    if (entry.name && row.displayName !== entry.name) patch.displayName = entry.name;
    if (row.locationId === null && entry.locationId !== null) patch.locationId = entry.locationId;
    if (entry.dids[0] && row.phoneNumber !== entry.dids[0]) patch.phoneNumber = entry.dids[0];

    if (Object.keys(patch).length > 0) toUpdate.push({ id: row.id, patch });
  }

  if (toInsert.length > 0) {
    await db.insert(extensions).values(toInsert).onConflictDoNothing();
  }
  /* Updates stay one statement each — they carry different values, and
     there are only ever a handful once the first sync has run. */
  for (const u of toUpdate) {
    await db.update(extensions).set(u.patch).where(eq(extensions.id, u.id));
  }

  return { added: toInsert.length, updated: toUpdate.length };
}
