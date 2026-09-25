/** Build-time settings. No secrets — everything here ships to the browser. */
export const ENV = {
  /** Same-origin now that the booking engine is served by Next. */
  apiBase: "",
  gtmId: process.env.NEXT_PUBLIC_GTM_ID ?? "",
  liveChatLicense: process.env.NEXT_PUBLIC_LIVECHAT_LICENSE ?? "",
  siteName: "Cleopatra Ink",
  marketingBase: process.env.NEXT_PUBLIC_MARKETING_BASE ?? "https://www.cleopatraink.com",
} as const;

export const api = (path: string) => `${ENV.apiBase}${path}`;
