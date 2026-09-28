import type { BusinessHours } from "@/db/schema";
import { TimelySession, sleep, PAGE_PAUSE_MS } from "./client";

/* ── Reading Timely's pages ────────────────────────────────────────────
 * Every function here parses HTML with a regular expression, because
 * Timely exposes no API for any of it. That is fragile by construction, so
 * each one reports a COUNT and never an empty success: "the staff list
 * parsed to zero people" and "this account has no staff" look identical to
 * a caller that only gets an array, and the first is a broken parser while
 * the second is a fact. The callers treat zero as a failure.
 * ────────────────────────────────────────────────────────────────── */

export interface ScrapedStaff {
  timelyId: string;
  name: string;
  email: string | null;
  status: number;
}

export interface ScrapedLocation {
  timelyId: string;
  name: string;
  address: string | null;
  slug: string;
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** "Cleopatra Ink Fort Myers" → "fort-myers", so a studio can be *offered*
 *  a match. Never used to make one automatically. */
export function slugify(name: string): string {
  return name
    .replace(/cleopatra\s*ink/gi, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The staff list, from the JSON the page carries in a script tag.
 *
 * The one piece of Timely that is not HTML scraping: the page ships a real
 * array, so this is the only parser here that cannot mis-read a field.
 */
export async function scrapeStaff(
  session: TimelySession,
): Promise<{ ok: true; staff: ScrapedStaff[] } | { ok: false; detail: string }> {
  const { status, html } = await session.request("GET", "/Settings/StaffList");
  if (status !== 200) return { ok: false, detail: `staff list HTTP ${status}` };
  return parseStaffList(html);
}

/* ── Parsing, apart from fetching ──────────────────────────────────────
 * The parsers are the fragile half — a template change over there breaks a
 * regular expression over here — so they are exported on their own and the
 * tests call THESE. A test that re-types the regular expression next to the
 * assertion tests its own copy: the real one can rot and the suite stays
 * green, which is worse than having no test.
 * ────────────────────────────────────────────────────────────── */
export function parseStaffList(
  html: string,
): { ok: true; staff: ScrapedStaff[] } | { ok: false; detail: string } {
  const match = /var staffList\s*=\s*(\[.*?\]);/s.exec(html);
  if (!match) return { ok: false, detail: "no staffList on the page — Timely changed the template" };

  let parsed: { id: number | string; name: string; email?: string; status?: number }[];
  try {
    parsed = JSON.parse(match[1]) as typeof parsed;
  } catch {
    return { ok: false, detail: "staffList was not valid JSON" };
  }

  return {
    ok: true,
    staff: parsed.map((s) => ({
      timelyId: String(s.id),
      name: s.name,
      // Timely writes the literal string for "none", which is not an address.
      email: !s.email || s.email === "N/A" ? null : s.email,
      status: s.status ?? 1,
    })),
  };
}

/** The studios this account can see. */
export async function scrapeLocations(
  session: TimelySession,
): Promise<{ ok: true; locations: ScrapedLocation[] } | { ok: false; detail: string }> {
  const { status, html } = await session.request("GET", "/Setup/Locations");
  if (status !== 200) return { ok: false, detail: `locations HTTP ${status}` };
  return parseLocations(html);
}

export function parseLocations(
  html: string,
): { ok: true; locations: ScrapedLocation[] } | { ok: false; detail: string } {
  const pattern = /data-id="(\d+)".*?card__title">\s*(.*?)\s*<\/h3>.*?<h3>\s*(.*?)\s*<\/h3>/gs;
  const out: ScrapedLocation[] = [];
  for (const m of html.matchAll(pattern)) {
    const name = m[2].replace(/\s+/g, " ").trim();
    out.push({
      timelyId: m[1],
      name,
      address: m[3].replace(/\s+/g, " ").trim() || null,
      slug: slugify(name),
    });
  }

  if (out.length === 0) {
    return { ok: false, detail: "no studios parsed — Timely changed the template" };
  }
  return { ok: true, locations: out };
}

/**
 * One studio's opening hours.
 *
 * Deliberately returns nothing when the page cannot be read. The Laravel
 * version fell back to 08:30–22:00 seven days a week, which is worse than
 * no answer: it publishes a studio as open at times nobody is there, and
 * the booking engine sells those slots.
 */
export async function scrapeLocationHours(
  session: TimelySession,
  timelyId: string,
): Promise<{ ok: true; hours: Partial<BusinessHours> } | { ok: false; detail: string }> {
  /* /Setup/Locations/Edit/{id} is where the Laravel integration looked and
     it answers 404 — every studio cost a wasted request and came back with
     no hours. The real page is the one the studio list links to. */
  const { status, html } = await session.request(
    "GET",
    `/Setup/Locations/Location/${timelyId}?tab=details`,
  );
  if (status !== 200) return { ok: false, detail: `hours HTTP ${status}` };
  return parseLocationHours(html);
}

export function parseLocationHours(
  html: string,
): { ok: true; hours: Partial<BusinessHours> } | { ok: false; detail: string } {
  /* Timely names the fields by day — Location.Hours.MondayOpen, .MondayStart,
     .MondayEnd — not by index, and the attributes come in no fixed order. So
     the tags are collected by id and then read, rather than matched by a
     pattern that assumes where `checked` or `value` sits.
     
     Each checkbox is shadowed by a hidden input of the same NAME carrying
     "false" — the usual ASP.NET pairing so an unticked box still posts. That
     twin has no id, which is what makes keying by id safe here. */
  const byId = new Map<string, string>();
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const id = /\bid="([^"]+)"/i.exec(m[0])?.[1];
    if (id && !byId.has(id)) byId.set(id, m[0]);
  }

