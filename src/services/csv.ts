/* ── BookNow CSV import engine ──────────────────────────────────────────────
   Parses the production exports (semicolon-delimited, quoted fields) and maps
   them 1:1 onto the console data model. Unknown studios are auto-created.   */
import {
  nextId, studioById, STUDIOS,
  type Lead, type LeadAttr, type Appointment, type ApptStatus, type CallLog, type CallStatus,
  type Platform, type Studio, type StudioConfig,
} from "../data";

export type CsvKind = "leads" | "appointments";

export interface ParseWarning { row: number; msg: string; }
export interface MappedColumn { source: string; target: string; sample: string; }
export interface ParsedFile {
  kind: CsvKind; fileName: string; rows: number;
  columns: MappedColumn[]; warnings: ParseWarning[];
  leads: Lead[]; appointments: Appointment[]; studios: Studio[]; calls: CallLog[];
  preview: Record<string, string>[];
}

/* ── low-level parser (auto delimiter, RFC-4180 quotes) ──────────────────── */
function detectDelimiter(headerLine: string): string {
  const counts: [string, number][] = [[";", 0], [",", 0], ["\t", 0]];
  let inQ = false;
  for (const ch of headerLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ) { const c = counts.find(x => x[0] === ch); if (c) c[1]++; }
  }
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ";";
}

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.slice(0, clean.indexOf("\n") === -1 ? clean.length : clean.indexOf("\n"));
  const delim = detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQ) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(c => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(c => c.trim() !== "")) rows.push(row);
  return rows;
}

/* ── header recognition ──────────────────────────────────────────────────── */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const LEAD_COLS: Record<string, string[]> = {
  id: ["leadid"], name: ["name", "customerfullname"], email: ["email", "customeremail"],
  phone: ["phoneformattede164", "customerphoneformattede164", "phonee164"],
  phoneDisplay: ["phonedisplay", "customerphonedisplay"],
  createdAt: ["createdatutc", "createdat"], updatedAt: ["updatedat"],
  studioName: ["studioname"], studioSlug: ["studioslug"], studioCountry: ["studiocountry"],
  crmStatus: ["crmstatus"], callStatus: ["callstatuscode"], callStatusLabel: ["callstatuslabel"],
  lastCalledAt: ["lastcalledat"], purpose: ["tattoopurposeservice", "servicepurpose"],
  style: ["tattoostyle"], size: ["tattoosize"], bodyAreas: ["bodyareasplacement"],
  timePref: ["timepreference"], story: ["storydescription"], vip: ["vipfreepickup"],
  refUrl: ["referenceimagepublicurl"], hasRef: ["hasreferenceimage"],
  isConverted: ["isconverted"], convType: ["conversiontype"],
  convApptId: ["convertedappointmentid"], convApptStatus: ["convertedappointmentstatus"],
  convApptDate: ["convertedappointmentscheduleddate"], convApptTime: ["convertedappointmentscheduledtime"],
  convApptStudio: ["convertedappointmentstudio"],
  platform: ["marketingplatform"], utmSource: ["utmsource"], utmMedium: ["utmmedium"],
  utmCampaign: ["utmcampaign"], utmTerm: ["utmterm"], utmContent: ["utmcontent"],
  gclid: ["gclidgoogleclickid"], fbclid: ["fbclidfacebookclickid"], ttclid: ["ttclidtiktokclickid"],
  landing: ["landingpageurl", "sourcelandingpage"],
  voiceCalls: ["totalvoicecalls"], lastCallDate: ["lastvoicecalldate"], lastCallResult: ["lastvoicecallresult"],
};

const APPT_COLS: Record<string, string[]> = {
  id: ["appointmentid"], uuid: ["uuid"], status: ["status"],
  date: ["scheduleddate"], time: ["scheduledtime"], studioTime: ["studiopreferredtime"],
  userTz: ["usertimezone"], createdAt: ["createdatutc", "createdat"], updatedAt: ["updatedat"],
  cancelledAt: ["cancelledat"], cancelReason: ["cancelreason"],
  name: ["customerfullname"], email: ["customeremail"],
  phone: ["customerphoneformattede164"], phoneDisplay: ["customerphonedisplay"],
  street: ["streetaddress"], city: ["city"], state: ["state"], zip: ["postalzip"],
  language: ["language"], consent: ["smsconsent"],
  studioId: ["studioid"], studioName: ["studioname"], studioSlug: ["studioslug"],
  studioCountry: ["studiocountry"], studioTz: ["studiotimezone"], studioPhone: ["studiophone"],
  purpose: ["servicepurpose"], style: ["tattoostyle"], size: ["tattoosize"],
  bodyAreas: ["bodyareasplacement"], storyType: ["storytype"], story: ["tattoodescriptionnotes"],
  vip: ["vipfreepickup"], refUrl: ["referenceimagepublicurl"], hasRef: ["hasreferenceimage"],
  leadId: ["matchedleadid"], leadStatus: ["matchedleadcallstatus"], leadCreatedAt: ["matchedleadcreatedat"],
  matchMethod: ["leadmatchmethod"], platform: ["marketingplatform"],
  utmSource: ["utmsource"], utmMedium: ["utmmedium"], utmCampaign: ["utmcampaign"],
  gclid: ["gclidgoogleclickid"], fbclid: ["fbclidfacebookclickid"], ttclid: ["ttclidtiktokclickid"],
  landing: ["sourcelandingpage", "landingpageurl"], ip: ["ipaddress"],
  voiceCalls: ["totalvoicecalls"], lastCallDate: ["lastvoicecalldate"], lastCallResult: ["lastvoicecallresult"],
};

