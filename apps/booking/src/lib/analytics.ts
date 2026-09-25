/* GTM and LiveChat used to be inline <script> blocks pasted into both the
 * Blade layout and index.html. Loading them from here means one copy, one
 * id, and nothing runs when the id is not configured (local dev stays quiet). */
import { ENV } from "./env";

declare global {
  interface Window {
    dataLayer?: unknown[];
    LiveChatWidget?: { call: (method: string, payload?: unknown) => void };
    __lc?: Record<string, unknown>;
  }
}

let gtmLoaded = false;
export function loadGtm(): void {
  if (gtmLoaded || !ENV.gtmId || typeof window === "undefined") return;
  gtmLoaded = true;

  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });

  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtm.js?id=${ENV.gtmId}`;
  document.head.appendChild(s);
}

let chatLoaded = false;
export function loadLiveChat(): void {
  if (chatLoaded || !ENV.liveChatLicense || typeof window === "undefined") return;
  chatLoaded = true;

  window.__lc = {
    license: Number(ENV.liveChatLicense),
    integration_name: "manual_onboarding",
    product_name: "livechat",
  };
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://cdn.livechatinc.com/tracking.js";
  document.head.appendChild(s);
}

/** Hand the chat agent the context they would otherwise have to ask for. */
export function identifyInLiveChat(p: {
  name?: string; email?: string; phone?: string; studio?: string; bookingRef?: string;
}): void {
  const lc = window.LiveChatWidget;
  if (!lc) return;
  if (p.name) lc.call("set_customer_name", p.studio ? `${p.name} | ${p.studio}` : p.name);
  if (p.email) lc.call("set_customer_email", p.email);
  lc.call("set_session_variables", { phone: p.phone ?? "", appointment_id: p.bookingRef ?? "" });
}

export function openLiveChat(): void {
  window.LiveChatWidget?.call("maximize");
}
