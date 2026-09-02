// ─── Cleopatra CRM · mock data layer ────────────────────────────────────────
// Deterministic pseudo-random dataset mirroring the production schema.

export type Platform = "instagram" | "facebook" | "google" | "tiktok" | "threads" | "direct";
export type CallStatus =
  | "not_called" | "no_answer" | "busy" | "interested" | "not_interested" | "wrong_number"
  | "appointment_made" | "callback_requested" | "already_scheduled" | "no_pn" | "double_lead"
  | "didnt_pick_up" | "spam" | "not_trusted";
export type ApptStatus = "pending" | "confirmed" | "cancelled" | "unreachable" | "sms_sent" | "spam" | "not_trusted";
export type CallResult = "Answered" | "Voicemail" | "Missed" | "Attempted";

export interface Studio {
  id: number; name: string; slug: string; phone: string; email: string; address: string;
  city: string; state: string; country: string; gtmCountry: string; timezone: string;
  bookingActive: boolean; image?: string; manager: string; hours: string;
  twilioNumber?: string; branchNumber?: string; vonageExt?: string;
}
export interface Artist {
  id: number; name: string; email: string; bio: string; specialties: string[];
  locationIds: number[]; active: boolean; instagram: string; hue: number;
}
export interface Extension {
  id: number; extension: string; displayName: string; username: string;
  phoneNumber: string; userType: string; locationId: number | null;
}
export interface LeadMeta {
  purpose: string; style: string; storyType: string; story: string; size: string;
  bodyAreas: string[]; referenceImages: string[]; consent: boolean; language: string;
}
export interface Attribution {
  platform: Platform; utmSource: string | null; utmMedium: string | null;
  utmCampaign: string | null; utmContent: string | null; gclid: string | null;
  fbclid: string | null; ttclid: string | null; referer: string | null; landingUrl: string;
  deviceType: string; browser: string; os: string; ip: string; ipCountry: string; userTimezone: string;
}
export interface Lead {
  id: string; name: string; email: string; phoneRaw: string; formattedPhone: string;
  status: "new" | "incomplete" | "filled" | "done"; callStatus: CallStatus;
  lastCalledAt: string | null; createdAt: string; unsubscribedAt: string | null;
  locationId: number; isDuplicate: boolean; meta: LeadMeta; attr: Attribution;
}
export interface Appointment {
  id: number; uuid: string; customerId: string | null; name: string; email: string;
  formattedPhone: string; locationId: number; purpose: string; style: string; storyType: string;
  story: string; size: string; bodyAreas: string[]; referenceImage: string | null;
  preferredDate: string; preferredTime: string; status: ApptStatus; isFreePick: boolean;
  language: string; createdAt: string; platform: Platform; campaign: string | null; consent: boolean;
}
export interface CallLog {
  id: number; direction: "inbound" | "outbound"; fromNumber: string; toNumber: string;
  fromName: string; toName: string; customerId: string | null; appointmentId: number | null;
  locationId: number; startTime: string; duration: number; result: CallResult;
  hasRecording: boolean; agent: string; ext: string;
}
export interface SmsMessage {
  id: number; direction: "inbound" | "outbound"; body: string; at: string;
  status: "delivered" | "sent" | "received" | "failed"; mediaUrl?: string;
}
export interface Conversation {
  id: number; phone: string; customerId: string | null; customerName: string; locationId: number;
  unreadCount: number; unsubscribed: boolean; messages: SmsMessage[];
}
export interface Note {
  id: number; author: string; notableType: "lead" | "appointment"; notableId: string;
  content: string; createdAt: string;
}

// ─── meta maps ──────────────────────────────────────────────────────────────
export const CALL_STATUS_META: Record<CallStatus, { label: string; color: string }> = {
  not_called:         { label: "Not Called",        color: "#8b8ba0" },
  no_answer:          { label: "No Answer",         color: "#e8a33d" },
  busy:               { label: "Busy",              color: "#e8a33d" },
  interested:         { label: "Interested",        color: "#2fbf71" },
  not_interested:     { label: "Not Interested",    color: "#e5484d" },
  wrong_number:       { label: "Wrong Number",      color: "#e5484d" },
  appointment_made:   { label: "Appointment Made",  color: "#d4af37" },
  callback_requested: { label: "Callback Requested",color: "#74a8ff" },
  already_scheduled:  { label: "Already Scheduled", color: "#74a8ff" },
  no_pn:              { label: "No Phone",          color: "#63637a" },
  double_lead:        { label: "Double Lead",       color: "#9b6bff" },
  didnt_pick_up:      { label: "Didn't Pick Up",    color: "#e8a33d" },
  spam:               { label: "Spam",              color: "#e5484d" },
  not_trusted:        { label: "Not Trusted",       color: "#f0716b" },
};
export const APPT_STATUS_META: Record<ApptStatus, { label: string; color: string }> = {
  pending:     { label: "Pending",     color: "#e8a33d" },
  confirmed:   { label: "Confirmed",   color: "#2fbf71" },
  cancelled:   { label: "Cancelled",   color: "#e5484d" },
  unreachable: { label: "Unreachable", color: "#f0716b" },
  sms_sent:    { label: "SMS Sent",    color: "#74a8ff" },
  spam:        { label: "Spam",        color: "#e5484d" },
  not_trusted: { label: "Not Trusted", color: "#f0716b" },
};
export const PLATFORM_META: Record<Platform, { label: string; color: string }> = {
  instagram: { label: "Instagram", color: "#e1589a" },
  facebook:  { label: "Facebook",  color: "#5b8def" },
  google:    { label: "Google Ads",color: "#e8a33d" },
  tiktok:    { label: "TikTok",    color: "#5fd6c9" },
  threads:   { label: "Threads",   color: "#b6b6c6" },
  direct:    { label: "Direct",    color: "#8b8ba0" },
};
export const RESULT_META: Record<CallResult, { color: string }> = {
  Answered:  { color: "#2fbf71" },
  Voicemail: { color: "#9b6bff" },
  Missed:    { color: "#e5484d" },
  Attempted: { color: "#8b8ba0" },
};
export const IMG = {
  refFineline: "https://image.qwenlm.ai/generated-images/968b917e-e0b2-437f-bd13-b6438d98a0ea/_result.png",
  refLion: "https://image.qwenlm.ai/generated-images/61dac0d2-ad9a-4eaa-92b1-b3111bad3edf/_result.png",
  refMoon: "https://image.qwenlm.ai/generated-images/a87667ad-3bb0-4950-9eca-75b23f4111b9/_result.png",
  studio1: "https://image.qwenlm.ai/generated-images/b5992b68-8bb7-4b4b-9cc8-2d6d98277f83/_result.png",
  studio2: "https://image.qwenlm.ai/generated-images/ddc9c763-8047-4db4-a988-f2eac8694b91/_result.png",
  studio3: "https://image.qwenlm.ai/generated-images/b9b3041a-e18c-4bd9-811b-5c75ca815c18/_result.png",
};
const REFS = [IMG.refLion, IMG.refFineline, IMG.refMoon];

