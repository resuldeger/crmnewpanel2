/** Build-time settings. No secrets — everything here ships to the browser. */
export const ENV = {
  apiBase: import.meta.env.VITE_API_BASE ?? "",
  gtmId: import.meta.env.VITE_GTM_ID ?? "",
  liveChatLicense: import.meta.env.VITE_LIVECHAT_LICENSE ?? "",
  siteName: "Cleopatra Ink",
  /** Marketing site the burger menu links out to. */
  marketingBase: import.meta.env.VITE_MARKETING_BASE ?? "https://www.cleopatraink.com",
} as const;

export const api = (path: string) => `${ENV.apiBase}${path}`;
