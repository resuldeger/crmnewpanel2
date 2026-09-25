import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cleopatra Ink · CRM Console",
  // An admin surface has no business in a search index.
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // The console's warm-paper palette lives here rather than on <body>, so
  // the public pages can keep their own dark theme.
  return (
    <div className="min-h-screen bg-ink-900 text-ink-50 selection:bg-gold-500/20 selection:text-gold-400">
      {children}
    </div>
  );
}