export const PURPOSES = ["New Tattoo", "Cover-Up", "Touch-Up", "Consultation"];
export const STYLES = ["Realism", "Black & Grey", "Fine Line", "Minimalist", "Old School", "Neo-Traditional", "Tribal", "Lettering", "Micro-Realism", "Geometric", "Japanese", "Watercolor"];
export const STORY_TYPES: Record<string, string> = { have_idea: "Has an Idea", have_reference: "Has Reference", artist_choice: "Artist's Choice" };
export const SIZES = ["Mini (< 5cm)", "Small (5–10cm)", "Medium (10–20cm)", "Large (Half Sleeve)", "XL (Full Sleeve / Back)"];
export const BODY_AREAS = ["Forearm", "Chest", "Back", "Shoulder", "Thigh", "Calf", "Spine", "Ribs", "Wrist", "Ankle", "Neck", "Hand"];
export const SMS_TEMPLATES = [
  { name: "Appointment Confirmation", body: "Hi {customer_name}! Your appointment at {location_name} is confirmed for {appointment_date}. Reply YES to confirm or call us to reschedule. — Cleopatra Ink" },
  { name: "Consultation Follow-up", body: "Hi {customer_name}, it was great talking with you! Your consultation slot at {location_name} is reserved for {appointment_date}. See you soon! 🖤" },
  { name: "Deposit Request", body: "Hi {customer_name}! To lock in {appointment_date} at {location_name}, a $50 deposit is required. Secure link: cleopatra.ink/deposit — valid 48h." },
  { name: "Re-engagement / Win-back", body: "Hey {customer_name}, your tattoo idea is still on our table at {location_name}. Flash slots opened this week — want one?" },
];

// ─── deterministic rng ──────────────────────────────────────────────────────
const mulberry32 = (a: number) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rand = mulberry32(20260214);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const ri = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const chance = (p: number) => rand() < p;

const NOW = Date.now();
const H = 3600_000, D = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();
let seq = 1000;
export const nextId = () => ++seq;

// ─── formatting helpers ─────────────────────────────────────────────────────
export const timeAgo = (isoStr: string) => {
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
};
export const fmtDT = (isoStr: string) =>
  new Date(isoStr).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
export const fmtD = (isoStr: string) =>
  new Date(isoStr).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