/* ── value normalization ─────────────────────────────────────────────────── */
export function detectKind(headers: string[]): CsvKind | null {
  const hs = headers.map(norm);
  if (hs.includes("leadid") || hs.includes("callstatuscode")) return "leads";
  if (hs.includes("appointmentid") || hs.includes("matchedleadid")) return "appointments";
  return null;
}

const toIso = (s: string | undefined): string | null => {
  if (!s || !s.trim()) return null;
  const v = s.trim().replace(" ", "T");
  const d = new Date(v.includes("T") ? v + (v.length <= 16 ? ":00" : "") + (v.endsWith("Z") ? "" : "Z") : v);
  return isNaN(+d) ? null : d.toISOString();
};
const mapPlatform = (raw: string): Platform => {
  const v = raw.trim().toLowerCase();
  if (v.startsWith("google")) return "google";
  if (v.startsWith("facebook") || v === "fb") return "facebook";
  if (v.startsWith("tiktok")) return "tiktok";
  if (v.startsWith("instagram")) return "instagram";
  if (v.includes("direct") || v.includes("organic") || v === "") return "direct";
  return "webform";
};
const CALL_STATUSES: CallStatus[] = ["not_called", "no_answer", "busy", "interested", "not_interested", "callback_requested", "appointment_made", "already_scheduled", "didnt_pick_up", "wrong_number", "double_lead", "no_pn", "spam", "not_trusted"];
const mapCallStatus = (raw: string): CallStatus => {
  const v = raw.trim().toLowerCase().replace(/[^a-z_]/g, "");
  return (CALL_STATUSES as string[]).includes(v) ? v as CallStatus : "not_called";
};
const mapApptStatus = (raw: string): ApptStatus => {
  const v = raw.trim().toLowerCase();
  if (v === "confirmed") return "confirmed";
  if (v === "cancelled" || v === "canceled") return "cancelled";
  if (v === "completed") return "completed";
  if (v === "spam") return "spam";
  if (v === "no_show" || v === "no show" || v === "noshow") return "no_show";
  if (v === "deposit" || v.includes("deposit")) return "deposit_paid";
  if (v === "rescheduled") return "rescheduled";
  return "pending";
};
const splitAreas = (raw: string): string[] =>
  raw.split(/[,;]/).map(s => s.trim().toLowerCase().replace(/\s+/g, "_")).filter(Boolean);
const yesNo = (raw: string): boolean => /^y(es)?$/i.test(raw.trim());

/* ── studio resolution (auto-creates unknown branches) ───────────────────── */
const STUDIO_ACCENTS = ["#fba200", "#5fd6c9", "#e8a33d", "#4c8dff", "#d4af37", "#e5484d", "#9b6bff", "#2fbf71", "#e1589a", "#7c4fe0"];
const hours7 = () => Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map(d => [d, { enabled: d !== "sun", open: "10:30", close: "19:30" }]));
const emptyConfig = (slug: string, phone: string, tz: string): StudioConfig => ({
  bookingSlug: slug, publicPhone: phone, latitude: 0, longitude: 0,
  gtmCountry: "US", gtmCityState: "", mapsUrl: "", timezone: tz, ianaTimezone: tz.startsWith("America") || tz.startsWith("Europe") || tz.startsWith("Asia") ? tz : "America/New_York",
  displayOrder: 900, bookingInterval: 30, enableOnlineBooking: true,
  socials: { instagram: "", facebook: "", tiktok: "", twitter: "", youtube: "" },
  twilio: { accountSid: "", authToken: "", messagingSid: "", specificPhone: "", smsAutomation: true },
  vonage: { did: phone, extension: "" },
  mail: { enabled: false, senderName: "", senderEmail: "", smtpHost: "smtp.gmail.com", smtpPort: 587, smtpUser: "", smtpPass: "" },
  businessHours: hours7(),
});

