import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { locations } from "@/db/schema";
import { BookingShell } from "../../_public/BookingShell";
import { serverLocale } from "../../_public/server-locale";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [studio] = await db
    .select({ name: locations.name })
    .from(locations)
    .where(eq(locations.slug, slug))
    .limit(1);
  const short = studio?.name.replace(/^Cleopatra Ink\s+/i, "") ?? "Cleopatra Ink";
  return { title: `Book an Appointment — ${short}` };
}

/**
 * The whole wizard lives at ONE address, like the live booking engine.
 *
 * Each step briefly had its own route segment. That changed the URL as the
 * visitor moved, and — because a different segment is a different React
 * tree — Next remounted the wizard on every step, wiping the form. By the
 * last step the answers were gone and the flow restarted at contact.
 * Steps are component state now; only /b/{uuid} is a separate page.
 */
export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);

  const [studio] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.slug, slug))
    .limit(1);
  if (!studio) notFound();

  const { locale, available } = await serverLocale(query);
  return <BookingShell slug={slug} locale={locale} availableLocales={available} />;
}
