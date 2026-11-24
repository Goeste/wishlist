import metascraper from "metascraper";
import metascraperTitle from "metascraper-title";
import metascraperImage from "metascraper-image";
import shopping from "$lib/server/shopping";
import { fetchHtml, extractJsonLd } from "./http";

const scraper = metascraper([shopping(), metascraperTitle(), metascraperImage()]);

export interface ShopInfo {
    url: string;
    name: string | null;
    imageUrl: string | null;
    gtin: string | null;
    /** price in minor units (cents) */
    price: { value: number; currency: string } | null;
}

const GTIN_KEYS = ["gtin13", "gtin", "gtin14", "gtin12", "gtin8", "ean"];

/** EAN/GTIN from any Product JSON-LD block (incl. offers and variants) or microdata. */
export const extractGtin = (html: string): string | null => {
    const candidates: unknown[] = [];
    const visit = (node: any, depth = 0) => {
        if (!node || typeof node !== "object" || depth > 4) return;
        for (const key of GTIN_KEYS) if (node[key]) candidates.push(node[key]);
        for (const child of [node.offers, node.hasVariant, node.mainEntity].flat()) visit(child, depth + 1);
    };
    extractJsonLd(html).forEach((b) => visit(b));

    const micro = html.match(/itemprop=["']gtin(?:13|14|12|8)?["'][^>]*content=["'](\d{8,14})["']/i);
    if (micro) candidates.push(micro[1]);

    for (const c of candidates) {
        const digits = String(c).replace(/\D/g, "");
        if (/^\d{8}$|^\d{12,14}$/.test(digits)) return digits;
    }
    return null;
};

const toAbsoluteUrl = (value: string | null | undefined, base: string) => {
    if (!value) return null;
    try {
        return new URL(value, base).href;
    } catch {
        return null;
    }
};

/**
 * Reads name, image, EAN and price from any shop page (Amazon, otto, MediaMarkt, ...),
 * using the same metascraper rules as the "fetch product data" button, but with
 * browser-like headers and retries.
 */
export const fetchShopInfo = async (url: string): Promise<ShopInfo | null> => {
    const resp = await fetchHtml(url);
    if (!resp) return null;

    const md = await scraper({ html: resp.body, url: resp.url });
    if (md.image && md.image.toLowerCase().includes("captcha")) return null;

    const rawPrice = typeof md.price === "number" ? md.price : parseFloat(String(md.price ?? ""));
    const price =
        Number.isFinite(rawPrice) && rawPrice > 0 && md.currency
            ? { value: Math.round(rawPrice * 100), currency: String(md.currency) }
            : null;

    return {
        url: resp.url,
        name: ((md.name as string | undefined) || md.title || null)?.trim() || null,
        imageUrl: toAbsoluteUrl(md.image, resp.url),
        gtin: extractGtin(resp.body),
        price
    };
};
