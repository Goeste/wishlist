import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { gotScraping } from "got-scraping";
import metascraper, { type Metadata } from "metascraper";
import metascraperTitle from "metascraper-title";
import metascraperImage from "metascraper-image";
import shopping from "$lib/server/shopping";
import { parseAcceptLanguageHeader } from "$lib/i18n";
import { getFormatter } from "$lib/server/i18n";
import { requireLoginOrError } from "$lib/server/auth";
import { env } from "$env/dynamic/private";
import { isPriceCompareEnabled } from "$lib/server/price-compare";
import { findCheapestOnIdealo } from "$lib/server/price-compare/idealo";
import { isBlockedTitle, isChallengePage, nameFromUrl, queryFromUrl } from "$lib/server/price-compare/blocked";
import { fetchWithBrowser } from "$lib/server/price-compare/browser";
import { logger } from "$lib/server/logger";

const scraper = metascraper([shopping(), metascraperTitle(), metascraperImage()]);

const determineProxy = (url: URL) => {
    if (url.protocol === "http:") {
        return env.http_proxy || env.HTTP_PROXY;
    } else if (url.protocol === "https:") {
        return env.https_proxy || env.HTTPS_PROXY;
    }
};

const BLOCKED_STATUS = [403, 429, 503];
const MAX_ATTEMPTS = 3;

const goShopping = async (targetUrl: URL, locales: string[]) => {
    // Bot protection (e.g. lego.com) sporadically answers with a 403 challenge page
    // ("Just a moment...") depending on the generated header fingerprint – retry with a fresh one.
    let resp = await gotScraping({
        url: targetUrl,
        proxyUrl: determineProxy(targetUrl),
        headerGeneratorOptions: {
            devices: ["desktop"],
            locales
        }
    });
    for (let attempt = 2; attempt <= MAX_ATTEMPTS && BLOCKED_STATUS.includes(resp.statusCode); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
        resp = await gotScraping({
            url: targetUrl,
            proxyUrl: determineProxy(targetUrl),
            headerGeneratorOptions: {
                devices: ["desktop"],
                locales
            }
        });
    }

    // still blocked by a JavaScript challenge ("Verify your browser", Shopify, Cloudflare):
    // load the page in headless Chromium
    const challenged = [403, 503].includes(resp.statusCode) || isChallengePage(resp.body);
    if (challenged) {
        const page = await fetchWithBrowser(targetUrl.toString());
        if (page) return scraper({ html: page.body, url: page.url });
    }

    if (resp.statusCode >= 400) {
        // error / rate-limit pages ("Too many requests") must not become item data
        throw new Error(`shop answered with status ${resp.statusCode}`);
    }

    const metadata = await scraper({ html: resp.body, url: resp.url });
    return metadata;
};

const isCaptchaResponse = (metadata: Metadata) => {
    return metadata.image && metadata.image.toLocaleLowerCase().indexOf("captcha") >= 0;
};

const getName = (metadata: Metadata) => (metadata as Metadata & { name?: string }).name || metadata.title;

const hasUsableName = (metadata: Metadata) => {
    const name = getName(metadata);
    return !!name && !isBlockedTitle(name);
};

const isBlockedPage = (metadata: Metadata) => {
    const name = getName(metadata);
    return isCaptchaResponse(metadata) || isBlockedTitle(name);
};

/**
 * Backup for shops that block scraping or don't expose image/price (only with price comparison enabled):
 * look the product up on idealo.de and fill in the missing name, image and price.
 */
const fillFromIdealo = async (metadata: Partial<Metadata> & Record<string, any>, targetUrl: URL) => {
    if (!(await isPriceCompareEnabled())) return metadata;

    const usableName = hasUsableName(metadata as Metadata);
    if (usableName && metadata.image && metadata.price) return metadata;

    const name = usableName ? metadata.name || metadata.title : queryFromUrl(targetUrl);
    if (!name) return metadata;

    try {
        const idealo = await findCheapestOnIdealo({ name });
        if (!idealo) return metadata;
        logger.info(
            { url: targetUrl.toString(), idealo: idealo.productUrl },
            "product: filled missing data from idealo"
        );
        return {
            ...metadata,
            name: usableName ? metadata.name : idealo.productTitle,
            title: usableName ? metadata.title : idealo.productTitle,
            image: metadata.image || idealo.imageUrl,
            price: metadata.price || (idealo.cheapest ? idealo.cheapest.value / 100 : undefined),
            currency: metadata.price ? metadata.currency : (idealo.cheapest?.currency ?? metadata.currency),
            url: targetUrl.toString()
        };
    } catch (err) {
        logger.warn({ err }, "product: idealo backup failed");
        return metadata;
    }
};

const getUrlOrError = async (url: string) => {
    const $t = await getFormatter();

    try {
        return new URL(url);
    } catch {
        error(400, $t("errors.valid-url-not-provided"));
    }
};

export const GET: RequestHandler = async ({ request, url }) => {
    await requireLoginOrError();
    const $t = await getFormatter();
    const encodedUrl = url.searchParams.get("url");
    const acceptLanguage = request.headers?.get("accept-language");
    const parsedLocales = parseAcceptLanguageHeader(acceptLanguage).filter(Boolean);
    // without Accept-Language header (e.g. API clients) got-scraping would send an invalid header
    const locales = parsedLocales.length > 0 ? parsedLocales : ["en-US"];

    if (encodedUrl) {
        const targetUrl = await getUrlOrError(decodeURI(encodedUrl));

        let metadata: Metadata & Record<string, any>;
        let blocked = false;
        try {
            metadata = await goShopping(targetUrl, locales);
            if (isCaptchaResponse(metadata) && metadata.url) {
                // retry with the resolved URL
                metadata = await getUrlOrError(metadata.url).then((url) => goShopping(url, locales));
            }
        } catch (err) {
            logger.warn({ url: targetUrl.toString(), err }, "product: unable to fetch shop page");
            metadata = { url: targetUrl.toString() } as Metadata;
            blocked = true;
        }
        if (isBlockedPage(metadata)) {
            // drop the challenge/error page data ("Just a moment...", "Robot Check"), keep only the url
            metadata = { url: targetUrl.toString() } as Metadata;
            blocked = true;
        }

        metadata = (await fillFromIdealo(metadata, targetUrl)) as Metadata;
        if (blocked && !hasUsableName(metadata)) {
            // last resort: a readable name from the URL instead of "Verify your browser"
            const fallbackName = nameFromUrl(targetUrl);
            if (fallbackName) {
                metadata = { ...metadata, name: fallbackName, title: fallbackName } as Metadata;
            } else if (!metadata.image) {
                error(424, $t("errors.product-information-not-available"));
            }
        }

        if (metadata.url == metadata.image) {
            metadata.url = targetUrl.toString();
        }

        return new Response(JSON.stringify(metadata));
    } else {
        error(400, $t("errors.must-specify-url-in-query-parameters"));
    }
};
