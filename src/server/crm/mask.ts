/* ── Secret masking for anything the console receives ──────────────────
 * The studio rows carry live Twilio auth tokens and SMTP passwords. The
 * console only needs to SHOW that a credential is configured, never its
 * value — so the value never leaves the server. A console user is not
 * automatically someone who should be able to send SMS as the studio or
 * read its mailbox, and a browser is a poor place to keep either.
 * ────────────────────────────────────────────────────────────────── */

/** "ACabc…xyz9" → enough to recognise, not enough to use. */
export function maskSecret(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export interface SafeTwilio {
  accountSid: string | null;
  authToken: string | null;
  messagingSid: string | null;
  specificPhone: string | null;
  smsAutomation: boolean;
  configured: boolean;
}

export function safeTwilio(raw: Record<string, unknown> | null | undefined): SafeTwilio {
  const t = raw ?? {};
  return {
    accountSid: maskSecret(t.accountSid),
    authToken: maskSecret(t.authToken),
    messagingSid: maskSecret(t.messagingSid),
    // A phone number is not a secret — the console needs to display it.
    specificPhone: typeof t.specificPhone === "string" ? t.specificPhone : null,
    smsAutomation: t.smsAutomation === true,
    configured: Boolean(t.authToken && (t.accountSid || t.messagingSid)),
  };
}

export interface SafeSmtp {
  enabled: boolean;
  senderName: string | null;
  senderEmail: string | null;
  host: string | null;
  port: number | null;
  username: string | null;
  password: string | null;
  configured: boolean;
}

export function safeSmtp(raw: Record<string, unknown> | null | undefined): SafeSmtp {
  const s = raw ?? {};
  return {
    enabled: s.enabled === true,
    senderName: typeof s.senderName === "string" ? s.senderName : null,
    senderEmail: typeof s.senderEmail === "string" ? s.senderEmail : null,
    host: typeof s.host === "string" ? s.host : null,
    port: typeof s.port === "number" ? s.port : null,
    username: typeof s.username === "string" ? s.username : null,
    password: maskSecret(s.password),
    configured: Boolean(s.host && s.username && s.password),
  };
}

/** Strips secrets from a studio row before it is serialised to the client. */
export function safeStudio<T extends { twilio?: unknown; smtp?: unknown }>(studio: T) {
  return {
    ...studio,
    twilio: safeTwilio(studio.twilio as Record<string, unknown>),
    smtp: safeSmtp(studio.smtp as Record<string, unknown>),
  };
}
