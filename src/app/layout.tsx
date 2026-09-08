import type { Metadata } from "next";
import "../index.css";

export const metadata: Metadata = {
  title: "Cleopatra Ink · CRM Console",
  description: "Cleopatra Ink Enterprise CRM Console",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23191510'/%3E%3Cpath d='M16 5 L27 26 H5 Z' fill='none' stroke='%23fba200' stroke-width='2.4'/%3E%3Ccircle cx='16' cy='19' r='2.6' fill='%23fba200'/%3E%3C/svg%3E",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700;800;900&family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-ink-900 text-ink-50 antialiased selection:bg-gold-500/20 selection:text-gold-400">
        {children}
      </body>
    </html>
  );
}
