"use client";

import { useEffect } from "react";
import { loadGtm, loadLiveChat } from "@/booking/lib/analytics";

/**
 * Loads GTM and LiveChat once, on the client only. Both no-op when their
 * ids are unset, so local development stays free of third-party scripts.
 */
export function useBootstrapAnalytics(): void {
  useEffect(() => {
    loadGtm();
    loadLiveChat();
  }, []);
}
