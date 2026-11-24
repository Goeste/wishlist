import { decodeEntities, fetchHtml, findJsonLdOfType, parsePrice } from "./http";

const IDEALO_BASE = "https://www.idealo.de";

export interface IdealoSearchHit {
    productUrl: string;
    title: string;
    fromPrice: number | null;
}

export interface IdealoOffer {
    /** price in minor units (cents) */
    value: number;
    currency: string;
    shop: string;
    /** idealo click-out link, redirects to the shop's offer page */
    url: string;
}

export interface IdealoResult {
    productUrl: string;
    productTitle: string;
    imageUrl: string | null;
    cheapest: IdealoOffer | null;
    /** how the product was found: set number and EAN are reliable, a name match less so */
    matchedBy: "set" | "gtin" | "name";
}

const stripTags = (s: string) =>
    decodeEntities(s.replace(/<[^>]*>/g, ""))
        .replace(/\s+/g, " ")
        .trim();

/** Parses the product clusters ("OffersOfProduct") from an idealo search result page. */
export const parseSearchResults = (html: string): IdealoSearchHit[] => {
    const hits: IdealoSearchHit[] = [];
    const chunks = html.split('data-testid="resultItemLink"').slice(1);
    for (const chunk of chunks) {
        const href = chunk.match(/href="(https:\/\/www\.idealo\.de\/preisvergleich\/OffersOfProduct\/[^"]+)"/);
        if (!href) continue;
        const title = chunk.match(/data-testid="product-summary-title"[^>]*>([\s\S]*?)<\/div>/);
        const price = chunk.match(/data-testid="detailed-price-info-price"[\s\S]*?<span>([^<]*\d[^<]*)<\/span>/);
        hits.push({
            productUrl: decodeEntities(href[1]),
            title: title ? stripTags(title[1]) : "",
            fromPrice: price ? parsePrice(price[1]) : null
        });
    }
    return hits;
};

const significantWords = (s: string) =>
    s
        .toLowerCase()
        .replace(/ß/g, "ss")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2);

/** short numbers and alphanumeric codes ("61", "3", "96", "9forty", "1000xm5"): sizes, volumes, models */
const shortNumbers = (s: string) =>
    new Set(
        s
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((w) => /\d/.test(w) && !/^\d{5,}$/.test(w))
    );

/** colour words (de/en) – variants of clothing etc. on idealo often differ only in colour */
const COLOURS = new Set(
    (
        "schwarz black weiss white rot red blau blue gruen green gelb yellow grau grey gray braun brown " +
        "beige rosa pink lila purple violett violet orange navy tuerkis turquoise teal oliv olive silber " +
        "silver gold khaki creme cream bordeaux burgundy mint anthrazit anthracite sky"
    ).split(" ")
);

/** Picks the search hit that matches the set number, or – without one – the best name match. */
export const pickHit = (hits: IdealoSearchHit[], name: string, setNumber: string | null) => {
    if (setNumber) {
        const re = new RegExp(`(^|\\D)${setNumber}(\\D|$)`);
        return hits.find((h) => h.title.includes(`(${setNumber})`)) ?? hits.find((h) => re.test(h.title)) ?? null;
    }
    const wanted = new Set(significantWords(name));
    if (wanted.size === 0) return null;
    const wantedColours = [...wanted].filter((w) => COLOURS.has(w));
    const wantedNumbers = shortNumbers(name);
    let best: { hit: IdealoSearchHit; score: number } | null = null;
    for (const hit of hits) {
        const words = [...new Set(significantWords(hit.title))];
        if (words.length === 0) continue;
        const overlap = words.filter((w) => wanted.has(w)).length;
        // a different colour means a different variant (e.g. "green" cap vs. "pastel brown" cap)
        if (wantedColours.length > 0 && words.some((w) => COLOURS.has(w) && !wanted.has(w))) continue;
        // sizes, volumes and model numbers must agree ("61 cm" vs. "40 cm", "Band 3" vs. no volume);
        // long numbers (article numbers, EANs) are often missing on one side and are ignored
        const hitNumbers = shortNumbers(hit.title);
        if ([...wantedNumbers].some((n) => !hitNumbers.has(n))) continue;
        if ([...hitNumbers].some((n) => /^\d+$/.test(n) && !wantedNumbers.has(n))) continue;
        // Shop titles (e.g. Amazon) are long and full of marketing words, idealo titles are short:
        // measure how much of the idealo title is covered by our name.
        const score = overlap < 2 && words.length > 1 ? 0 : overlap / words.length;
        if (!best || score > best.score) best = { hit, score };
    }
    // only accept reasonably confident matches to avoid linking wrong products
    return best && best.score >= 0.6 ? best.hit : null;
};

