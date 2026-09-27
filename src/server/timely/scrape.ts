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
  const { status, html } = await session.request("GET", `/Setup/Locations/Edit/${timelyId}`);
  if (status !== 200) return { ok: false, detail: `hours HTTP ${status}` };

  const hours: Partial<BusinessHours> = {};
  for (let i = 0; i < 7; i += 1) {
    const isOpen = new RegExp(
      `name="Hours\\[${i}\\]\\.IsOpen"[^>]*value="true"[^>]*checked`, "i",
    ).test(html);
    if (!isOpen) continue;
    const start = new RegExp(`name="Hours\\[${i}\\]\\.Start"[^>]*value="([^"]*)"`, "i").exec(html)?.[1];
    const end = new RegExp(`name="Hours\\[${i}\\]\\.End"[^>]*value="([^"]*)"`, "i").exec(html)?.[1];
    if (!start || !end) continue;
    /* The booking engine's own shape — `enabled/open/close`, not
       `open/start/end`. Two names for opening hours in one codebase is how
       a studio ends up published with the wrong ones. */
    hours[DAYS[i]] = { enabled: true, open: start, close: end };
  }

  if (Object.keys(hours).length === 0) {
    return { ok: false, detail: "no opening hours parsed" };
  }
  return { ok: true, hours };
}

/** The slot length, which Timely sets once for the whole account. */
export async function scrapeSlotMinutes(
  session: TimelySession,
): Promise<number | null> {
  const { status, html } = await session.request("GET", "/Setup/CalendarSettings");
  if (status !== 200) return null;
  const m =
    /name="SlotDuration"[\s\S]*?value="(\d+)"\s+selected/i.exec(html) ??
    /name="SlotDuration"[\s\S]*?selected="selected"\s+value="(\d+)"/i.exec(html);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Which studios a member of staff actually works at. */
export async function scrapeStaffLocations(
  session: TimelySession,
  staffTimelyId: string,
): Promise<{ ok: true; locationIds: string[] } | { ok: false; detail: string }> {
  const { status, html } = await session.request("GET", `/Settings/StaffEdit/${staffTimelyId}`);
  if (status !== 200) return { ok: false, detail: `staff page HTTP ${status}` };

  const pattern = new RegExp(
    `<a href="/Settings/StaffLocation\\?staffId=${staffTimelyId}&amp;locationId=(\\d+)"[^>]*>(.*?)</a>`,
    "gs",
  );
  const assigned: string[] = [];
  for (const m of html.matchAll(pattern)) {
    // A tick beside the studio is what "works here" looks like in the markup.
    if (m[2].includes("fa-check")) assigned.push(m[1]);
  }
  return { ok: true, locationIds: assigned };
}

export { sleep, PAGE_PAUSE_MS };
