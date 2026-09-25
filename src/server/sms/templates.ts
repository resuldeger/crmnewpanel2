/* ── Message templates ─────────────────────────────────────────────────
 * Bodies live in the database (message_templates) so they can be edited
 * per studio and per language without a deploy. These are the fallbacks
 * used when a studio has not overridden anything.
 * ────────────────────────────────────────────────────────────────── */
export type TemplateKey =
  | "lead_recovery_5m" | "lead_recovery_2h" | "lead_recovery_24h"
  | "appointment_reminder_24h" | "appointment_reminder_3h"
  | "booking_confirmation" | "winback";

export const DEFAULT_TEMPLATES: Record<TemplateKey, Record<string, string>> = {
  lead_recovery_5m: {
    en: "Hi {name}, it's {studio}. You were a step away from booking — finish here: {link}",
    tr: "Merhaba {name}, {studio}. Randevunu tamamlamana bir adim kalmisti: {link}",
    es: "Hola {name}, somos {studio}. Te faltaba un paso para reservar: {link}",
    de: "Hallo {name}, hier ist {studio}. Dir fehlte nur ein Schritt zur Buchung: {link}",
  },
  lead_recovery_2h: {
    en: "{name}, your spot at {studio} is still open. Pick a time: {link}",
    tr: "{name}, {studio} randevun hala acik. Saat sec: {link}",
    es: "{name}, tu lugar en {studio} sigue disponible. Elige hora: {link}",
    de: "{name}, dein Platz bei {studio} ist noch frei. Zeit waehlen: {link}",
  },
  lead_recovery_24h: {
    en: "Last reminder from {studio}, {name} — your design consultation is free. {link}",
    tr: "{studio} son hatirlatma {name} — tasarim gorusmen ucretsiz. {link}",
    es: "Ultimo recordatorio de {studio}, {name} — tu consulta de diseno es gratis. {link}",
    de: "Letzte Erinnerung von {studio}, {name} — dein Design-Gespraech ist kostenlos. {link}",
  },
  appointment_reminder_24h: {
    en: "Reminder: your appointment at {studio} is tomorrow, {date} at {time}. Manage it: {link}",
    tr: "Hatirlatma: {studio} randevun yarin, {date} saat {time}. Yonet: {link}",
    es: "Recordatorio: tu cita en {studio} es manana, {date} a las {time}. Gestionar: {link}",
    de: "Erinnerung: dein Termin bei {studio} ist morgen, {date} um {time}. Verwalten: {link}",
  },
  appointment_reminder_3h: {
    en: "See you soon, {name} — {studio} at {time} today. {link}",
    tr: "Birazdan gorusuruz {name} — bugun saat {time}, {studio}. {link}",
    es: "Hasta pronto, {name} — {studio} hoy a las {time}. {link}",
    de: "Bis gleich, {name} — {studio} heute um {time}. {link}",
  },
  booking_confirmation: {
    en: "{name}, your appointment at {studio} is confirmed for {date} at {time}. {link}",
    tr: "{name}, {studio} randevun {date} saat {time} icin onaylandi. {link}",
    es: "{name}, tu cita en {studio} esta confirmada para el {date} a las {time}. {link}",
    de: "{name}, dein Termin bei {studio} am {date} um {time} ist bestaetigt. {link}",
  },
  winback: {
    en: "{name}, still thinking about that tattoo? {studio} would love to see you. {link}",
    tr: "{name}, o dovme hala aklinda mi? {studio} seni gormekten mutlu olur. {link}",
    es: "{name}, sigues pensando en ese tatuaje? En {studio} te esperamos. {link}",
    de: "{name}, denkst du noch an dein Tattoo? {studio} freut sich auf dich. {link}",
  },
};

/** Replaces {placeholders}; an unknown one is removed rather than printed. */
export function render(body: string, vars: Record<string, string | null | undefined>): string {
  return body
    .replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * GSM-7 vs UCS-2. A Turkish "ı" or "ş" flips the whole message to UCS-2,
 * where a segment is 70 characters instead of 160 — the same text can
 * silently cost twice as much. Worth knowing before sending, not after.
 */
export function segmentCount(body: string): number {
  const gsm7 = /^[\x20-\x7E\n\r€£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉÄÖÑÜ§¿äöñüà]*$/;
  const unicode = !gsm7.test(body);
  const single = unicode ? 70 : 160;
  const concatenated = unicode ? 67 : 153;
  return body.length <= single ? 1 : Math.ceil(body.length / concatenated);
}
