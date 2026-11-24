import { fetchHtml, findJsonLdOfType, parsePrice } from "./http";

export interface LegoInfo {
    setNumber: string;
    name: string | null;
    imageUrl: string | null;
    url: string;
    /** UVP in minor units (cents) */
    rrp: { value: number; currency: string } | null;
}

export const isLegoUrl = (url: string | null | undefined) => {
    if (!url) return false;
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host === "lego.com" || host.endsWith(".lego.com");
    } catch {
        return false;
    }
};

/**
 * Tries to determine a LEGO set number (4–6 digits) from a lego.com URL
 * (".../product/the-lord-of-the-rings-rivendell-10316") or a name like
 * "LEGO Herr der Ringe - Bruchtal (10316)".
 */
export const extractSetNumber = (url: string | null | undefined, name: string | null | undefined) => {
    if (url && isLegoUrl(url)) {
        try {
            const path = new URL(url).pathname.replace(/\/+$/, "");
            const m = path.match(/\/product\/(?:.*?-)?(\d{4,6})$/i);
            if (m) return m[1];
        } catch {
            // ignore
        }
    }
    // only for LEGO products – other names may contain unrelated numbers like "Pullover (12345)"
    if (name && (/lego/i.test(name) || isLegoUrl(url))) {
        const inParens = name.match(/\((\d{4,6})\)/);
        if (inParens) return inParens[1];
        const m = name.match(/(?:^|\D)(\d{4,6})(?:\D|$)/);
        if (m) return m[1];
    }
    return null;
};

/**
 * Finds the list price (UVP) of the main product in lego.com's embedded Apollo state.
 * The main product block looks like:
 *   "sku":"6426503","price":{...},"listPrice":{"__typename":"Price","centAmount":49999,...}
 */
const extractListPrice = (html: string, sku: string | null): number | null => {
    if (sku) {
        const skuIdx = html.indexOf(`"sku":"${sku}","price"`);
        if (skuIdx >= 0) {
            const window = html.slice(skuIdx, skuIdx + 800);
            const m = window.match(/"listPrice":\{[^}]*?"centAmount":(\d+)/);
            if (m) return parseInt(m[1], 10);
        }
    }
    const first = html.match(/"listPrice":\{[^}]*?"centAmount":(\d+)/);
    return first ? parseInt(first[1], 10) : null;
};

/**
 * Loads product information from lego.com.
 * Accepts either a lego.com product URL or a set number
 * (lego.com redirects /de-de/product/<setNumber> to the canonical page).
 */
export const fetchLegoInfo = async (opts: {
    url?: string | null;
    setNumber?: string | null;
}): Promise<LegoInfo | null> => {
    const target =
        opts.url && isLegoUrl(opts.url)
            ? opts.url
            : opts.setNumber
              ? `https://www.lego.com/de-de/product/${opts.setNumber}`
              : null;
    if (!target) return null;

    const resp = await fetchHtml(target);
    if (!resp) return null;

    const product = findJsonLdOfType(resp.body, "Product");
    const setNumber = (product?.productId as string | undefined) ?? opts.setNumber ?? extractSetNumber(resp.url, null);
    if (!setNumber) return null;

    let image: unknown = product?.image;
    if (Array.isArray(image)) image = image[0];
    if (image && typeof image === "object") image = (image as any).url ?? (image as any).contentUrl;
    let imageUrl = typeof image === "string" ? image : null;
    if (!imageUrl) {
        const og = resp.body.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
        imageUrl = og ? og[1].replace(/&amp;/g, "&") : null;
    }

    const offers = Array.isArray(product?.offers) ? product?.offers[0] : product?.offers;
    const currency: string = offers?.priceCurrency ?? "EUR";
    let rrpCents = extractListPrice(resp.body, (product?.sku as string | undefined) ?? null);
    if (rrpCents === null) {
        const p = parsePrice(offers?.price);
        rrpCents = p !== null ? Math.round(p * 100) : null;
    }

    return {
        setNumber,
        name: product?.name ?? null,
        imageUrl,
        url: resp.url,
        rrp: rrpCents !== null ? { value: rrpCents, currency } : null
    };
};

const decodeHtml = (s: string) =>
    s
        .replace(/<[^>]*>/g, " ")
        .replace(/&reg;/g, "®")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#0*39;|&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&([a-z])uml;/gi, (_, c: string) => ({ a: "ä", o: "ö", u: "ü", A: "Ä", O: "Ö", U: "Ü" })[c] ?? c)
        .replace(/&szlig;/g, "ß")
        .replace(/\s+/g, " ")
        .trim();

/**
 * Fallback for LEGO sets when lego.com blocks the request (common from datacenter IPs):
 * brickmerge.de lists the German RRP ("UVP"), name and image of every set.
 */
export const fetchBrickmergeInfo = async (setNumber: string): Promise<LegoInfo | null> => {
    const url = `https://www.brickmerge.de/${setNumber}-1`;
    const resp = await fetchHtml(url);
    if (!resp) return null;

    // the first RRP on the page belongs to the set itself, later ones to related sets
    const uvp = resp.body.match(/title="unverbindliche Preisempfehlung">\s*UVP\s*([\d.,]+)/);
    const rrp = uvp ? parsePrice(uvp[1]) : null;

    const h1 = resp.body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    const name = h1 ? decodeHtml(h1[1]).replace(/^LEGO\s*®\s*/, "LEGO® ") : null;

    const ogImage =
        resp.body.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/) ??
        resp.body.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/);

    // make sure the page really is about this set
    if (name && !name.includes(setNumber)) return null;

    return {
        setNumber,
        name,
        imageUrl: ogImage ? ogImage[1] : null,
        url: resp.url,
        rrp: rrp !== null ? { value: Math.round(rrp * 100), currency: "EUR" } : null
    };
};

/** lego.com first, brickmerge.de as fallback (and for a missing RRP). */
export const fetchLegoSetInfo = async (opts: {
    url?: string | null;
    setNumber?: string | null;
}): Promise<LegoInfo | null> => {
    const lego = await fetchLegoInfo(opts);
    if (lego?.rrp) return lego;

    const setNumber = lego?.setNumber ?? opts.setNumber ?? extractSetNumber(opts.url, null);
    if (!setNumber) return lego;

    const brickmerge = await fetchBrickmergeInfo(setNumber);
    if (!brickmerge) return lego;
    return {
        setNumber,
        name: lego?.name ?? brickmerge.name,
        imageUrl: lego?.imageUrl ?? brickmerge.imageUrl,
        url: lego?.url ?? brickmerge.url,
        rrp: lego?.rrp ?? brickmerge.rrp
    };
};
