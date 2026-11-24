import { existsSync } from "node:fs";
import { env } from "$env/dynamic/private";
import { logger } from "$lib/server/logger";
import { isChallengePage } from "./blocked";
import type { Browser } from "playwright-core";

/**
 * Headless-Chromium fallback for shops whose bot protection requires JavaScript
 * ("Verify your browser", "Just a moment...", Shopify challenge, ...).
 *
 * - only used when a normal request was blocked
 * - one page at a time (keeps memory low on small servers)
 * - the browser is started on demand and closed again after a minute of idleness
 * - disable with BROWSER_FALLBACK=false; CHROMIUM_PATH points to the executable
 */

const IDLE_CLOSE_MS = 60_000;
const DEFAULT_PATHS = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];
const USER_AGENT =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

let browserPromise: Promise<Browser> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<unknown> = Promise.resolve();

const executablePath = () => {
    if (env.BROWSER_FALLBACK === "false") return null;
    if (env.CHROMIUM_PATH) return existsSync(env.CHROMIUM_PATH) ? env.CHROMIUM_PATH : null;
    return DEFAULT_PATHS.find((p) => existsSync(p)) ?? null;
};

export const isBrowserFallbackAvailable = () => executablePath() !== null;

const getBrowser = async (path: string) => {
    if (!browserPromise) {
        const { chromium } = await import("playwright-core");
        browserPromise = chromium
            .launch({
                executablePath: path,
                headless: true,
                args: [
                    "--no-sandbox", // the container runs as root
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--disable-blink-features=AutomationControlled",
                    "--lang=de-DE"
                ]
            })
            .then((browser) => {
                logger.info("browser-fallback: chromium started");
                browser.on("disconnected", () => {
                    browserPromise = null;
                });
                return browser;
            })
            .catch((err) => {
                browserPromise = null;
                throw err;
            });
    }
    return browserPromise;
};

const scheduleClose = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => {
        const pending = browserPromise;
        browserPromise = null;
        if (pending) {
            try {
                await (await pending).close();
                logger.info("browser-fallback: chromium closed after idle time");
            } catch {
                // already gone
            }
        }
    }, IDLE_CLOSE_MS);
};

const loadPage = async (path: string, url: string, timeoutMs: number) => {
    const browser = await getBrowser(path);
    const context = await browser.newContext({
        locale: "de-DE",
        timezoneId: "Europe/Berlin",
        userAgent: USER_AGENT,
        viewport: { width: 1366, height: 900 },
        extraHTTPHeaders: { "Accept-Language": "de-DE,de;q=0.9,en;q=0.8" }
    });
    try {
        await context.addInitScript(() => {
            Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        });
        // don't load images, fonts and media – only the document matters
        await context.route("**/*", (route) =>
            ["image", "media", "font"].includes(route.request().resourceType()) ? route.abort() : route.continue()
        );

        const page = await context.newPage();
        // status of the latest main document: a solved challenge starts with 403 and reloads with 200
        let lastStatus = 0;
        page.on("response", (r) => {
            if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) lastStatus = r.status();
        });
        const deadline = Date.now() + timeoutMs;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

        // challenge pages solve themselves via JavaScript and then reload/redirect
        let html = await page.content();
        while (isChallengePage(html) && Date.now() < deadline) {
            await page.waitForTimeout(1_000);
            try {
                await page.waitForLoadState("domcontentloaded", { timeout: 2_000 });
                html = await page.content();
            } catch {
                // navigation in progress – try again
            }
        }
        if (isChallengePage(html)) {
            logger.warn({ url }, "browser-fallback: challenge not solved in time");
            return null;
        }
        if (lastStatus >= 400) {
            logger.warn({ url, status: lastStatus }, "browser-fallback: blocked even for the browser");
            return null;
        }
        return { status: lastStatus || 200, url: page.url(), body: html };
    } finally {
        await context.close().catch(() => undefined);
    }
};

/**
 * Loads a page in headless Chromium and returns the HTML after any JS challenge was solved.
 * Returns null if the fallback is unavailable/disabled or the page could not be loaded.
 */
export const fetchWithBrowser = async (
    url: string,
    timeoutMs = 30_000
): Promise<{ status: number; url: string; body: string } | null> => {
    const path = executablePath();
    if (!path) return null;

    // run one page at a time
    const run = queue.then(async () => {
        if (idleTimer) clearTimeout(idleTimer);
        try {
            const result = await loadPage(path, url, timeoutMs);
            if (result) logger.info({ url }, "browser-fallback: page loaded");
            return result;
        } catch (err) {
            logger.warn({ url, err }, "browser-fallback: failed to load page");
            return null;
        } finally {
            scheduleClose();
        }
    });
    queue = run.catch(() => undefined);
    return run;
};
