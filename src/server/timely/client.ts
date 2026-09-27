import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { timelyAccounts } from "@/db/schema";
import { open } from "@/server/crypto/secretBox";

/* ── Talking to Timely ─────────────────────────────────────────────────
 * Timely has no API for any of this. Everything below is a browser session
 * being driven by regular expressions over HTML, which is exactly as
 * fragile as it sounds: a template change over there breaks a parser over
 * here, silently, and the first symptom is a studio whose diary looks
 * empty.
 *
 * So every parser reports how much it found, and a sweep that suddenly
 * finds nothing is treated as a failure rather than as an empty account.
 *
 * Two things that are not arbitrary:
 *
 * The session is kept. Logging in on every request is both slow and the
 * fastest way to be treated as a robot; cookies live on the account row
 * and are refreshed as they come back.
 *
 * A failed login clears them first. A stale Cloudflare cookie turns a
 * perfectly good password into a 403, and retrying with the same cookie
 * fails the same way forever.
 * ────────────────────────────────────────────────────────────────── */

const BASE = "https://app.gettimely.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Timely rate-limits and shares these pages with real staff browsers. */
export const PAGE_PAUSE_MS = 500;

export interface TimelyAccountRow {
  id: number;
  label: string;
  email: string;
  passwordEnc: string | null;
  cookies: Record<string, string>;
}

export class TimelySession {
  private cookies: Record<string, string>;

  constructor(private readonly account: TimelyAccountRow) {
    this.cookies = { ...account.cookies };
  }

  private cookieHeader(): string {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  /** Keeps whatever Timely sends back, including the Cloudflare cookie. */
  private absorb(res: Response): void {
    const raw = res.headers.getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
  }

  async request(
    method: "GET" | "POST",
    path: string,
    body?: URLSearchParams,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; html: string }> {
    const url = path.startsWith("http") ? path : `${BASE}${path}`;
    const res = await fetch(url, {
      method,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...(this.cookieHeader() ? { Cookie: this.cookieHeader() } : {}),
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...extraHeaders,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    this.absorb(res);
    return { status: res.status, html: await res.text() };
  }

  /** Written back so the next sweep, in another process, reuses the session. */
  async persist(patch: Partial<{ lastLoginAt: Date; lastSyncAt: Date; lastError: string | null }> = {}): Promise<void> {
    await db
      .update(timelyAccounts)
      .set({ cookies: this.cookies, updatedAt: new Date(), ...patch })
      .where(eq(timelyAccounts.id, this.account.id));
  }

  /** A logged-out page always carries the login form; a logged-in one never does. */
  private static isLoginPage(html: string): boolean {
    const lower = html.toLowerCase();
    return lower.includes('id="login-form"') || lower.includes('name="__requestverificationtoken"');
  }

  async isLoggedIn(): Promise<boolean> {
    if (Object.keys(this.cookies).length === 0) return false;
    const { status, html } = await this.request("GET", "/calendar");
    if (status !== 200) return false;
    return !TimelySession.isLoginPage(html) && /calendar|dashboard/i.test(html);
  }

  async login(): Promise<{ ok: true } | { ok: false; detail: string }> {
    const password = open(this.account.passwordEnc);
    if (!password) {
      return {
        ok: false,
        detail: "no usable password on file — re-enter it for this account",
      };
    }

    /* Cleared BEFORE the attempt. A stale Cloudflare cookie makes a correct
       password answer 403, and retrying with it fails identically forever. */
    this.cookies = {};

    const loginPath = "/Account/Login?ReturnUrl=%2Fdashboard";
    const page = await this.request("GET", loginPath);
    const token = /name="__RequestVerificationToken"[^>]*value="([^"]+)"/i.exec(page.html)?.[1];
    if (!token) {
      return { ok: false, detail: `no CSRF token on the login page (HTTP ${page.status})` };
    }

    const res = await this.request(
      "POST",
      loginPath,
      new URLSearchParams({
        __RequestVerificationToken: token,
        Email: this.account.email,
        Password: password,
        RememberMe: "false",
      }),
      { Origin: BASE, Referer: `${BASE}${loginPath}` },
    );

    if (TimelySession.isLoginPage(res.html)) {
      /* Timely does not say which it is, and guessing in the log would be
         worse than admitting we cannot tell. */
      return { ok: false, detail: "Timely rejected the sign-in — wrong password, or a captcha" };
    }

    await this.persist({ lastLoginAt: new Date(), lastError: null });
    return { ok: true };
  }

  async ensureLoggedIn(): Promise<{ ok: true } | { ok: false; detail: string }> {
    if (await this.isLoggedIn()) return { ok: true };
    return this.login();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
