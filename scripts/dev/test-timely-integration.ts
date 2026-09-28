/* ── Comprehensive Test Suite: Timely Multi-Account & Availability ── */
import { parseIcs, resolveTzid } from "../../src/server/booking/ics";
import { slugify } from "../../src/server/timely/scrape";

let passed = 0;
let failed = 0;

function assert(description: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${description}`);
  } else {
    failed += 1;
    console.error(`  ✗ FAIL: ${description}${detail ? ` (${detail})` : ""}`);
  }
}

console.log("\n=======================================================");
console.log("  CLEOPATRA CRM — TIMELY INTEGRATION TEST SUITE");
console.log("=======================================================\n");

// ─────────────────────────────────────────────────────────────────────────────
// TEST SCENARIO 1: Slugification & Auto-Match Candidates
// ─────────────────────────────────────────────────────────────────────────────
console.log("▶ [Test 1] Studio Name Slugification & Auto-Match Candidate generation");
assert("Cleopatra Ink Miami Beach -> miami-beach", slugify("Cleopatra Ink Miami Beach") === "miami-beach");
assert("Cleopatra Ink Fort Myers -> fort-myers", slugify("Cleopatra Ink Fort Myers") === "fort-myers");
assert("CLEOPATRA INK Istanbul Kadikoy -> istanbul-kadikoy", slugify("CLEOPATRA INK Istanbul Kadikoy") === "istanbul-kadikoy");
assert("Denver Tattoo -> denver-tattoo", slugify("Denver Tattoo") === "denver-tattoo");

// ─────────────────────────────────────────────────────────────────────────────
// TEST SCENARIO 2: Windows Timezone Resolution (Timely format)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Test 2] Windows Timezone Mappings from Timely iCal feeds");
assert("Eastern Standard Time -> America/New_York", resolveTzid("Eastern Standard Time") === "America/New_York");
assert("Mountain Standard Time -> America/Denver", resolveTzid("Mountain Standard Time") === "America/Denver");
assert("Central Standard Time -> America/Chicago", resolveTzid("Central Standard Time") === "America/Chicago");
assert("Turkey Standard Time -> Europe/Istanbul", resolveTzid("Turkey Standard Time") === "Europe/Istanbul");
assert("Standard IANA zone passes through", resolveTzid("America/New_York") === "America/New_York");

// ─────────────────────────────────────────────────────────────────────────────
// TEST SCENARIO 3: Secret .ics Webhook URL Extraction & Regex Parsing
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Test 3] HTML Scraper Regex for CalendarSyncUrl & Staff Locations");
const mockStaffEditHtml = `
<div class="form-group">
  <textarea id="CalendarSyncModel_CalendarSyncUrl" readonly="readonly">https://webhooks.gettimely.com/ical/staff/abc-123-secret-token</textarea>
</div>
<div class="locations-list">
  <a href="/Settings/StaffLocation?staffId=991&amp;locationId=42"><span class="fa fa-check"></span> Miami Beach</a>
  <a href="/Settings/StaffLocation?staffId=991&amp;locationId=43"><span></span> Orlando (Unchecked)</a>
  <a href="/Settings/StaffLocation?staffId=991&amp;locationId=44"><span class="fa fa-check"></span> Tampa</a>
</div>
`;

// Extract Webhook URL
const calMatch = /id="CalendarSyncModel_CalendarSyncUrl"[^>]*>([\s\S]*?)<\/textarea>/i.exec(mockStaffEditHtml);
const extractedUrl = calMatch ? calMatch[1].trim() : null;
assert("Extracted secret .ics webhook URL correctly", extractedUrl === "https://webhooks.gettimely.com/ical/staff/abc-123-secret-token");

// Extract assigned locations
const locPattern = /<a href="\/Settings\/StaffLocation\?staffId=991&amp;locationId=(\d+)"[^>]*>(.*?)<\/a>/gs;
const assignedLocs: string[] = [];
for (const m of mockStaffEditHtml.matchAll(locPattern)) {
  if (m[2].includes("fa-check")) assignedLocs.push(m[1]);
}
assert("Extracted assigned location IDs (Miami Beach: 42, Tampa: 44)", assignedLocs.length === 2 && assignedLocs.includes("42") && assignedLocs.includes("44"));

// ─────────────────────────────────────────────────────────────────────────────
// TEST SCENARIO 4: iCalendar Feed Parsing & UTC Conversion
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Test 4] RFC 5545 iCalendar parsing with UTC instant conversion");
const mockIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//GetTimely//EN
BEGIN:VEVENT
UID:timely-event-101@gettimely.com
SUMMARY:Tattoo Session - John Doe
DTSTART;TZID=Eastern Standard Time:20261015T140000
DTEND;TZID=Eastern Standard Time:20261015T160000
STATUS:CONFIRMED
END:VEVENT
BEGIN:VEVENT
UID:timely-event-102@gettimely.com
SUMMARY:Cancelled Consultation
DTSTART:20261015T100000Z
DTEND:20261015T110000Z
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`;

const events = parseIcs(mockIcs, "America/New_York");
assert("Parsed active events (cancelled filtered out or flagged)", events.length === 2);
const activeEvent = events.find((e) => e.uid === "timely-event-101@gettimely.com");
assert("Active event exists with correct summary", activeEvent !== undefined && activeEvent.summary === "Tattoo Session - John Doe");
assert("Active event is not cancelled", activeEvent !== undefined && !activeEvent.cancelled);

// 14:00 EDT (UTC-4) = 18:00 UTC
const startIso = activeEvent?.start.toISOString();
assert("DTSTART 14:00 in Eastern Standard Time correctly converts to 18:00 UTC", startIso === "2026-10-15T18:00:00.000Z", `Got: ${startIso}`);

const cancelledEvent = events.find((e) => e.uid === "timely-event-102@gettimely.com");
assert("Cancelled event is marked cancelled: true", cancelledEvent !== undefined && cancelledEvent.cancelled);

// ─────────────────────────────────────────────────────────────────────────────
// TEST SCENARIO 5: Multi-Chair / Slot Capacity Simulation (slotCapacity = 2)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Test 5] Slot Capacity & Overlap Logic (2 concurrent chairs)");
// Studio capacity: 2 chairs
const slotCapacity = 2;
const slotStart = new Date("2026-10-15T18:00:00Z").getTime();
const slotEnd = new Date("2026-10-15T18:30:00Z").getTime();

// Case A: 1 Timely appointment occupies chair 1
const appointmentsCaseA = [
  { startsAt: new Date("2026-10-15T18:00:00Z").getTime(), endsAt: new Date("2026-10-15T19:00:00Z").getTime(), artistId: 10 },
];
let occupiedA = 0;
for (const appt of appointmentsCaseA) {
  if (appt.startsAt < slotEnd && appt.endsAt > slotStart) occupiedA += 1;
}
const isAvailableCaseA = occupiedA < slotCapacity;
assert("Slot remains AVAILABLE when 1 Timely appointment is booked (capacity = 2)", isAvailableCaseA === true && occupiedA === 1);

// Case B: 2 Appointments (1 Timely + 1 Our Booking)
const appointmentsCaseB = [
  { startsAt: new Date("2026-10-15T18:00:00Z").getTime(), endsAt: new Date("2026-10-15T19:00:00Z").getTime(), artistId: 10 },
  { startsAt: new Date("2026-10-15T18:00:00Z").getTime(), endsAt: new Date("2026-10-15T18:30:00Z").getTime(), artistId: 11 },
];
let occupiedB = 0;
for (const appt of appointmentsCaseB) {
  if (appt.startsAt < slotEnd && appt.endsAt > slotStart) occupiedB += 1;
}
const isAvailableCaseB = occupiedB < slotCapacity;
assert("Slot becomes BLOCKED when both chairs are occupied (capacity = 2)", isAvailableCaseB === false && occupiedB === 2);

console.log("\n=======================================================");
console.log(`  RESULTS: ${passed} PASSED / ${failed} FAILED`);
console.log("=======================================================\n");

process.exit(failed === 0 ? 0 : 1);
