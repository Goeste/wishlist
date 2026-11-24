import { fetchHtml, decodeEntities, parsePrice } from "./http";

/**
 * Amazon often serves product pages to servers without the buy box ("Derzeit nicht verfügbar"),
 * although the article is available. The "all offers" request (the panel that opens on
 * "Alle Angebote") still contains the current price to pay – including deal prices – and the RRP.
 * The delivery location is derived from the server's IP (a German server gets a German address).
 */

export interface AmazonOffer {
    /** price in minor units (cents) */
    price: { value: number; currency: string } | null;
    /** "UVP" shown by Amazon, in minor units */
    rrp: { value: number; currency: string } | null;
    seller: string | null;
    /** product title and image – useful when the product page itself is blocked */
    title: string | null;
    imageUrl: string | null;
}

export const isAmazonUrl = (url: string | null | undefined) => {
    if (!url) return false;
    try {
        return /(^|\.)amazon\.[a-z.]+$/i.test(new URL(url).hostname);
    } catch {
        return false;
    }
};

export const extractAsin = (url: string) => {
    try {
        const path = new URL(url).pathname;
        return (
            path.match(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN|o\/ASIN)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1] ??
            null
        );
    } catch {
        return null;
    }
};

const toCents = (raw: string | undefined | null) => {
    const value = parsePrice(raw ? decodeEntities(raw) : null);
    return value !== null && value > 0 ? { value: Math.round(value * 100), currency: "EUR" } : null;
};

export const parseAmazonOffers = (html: string): AmazonOffer => {
    // price of the featured offer ("99,99 € mit 29 Prozent Einsparungen")
    const toPay = html.match(/apex-pricetopay-accessibility-label"[^>]*>\s*([\d.,]+)/)?.[1];
    const split = html.match(/a-price-whole">([\d.]+)[\s\S]{0,200}?a-price-fraction">(\d+)/);
    const price = toCents(toPay) ?? (split ? toCents(`${split[1]},${split[2]}`) : null);

    const rrp = toCents(html.match(/UVP:\s*([\d.,]+)\s*(?:€|&euro;)/)?.[1]);

    const sellerRaw =
        html.match(/id="aod-offer-soldBy"[\s\S]{0,800}?aria-label="([^"]+)"/)?.[1] ??
        html.match(/id="aod-offer-soldBy"[\s\S]{0,800}?<a[^>]*>\s*([^<]{2,80})<\/a>/)?.[1];
    const seller = sellerRaw
        ? decodeEntities(sellerRaw)
              .replace(/\.\s*Öffnet eine neue Seite.*$/i, "")
              .trim()
        : null;

    const titleRaw = html.match(/id="aod-asin-title-text"[^>]*>([\s\S]*?)<\/h5>/)?.[1];
    const title = titleRaw
        ? decodeEntities(titleRaw.replace(/<[^>]*>/g, " "))
              .replace(/\s+/g, " ")
              .trim() || null
        : null;
    const imageUrl = html.match(/<img[^>]*src="([^"]+)"[^>]*id="aod-asin-image-id"/)?.[1] ?? null;

    return { price, rrp, seller, title, imageUrl };
};

/** Amazon answers 503 to quick successive requests – keep at least this gap between them */
const MIN_GAP_MS = 2_000;
let nextSlot = 0;
const waitForSlot = async () => {
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
};

export const fetchAmazonOffer = async (url: string): Promise<AmazonOffer | null> => {
    if (!isAmazonUrl(url)) return null;
    const asin = extractAsin(url);
    if (!asin) return null;
    await waitForSlot();
    const host = new URL(url).hostname;
    const offersUrl = `https://${host}/gp/product/ajax/aodAjaxMain/ref=dp_aod_NEW_mbc?asin=${asin}&pc=dp&experienceId=aodAjaxMain`;

    const resp = await fetchHtml(offersUrl, 20_000, 2, {
        "x-requested-with": "XMLHttpRequest",
        referer: `https://${host}/dp/${asin}`
    });
    if (!resp) return null;
    const offer = parseAmazonOffers(resp.body);
    return offer.price || offer.rrp ? offer : null;
};
