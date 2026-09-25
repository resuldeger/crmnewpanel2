/** Resolves an ad platform from click ids and UTM values. */
const PLATFORMS = ["instagram", "facebook", "tiktok", "google", "webform", "direct"] as const;
export type Platform = (typeof PLATFORMS)[number];

export function resolvePlatform(
  utm: { source?: string | null; medium?: string | null },
  click: Record<string, string | null | undefined>,
  referrer?: string | null,
): Platform {
  if (click.gclid || click.gbraid || click.wbraid || click.dclid) return "google";
  if (click.fbclid) return "facebook";
  if (click.ttclid) return "tiktok";

  const source = (utm.source ?? "").toLowerCase();
  if (source.includes("google")) return "google";
  if (source.includes("tiktok")) return "tiktok";
  if (source.includes("instagram") || source === "ig") return "instagram";
  if (source.includes("facebook") || source === "fb" || source.includes("meta")) return "facebook";

  const ref = (referrer ?? "").toLowerCase();
  if (ref.includes("instagram.com")) return "instagram";
  if (ref.includes("facebook.com")) return "facebook";
  if (ref.includes("tiktok.com")) return "tiktok";
  if (ref.includes("google.")) return "google";

  if (utm.source || utm.medium) return "webform";
  return "direct";
}

const CLICK_KEYS = [
  "gclid", "gbraid", "wbraid", "dclid", "fbclid", "msclkid",
  "ttclid", "sccid", "epik", "twclid", "li_fat_id", "rdt_cid", "yclid",
] as const;

export function pickClickIds(params: URLSearchParams | Record<string, string>): Record<string, string> {
  const get = (k: string) =>
    params instanceof URLSearchParams ? params.get(k) : (params[k] ?? null);
  const out: Record<string, string> = {};
  for (const k of CLICK_KEYS) {
    const v = get(k);
    if (v) out[k] = v;
  }
  return out;
}

/** Minimal UA classification — enough for the funnel report, no fingerprinting. */
export function classifyUserAgent(ua: string | null): { deviceType: string; browser: string; os: string } {
  const s = (ua ?? "").toLowerCase();
  const deviceType = /ipad|tablet/.test(s) ? "tablet" : /mobi|iphone|android/.test(s) ? "mobile" : "desktop";
  const browser =
    s.includes("instagram") ? "Instagram In-App"
    : s.includes("fban") || s.includes("fbav") ? "Facebook In-App"
    : s.includes("edg/") ? "Edge"
    : s.includes("chrome") && !s.includes("chromium") ? "Chrome"
    : s.includes("safari") ? "Safari"
    : s.includes("firefox") ? "Firefox"
    : "Other";
  const os =
    s.includes("iphone") || s.includes("ipad") ? "iOS"
    : s.includes("android") ? "Android"
    : s.includes("mac os") ? "macOS"
    : s.includes("windows") ? "Windows"
    : s.includes("linux") ? "Linux"
    : "Other";
  return { deviceType, browser, os };
}

export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? headers.get("cf-connecting-ip");
}
