/** Minimal TwiML builder. Twilio parses XML, so every value must be escaped. */
const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export interface DialOptions {
  to: string;
  callerId?: string | null;
  timeoutSeconds?: number;
  record?: boolean;
  statusCallback?: string;
}

export function dial({ to, callerId, timeoutSeconds = 25, record = false, statusCallback }: DialOptions): string {
  const attrs = [
    `timeout="${timeoutSeconds}"`,
    `answerOnBridge="true"`,
    callerId ? `callerId="${esc(callerId)}"` : "",
    record ? `record="record-from-answer-dual"` : "",
    statusCallback ? `action="${esc(statusCallback)}" method="POST"` : "",
  ].filter(Boolean).join(" ");
  return `<Dial ${attrs}><Number>${esc(to)}</Number></Dial>`;
}

export function say(text: string, language = "en-US"): string {
  return `<Say language="${esc(language)}" voice="Polly.Joanna">${esc(text)}</Say>`;
}

export const hangup = () => "<Hangup/>";
export const reject = (reason: "rejected" | "busy" = "rejected") => `<Reject reason="${reason}"/>`;