/** Shortens long shop titles to a useful search query. */
export const toSearchQuery = (name: string) => {
    // "Sony WH-1000XM5 Kopfhörer, Schwarz | Marke" -> "Sony WH-1000XM5 Kopfhörer"
    const head = name.split(/\s[|–]\s|,\s|\s\(/)[0].trim();
    const base = head.split(/\s+/).length >= 2 ? head : name;
    return base.split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
};

/** Parses all new-condition offers of an idealo product page and returns the cheapest. */
export const parseCheapestOffer = (html: string): IdealoOffer | null => {
    const usedIdx = html.search(/data-offerlist-segment="used"/);
    const relevant = usedIdx >= 0 ? html.slice(0, usedIdx) : html;
    const items = relevant.split('<li class="productOffers-listItem ').slice(1);

    let cheapest: IdealoOffer | null = null;
    for (const item of items) {
        const mtrx = item.match(/data-mtrx-click='([^']+)'/);
        const href = item.match(/href="(\/relocator\/relocate\?[^"]+)"/);
        if (!mtrx || !href) continue;
        try {
            const data = JSON.parse(decodeEntities(mtrx[1]));
            const price = parsePrice(data?.products?.[0]?.price);
            if (price === null) continue;
            const value = Math.round(price * 100);
            if (!cheapest || value < cheapest.value) {
                cheapest = {
                    value,
                    currency: "EUR",
                    shop: String(data.shop_name ?? "").trim() || "Shop",
                    url: IDEALO_BASE + decodeEntities(href[1])
                };
            }
        } catch {
            // ignore malformed offer
        }
    }
    return cheapest;
};

export interface IdealoQuery {
    name: string;
    setNumber?: string | null;
    /** EAN/GTIN – idealo redirects an EAN search straight to the matching product page */
    gtin?: string | null;
}

const isProductPage = (url: string) => url.includes("/preisvergleich/OffersOfProduct/");

const searchUrlFor = (q: string) =>
    `${IDEALO_BASE}/preisvergleich/MainSearchProductCategory.html?q=${encodeURIComponent(q)}`;

/** Finds the idealo product page: by set number, by EAN, or by name (in that order). */
const findProductPage = async ({ name, setNumber, gtin }: IdealoQuery) => {
    const attempts: { query: string; setNumber: string | null; by: IdealoResult["matchedBy"] }[] = [];
    if (setNumber) attempts.push({ query: `LEGO ${setNumber}`, setNumber, by: "set" });
    if (gtin) attempts.push({ query: gtin, setNumber: null, by: "gtin" });
    if (name.trim()) attempts.push({ query: toSearchQuery(name), setNumber: null, by: "name" });

    for (const attempt of attempts) {
        const search = await fetchHtml(searchUrlFor(attempt.query));
        if (!search) continue;

        if (isProductPage(search.url)) {
            const title = search.body.match(/<title>([^<|]*)/)?.[1]?.trim() ?? name;
            return { hit: { productUrl: search.url, title, fromPrice: null }, page: search, by: attempt.by };
        }

        const hits = parseSearchResults(search.body);
        // an EAN search with exactly one product cluster is unambiguous
        const hit = attempt.query === gtin && hits.length === 1 ? hits[0] : pickHit(hits, name, attempt.setNumber);
        if (hit) return { hit, page: await fetchHtml(hit.productUrl), by: attempt.by };
    }
    return null;
};

/**
 * Searches idealo.de and returns the cheapest new offer incl. shop name and click-out link.
 */
export const findCheapestOnIdealo = async (query: IdealoQuery): Promise<IdealoResult | null> => {
    const found = await findProductPage(query);
    if (!found) return null;
    const { hit, page: productPage, by: matchedBy } = found;

    if (!productPage) {
        // fall back to the "from" price of the search page, linking to the comparison page
        return hit.fromPrice !== null
            ? {
                  productUrl: hit.productUrl,
                  productTitle: hit.title,
                  imageUrl: null,
                  cheapest: {
                      value: Math.round(hit.fromPrice * 100),
                      currency: "EUR",
                      shop: "idealo",
                      url: hit.productUrl
                  },
                  matchedBy
              }
            : null;
    }

    let cheapest = parseCheapestOffer(productPage.body);
    const group = findJsonLdOfType(productPage.body, "ProductGroup");
    let image: unknown = group?.image;
    if (Array.isArray(image)) image = image[0];

    if (!cheapest) {
        const product = findJsonLdOfType(productPage.body, "Product");
        const low = parsePrice(product?.offers?.lowPrice);
        if (low !== null) {
            cheapest = {
                value: Math.round(low * 100),
                currency: product?.offers?.priceCurrency ?? "EUR",
                shop: "idealo",
                url: hit.productUrl
            };
        }
    }

    const product = findJsonLdOfType(productPage.body, "Product");
    return {
        productUrl: hit.productUrl,
        productTitle: (product?.name as string | undefined) ?? hit.title,
        imageUrl: typeof image === "string" ? image : null,
        cheapest,
        matchedBy
    };
};
