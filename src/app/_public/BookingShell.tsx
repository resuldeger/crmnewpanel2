"use client";

import { LocaleProvider } from "@/booking/lib/locale";
import ErrorBoundary from "@/booking/components/ErrorBoundary";
import BookingWizard from "@/booking/screens/BookingWizard";
import { useBootstrapAnalytics } from "./useBootstrapAnalytics";
import "@/booking/components/PhoneInput.css";
import "./public.css";

/** Client boundary for the wizard: providers, analytics, crash guard. */
export function BookingShell({
  locale,
  availableLocales,
  ...props
}: {
  slug: string;
  locale: string;
  availableLocales: string[];
}) {
  useBootstrapAnalytics();
  return (
    <ErrorBoundary>
      <LocaleProvider initialLocale={locale} initialAvailable={availableLocales}>
        <BookingWizard {...props} />
      </LocaleProvider>
    </ErrorBoundary>
  );
}
