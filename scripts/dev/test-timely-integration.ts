/* ── Comprehensive Test Suite: Timely Multi-Account & Availability ── */
import { parseIcs, resolveTzid } from "../../src/server/booking/ics";
import {
  slugify,
  parseStaffList,
  parseLocations,
  parseLocationHours,
  parseStaffEditPage,
} from "../../src/server/timely/scrape";

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
<div class="checkbox">
  <input id="CalendarSyncModel_CalendarSyncEnabled" name="CalendarSyncModel.CalendarSyncEnabled" type="checkbox" value="true" checked="checked" />
</div>
<div class="form-group">
  <textarea id="CalendarSyncModel_CalendarSyncUrl" readonly="readonly">https://webhooks.gettimely.com/ical/staff/abc-123-secret-token</textarea>
</div>
<div class="locations-list">
  <a href="/Settings/StaffLocation?staffId=991&amp;locationId=42"><span class="fa fa-check"></span> Miami Beach</a>
  <a href="/Settings/StaffLocation?staffId=991&amp;locationId=43"><span></span> Orlando (Unchecked)</a>
  <a href="/Settings/StaffLocation?staffId=991&amp;locationId=44"><span class="fa fa-check"></span> Tampa</a>
</div>
`;

/* The REAL parser, not a copy of its regular expression beside the
   assertion. A duplicated regex lets the real one rot while the suite
   stays green. */
const details = parseStaffEditPage(mockStaffEditHtml, "991");

/* Sync off. Timely still prints a URL here, and it is worthless: the guid is
   re-minted on every page load and each one answers 404. Storing it would send
   the sweep after an address that never existed and report it as a network
   fault. The URL must be dropped, and only the flag survives. */
const mockSyncOffHtml = mockStaffEditHtml.replace(' checked="checked"', "");
const offDetails = parseStaffEditPage(mockSyncOffHtml, "991");
assert("Sync-off staff page still parses", offDetails.ok);
if (offDetails.ok) {
  assert("Sync off is reported", offDetails.details.syncEnabled === false);
  assert(
    "The dead URL from an unticked page is discarded",
    offDetails.details.webhookUrl === null,
    `Got: ${offDetails.details.webhookUrl}`,
  );
  assert(
    "Studio assignments are still read when sync is off",
    offDetails.details.locationIds.length === 2,
    `Got: ${JSON.stringify(offDetails.details.locationIds)}`,
  );
}

/* Timely renames the input one day. Reading a missing checkbox as "off" would
   drop every feed in the chain in a single sweep. Unknown keeps the URL and
   lets the feed read decide, so a markup change costs 404s, not the roster. */
const mockNoCheckboxHtml = mockStaffEditHtml.replace(
  /<input id="CalendarSyncModel_CalendarSyncEnabled"[^>]*\/>/,
  '<input id="CalendarSyncModel_SyncOn" type="checkbox" checked="checked" />',
);
const unknownDetails = parseStaffEditPage(mockNoCheckboxHtml, "991");
assert("Page with no sync checkbox still parses", unknownDetails.ok);
if (unknownDetails.ok) {
  assert("A missing checkbox reads as unknown, not off", unknownDetails.details.syncEnabled === null);
  assert(
    "An unknown page keeps its URL rather than dropping the feed",
    unknownDetails.details.webhookUrl === "https://webhooks.gettimely.com/ical/staff/abc-123-secret-token",
    `Got: ${unknownDetails.details.webhookUrl}`,
  );
}

assert("Staff page parses", details.ok);
if (details.ok) {
  assert("Sync on is reported", details.details.syncEnabled === true);
  assert(
    "Extracted secret .ics webhook URL correctly",
    details.details.webhookUrl === "https://webhooks.gettimely.com/ical/staff/abc-123-secret-token",
    `Got: ${details.details.webhookUrl}`,
  );
  assert(
    "Extracted assigned location IDs (Miami Beach: 42, Tampa: 44)",
    details.details.locationIds.length === 2 &&
      details.details.locationIds.includes("42") &&
      details.details.locationIds.includes("44"),
    `Got: ${JSON.stringify(details.details.locationIds)}`,
  );
  assert(
    "Unticked studio (Orlando: 43) is left out",
    !details.details.locationIds.includes("43"),
  );
}

/* Timely changing a template is the failure this integration actually has,
   so the parsers must say so rather than return an empty success — "parsed
   to nothing" and "there is nothing" are the same array to a caller. */
console.log("\n▶ [Test 3b] A changed template is reported, not swallowed");

const staffListOk = parseStaffList(`<script>var staffList = [{"id":7,"name":"Ada","email":"N/A","status":1}];</script>`);
assert("Staff list parses from the page's own JSON", staffListOk.ok);
if (staffListOk.ok) {
  assert("N/A e-mail becomes null", staffListOk.staff[0].email === null);
  assert("Timely id is carried as a string", staffListOk.staff[0].timelyId === "7");
}
assert("Staff list: missing array is an error", !parseStaffList("<html>nothing here</html>").ok);
assert("Staff list: broken JSON is an error", !parseStaffList("var staffList = [oops];").ok);

assert("Locations: nothing parsed is an error", !parseLocations("<html>changed</html>").ok);
const locsOk = parseLocations(
  `<div data-id="42"><h3 class="card__title"> Cleopatra Ink Miami Beach </h3><h3> 1 Ocean Dr </h3></div>`,
);
assert("Locations parse, name slugified for matching", locsOk.ok && locsOk.locations[0].slug === "miami-beach");

assert("Hours: nothing parsed is an error", !parseLocationHours("<html>changed</html>").ok);
/* The real markup, copied from a live location page: named by day, not
   indexed, and every checkbox shadowed by a hidden twin carrying "false" —
   the ASP.NET pairing that makes an unticked box still post. The old fixture
   used Hours[0].IsOpen, which is what the Laravel integration read from a
   page that now answers 404. */
const hoursOk = parseLocationHours(`
  <input checked="checked" id="Location_Hours_MondayOpen" name="Location.Hours.MondayOpen" type="checkbox" value="true" />
  <input name="Location.Hours.MondayOpen" type="hidden" value="false" />
  <input autocomplete="off" type="hidden" id="Location_Hours_MondayStart" name="Location.Hours.MondayStart" value="10:00" />
  <input autocomplete="off" type="hidden" id="Location_Hours_MondayEnd" name="Location.Hours.MondayEnd" value="20:00" />
  <input id="Location_Hours_TuesdayOpen" name="Location.Hours.TuesdayOpen" type="checkbox" value="true" />
  <input name="Location.Hours.TuesdayOpen" type="hidden" value="false" />
  <input autocomplete="off" type="hidden" id="Location_Hours_TuesdayStart" name="Location.Hours.TuesdayStart" value="09:00" />
  <input autocomplete="off" type="hidden" id="Location_Hours_TuesdayEnd" name="Location.Hours.TuesdayEnd" value="17:00" />
  <input checked="checked" id="Location_Hours_WednesdayOpen" name="Location.Hours.WednesdayOpen" type="checkbox" value="true" />
  <input autocomplete="off" type="hidden" id="Location_Hours_WednesdayStart" name="Location.Hours.WednesdayStart" value="" />
`);
assert("Monday parses into the booking engine's own shape",
  hoursOk.ok && hoursOk.hours.mon?.enabled === true && hoursOk.hours.mon?.open === "10:00" && hoursOk.hours.mon?.close === "20:00",
  hoursOk.ok ? JSON.stringify(hoursOk.hours.mon) : "parse failed");
assert("The hidden false twin is not mistaken for a ticked day",
  hoursOk.ok && hoursOk.hours.tue === undefined);
assert("A day ticked open with no times is skipped, not published half-set",
  hoursOk.ok && hoursOk.hours.wed === undefined);

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