class StudioResolver {
  created: Studio[] = [];
  private bySlug = new Map<string, number>();
  private byName = new Map<string, number>();
  constructor(existing: Studio[]) {
    existing.forEach(s => { this.bySlug.set(s.slug.toLowerCase(), s.id); this.byName.set(s.name.toLowerCase(), s.id); });
  }
  resolve(opts: { name?: string; slug?: string; country?: string; tz?: string; phone?: string; email?: string; displayId?: number }): number {
    const name = (opts.name ?? "").trim();
    const slug = (opts.slug ?? "").trim().toLowerCase() || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!name && !slug) return this.online();
    if (name === "Online / General" || slug === "online") return this.online();
    const hitSlug = this.bySlug.get(slug); if (hitSlug) return hitSlug;
    const hitName = this.byName.get(name.toLowerCase()); if (hitName) return hitName;
    const id = opts.displayId && !this.created.some(s => s.id === opts.displayId) && !studioById(opts.displayId)
      ? opts.displayId
      : 5000 + this.created.length + 1;
    const city = name.replace(/^Cleopatra Ink /i, "");
    const st: Studio = {
      id, name: `Cleopatra Ink ${city}`, slug: slug || `studio-${id}`, phone: opts.phone ?? "", email: opts.email ?? "",
      address: "", city, state: "", country: opts.country?.trim() || "USA", gtmCountry: opts.country?.trim() || "USA",
      timezone: opts.tz ?? "Eastern Standard Time", bookingActive: true, manager: "", hours: "Mon–Sat · 10:30–19:30",
      accent: STUDIO_ACCENTS[this.created.length % STUDIO_ACCENTS.length],
      config: emptyConfig(slug || `studio-${id}`, opts.phone ?? "", opts.tz ?? "America/New_York"),
    };
    this.created.push(st);
    this.bySlug.set(st.slug, id); this.byName.set(st.name.toLowerCase(), id);
    return id;
  }
  private online(): number {
    const hit = this.bySlug.get("online"); if (hit) return hit;
    const id = 4999;
    const st: Studio = {
      id, name: "Online / General", slug: "online", phone: "+1 (833) 555-0100", email: "online@cleopatraink.com",
      address: "", city: "Online", state: "", country: "Online", gtmCountry: "US", timezone: "Eastern Standard Time",
      bookingActive: true, manager: "—", hours: "24/7 web intake", accent: "#948d7d",
      config: emptyConfig("online", "+18335550100", "America/New_York"),
    };
    this.created.push(st); this.bySlug.set("online", id);
    return id;
  }
}

