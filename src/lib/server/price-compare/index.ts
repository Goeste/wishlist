import { client } from "$lib/server/prisma";
import { logger } from "$lib/server/logger";
import { getConfig } from "$lib/server/config";
import { createImage } from "$lib/server/image-util";
import { itemEmitter } from "$lib/server/events/emitters";
import { ItemEvent } from "$lib/events";
import { getItemInclusions } from "$lib/server/items";
import { extractSetNumber, fetchLegoSetInfo, isLegoUrl } from "./lego";
import { isBlockedTitle, nameFromUrl, queryFromUrl } from "./blocked";
import { findCheapestOnIdealo, type IdealoOffer } from "./idealo";
import { fetchShopInfo, type ShopInfo } from "./shop";
import { getHostname } from "$lib/server/shopping/helpers";
import { sleep } from "./http";

/** Display names for big shops, so idealo ("Amazon") and our own lookup ("amazon.de") agree */
const KNOWN_SHOPS: Record<string, string> = {
    amazon: "Amazon",
    ebay: "eBay",
    otto: "OTTO",
    mediamarkt: "MediaMarkt",
    saturn: "Saturn",
    lego: "LEGO",
    kaufland: "Kaufland",
    galaxus: "Galaxus",
    thalia: "Thalia"
};
export const shopLabel = (name: string) => {
    const s = name.trim();
    const lower = s.toLowerCase().replace(/^www\./, "");
    const base = lower.match(/^([a-z0-9-]+)\.[a-z.]{2,}$/)?.[1] ?? lower.match(/^([a-z0-9-]+)(?: marketplace)?$/)?.[1];
    return (base && KNOWN_SHOPS[base]) || s;
};

/**
 * An idealo hit found only by name is rejected if it is far cheaper than the shop's own price:
 * that is almost always a different variant/product, not a bargain.
 */
const MIN_PLAUSIBLE_RATIO = 0.6;

/** Pause between items in batch runs, to stay polite towards lego.com / idealo.de */
const BATCH_DELAY_MS = 2_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
/** "Lowest price within the last 30 days" comparison window */
const HISTORY_WINDOW_MS = 30 * DAY_MS;

export const isPriceCompareEnabled = async () => {
    const config = await getConfig();
    return config.priceCompare?.enable === true;
};

/**
 * Enriches a single item:
 *  - LEGO items: UVP (list price) and image from lego.com, with brickmerge.de as fallback
 *  - all shops: image, EAN and own price from the product page
 *  - all items with a recognisable product: cheapest new offer on idealo.de incl. shop name and link
 *  - names taken from bot-protection pages ("Just a moment...", "Verify your browser") are repaired
 *
 * Never throws; failures are logged and the item is left unchanged.
 * Returns true if anything was written.
 */
