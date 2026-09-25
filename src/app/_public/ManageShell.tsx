"use client";

import { LocaleProvider } from "@/booking/lib/locale";
import ErrorBoundary from "@/booking/components/ErrorBoundary";
import ManageBooking from "@/booking/screens/ManageBooking";
import { useBootstrapAnalytics } from "./useBootstrapAnalytics";
import "./public.css";

export function ManageShell({ uuid, locale, availableLocales }: { uuid: string; locale: string; availableLocales: string[] }) {
  useBootstrapAnalytics();
  return (
    <ErrorBoundary>
      <LocaleProvider initialLocale={locale} initialAvailable={availableLocales}>
        <ManageBooking uuid={uuid} />
      </LocaleProvider>
    </ErrorBoundary>
  );
}