export const fmtDur = (sec: number) => {
  if (sec <= 0) return "0s";
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
};
export const prettyPhone = (e164: string) => {
  if (e164.startsWith("+1") && e164.length === 12)
    return `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;
  return e164;
};
export const initials = (name: string) =>
  name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("");
export const AVATAR_HUES = [42, 152, 210, 265, 330, 18, 190, 95];
export const hueFor = (s: string) => AVATAR_HUES[(s.charCodeAt(0) + (s.charCodeAt(1) || 0)) % AVATAR_HUES.length];

// ─── studios ────────────────────────────────────────────────────────────────
export const STUDIOS: Studio[] = [
  { id: 1, name: "Cleopatra Ink Tacoma", slug: "tacoma", phone: "+12534219735", email: "tacoma@cleopatra.ink", address: "1902 Commerce St", city: "Tacoma", state: "WA", country: "USA", gtmCountry: "US", timezone: "America/Los_Angeles", bookingActive: true, image: IMG.studio1, manager: "Cleo Rivera", hours: "Mon–Sat · 11:00–20:00" },
  { id: 2, name: "Cleopatra Ink Miami", slug: "miami", phone: "+17865219902", email: "miami@cleopatra.ink", address: "821 Lincoln Rd", city: "Miami Beach", state: "FL", country: "USA", gtmCountry: "US", timezone: "America/New_York", bookingActive: true, image: IMG.studio2, manager: "Sofia Marquez", hours: "Daily · 10:00–22:00" },
  { id: 3, name: "Cleopatra Ink Brooklyn", slug: "brooklyn", phone: "+19293411084", email: "bk@cleopatra.ink", address: "227 Bedford Ave", city: "Brooklyn", state: "NY", country: "USA", gtmCountry: "US", timezone: "America/New_York", bookingActive: true, image: IMG.studio3, manager: "Ava Kim", hours: "Mon–Sat · 12:00–21:00" },
  { id: 4, name: "Cleopatra Ink Austin", slug: "austin", phone: "+15123086741", email: "austin@cleopatra.ink", address: "1409 S Lamar Blvd", city: "Austin", state: "TX", country: "USA", gtmCountry: "US", timezone: "America/Chicago", bookingActive: true, manager: "Diego Fuentes", hours: "Mon–Sat · 11:00–20:00" },
  { id: 5, name: "Cleopatra Ink Los Angeles", slug: "los-angeles", phone: "+13234900177", email: "la@cleopatra.ink", address: "8475 Melrose Ave", city: "Los Angeles", state: "CA", country: "USA", gtmCountry: "US", timezone: "America/Los_Angeles", bookingActive: true, image: IMG.studio1, manager: "Nina Park", hours: "Daily · 11:00–21:00" },
  { id: 6, name: "Cleopatra Ink Seattle", slug: "seattle", phone: "+12065591338", email: "seattle@cleopatra.ink", address: "1621 Pine St", city: "Seattle", state: "WA", country: "USA", gtmCountry: "US", timezone: "America/Los_Angeles", bookingActive: false, manager: "Owen Holt", hours: "Tue–Sun · 11:00–19:00" },
  { id: 7, name: "Cleopatra Ink Chicago", slug: "chicago", phone: "+13127990452", email: "chicago@cleopatra.ink", address: "1566 N Damen Ave", city: "Chicago", state: "IL", country: "USA", gtmCountry: "US", timezone: "America/Chicago", bookingActive: true, manager: "Maya Ellis", hours: "Mon–Sat · 12:00–20:00" },
  { id: 8, name: "Cleopatra Ink London", slug: "london", phone: "+442071234466", email: "london@cleopatra.ink", address: "42 Camden High St", city: "London", state: "ENG", country: "UK", gtmCountry: "GB", timezone: "Europe/London", bookingActive: true, image: IMG.studio2, manager: "Freya Walsh", hours: "Mon–Sat · 10:00–19:00" },
  { id: 9, name: "Cleopatra Ink Berlin", slug: "berlin", phone: "+493012347890", email: "berlin@cleopatra.ink", address: "Oranienstraße 24", city: "Berlin", state: "BE", country: "Germany", gtmCountry: "DE", timezone: "Europe/Berlin", bookingActive: true, manager: "Jonas Weber", hours: "Tue–Sat · 12:00–20:00" },
  { id: 10, name: "Cleopatra Ink İstanbul", slug: "istanbul", phone: "+902129091010", email: "istanbul@cleopatra.ink", address: "Caferağa Mah. Moda Cad. 112", city: "İstanbul", state: "Kadıköy", country: "Türkiye", gtmCountry: "TR", timezone: "Europe/Istanbul", bookingActive: true, image: IMG.studio3, manager: "Baran Doğan", hours: "Daily · 10:00–21:00" },
  { id: 11, name: "Cleopatra Ink Ankara", slug: "ankara", phone: "+903124407878", email: "ankara@cleopatra.ink", address: "Bestekar Cad. 34/B", city: "Ankara", state: "Çankaya", country: "Türkiye", gtmCountry: "TR", timezone: "Europe/Istanbul", bookingActive: true, manager: "Zeynep Arslan", hours: "Mon–Sat · 10:00–20:00" },
  { id: 12, name: "Cleopatra Ink İzmir", slug: "izmir", phone: "+902324215959", email: "izmir@cleopatra.ink", address: "Kıbrıs Şehitleri Cad. 140", city: "İzmir", state: "Alsancak", country: "Türkiye", gtmCountry: "TR", timezone: "Europe/Istanbul", bookingActive: false, manager: "Deniz Koç", hours: "Mon–Sat · 11:00–19:00" },
  { id: 13, name: "Cleopatra Ink Amsterdam", slug: "amsterdam", phone: "+31201234567", email: "ams@cleopatra.ink", address: "Reguliersdwarsstraat 58", city: "Amsterdam", state: "NH", country: "Netherlands", gtmCountry: "NL", timezone: "Europe/Amsterdam", bookingActive: true, manager: "Lotte Visser", hours: "Wed–Sun · 12:00–21:00" },
  { id: 14, name: "Cleopatra Ink Barcelona", slug: "barcelona", phone: "+34931234567", email: "bcn@cleopatra.ink", address: "Carrer de la Riera Baixa 9", city: "Barcelona", state: "CT", country: "Spain", gtmCountry: "ES", timezone: "Europe/Madrid", bookingActive: true, manager: "Pau Ferrer", hours: "Mon–Sat · 10:00–20:00" },
];
export const studioById = (id: number) => STUDIOS.find(s => s.id === id);

// ─── artists ────────────────────────────────────────────────────────────────
export const ARTISTS: Artist[] = [
  { id: 1, name: "Marco 'Pharaoh' Reyes", email: "marco@cleopatra.ink", bio: "Black & grey realism, 12 years behind the machine. Large-scale sleeves & portraits.", specialties: ["Black & Grey", "Realism"], locationIds: [1, 5], active: true, instagram: "pharaoh.ink", hue: 42 },
  { id: 2, name: "Elif Yıldız", email: "elif@cleopatra.ink", bio: "Fine line and micro-realism specialist. Botanical, celestial and delicate script work.", specialties: ["Fine Line", "Micro-Realism"], locationIds: [10, 11], active: true, instagram: "elif.inklines", hue: 330 },
  { id: 3, name: "Dante Cole", email: "dante@cleopatra.ink", bio: "Old school & neo-traditional. Bold lines, saturated color, no regrets.", specialties: ["Old School", "Neo-Traditional"], locationIds: [2, 4], active: true, instagram: "dantecole.ttt", hue: 18 },
  { id: 4, name: "Yuki Tanaka", email: "yuki@cleopatra.ink", bio: "Traditional Japanese irezumi — koi, dragons, waves. Full back pieces welcome.", specialties: ["Japanese", "Black & Grey"], locationIds: [5, 3], active: true, instagram: "yuki.irezumi", hue: 210 },
  { id: 5, name: "Greta Hoffmann", email: "greta@cleopatra.ink", bio: "Geometric & ornamental precision. Sacred geometry, dotwork, blackwork patterns.", specialties: ["Geometric", "Tribal"], locationIds: [9, 13], active: true, instagram: "greta.geometry", hue: 265 },
  { id: 6, name: "Jae-won Seo", email: "jaewon@cleopatra.ink", bio: "Minimalist single-needle work. Tiny meaningful pieces with surgical precision.", specialties: ["Minimalist", "Fine Line"], locationIds: [3, 7], active: true, instagram: "jaewon.minimal", hue: 190 },
  { id: 7, name: "Lola Fuentes", email: "lola@cleopatra.ink", bio: "Watercolor & freehand florals. Color splash blends that heal vibrant.", specialties: ["Watercolor", "Neo-Traditional"], locationIds: [4, 2], active: false, instagram: "lola.acuarela", hue: 152 },
  { id: 8, name: "Kerem Aydın", email: "kerem@cleopatra.ink", bio: "Lettering & calligraphy tattoos — custom scripts, Gothic to modern minimal.", specialties: ["Lettering", "Minimalist"], locationIds: [10, 12], active: true, instagram: "kerem.scripts", hue: 95 },
  { id: 9, name: "Sasha Volkov", email: "sasha@cleopatra.ink", bio: "Cover-up alchemist. Reworking old ink into large-scale black & grey statements.", specialties: ["Cover-Up", "Black & Grey"], locationIds: [8, 9], active: true, instagram: "volkov.coverups", hue: 265 },
  { id: 10, name: "Camila Duarte", email: "camila@cleopatra.ink", bio: "Realism portraits & wildlife. Eyes are her signature — clients cry, she frames it.", specialties: ["Realism", "Micro-Realism"], locationIds: [14, 13], active: true, instagram: "camila.realism", hue: 18 },
];

// ─── vonage extensions ──────────────────────────────────────────────────────
export const EXTENSIONS: Extension[] = [
  { id: 1, extension: "432", displayName: "Cleopatra Ink Tacoma", username: "Cleo.Tacoma", phoneNumber: "+12534219735", userType: "END_USER", locationId: 1 },
  { id: 2, extension: "462", displayName: "Cleopatra Ink Miami", username: "Cleo.Miami", phoneNumber: "+17865219902", userType: "END_USER", locationId: 2 },
  { id: 3, extension: "403", displayName: "Cleopatra Ink Callcenter9", username: "Cleo.Callcenter9", phoneNumber: "+19803521019", userType: "END_USER", locationId: null },
  { id: 4, extension: "401", displayName: "Cleopatra Ink Callcenter1", username: "Cleo.Callcenter1", phoneNumber: "+19803521001", userType: "END_USER", locationId: null },
  { id: 5, extension: "405", displayName: "Cleopatra Ink Callcenter3", username: "Cleo.Callcenter3", phoneNumber: "+19803521005", userType: "END_USER", locationId: null },
  { id: 6, extension: "441", displayName: "Cleopatra Ink Brooklyn", username: "Cleo.Brooklyn", phoneNumber: "+19293411084", userType: "END_USER", locationId: 3 },
  { id: 7, extension: "455", displayName: "Cleopatra Ink İstanbul", username: "Cleo.Istanbul", phoneNumber: "+902129091010", userType: "END_USER", locationId: 10 },
  { id: 8, extension: "470", displayName: "Cleopatra Ink London", username: "Cleo.London", phoneNumber: "+442071234466", userType: "END_USER", locationId: 8 },
  { id: 9, extension: "478", displayName: "Cleopatra Ink Berlin", username: "Cleo.Berlin", phoneNumber: "+493012347890", userType: "END_USER", locationId: 9 },
  { id: 10, extension: "482", displayName: "Cleopatra Ink Austin", username: "Cleo.Austin", phoneNumber: "+15123086741", userType: "END_USER", locationId: 4 },
];

// ─── studio phone wiring (Twilio sender, branch line, Vonage ext) ───────────
STUDIOS.forEach((s, i) => {
  if (!s.twilioNumber) s.twilioNumber = `+1 (833) ${String(204 + i * 7).padStart(3, "0")}-${String(1108 + i * 137).slice(-4)}`;
  if (!s.branchNumber) s.branchNumber = s.phone;
  if (!s.vonageExt) {
    const e = EXTENSIONS.find(x => x.locationId === s.id);
    s.vonageExt = e ? e.extension : String(440 + i);
  }
});

// ─── lead generation ────────────────────────────────────────────────────────
const FIRST = ["Emma","Liam","Olivia","Noah","Ava","Ethan","Mia","Lucas","Sofia","Mason","Elif","Mert","Zeynep","Emre","Ayşe","Kerem","Deniz","Selin","Baran","Ece","Freya","Jonas","Lena","Max","Greta","Felix","Camila","Mateo","Valentina","Diego","Chloe","Oliver","Amelia","Jack","Harper","Leo","Yuki","Haruto","Aoi","Ren","Lotte","Sem","Ines","Pau","Montserrat","Jordi","Nadia","Omar","Layla","Tariq"];
const LAST = ["Johnson","Smith","Williams","Brown","Garcia","Miller","Davis","Wilson","Anderson","Taylor","Yılmaz","Kaya","Demir","Şahin","Çelik","Arslan","Doğan","Koç","Aydın","Yıldız","Müller","Schmidt","Weber","Wagner","Becker","Hoffmann","Silva","Santos","Oliveira","Costa","Fernandez","Lopez","Martinez","Walker","Hall","Young","Tanaka","Sato","Kobayashi","Takahashi","Visser","Jansen","Bakker","Meijer","Ferrer","Puig","Vidal","Serra","Rahman","Haddad"];
const STORIES = [
  "A serpent wrapped around a dagger with roses — memorial piece for my father. Shading must be soft, photorealistic eyes.",
  "Minimal moon phases down the spine. Thin single needle, tiny stars scattered between phases.",
  "Black & grey lion portrait on the chest, mane flowing into geometric linework toward the shoulders.",
  "Cover-up of an old tribal band on the forearm — thinking Japanese wave and koi, lots of movement.",
  "Custom lettering of my grandmother's handwriting saying 'still I rise' on the ribs.",
  "Micro-realism portrait of my dog with a halo — inside forearm, palm sized.",
  "Sacred geometry flower-of-life expanding from the elbow down the forearm, pure dotwork.",
  "Neo-traditional panther head with red accents, classic flash vibe but fully custom.",
  "Fine line botanical bouquet — peonies, lavender and olive branch circling the calf.",
  "Two swallows on the collarbones facing each other, old school color, traditional bold lines.",
  "Watercolor phoenix rising across the shoulder blade, orange and teal pigment splashes.",
  "Compass and map fragments on the upper arm — I travel for work, it's my story in ink.",
];
const CAMPAIGNS: Record<Platform, string[]> = {
  instagram: ["ig_stories_fine_line", "ig_reels_flash_week", "ig_influencer_miami"],
  facebook: ["fb_leadgen_coverup", "fb_retargeting_30d", "fb_local_awareness"],
  google: ["g_search_tattoo_near_me", "g_pmax_realism", "g_search_cover_up"],
  tiktok: ["tt_spark_artist_pov", "tt_infeed_time_lapse"],
  threads: ["th_launch_promo"],
  direct: [],
};
const MEDIUMS: Record<Platform, string[]> = {
  instagram: ["stories", "reels", "bio_link"], facebook: ["cpc", "lead_form"], google: ["cpc", "search"],
  tiktok: ["spark_ads", "infeed"], threads: ["post"], direct: [],
};
const REFERERS: Record<Platform, string | null> = {
  instagram: "https://www.instagram.com/", facebook: "https://www.facebook.com/", google: "https://www.google.com/",
  tiktok: "https://www.tiktok.com/", threads: "https://www.threads.net/", direct: null,
};
const BROWSERS = ["Chrome", "Safari", "Instagram InApp", "TikTok InApp", "Edge", "Firefox"];
const OSES = ["iOS", "Android", "macOS", "Windows"];
const DEVICES = ["mobile", "mobile", "mobile", "desktop", "tablet"];

const randClickId = () => Array.from({ length: 24 }, () => "abcdefghij0123456789"[Math.floor(rand() * 20)]).join("");

function makeAttribution(platform: Platform, slug: string): Attribution {
  const camp = CAMPAIGNS[platform];
  const med = MEDIUMS[platform];
  const utmSource = platform === "direct" ? null : platform === "google" ? "google" : platform;
  return {
    platform,
    utmSource,
    utmMedium: med.length ? pick(med) : null,
    utmCampaign: camp.length ? pick(camp) : null,
    utmContent: camp.length && chance(0.5) ? pick(["video_a", "carousel_b", "static_c", "hook_v2"]) : null,
    gclid: platform === "google" ? randClickId() : null,
    fbclid: platform === "facebook" ? randClickId() : null,
    ttclid: platform === "tiktok" ? randClickId() : null,
    referer: REFERERS[platform],
    landingUrl: `https://cleopatra.ink/booking/${slug}${utmSource ? `?utm_source=${utmSource}&utm_medium=${pick(med)}&utm_campaign=${pick(camp)}` : ""}`,
    deviceType: pick(DEVICES),
    browser: pick(BROWSERS),
    os: pick(OSES),
    ip: `${ri(24, 220)}.${ri(0, 255)}.${ri(0, 255)}.${ri(2, 250)}`,
    ipCountry: pick(["US", "US", "US", "TR", "DE", "GB", "ES", "NL"]),
    userTimezone: pick(["America/Los_Angeles", "America/New_York", "America/Chicago", "Europe/Istanbul", "Europe/Berlin", "Europe/London"]),
  };
}