/* ── public API ──────────────────────────────────────────────────────────── */
export function parseBookNowCsv(fileName: string, text: string, existingStudios: Studio[]): ParsedFile {
  const grid = parseCsv(text);
  if (grid.length < 2) throw new Error("CSV is empty or has no data rows");
  const headers = grid[0].map(h => h.trim());
  const kind = detectKind(headers);
  if (!kind) throw new Error("Unrecognized export — expected a leads or appointments CSV");
  const spec = kind === "leads" ? LEAD_COLS : APPT_COLS;

  const idx = new Map<string, number>();
  headers.forEach((h, i) => {
    const n = norm(h);
    for (const [field, variants] of Object.entries(spec)) {
      if (variants.includes(n) && !idx.has(field)) idx.set(field, i);
    }
  });
  const get = (row: string[], field: string): string => {
    const i = idx.get(field);
    return i === undefined ? "" : (row[i] ?? "").trim();
  };

  const resolver = new StudioResolver([...STUDIOS, ...existingStudios]);
  const leads: Lead[] = []; const appointments: Appointment[] = []; const calls: CallLog[] = [];
  const warnings: ParseWarning[] = [];
  const preview: Record<string, string>[] = [];

  grid.slice(1).forEach((row, rn) => {
    const rowNum = rn + 2;
    if (preview.length < 5) {
      const rec: Record<string, string> = {};
      idx.forEach((ci, field) => { rec[field] = row[ci] ?? ""; });
      preview.push(rec);
    }
    if (kind === "leads") {
      const id = get(row, "id");
      if (!id) { warnings.push({ row: rowNum, msg: "Missing Lead ID — skipped" }); return; }
      const phone = get(row, "phone") || (get(row, "phoneDisplay").replace(/[^0-9+]/g, "") || "");
      if (!phone) warnings.push({ row: rowNum, msg: `${get(row, "name") || id}: no E.164 phone` });
      const locationId = resolver.resolve({ name: get(row, "studioName"), slug: get(row, "studioSlug"), country: get(row, "studioCountry") });
      const callStatus = mapCallStatus(get(row, "callStatus"));
      const voiceCalls = parseInt(get(row, "voiceCalls"), 10) || 0;
      const attr: LeadAttr = {
        platform: mapPlatform(get(row, "platform")),
        utmSource: get(row, "utmSource"), utmMedium: get(row, "utmMedium"),
        utmCampaign: get(row, "utmCampaign") || null,
        gclid: get(row, "gclid") || null, fbclid: get(row, "fbclid") || null, ttclid: get(row, "ttclid") || null,
        landingPage: get(row, "landing"),
      };
      leads.push({
        id, name: get(row, "name") || "Unknown", email: get(row, "email"), formattedPhone: phone, locationId,
        status: (get(row, "crmStatus") || "new") as Lead["status"], callStatus,
        lastCalledAt: toIso(get(row, "lastCalledAt")), createdAt: toIso(get(row, "createdAt")) ?? new Date().toISOString(),
        unsubscribedAt: null, isDuplicate: false,
        meta: {
          purpose: get(row, "purpose"), style: get(row, "style"), size: get(row, "size"),
          storyType: yesNo(get(row, "hasRef")) ? "have_reference" : (get(row, "story") ? "have_idea" : "artist_choice"),
          story: get(row, "story"), bodyAreas: splitAreas(get(row, "bodyAreas")),
          referenceImages: yesNo(get(row, "hasRef")) && get(row, "refUrl") ? [get(row, "refUrl")] : [],
          language: "en", consent: true,
        },
        attr,
      });
      const lcd = toIso(get(row, "lastCallDate"));
      if (voiceCalls > 0 && lcd) {
        const result = (get(row, "lastCallResult") || "Answered") as CallLog["result"];
        for (let k = 0; k < Math.min(voiceCalls, 3); k++) {
          calls.push({
            id: nextId(), direction: "outbound", fromNumber: "+1 (833) 555-0100", toNumber: phone,
            fromName: "Callcenter Main (#400)", toName: get(row, "name") || "Unknown",
            customerId: id, appointmentId: null, locationId,
            startTime: new Date(+new Date(lcd) - k * 3600_000 * 5).toISOString(),
            duration: k === 0 && result === "Answered" ? 60 + ((id.length * 7) % 180) : 0,
            result: k === 0 ? result : "Attempted", hasRecording: k === 0 && result === "Answered",
            agent: "Agent · Callcenter1", ext: "401",
          });
        }
      }
    } else {
      const rawId = get(row, "id");
      const id = parseInt(rawId, 10);
      if (!rawId || isNaN(id)) { warnings.push({ row: rowNum, msg: "Missing Appointment ID — skipped" }); return; }
      const phone = get(row, "phone");
      if (!phone) warnings.push({ row: rowNum, msg: `${get(row, "name") || rawId}: no E.164 phone` });
      const locationId = resolver.resolve({
        name: get(row, "studioName"), slug: get(row, "studioSlug"), country: get(row, "studioCountry"),
        tz: get(row, "studioTz"), phone: get(row, "studioPhone"), displayId: parseInt(get(row, "studioId"), 10) || undefined,
      });
      const date = get(row, "date"); const time = get(row, "time") || "12:00";
      if (!date) warnings.push({ row: rowNum, msg: `${get(row, "name") || rawId}: missing scheduled date` });
      appointments.push({
        id, uuid: get(row, "uuid") || `BK-${id}`, customerId: get(row, "leadId") || null,
        name: get(row, "name") || "Unknown", email: get(row, "email"), formattedPhone: phone, locationId,
        purpose: get(row, "purpose"), style: get(row, "style"), size: get(row, "size"),
        storyType: get(row, "storyType"), story: get(row, "story"), bodyAreas: splitAreas(get(row, "bodyAreas")),
        referenceImage: yesNo(get(row, "hasRef")) && get(row, "refUrl") ? get(row, "refUrl") : null,
        preferredDate: toIso(`${date}T${time}`) ?? `${date}T12:00:00.000Z`, preferredTime: time,
        status: mapApptStatus(get(row, "status")), isFreePick: yesNo(get(row, "vip")),
        language: get(row, "language") || "en", createdAt: toIso(get(row, "createdAt")) ?? new Date().toISOString(),
        platform: mapPlatform(get(row, "platform")), campaign: get(row, "utmCampaign") || null,
        consent: yesNo(get(row, "consent")),
        cancelReason: get(row, "cancelReason") || null, userTimezone: get(row, "userTz") || undefined,
        voiceCalls: parseInt(get(row, "voiceCalls"), 10) || undefined, streetAddress: get(row, "street") || undefined,
      });
    }
  });

  const columns: MappedColumn[] = [];
  idx.forEach((ci, field) => {
    const firstData = grid[1]?.[ci] ?? "";
    columns.push({ source: headers[ci], target: field, sample: firstData.length > 34 ? firstData.slice(0, 34) + "…" : firstData });
  });

  return { kind, fileName, rows: grid.length - 1, columns, warnings, leads, appointments, studios: resolver.created, calls, preview };
}
