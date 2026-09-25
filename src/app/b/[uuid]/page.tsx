import { ManageShell } from "../../_public/ManageShell";
import { serverLocale } from "../../_public/server-locale";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Manage your appointment — Cleopatra Ink",
  // A booking reference in a URL should never end up in a search index.
  robots: { index: false, follow: false, nocache: true },
};

export default async function ManageBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ uuid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ uuid }, query] = await Promise.all([params, searchParams]);
  const { locale, available } = await serverLocale(query);
  return <ManageShell uuid={uuid} locale={locale} availableLocales={available} />;
}
