import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { locales } from "@/db/schema";

export const dynamic = "force-dynamic";

/** Every language the booking engine can serve, for the language switcher. */
export async function GET() {
  const rows = await db
    .select({
      code: locales.code,
      name: locales.name,
      nativeName: locales.nativeName,
      isDefault: locales.isDefault,
    })
    .from(locales)
    .where(eq(locales.isActive, true))
    .orderBy(asc(locales.sortOrder));

  return NextResponse.json(
    { locales: rows },
    { headers: { "Cache-Control": "no-store" } },
  );
}
