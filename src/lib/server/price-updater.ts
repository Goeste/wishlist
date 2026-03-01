import { client } from "./prisma";
import { logger } from "./logger";
import metascraper from "metascraper";
import metascraperShopping from "./shopping";

const scraper = metascraper([metascraperShopping()]);

interface FetchedPrice {
    value: number;
    currency: string;
}

/**
 * Fetches the current price for a URL using the existing metascraper shopping module.
 * Returns null if price or currency could not be determined.
 */
async function fetchPriceForUrl(url: string): Promise<FetchedPrice | null> {
    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; Wishlist-PriceBot/1.0)"
            },
            signal: AbortSignal.timeout(15_000)
        });

        if (!response.ok) return null;

        const html = await response.text();
        const metadata = await scraper({ html, url });

        if (!metadata.price || !metadata.currency) return null;

        const numericValue = Math.round(parseFloat(metadata.price) * 100);
        if (isNaN(numericValue)) return null;

        return { value: numericValue, currency: metadata.currency };
    } catch (err) {
        logger.warn({ url, err }, "price-updater: failed to fetch price for url");
        return null;
    }
}

/**
 * Runs the automatic price update for all unclaimed items that have a URL.
 * Only writes to the DB when the price actually changed.
 * Returns the number of items whose price was updated.
 */
export async function runPriceUpdate(): Promise<number> {
    logger.info("price-updater: starting automatic price update run");

    const items = await client.item.findMany({
        where: {
            url: { not: null },
            claims: { none: {} }
        },
        include: {
            itemPrice: true
        }
    });

    if (items.length === 0) {
        logger.info("price-updater: no unclaimed items with URLs found");
        return 0;
    }

    logger.info(`price-updater: checking prices for ${items.length} unclaimed item(s)`);

    let updatedCount = 0;

    for (const item of items) {
        const fetched = await fetchPriceForUrl(item.url!);
        if (!fetched) continue;

        const currentValue = item.itemPrice?.value ?? null;
        const currentCurrency = item.itemPrice?.currency ?? null;

        if (fetched.value === currentValue && fetched.currency === currentCurrency) {
            continue;
        }

        if (item.itemPriceId) {
            await client.itemPrice.update({
                where: { id: item.itemPriceId },
                data: { value: fetched.value, currency: fetched.currency }
            });
        } else {
            const created = await client.itemPrice.create({
                data: { value: fetched.value, currency: fetched.currency }
            });
            await client.item.update({
                where: { id: item.id },
                data: { itemPriceId: created.id }
            });
        }

        updatedCount++;
        logger.info(
            { itemId: item.id, oldValue: currentValue, newValue: fetched.value, currency: fetched.currency },
            "price-updater: price changed, updated"
        );
    }

    logger.info(`price-updater: run complete – ${updatedCount} item(s) updated`);
    return updatedCount;
}