function makeLead(i: number): Lead {
  const name = `${pick(FIRST)} ${pick(LAST)}`;
  const loc = pick(STUDIOS);
  const r = rand();
  const platform: Platform = r < 0.28 ? "instagram" : r < 0.48 ? "facebook" : r < 0.68 ? "google" : r < 0.83 ? "tiktok" : r < 0.88 ? "threads" : "direct";
  const areaCode = pick(["253", "786", "929", "512", "323", "206", "312", "980", "281", "415"]);
  const phone = `+1${areaCode}${ri(200, 989)}${ri(1000, 9999)}`;
  const statusRoll = rand();
  const status: Lead["status"] = statusRoll < 0.18 ? "incomplete" : statusRoll < 0.3 ? "new" : statusRoll < 0.62 ? "filled" : "done";
  const csRoll = rand();
  const callStatus: CallStatus =
    status === "incomplete" ? (chance(0.6) ? "not_called" : chance(0.5) ? "no_pn" : "not_called") :
    csRoll < 0.24 ? "not_called" : csRoll < 0.38 ? "no_answer" : csRoll < 0.43 ? "busy" :
    csRoll < 0.55 ? "interested" : csRoll < 0.62 ? "not_interested" : csRoll < 0.66 ? "wrong_number" :
    csRoll < 0.76 ? "appointment_made" : csRoll < 0.83 ? "callback_requested" : csRoll < 0.87 ? "already_scheduled" :
    csRoll < 0.9 ? "didnt_pick_up" : csRoll < 0.94 ? "double_lead" : csRoll < 0.97 ? "spam" : "not_trusted";
  const createdAt = NOW - Math.floor(rand() ** 1.6 * 30 * D) - ri(0, 8) * H;
  const hasPhone = callStatus !== "no_pn";
  const lastCalledAt = ["not_called", "no_pn"].includes(callStatus) ? null : iso(createdAt + ri(1, 40) * H);
  return {
    id: `CUS-${(1000 + i).toString(36).toUpperCase()}${ri(100, 999)}`,
    name,
    email: `${name.toLowerCase().replace(/[^a-z ]/g, "").replace(/ +/g, ".")}@${pick(["gmail.com", "outlook.com", "yahoo.com", "icloud.com", "hotmail.com"])}`,
    phoneRaw: hasPhone ? phone.slice(2) : "",
    formattedPhone: hasPhone ? phone : "",
    status,
    callStatus,
    lastCalledAt,
    createdAt: iso(createdAt),
    unsubscribedAt: chance(0.05) ? iso(createdAt + ri(2, 60) * H) : null,
    locationId: loc.id,
    isDuplicate: false,
    meta: {
      purpose: pick(PURPOSES),
      style: pick(STYLES),
      storyType: pick(["have_idea", "have_reference", "have_reference", "artist_choice"]),
      story: status === "incomplete" ? "" : pick(STORIES),
      size: pick(SIZES),
      bodyAreas: Array.from(new Set([pick(BODY_AREAS), pick(BODY_AREAS), ...(chance(0.5) ? [pick(BODY_AREAS)] : [])])),
      referenceImages: chance(0.42) && status !== "incomplete" ? [pick(REFS), ...(chance(0.3) ? [pick(REFS)] : [])] : [],
      consent: chance(0.93),
      language: pick(["en", "en", "en", "tr", "de", "es"]),
    },
    attr: makeAttribution(platform, loc.slug),
  };
}