export const enrichItem = async (itemId: number): Promise<boolean> => {
    try {
        const item = await client.item.findUnique({ where: { id: itemId }, include: { itemPrice: true } });
        if (!item) return false;

        let setNumber = extractSetNumber(item.url, item.name);
        const data: {
            rrpValue?: number | null;
            rrpCurrency?: string | null;
            bestPriceValue?: number | null;
            bestPriceCurrency?: string | null;
            bestPriceShop?: string | null;
            bestPriceUrl?: string | null;
            bestPriceCheckedAt?: Date;
            bestPriceRefValue?: number | null;
            bestPriceRefWindow?: string | null;
            imageUrl?: string;
            name?: string;
        } = {};
        const nameIsBroken = !item.name.trim() || isBlockedTitle(item.name);
        let betterName: string | null = null;
        let imageCandidate: string | null = null;

        // 1) lego.com: UVP + image
        if (setNumber || isLegoUrl(item.url)) {
            const lego = await fetchLegoSetInfo({ url: item.url, setNumber });
            if (lego) {
                setNumber = lego.setNumber;
                betterName ??= lego.name;
                if (lego.rrp) {
                    data.rrpValue = lego.rrp.value;
                    data.rrpCurrency = lego.rrp.currency;
                }
                imageCandidate = lego.imageUrl;
            }
        } else {
            // not (or no longer) a LEGO item, e.g. after the URL was changed
            data.rrpValue = null;
            data.rrpCurrency = null;
        }

        // 2) any other shop (Amazon, otto, MediaMarkt, ...): image, EAN and the shop's own price
        let shopInfo: ShopInfo | null = null;
        if (item.url && !isLegoUrl(item.url)) {
            shopInfo = await fetchShopInfo(item.url);
            imageCandidate ??= shopInfo?.imageUrl ?? null;
            betterName ??= shopInfo?.name ?? null;
            // RRP stated by the shop (Amazon "UVP"), unless a LEGO RRP was found
            if (shopInfo?.rrp && data.rrpValue == null) {
                data.rrpValue = shopInfo.rrp.value;
                data.rrpCurrency = shopInfo.rrp.currency;
            }
        }

        // 3) idealo.de: cheapest offer + shop link (search by set number, EAN or name)
        const searchName = nameIsBroken ? (betterName ?? (item.url ? queryFromUrl(item.url) : null) ?? "") : item.name;
        const idealo = await findCheapestOnIdealo({
            name: searchName,
            setNumber,
            gtin: shopInfo?.gtin
        });

        // the item's own shop counts as an offer too (backup if idealo finds nothing)
        const offers: IdealoOffer[] = [];
        const reference = shopInfo?.price ?? item.itemPrice;
        const implausible =
            idealo?.cheapest &&
            idealo.matchedBy === "name" &&
            reference &&
            reference.currency === idealo.cheapest.currency &&
            idealo.cheapest.value < reference.value * MIN_PLAUSIBLE_RATIO;
        if (implausible) {
            logger.info(
                { itemId, idealo: idealo.productUrl, price: idealo.cheapest!.value, reference: reference.value },
                "price-compare: idealo name match ignored, price implausibly low"
            );
        } else if (idealo?.cheapest) offers.push(idealo.cheapest);
        if (shopInfo?.price && item.url) {
            offers.push({
                ...shopInfo.price,
                shop: getHostname(shopInfo.url),
                url: item.url
            });
        }
        const sameCurrency = offers.filter((o) => o.currency === (offers[0]?.currency ?? "EUR"));
        const cheapest = sameCurrency.sort((a, b) => a.value - b.value)[0] ?? null;

        // If nothing can be reached/matched, the previous values are kept.
        const now = new Date();
        if (cheapest) {
            const { value, currency, url } = cheapest;
            const shop = shopLabel(cheapest.shop);
            data.bestPriceValue = value;
            data.bestPriceCurrency = currency;
            data.bestPriceShop = shop;
            data.bestPriceUrl = url;
            data.bestPriceCheckedAt = now;

            // reference: lowest price of the previous 30 days (before this check), same currency;
            // without data in that window, fall back to the lowest price ever recorded
            const low30 = await client.itemBestPriceHistory.aggregate({
                where: { itemId, currency, checkedAt: { gte: new Date(now.getTime() - HISTORY_WINDOW_MS) } },
                _min: { value: true }
            });
            if (low30._min.value !== null) {
                data.bestPriceRefValue = low30._min.value;
                data.bestPriceRefWindow = "30d";
            } else {
                const lowAll = await client.itemBestPriceHistory.aggregate({
                    where: { itemId, currency },
                    _min: { value: true }
                });
                data.bestPriceRefValue = lowAll._min.value ?? null;
                data.bestPriceRefWindow = lowAll._min.value !== null ? "all" : null;
            }

            await client.itemBestPriceHistory.create({
                data: { itemId, value, currency, shop, checkedAt: now }
            });
        }
        imageCandidate ??= idealo?.imageUrl ?? null;
        // prefer short, clean names: LEGO set name > idealo product name > shop title > URL
        const replacement = [
            setNumber ? betterName : null,
            idealo?.productTitle,
            betterName,
            item.url ? nameFromUrl(item.url) : null
        ].find((n): n is string => !!n && !isBlockedTitle(n));
        if (nameIsBroken && replacement) {
            data.name = replacement.slice(0, 250);
        }

        // 4) image only when the item doesn't have one yet – never overwrite user uploads
        if (!item.imageUrl && imageCandidate) {
            try {
                const file = await createImage(item.name, imageCandidate);
                if (file) data.imageUrl = file;
            } catch (err) {
                logger.warn({ itemId, imageCandidate, err }, "price-compare: unable to store image");
            }
        }

        const updated = await client.item.update({
            where: { id: itemId },
            data,
            include: getItemInclusions()
        });
        itemEmitter.emit(ItemEvent.ITEM_UPDATE, updated);

        logger.info(
            {
                itemId,
                setNumber,
                rrp: data.rrpValue,
                renamed: data.name,
                bestPrice: data.bestPriceValue,
                shop: data.bestPriceShop
            },
            "price-compare: item enriched"
        );
        return true;
    } catch (err) {
        logger.error({ itemId, err }, "price-compare: failed to enrich item");
        return false;
    }
};

/** Fire-and-forget enrichment after an item was created or edited (only if the feature is enabled). */
export const enrichItemInBackground = (itemId: number) => {
    isPriceCompareEnabled()
        .then((enabled) => (enabled ? enrichItem(itemId) : false))
        .catch((err) => logger.error({ itemId, err }, "price-compare: background enrichment failed"));
};

/** Runs the price comparison for all unclaimed items. Returns the number of enriched items. */
export const runPriceCompare = async (): Promise<number> => {
    if (!(await isPriceCompareEnabled())) return 0;

    const items = await client.item.findMany({
        where: { claims: { none: {} } },
        select: { id: true }
    });
    logger.info(`price-compare: comparing prices for ${items.length} unclaimed item(s)`);

    let count = 0;
    for (const [i, { id }] of items.entries()) {
        if (i > 0) await sleep(BATCH_DELAY_MS);
        if (await enrichItem(id)) count++;
    }
    logger.info(`price-compare: run complete – ${count} item(s) enriched`);
    return count;
};
