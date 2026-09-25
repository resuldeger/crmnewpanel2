import { reportFailure, reportSuccess } from "@/server/integrations/health";
/* ── Outbound transport ────────────────────────────────────────────────
 * Two implementations behind one interface:
 *   · "twilio" — the real REST API
 *   · "log"    — writes to the console and returns a fake sid
 * The log transport is what makes the whole automation pipeline testable
 * locally without sending a single real message to a real phone.
 * ────────────────────────────────────────────────────────────────── */
export interface SendParams {
  to: string;
  from?: string | null;
  messagingServiceSid?: string | null;
  body: string;
  mediaUrls?: string[];
  statusCallback?: string | null;
  accountSid: string | null;
  authToken: string | null;
}

export interface SendResult {
  sid: string;
  status: "queued" | "sent" | "failed";
  errorCode?: string;
  errorMessage?: string;
}

export type TransportName = "twilio" | "log";

export function activeTransport(): TransportName {
  const configured = process.env.SMS_TRANSPORT;
  if (configured === "twilio" || configured === "log") return configured;
  // Default to the safe one. Sending real messages must be a deliberate act.
  return process.env.NODE_ENV === "production" ? "twilio" : "log";
}

async function sendViaTwilio(p: SendParams): Promise<SendResult> {
  if (!p.accountSid || !p.authToken) {
    return { sid: "", status: "failed", errorMessage: "Twilio credentials missing for this studio" };
  }
  if (!p.from && !p.messagingServiceSid) {
    return { sid: "", status: "failed", errorMessage: "No sender number or messaging service configured" };
  }

  const form = new URLSearchParams({ To: p.to, Body: p.body });
  if (p.messagingServiceSid) form.set("MessagingServiceSid", p.messagingServiceSid);
  else if (p.from) form.set("From", p.from);
  if (p.statusCallback) form.set("StatusCallback", p.statusCallback);
  for (const url of p.mediaUrls ?? []) form.append("MediaUrl", url);

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${p.accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${p.accountSid}:${p.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    },
  );

  const data = (await res.json().catch(() => ({}))) as {
    sid?: string; status?: string; code?: number; message?: string;
  };

  if (!res.ok) {
    /* 401 is a bad Account SID or auth token, and 20003 is Twilio's own
       "authenticate" code. Neither improves by being retried, and a
       campaign run would repeat it once per recipient — so it stops the
       integration and says so in the panel instead. Everything else is a
       per-message problem (a bad number, a blocked region) and must not
       take the whole channel down. */
    if (res.status === 401 || data.code === 20003) {
      await reportFailure("twilio", {
        reason: "Twilio rejected our credentials",
        detail: data.message ?? `HTTP ${res.status}`,
        fatal: true,
      });
    }
    return {
      sid: data.sid ?? "",
      status: "failed",
      errorCode: data.code ? String(data.code) : String(res.status),
      errorMessage: data.message ?? `Twilio returned ${res.status}`,
    };
  }
  await reportSuccess("twilio");
  return { sid: data.sid ?? "", status: "queued" };
}

let logCounter = 0;
async function sendViaLog(p: SendParams): Promise<SendResult> {
  logCounter += 1;
  const sid = `SMLOCAL${String(Date.now()).slice(-8)}${String(logCounter).padStart(3, "0")}`;
  console.info(
    `\n┌─ SMS (log transport — nothing was actually sent)\n` +
    `│ to:   ${p.to}\n` +
    `│ from: ${p.messagingServiceSid ?? p.from ?? "(unset)"}\n` +
    `│ sid:  ${sid}\n` +
    `├─\n${p.body.split("\n").map((l) => `│ ${l}`).join("\n")}\n` +
    `└─────────────────────────────────────────────`,
  );
  return { sid, status: "queued" };
}

export async function sendMessage(p: SendParams): Promise<SendResult> {
  return activeTransport() === "twilio" ? sendViaTwilio(p) : sendViaLog(p);
}
