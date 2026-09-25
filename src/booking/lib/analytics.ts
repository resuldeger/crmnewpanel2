/* GTM and LiveChat used to be inline <script> blocks pasted into both the
 * Blade layout and index.html. Loading them from here means one copy, one
 * id, and nothing runs when the id is not configured (local dev stays quiet). */
import { ENV } from "./env";

/** livechat.com's widget API — a queue until tracking.js swaps in `_h`. */
interface LiveChatApi {
  _q: [string, unknown[]][];
  _h: ((...args: unknown[]) => unknown) | null;
  _v: string;
  on: (...args: unknown[]) => void;
  once: (...args: unknown[]) => void;
  off: (...args: unknown[]) => void;
  get: (...args: unknown[]) => unknown;
  call: (method: string, payload?: unknown) => void;
  init: () => void;
  _push: (entry: [string, unknown[]]) => unknown;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    LiveChatWidget?: LiveChatApi;
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

  /* This is livechat.com's own bootstrap, kept verbatim from the old
   * index.html. Appending tracking.js alone was not enough: the widget drew
   * itself, but window.LiveChatWidget never existed, so set_customer_name
   * and maximize() fell through and the "Chat with us" button did nothing.
   * The stub is a queue — calls made before the script finishes loading are
   * replayed once it does. */
  const w = window as Window & {
    LiveChatWidget?: LiveChatApi;
    __lc?: Record<string, unknown> & { asyncInit?: boolean };
  };

  const api: LiveChatApi = {
    _q: [],
    _h: null,
    _v: "2.0",
    on(...args: unknown[]) { api._push(["on", args]); },
    once(...args: unknown[]) { api._push(["once", args]); },
    off(...args: unknown[]) { api._push(["off", args]); },
    get(...args: unknown[]) {
      if (!api._h) throw new Error("[LiveChatWidget] You can't use getters before load.");
      return api._push(["get", args]);
    },
    call(...args: unknown[]) { api._push(["call", args]); },
    init() {
      const s = document.createElement("script");
      s.async = true;
      s.type = "text/javascript";
      s.src = "https://cdn.livechatinc.com/tracking.js";
      document.head.appendChild(s);
    },
    _push(entry: [string, unknown[]]) {
      return api._h ? api._h(...entry) : api._q.push(entry);
    },
  };

  if (!w.__lc?.asyncInit) api.init();
  w.LiveChatWidget = w.LiveChatWidget ?? api;
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
