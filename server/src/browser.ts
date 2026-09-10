import { chromium, type BrowserContext, type Page } from "playwright";

/**
 * Fetches BGG through a real Chromium.
 *
 * BGG sits behind Cloudflare, which fingerprints the TLS handshake and issues a JS challenge.
 * Node cannot satisfy either, and cf_clearance is bound to the fingerprint that earned it, so a
 * cookie copied from a browser is rejected too. Driving an actual browser sidesteps all of it:
 * the challenge runs, the clearance cookie is issued to this client, and requests are made from
 * the page's own origin using Chrome's network stack.
 */

const DATA_DIR = process.env.DATA_DIR ?? "/data";
const IDLE_SHUTDOWN_MS = 60_000;

let contextPromise: Promise<BrowserContext> | null = null;
let page: Page | null = null;
let idleTimer: NodeJS.Timeout | null = null;

function isChallenge(html: string): boolean {
  return /challenge-platform|Just a moment|cf-browser-verification|__CF\$cv\$params/i.test(html);
}

async function createContext(): Promise<BrowserContext> {
  // Persisted so the Cloudflare clearance survives restarts instead of re-solving every sync.
  const context = await chromium.launchPersistentContext(`${DATA_DIR}/browser-profile`, {
    headless: true,
    executablePath: process.env.BGG_BROWSER_EXECUTABLE || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", ...(process.env.BGG_BROWSER_ARGS?.split(",").filter(Boolean) ?? [])],
    viewport: { width: 1280, height: 800 },
  });
  return context;
}

async function getPage(): Promise<Page> {
  if (!contextPromise) contextPromise = createContext();
  const context = await contextPromise;
  if (page && !page.isClosed()) return page;

  page = await context.newPage();
  // Land on the site itself first so the challenge is solved and cookies are set for the origin.
  const origin = process.env.BGG_ORIGIN ?? "https://boardgamegeek.com";
  const res = await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (res && isChallenge(await page.content())) {
    // Cloudflare's interstitial replaces itself once its JS completes.
    await page
      .waitForFunction(
        "!/challenge-platform|Just a moment/i.test(document.documentElement.innerHTML)",
        undefined,
        { timeout: 45_000 }
      )
      .catch(() => {});
  }
  return page;
}

function touchIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void closeBrowser(), IDLE_SHUTDOWN_MS);
}

export interface BrowserResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

export async function fetchViaBrowser(url: string): Promise<BrowserResponse> {
  const active = await getPage();
  touchIdleTimer();

  // Requested from inside the page, so it carries the page's cookies and Chrome's own stack.
  const result = await active.evaluate(async (target: string) => {
    const res = await fetch(target, {
      headers: { Accept: "text/xml,application/xml,*/*;q=0.8" },
      credentials: "include",
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { status: res.status, body: await res.text(), headers };
  }, url);

  return result;
}

export async function closeBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const pending = contextPromise;
  contextPromise = null;
  page = null;
  if (pending) {
    await pending.then((ctx) => ctx.close()).catch(() => {});
  }
}
