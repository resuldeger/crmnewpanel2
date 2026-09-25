import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { negotiateLocale, LOCALE_COOKIE } from "@/server/i18n/negotiate";
import "../index.css";

export const metadata: Metadata = {
  title: "Cleopatra Ink",
  description: "Cleopatra Ink — booking and studio operations",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23191510'/%3E%3Cpath d='M16 5 L27 26 H5 Z' fill='none' stroke='%23fba200' stroke-width='2.4'/%3E%3Ccircle cx='16' cy='19' r='2.6' fill='%23fba200'/%3E%3C/svg%3E",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // <html lang> must match what the page actually renders, or screen
  // readers and translation tools get it wrong. Negotiated once, here.
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  let lang = "en";
  try {
    const negotiated = await negotiateLocale({
      cookie: cookieStore.get(LOCALE_COOKIE)?.value,
      acceptLanguage: headerList.get("accept-language"),
    });
    lang = negotiated.locale;
  } catch {
    /* database unavailable — English is a safe default for the shell */
  }

  return (
    <html lang={lang}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700;800;900&family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&family=Playfair+Display:wght@400;700;900&family=Inter:wght@300;400;600;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
