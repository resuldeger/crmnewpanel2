/* ── Comprehensive Test Suite: Timely Multi-Account & Availability ── */
import { parseIcs, resolveTzid } from "../../src/server/booking/ics";
import { buildTargets } from "../../src/server/jobs/timelySync";
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
/* An empty staff list is a broken parser, not an empty account. Letting it
   through as a success would stamp last_sync_at and show a healthy card over
   an integration that had quietly stopped reading anything. */
{
  const empty = parseStaffList('<script>var staffList = [];</script>');
  assert("An empty staffList is reported as a failure", empty.ok === false);
  const gone = parseStaffList("<html><body>nothing here</body></html>");
  assert("A missing staffList is reported as a failure", gone.ok === false);
  const one = parseStaffList('<script>var staffList = [{"id":7,"name":"Designer Ada","email":"N/A","status":1}];</script>');
  assert("A real staffList parses", one.ok === true);
  if (one.ok) {
    assert("Timely's literal N/A is not kept as an address", one.staff[0].email === null);
    assert("Timely's id is kept as text", one.staff[0].timelyId === "7");
  }
}

/* Slugs are only ever a suggestion for a match, but a wrong one is offered
   to a human who may accept it, so the accents have to survive the trip. */
{
  assert("Turkish accents fold to ASCII", slugify("Cleopatra Ink Şişli Güzel") === "sisli-guzel");
  assert("The chain name is stripped", slugify("Cleopatra Ink Fort Myers") === "fort-myers");
}

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
// ─────────────────────────────────────────────────────────────────────────────
// TEST SCENARIO 3b: One artist, two Timely diaries
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Test 3b] Two Timely calendars for one artist stay on one target");
{
  /* Timely carries some people twice, under two ids with two diaries. Both
     used to become their own sweep target, and blocks are tagged by ARTIST —
     so the cleanup, which removes every block under that tag the feed just
     read did not mention, had whichever target finished second delete the
     first one's work. With one of the two calendars empty the answer was
     simply "no blocks". Proven against the live row before this changed:
     artist 229 held 1 block and the empty feed's cleanup removed it. */
  const { targets, unmapped } = buildTargets([], [
    { staffId: 1, staffName: "Designer Tuna Ergin", webhookUrl: "https://feed/a.ics", artistId: 229, localLocationId: 26 },
    { staffId: 2, staffName: "Designer Tuna Ergin", webhookUrl: "https://feed/b.ics", artistId: 229, localLocationId: 26 },
  ]);
  assert("Two diaries for one artist make ONE target", targets.length === 1, `${targets.length} targets`);
  assert("Both calendars are on it", targets[0]?.urls.length === 2, JSON.stringify(targets[0]?.urls));
  assert("Both staff rows are on it", targets[0]?.timelyStaffIds.length === 2);
  assert("The studio is not repeated", targets[0]?.locationIds.length === 1);
  assert("Nobody counted as unmapped", unmapped === 0);
}
{
  /* A diary nobody has attributed to a chair is not swept. An unattributed
     block counts as a seat used and does not dedupe, so two overlapping
     entries from ONE person would take both chairs at a studio whose
     capacity is two and close it. */
  const { targets, unmapped } = buildTargets([], [
    { staffId: 3, staffName: "Designer Nobody", webhookUrl: "https://feed/c.ics", artistId: null, localLocationId: 26 },
    { staffId: 3, staffName: "Designer Nobody", webhookUrl: "https://feed/c.ics", artistId: null, localLocationId: 27 },
  ]);
  assert("An unmapped diary is not swept", targets.length === 0);
  assert("One person counted once, not once per studio", unmapped === 1, `${unmapped}`);
}
{
  /* A hand-pasted URL on the artist and a scraped one from Timely are the
     same person, so they share a target rather than racing each other. */
  const { targets } = buildTargets(
    [{ artistId: 7, artistName: "Ada", feedUrl: "https://feed/hand.ics", locationId: 3 }],
    [{ staffId: 9, staffName: "Designer Ada", webhookUrl: "https://feed/scraped.ics", artistId: 7, localLocationId: 4 }],
  );
  assert("Hand-pasted and scraped merge onto one target", targets.length === 1);
  assert("Both feeds are read", targets[0]?.urls.length === 2);
  assert("Both studios are blocked", targets[0]?.locationIds.length === 2);
}

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
console.log("\n▶ [Test 4b] Timezones: Windows names, DST, Arizona, floating times");
{
  const mk = (tzid: string | null, start: string, end: string) =>
    ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:tz-probe",
     tzid ? `DTSTART;TZID=${tzid}:${start}` : `DTSTART:${start}`,
     tzid ? `DTEND;TZID=${tzid}:${end}` : `DTEND:${end}`,
     "END:VEVENT", "END:VCALENDAR"].join("\n");
  const at = (tzid: string | null, start: string, end: string, studioTz = "America/New_York") =>
    parseIcs(mk(tzid, start, end), studioTz)[0]?.start.toISOString() ?? "(dropped)";

  /* Windows zone names are not what they sound like: "Eastern Standard Time"
     means the Eastern zone INCLUDING its daylight saving, so a June booking
     is UTC-4 and a January one UTC-5. A fixed -05:00 would put every summer
     appointment an hour early for half the year. */
  assert("Summer Eastern is UTC-4",
    at("Eastern Standard Time", "20260630T140000", "20260630T150000") === "2026-06-30T18:00:00.000Z");
  assert("Winter Eastern is UTC-5",
    at("Eastern Standard Time", "20260115T140000", "20260115T150000") === "2026-01-15T19:00:00.000Z");

  /* Arizona keeps the same offset all year. Mapping it to America/Denver
     would move every Chandler and Scottsdale booking by an hour in summer. */
  assert("Arizona stays UTC-7 in June",
    at("US Mountain Standard Time", "20260630T140000", "20260630T150000") === "2026-06-30T21:00:00.000Z");
  assert("Arizona stays UTC-7 in January",
    at("US Mountain Standard Time", "20260115T140000", "20260115T150000") === "2026-01-15T21:00:00.000Z");

  /* A floating time — no Z, no TZID — read as UTC moves a New York booking
     five hours, which shows a taken slot as free. It is read in the studio's
     own zone instead, so the same wall clock means two different instants at
     two studios. */
  assert("Floating time follows the studio · Phoenix",
    at(null, "20260630T140000", "20260630T150000", "America/Phoenix") === "2026-06-30T21:00:00.000Z");
  assert("Floating time follows the studio · New York",
    at(null, "20260630T140000", "20260630T150000", "America/New_York") === "2026-06-30T18:00:00.000Z");

  assert("A Z suffix is already UTC",
    at(null, "20260630T140000Z", "20260630T150000Z") === "2026-06-30T14:00:00.000Z");

  /* An unrecognised TZID falls back to the studio's zone rather than being
     dropped: a booking at the wrong hour is a bug, one that vanishes sells
     the slot twice. */
  assert("An unknown TZID does not drop the event",
    at("Mars Standard Time", "20260630T140000", "20260630T150000", "America/Phoenix") === "2026-06-30T21:00:00.000Z");

  /* 8 March 2026: the hour 02:00–03:00 does not exist in New York. A DTEND
     of 02:30 resolves to the same instant as a DTSTART of 01:30, and the
     event used to be dropped for having no length — a taken chair put back
     on sale. It now falls back to half an hour. */
  const spring = parseIcs(mk("Eastern Standard Time", "20260308T013000", "20260308T023000"), "America/New_York")[0];
  assert("An event ending in a nonexistent hour survives", spring !== undefined);
  assert("It keeps its start", spring?.start.toISOString() === "2026-03-08T06:30:00.000Z", String(spring?.start));
  assert("It gets half an hour", spring && spring.end.getTime() - spring.start.getTime() === 30 * 60_000);

  /* 1 November 2026: 01:30 happens twice. 01:30 to 02:30 really is two hours
     of wall time, and that is what the chair is occupied for. */
  const fall = parseIcs(mk("Eastern Standard Time", "20261101T013000", "20261101T023000"), "America/New_York")[0];
  assert("The repeated hour is counted once, as real time",
    fall && fall.end.getTime() - fall.start.getTime() === 2 * 60 * 60_000,
    fall ? String((fall.end.getTime() - fall.start.getTime()) / 60000) + " min" : "dropped");
}

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