export const LEADS: Lead[] = Array.from({ length: 64 }, (_, i) => makeLead(i + 1));
// craft a few duplicates on purpose
LEADS[14] = { ...LEADS[14], formattedPhone: LEADS[3].formattedPhone, phoneRaw: LEADS[3].phoneRaw, email: LEADS[3].email, isDuplicate: true, callStatus: "double_lead" };
LEADS[29] = { ...LEADS[29], formattedPhone: LEADS[8].formattedPhone, phoneRaw: LEADS[8].phoneRaw, isDuplicate: true, callStatus: "double_lead" };
LEADS[41] = { ...LEADS[41], formattedPhone: "", phoneRaw: "", callStatus: "no_pn", meta: { ...LEADS[41].meta, consent: true } };

// ─── call generation ────────────────────────────────────────────────────────
function makeCalls(): CallLog[] {
  const calls: CallLog[] = [];
  const callLeads = LEADS.filter(l => !["not_called", "no_pn", "spam"].includes(l.callStatus));
  callLeads.forEach((lead, idx) => {
    const n = ri(1, 4);
    const locExt = EXTENSIONS.find(e => e.locationId === lead.locationId);
    const ccExt = pick(EXTENSIONS.filter(e => e.locationId === null));
    const ext = locExt && chance(0.6) ? locExt : ccExt;
    for (let k = 0; k < n; k++) {
      const inbound = chance(0.28);
      const roll = rand();
      const result: CallResult = roll < 0.46 ? "Answered" : roll < 0.7 ? "Missed" : roll < 0.86 ? "Voicemail" : "Attempted";
      const duration = result === "Answered" ? ri(25, 480) : result === "Voicemail" ? ri(12, 40) : 0;
      const startTime = new Date(lead.createdAt).getTime() + ri(1, 90) * H + k * ri(3, 30) * H;
      if (startTime > NOW) continue;
      calls.push({
        id: 5000 + idx * 10 + k,
        direction: inbound ? "inbound" : "outbound",
        fromNumber: inbound ? lead.formattedPhone : ext.phoneNumber,
        toNumber: inbound ? ext.phoneNumber : lead.formattedPhone,
        fromName: inbound ? lead.name : `${ext.displayName} (#${ext.extension})`,
        toName: inbound ? `${ext.displayName} (#${ext.extension})` : lead.name,
        customerId: lead.id,
        appointmentId: null,
        locationId: lead.locationId,
        startTime: iso(startTime),
        duration,
        result,
        hasRecording: result === "Answered" || result === "Voicemail",
        agent: ext.username.replace("Cleo.", "Agent · "),
        ext: ext.extension,
      });
    }
  });
  return calls.sort((a, b) => +new Date(b.startTime) - +new Date(a.startTime));
}
export const CALLS: CallLog[] = makeCalls();