  const NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
  const value = (tag: string | undefined) => (tag ? /\bvalue="([^"]*)"/i.exec(tag)?.[1] : undefined);

  const hours: Partial<BusinessHours> = {};
  for (let i = 0; i < NAMES.length; i += 1) {
    const day = NAMES[i];
    const openTag = byId.get(`Location_Hours_${day}Open`);
    if (!openTag || !/\bchecked\b/i.test(openTag)) continue;

    const start = value(byId.get(`Location_Hours_${day}Start`));
    const end = value(byId.get(`Location_Hours_${day}End`));
    /* A day ticked open with no times is not a day we can publish. Skipping
       it leaves the studio closed then, which is the safe direction: the
       other one sells appointments at hours nobody works. */
    if (!start || !end) continue;

    hours[DAYS[i]] = { enabled: true, open: start, close: end };
  }

  if (Object.keys(hours).length === 0) {
    return { ok: false, detail: "no opening hours parsed" };
  }
  return { ok: true, hours };
}

/* The slot length used to be scraped from /Setup/CalendarSettings. That page
   answers 404 now, and it is on neither the location page nor the obvious
   alternatives — so the scrape is gone rather than kept as a request that
   always fails. The booking engine reads our own
   locations.booking_interval_min, which is where the number belongs. */

export interface ScrapedStaffDetails {
  webhookUrl: string | null;
  locationIds: string[];
}

/**
 * Deep scrape for one staff member: their private iCalendar sync URL
 * and which studios they work at.
 */
export async function scrapeStaffDetails(
  session: TimelySession,
  staffTimelyId: string,
): Promise<{ ok: true; details: ScrapedStaffDetails } | { ok: false; detail: string }> {
  const { status, html } = await session.request("GET", `/Settings/StaffEdit/${staffTimelyId}`);
  if (status !== 200) return { ok: false, detail: `staff page HTTP ${status}` };
  return parseStaffEditPage(html, staffTimelyId);
}

export function parseStaffEditPage(
  html: string,
  staffTimelyId: string,
): { ok: true; details: ScrapedStaffDetails } | { ok: false; detail: string } {
  // 1. Private iCalendar URL
  let webhookUrl: string | null = null;
  const calMatch = /id="CalendarSyncModel_CalendarSyncUrl"[^>]*>([\s\S]*?)<\/textarea>/i.exec(html);
  if (calMatch && calMatch[1].trim()) {
    const raw = calMatch[1].trim();
    if (raw.startsWith("http")) webhookUrl = raw;
  }

  // 2. Assigned studios (marked with fa-check)
  const pattern = new RegExp(
    `<a href="/Settings/StaffLocation\\?staffId=${staffTimelyId}&amp;locationId=(\\d+)"[^>]*>(.*?)</a>`,
    "gs",
  );
  const assigned: string[] = [];
  for (const m of html.matchAll(pattern)) {
    if (m[2].includes("fa-check")) assigned.push(m[1]);
  }

  return { ok: true, details: { webhookUrl, locationIds: assigned } };
}

/** Which studios a member of staff actually works at. */
export async function scrapeStaffLocations(
  session: TimelySession,
  staffTimelyId: string,
): Promise<{ ok: true; locationIds: string[] } | { ok: false; detail: string }> {
  const res = await scrapeStaffDetails(session, staffTimelyId);
  if (!res.ok) return res;
  return { ok: true, locationIds: res.details.locationIds };
}

export { sleep, PAGE_PAUSE_MS };

