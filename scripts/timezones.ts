/**
 * FINDING #5 — every one of the 46 live studios is stored as
 * "America/New_York", including the Pacific, Mountain, Arizona and Central
 * ones. Slot times shown to those customers are 1–3 hours off.
 *
 * This is the correction map. State comes from the address; a handful of
 * studios need an explicit override (Florida's panhandle is Central, Arizona
 * does not observe DST, Indiana/Michigan/Kentucky have their own zones).
 */
export const STATE_TIMEZONE: Record<string, string> = {
  // Pacific
  WA: "America/Los_Angeles", CA: "America/Los_Angeles", NV: "America/Los_Angeles", OR: "America/Los_Angeles",
  // Mountain
  CO: "America/Denver", UT: "America/Denver", NM: "America/Denver", MT: "America/Denver", ID: "America/Denver",
  // Arizona — Mountain time, no DST
  AZ: "America/Phoenix",
  // Central
  WI: "America/Chicago", LA: "America/Chicago", OK: "America/Chicago", TX: "America/Chicago",
  IL: "America/Chicago", MO: "America/Chicago", MN: "America/Chicago", TN: "America/Chicago",
  AL: "America/Chicago", AR: "America/Chicago", IA: "America/Chicago", KS: "America/Chicago",
  NE: "America/Chicago", MS: "America/Chicago",
  // Eastern
  GA: "America/New_York", MD: "America/New_York", NY: "America/New_York", OH: "America/New_York",
  NC: "America/New_York", SC: "America/New_York", PA: "America/New_York", FL: "America/New_York",
  VA: "America/New_York", WV: "America/New_York", NJ: "America/New_York", CT: "America/New_York",
  MA: "America/New_York", ME: "America/New_York", NH: "America/New_York", VT: "America/New_York",
  RI: "America/New_York", DE: "America/New_York", DC: "America/New_York",
  // Own zones
  IN: "America/Indiana/Indianapolis",
  MI: "America/Detroit",
  KY: "America/Kentucky/Louisville",
};

/** Studios whose address is missing, ambiguous, or in a split-zone state. */
export const SLUG_TIMEZONE: Record<string, string> = {
  destin: "America/Chicago",        // Okaloosa County, FL — Central
  panama: "America/Chicago",        // Panama City Beach, Bay County FL — Central
  tallahassee: "America/New_York",  // Leon County FL — Eastern (east of the split)
  charlotte: "America/New_York",    // address pending — NC
  "columbus-ga": "America/New_York",
  louisville: "America/Kentucky/Louisville",
  spokane: "America/Los_Angeles",
  "san-francisco": "America/Los_Angeles", // address carries no state code
  "test-branch": "America/New_York",
};

const STATE_RE = /,\s*([A-Z]{2})[,\s]+\d{5}/;
const STATE_RE_LOOSE = /\b([A-Z]{2})\b(?=[^A-Za-z]*\d{5})/;

export function stateFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  return (address.match(STATE_RE) ?? address.match(STATE_RE_LOOSE))?.[1] ?? null;
}

export function resolveTimezone(slug: string, address: string | null | undefined): {
  timezone: string; state: string | null; via: "slug" | "state" | "fallback";
} {
  const override = SLUG_TIMEZONE[slug];
  const state = stateFromAddress(address);
  if (override) return { timezone: override, state, via: "slug" };
  if (state && STATE_TIMEZONE[state]) return { timezone: STATE_TIMEZONE[state], state, via: "state" };
  return { timezone: "America/New_York", state, via: "fallback" };
}

/** Human label shown next to the IANA id in the studio editor. */
export const TIMEZONE_LABEL: Record<string, string> = {
  "America/Los_Angeles": "Pacific Time",
  "America/Denver": "Mountain Time",
  "America/Phoenix": "Arizona (no DST)",
  "America/Chicago": "Central Time",
  "America/New_York": "Eastern Time",
  "America/Indiana/Indianapolis": "Eastern Time (Indiana)",
  "America/Detroit": "Eastern Time (Michigan)",
  "America/Kentucky/Louisville": "Eastern Time (Kentucky)",
};