// ─── appointments ───────────────────────────────────────────────────────────
function makeAppointments(): Appointment[] {
  const appts: Appointment[] = [];
  const converted = LEADS.filter(l => ["appointment_made", "already_scheduled", "interested", "done" as CallStatus].includes(l.callStatus) || l.status === "done").slice(0, 18);
  converted.forEach((lead, i) => {
    const dayOffset = ri(-4, 16);
    appts.push({
      id: 200 + i,
      uuid: `BK-${randClickId().slice(0, 8).toUpperCase()}`,
      customerId: lead.id,
      name: lead.name, email: lead.email, formattedPhone: lead.formattedPhone,
      locationId: lead.locationId, purpose: lead.meta.purpose, style: lead.meta.style,
      storyType: lead.meta.storyType, story: lead.meta.story, size: lead.meta.size,
      bodyAreas: lead.meta.bodyAreas, referenceImage: lead.meta.referenceImages[0] ?? null,
      preferredDate: iso(NOW + dayOffset * D), preferredTime: pick(["10:00", "11:30", "13:00", "14:00", "15:30", "17:00", "18:30"]),
      status: (["appointment_made", "already_scheduled"].includes(lead.callStatus) ? (chance(0.6) ? "confirmed" : "sms_sent") : pick(["pending", "pending", "confirmed", "sms_sent"])) as ApptStatus,
      isFreePick: chance(0.15), language: lead.meta.language, createdAt: lead.createdAt,
      platform: lead.attr.platform, campaign: lead.attr.utmCampaign, consent: lead.meta.consent,
    });
  });
  for (let i = 0; i < 14; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const loc = pick(STUDIOS);
    const r = rand();
    const platform: Platform = r < 0.3 ? "instagram" : r < 0.5 ? "facebook" : r < 0.7 ? "google" : r < 0.85 ? "tiktok" : "direct";
    appts.push({
      id: 220 + i,
      uuid: `BK-${randClickId().slice(0, 8).toUpperCase()}`,
      customerId: null,
      name, email: `${name.toLowerCase().replace(/[^a-z ]/g, "").replace(/ +/g, ".")}@gmail.com`,
      formattedPhone: `+1${pick(["253", "786", "929", "512", "323"])}${ri(200, 989)}${ri(1000, 9999)}`,
      locationId: loc.id, purpose: pick(PURPOSES), style: pick(STYLES),
      storyType: pick(["have_idea", "have_reference", "artist_choice"]), story: pick(STORIES),
      size: pick(SIZES), bodyAreas: [pick(BODY_AREAS), pick(BODY_AREAS)].filter((v, ix, a) => a.indexOf(v) === ix),
      referenceImage: chance(0.4) ? pick(REFS) : null,
      preferredDate: iso(NOW + ri(-3, 18) * D), preferredTime: pick(["10:00", "12:00", "14:00", "16:00", "18:00"]),
      status: pick(["pending", "pending", "confirmed", "confirmed", "sms_sent", "cancelled", "unreachable", "pending"]) as ApptStatus,
      isFreePick: chance(0.18), language: "en", createdAt: iso(NOW - ri(0, 20) * D - ri(0, 20) * H),
      platform, campaign: CAMPAIGNS[platform][0] ?? null, consent: chance(0.92),
    });
  }
  return appts.sort((a, b) => +new Date(a.preferredDate) - +new Date(b.preferredDate));
}
export const APPOINTMENTS: Appointment[] = makeAppointments();
// link some calls to appointments
CALLS.forEach(c => {
  const appt = APPOINTMENTS.find(a => a.customerId === c.customerId);
  if (appt) c.appointmentId = appt.id;
});

