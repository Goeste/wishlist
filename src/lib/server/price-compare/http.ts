import { gotScraping } from "got-scraping";
import { env } from "$env/dynamic/private";
import { logger } from "$lib/server/logger";

export interface HtmlResponse {
    status: number;
    url: string;
    body: string;
}

const determineProxy = (url: URL) => {
    if (url.protocol === "http:") {
        return env.http_proxy || env.HTTP_PROXY;
    } else if (url.protocol === "https:") {
        return env.https_proxy || env.HTTPS_PROXY;
    }
};

/**
 * Fetches a page with browser-like headers and TLS fingerprint (got-scraping).
 * Plain `fetch` gets blocked with 403 by lego.com and idealo.de.
 * Bot protection (e.g. lego.com) sporadically answers 403 depending on the randomly
 * generated header fingerprint, so blocked requests are retried with a fresh one.
 * Returns null on network errors or non-2xx responses.
 */
export const fetchHtml = async (rawUrl: string, timeoutMs = 20_000, attempts = 3): Promise<HtmlResponse | null> => {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const resp = await gotScraping({
                url,
                proxyUrl: determineProxy(url),
                headerGeneratorOptions: {
                    devices: ["desktop"],
                    locales: ["de-DE"]
                },
                timeout: { request: timeoutMs },
                throwHttpErrors: false
            });

            if (resp.statusCode >= 200 && resp.statusCode < 300) {
                return { status: resp.statusCode, url: resp.url, body: resp.body };
            }

            const retryable = [403, 429, 503].includes(resp.statusCode);
            logger.warn(
                { url: rawUrl, status: resp.statusCode, attempt },
                "price-compare: unexpected status" + (retryable && attempt < attempts ? ", retrying" : "")
            );
            if (!retryable) return null;
        } catch (err) {
            logger.warn({ url: rawUrl, err, attempt }, "price-compare: request failed");
        }
        if (attempt < attempts) await sleep(1_000 * attempt);
    }
    return null;
};

/** Minimal HTML entity decoding for attribute values. */
export const decodeEntities = (str: string) =>
    str
        .replace(/&#0*34;/g, '"')
        .replace(/&#0*39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&");

/** Returns all parsed JSON-LD blocks of a page (flattening arrays and @graph). */
export const extractJsonLd = (html: string): Record<string, any>[] => {
    const blocks: Record<string, any>[] = [];
    const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
        try {
            const parsed = JSON.parse(match[1].trim());
            const list = Array.isArray(parsed) ? parsed : [parsed];
            for (const entry of list) {
                if (entry && Array.isArray(entry["@graph"])) blocks.push(...entry["@graph"]);
                else if (entry) blocks.push(entry);
            }
        } catch {
            // ignore malformed blocks
        }
    }
    return blocks;
};

export const findJsonLdOfType = (html: string, type: string) =>
    extractJsonLd(html).find((b) => b["@type"] === type || (Array.isArray(b["@type"]) && b["@type"].includes(type)));

/** Parses "1.234,56 €" / "395,00" / "1,234.56" into a number. */
export const parsePrice = (raw: string | number | null | undefined): number | null => {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    let s = raw.replace(/[^\d.,]/g, "");
    if (!s) return null;
    if (/,\d{1,2}$/.test(s)) {
        s = s.replace(/\./g, "").replace(",", ".");
    } else {
        s = s.replace(/,/g, "");
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
