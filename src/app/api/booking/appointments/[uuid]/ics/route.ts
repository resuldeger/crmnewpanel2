import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appointments, locations } from "@/db/schema";
import { resolveDictionary } from "@/server/booking/dictionary";

export const dynamic = "force-dynamic";

/** RFC 5545: escape , ; \ and newlines inside a property value. */
const esc = (v: string) =>
  v.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** RFC 5545: fold lines at 75 octets, continuation lines start with a space. */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (start === 0 ? 75 : 74), bytes.length);
    // never split a multi-byte character
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push((start === 0 ? "" : " ") + bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return parts.join("\r\n");
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export async function GET(_req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await ctx.params;

  const [row] = await db
    .select({ a: appointments, studio: locations })
    .from(appointments)
    .innerJoin(locations, eq(locations.id, appointments.locationId))
    .where(eq(appointments.bkUuid, uuid))
    .limit(1);

  if (!row) return NextResponse.json({ message: "Not found" }, { status: 404 });

  const shortName = row.studio.name.replace(/^Cleopatra Ink\s+/i, "");
  const dict = await resolveDictionary("booking", row.a.locale, row.studio.id);
  const title = (dict.messages["calendar.ics"]?.summary ?? "Tattoo Appointment - :location")
    .replace(":location", shortName);
  const description = (dict.messages["calendar.ics"]?.description ?? "Your appointment at :location")
    .replace(":location", shortName);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cleopatra Ink//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${row.a.bkUuid}@cleopatraink.com`,
    `DTSTAMP:${stamp(new Date())}`,
    // Stored as a UTC instant, so the calendar lands on the right hour in
    // whatever timezone the customer's device is set to.
    `DTSTART:${stamp(row.a.startsAt)}`,
    `DTEND:${stamp(row.a.endsAt)}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(description)}`,
    row.studio.address ? `LOCATION:${esc(row.studio.address)}` : null,
    `STATUS:${row.a.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((l): l is string => l !== null);

  // CRLF line endings are mandatory; Outlook rejects bare LF.
  const body = lines.map(fold).join("\r\n") + "\r\n";

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="cleopatra-${row.a.bkUuid}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