// ─── sms conversations ──────────────────────────────────────────────────────
const INBOUND_LINES = [
  "Hey! I just filled out the form — how soon can I get a consultation?",
  "Hi, is the flash piece from your story still available?",
  "What's the deposit for a half sleeve?",
  "Can I move my appointment to next Saturday?",
  "I sent a reference photo, did you get it?",
  "Do you do walk-ins on Sundays?",
  "Perfect, thank you! See you then 🖤",
  "Does the price include touch-ups?",
  "I'm running 10 min late, so sorry!",
  "My friend wants to book together, is that possible?",
];
const OUTBOUND_LINES = [
  "Hi {name}! Thanks for reaching out to Cleopatra Ink 💛 We'd love to bring your idea to life.",
  "Your consultation is booked — {date}. Reply YES to confirm!",
  "We received your reference — the artists love the direction. Great taste!",
  "A $50 deposit locks your date. Here's your secure link: cleopatra.ink/pay",
  "Saturday works! I've moved you to 14:00 with the same artist.",
  "No worries at all — see you soon, the chair is waiting 🖤",
  "Yes! Sunday walk-ins start at 12:00, first come first served.",
];
function makeConversations(): Conversation[] {
  const convLeads = LEADS.filter(l => l.formattedPhone && !["spam", "not_trusted", "wrong_number", "no_pn"].includes(l.callStatus)).slice(0, 11);
  return convLeads.map((lead, i) => {
    const nMsg = ri(5, 11);
    const msgs: SmsMessage[] = [];
    let t = new Date(lead.createdAt).getTime() + H;
    for (let m = 0; m < nMsg; m++) {
      const inbound = m % 2 === 0;
      t += ri(4, 900) * 60_000;
      if (t > NOW - 10 * 60_000) t = NOW - ri(10, 240) * 60_000;
      msgs.push({
        id: 9000 + i * 100 + m,
        direction: inbound ? "inbound" : "outbound",
        body: (inbound ? pick(INBOUND_LINES) : pick(OUTBOUND_LINES).replace("{name}", lead.name.split(" ")[0]).replace("{date}", fmtD(iso(NOW + ri(1, 10) * D)))).trim(),
        at: iso(t),
        status: inbound ? "received" : chance(0.9) ? "delivered" : "sent",
        mediaUrl: inbound && chance(0.18) ? pick(REFS) : undefined,
      });
    }
    const unread = i < 4 ? ri(1, 3) : 0;
    if (unread > 0) for (let u = 0; u < unread; u++) {
      const mIdx = msgs.length - 1 - u;
      if (mIdx >= 0) { msgs[mIdx].direction = "inbound"; msgs[mIdx].status = "received"; }
    }
    msgs.sort((a, b) => +new Date(a.at) - +new Date(b.at));
    return {
      id: 600 + i,
      phone: lead.formattedPhone,
      customerId: lead.id,
      customerName: lead.name,
      locationId: lead.locationId,
      unreadCount: unread,
      unsubscribed: !!lead.unsubscribedAt,
      messages: msgs,
    };
  });
}
export const CONVERSATIONS: Conversation[] = makeConversations();

// ─── notes ──────────────────────────────────────────────────────────────────
const NOTE_POOL = [
  "Client asked for a Saturday slot — artists Mia & Marco both free after 13:00.",
  "Prefers email contact during work hours, calls after 17:00 only.",
  "Budget around $400–600 for this piece, flexible on size.",
  "Wants to combine two ideas into one sleeve — schedule 2h consultation.",
  "Spoke with partner too, they may book a matching piece same day.",
  "Very detailed reference folder sent via SMS — check the thread.",
  "Reschedule risk: traveling next week, confirm 48h before.",
  "Referred by existing client Dana R. — apply loyalty discount.",
];
export const NOTES: Note[] = LEADS.slice(0, 26).map((l, i) => ({
  id: 7000 + i,
  author: pick(["Cleo Rivera", "Sofia Marquez", "Agent · Callcenter9", "Ava Kim", "Baran Doğan"]),
  notableType: "lead",
  notableId: l.id,
  content: NOTE_POOL[i % NOTE_POOL.length],
  createdAt: iso(new Date(l.createdAt).getTime() + ri(2, 48) * H),
}));
APPOINTMENTS.slice(0, 10).forEach((a, i) => NOTES.push({
  id: 7100 + i, author: pick(["Cleo Rivera", "Sofia Marquez", "Freya Walsh"]),
  notableType: "appointment", notableId: String(a.id),
  content: NOTE_POOL[(i + 3) % NOTE_POOL.length], createdAt: iso(new Date(a.createdAt).getTime() + ri(2, 30) * H),
}));

// ─── analytics series ───────────────────────────────────────────────────────
export const DAILY = Array.from({ length: 30 }, (_, i) => {
  const t = NOW - (29 - i) * D;
  const wave = Math.sin(i / 4.2) * 0.35 + 1;
  return {
    date: iso(t),
    leads: Math.round((14 + rand() * 20) * wave),
    appts: Math.round((4 + rand() * 8) * wave),
    calls: Math.round((22 + rand() * 30) * wave),
  };
});
export const FUNNEL = [
  { label: "Sessions Initiated", count: 5184 },
  { label: "Studio Selected", count: 4122 },
  { label: "Tattoo Style Chosen", count: 3265 },
  { label: "Contact Info Entered", count: 1692 },
  { label: "Appointment Completed", count: 1147 },
  { label: "Consultation Attended", count: 688 },
];

export function campaignRows(leads: Lead[], appts: Appointment[]) {
  const map = new Map<string, { source: Platform; medium: string; campaign: string; inquiries: number; booked: number; content: string }>();
  leads.forEach(l => {
    if (!l.attr.utmCampaign) return;
    const key = `${l.attr.platform}|${l.attr.utmMedium}|${l.attr.utmCampaign}`;
    const row = map.get(key) ?? { source: l.attr.platform, medium: l.attr.utmMedium ?? "—", campaign: l.attr.utmCampaign, inquiries: 0, booked: 0, content: "—" };
    row.inquiries++;
    if (l.attr.utmContent) row.content = l.attr.utmContent;
    map.set(key, row);
  });
  appts.forEach(a => {
    if (!a.campaign) return;
    for (const row of map.values()) if (row.campaign === a.campaign) { row.booked++; break; }
  });
  return [...map.values()].sort((a, b) => b.inquiries - a.inquiries);
}

// ─── phone number registry ──────────────────────────────────────────────────
export type NumberKind = "vonage" | "twilio" | "branch";
export const NUMBER_KIND_META: Record<NumberKind, { label: string; color: string }> = {
  vonage: { label: "Vonage VBC Line",   color: "#4c8dff" },
  twilio: { label: "Twilio SMS Number", color: "#e5484d" },
  branch: { label: "Branch Landline",   color: "#d4af37" },
};
export interface StudioNumber {
  id: number; studioId: number; kind: NumberKind; label: string; number: string; smsCapable: boolean;
}
export const NUMBERS: StudioNumber[] = STUDIOS.flatMap(s => {
  const ext = EXTENSIONS.find(e => e.locationId === s.id);
  const rows: StudioNumber[] = [];
  if (ext) rows.push({ id: nextId(), studioId: s.id, kind: "vonage", label: `Main line · ext ${ext.extension}`, number: ext.phoneNumber, smsCapable: true });
  rows.push({ id: nextId(), studioId: s.id, kind: "twilio", label: "Booking SMS", number: `${s.phone.slice(0, s.phone.length - 2)}${ri(10, 89)}`, smsCapable: true });
  if (!ext) rows.push({ id: nextId(), studioId: s.id, kind: "branch", label: "Front desk", number: s.phone, smsCapable: false });
  return rows;
});

// ─── roles & permission matrix ──────────────────────────────────────────────
export interface Role { id: string; name: string; color: string; desc: string; system?: boolean }
export const ROLES: Role[] = [
  { id: "super_admin", name: "Super Admin", color: "#d4af37", desc: "Full access — settings, keys, every studio.", system: true },
  { id: "admin", name: "Studio Admin", color: "#b18aff", desc: "Manages assigned studios, staff & reports." },
  { id: "editor", name: "Editor", color: "#74a8ff", desc: "Leads, bookings & SMS — no settings." },
  { id: "agent", name: "Call Agent", color: "#4fd08d", desc: "Call floor, lead statuses, notes." },
  { id: "artist", name: "Artist", color: "#e1589a", desc: "Own schedule, briefs & references." },
  { id: "viewer", name: "Viewer", color: "#8b8ba0", desc: "Read-only dashboards & reports." },
];
export interface Permission { id: string; label: string; group: string }
export const PERMISSIONS: Permission[] = [
  { id: "leads.view", label: "View leads & 360° profiles", group: "Leads" },
  { id: "leads.edit", label: "Change lead call status", group: "Leads" },
  { id: "leads.convert", label: "Convert leads to bookings", group: "Leads" },
  { id: "appts.manage", label: "Manage appointments", group: "Bookings" },
  { id: "sms.send", label: "Send SMS to clients", group: "Messaging" },
  { id: "sms.templates", label: "Edit SMS templates", group: "Messaging" },
  { id: "calls.listen", label: "Listen to recordings", group: "Call Center" },
  { id: "calls.manage", label: "Manage call routing", group: "Call Center" },
  { id: "reports.view", label: "View reports & funnel", group: "Insights" },
  { id: "studios.manage", label: "Add / edit studios", group: "Organization" },
  { id: "staff.manage", label: "Manage staff & roles", group: "Organization" },
  { id: "settings.keys", label: "API keys & settings", group: "Organization" },
];
export const DEFAULT_MATRIX: Record<string, string[]> = {
  super_admin: PERMISSIONS.map(p => p.id),
  admin: ["leads.view", "leads.edit", "leads.convert", "appts.manage", "sms.send", "sms.templates", "calls.listen", "reports.view", "studios.manage", "staff.manage"],
  editor: ["leads.view", "leads.edit", "leads.convert", "appts.manage", "sms.send", "calls.listen", "reports.view"],
  agent: ["leads.view", "leads.edit", "sms.send", "calls.listen"],
  artist: ["leads.view", "appts.manage"],
  viewer: ["leads.view", "reports.view"],
};

// ─── staff directory ────────────────────────────────────────────────────────
export interface StaffMember {
  id: number; name: string; email: string; roleId: string;
  locationIds: number[] | "all"; active: boolean; lastActiveAt: string;
}
export const STAFF: StaffMember[] = [
  { id: 1, name: "Cleo Rivera", email: "cleo@cleopatra.ink", roleId: "super_admin", locationIds: "all", active: true, lastActiveAt: iso(NOW - 2 * 60_000) },
  { id: 2, name: "Sofia Marquez", email: "sofia@cleopatra.ink", roleId: "admin", locationIds: [2, 4], active: true, lastActiveAt: iso(NOW - 26 * 60_000) },
  { id: 3, name: "Ava Kim", email: "ava@cleopatra.ink", roleId: "admin", locationIds: [3], active: true, lastActiveAt: iso(NOW - 3 * H) },
  { id: 4, name: "Baran Doğan", email: "baran@cleopatra.ink", roleId: "editor", locationIds: [10, 8], active: true, lastActiveAt: iso(NOW - 41 * 60_000) },
  { id: 5, name: "Freya Walsh", email: "freya@cleopatra.ink", roleId: "editor", locationIds: [8], active: false, lastActiveAt: iso(NOW - 2 * D) },
  { id: 6, name: "Maya Ellis", email: "maya@cleopatra.ink", roleId: "agent", locationIds: [7, 1], active: true, lastActiveAt: iso(NOW - 12 * 60_000) },
  { id: 7, name: "Diego Fuentes", email: "diego@cleopatra.ink", roleId: "agent", locationIds: [4], active: true, lastActiveAt: iso(NOW - 5 * H) },
  { id: 8, name: "Mia Torres", email: "mia@cleopatra.ink", roleId: "artist", locationIds: [2], active: true, lastActiveAt: iso(NOW - 33 * 60_000) },
  { id: 9, name: "Owen Holt", email: "owen@cleopatra.ink", roleId: "viewer", locationIds: [6], active: false, lastActiveAt: iso(NOW - 6 * D) },
];
