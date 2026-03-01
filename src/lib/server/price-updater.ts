import { client } from "./prisma";
import { logger } from "./logger";
import metascraper from "metascraper";
import metascraperShopping from "./shopping";

const scraper = metascraper([metascraperShopping()]);

/**
 * Fetches the current price for a single URL using metascraper.
 * Returns null if price could not be determined.
 */
async function fetchPriceForUrl(
    url: string
): Promise<{ value: number; currency: string } | null> {
    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (compatible; Wishlist-PriceBot/1.0)"
            },
            signal: AbortSignal.timeout(15_000)
        });

        if (!response.ok) return null;

        const html = await response.text();
        const metadata = await scraper({ html, url });

        if (!metadata.price || !metadata.currency) return null;

        // price from scraper is a string like "19.99"
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
 * Only updates the DB if the price actually changed.
 * Returns the number of items updated.
 */
export async function runPriceUpdate(): Promise<number> {
    logger.info("price-updater: starting automatic price update run");

    // Find all items that:
    // - have a URL
    // - are NOT claimed (no ItemClaim rows for them)
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
        // url is guaranteed non-null by the where clause above
        const fetched = await fetchPriceForUrl(item.url!);
        if (!fetched) continue;

        const currentValue = item.itemPrice?.value ?? null;
        const currentCurrency = item.itemPrice?.currency ?? null;

        // Skip if price hasn't changed
        if (
            currentValue === fetched.value &&
            currentCurrency === fetched.currency
        ) {
            continue;
        }

        // Upsert the ItemPrice record and link it to the item
        const upsertedPrice = await client.itemPrice.upsert({
            where: { id: item.itemPriceId ?? "" },
            create: {
                value: fetched.value,
                currency: fetched.currency
            },
            update: {
                value: fetched.value,
                currency: fetched.currency
            }
        });

        // If item didn't have an itemPriceId yet, link it now
        if (!item.itemPriceId) {
            await client.item.update({
                where: { id: item.id },
                data: { itemPriceId: upsertedPrice.id }
            });
        }

        updatedCount++;
        logger.info(
            { itemId: item.id, old: currentValue, new: fetched.value, currency: fetched.currency },
            "price-updater: updated price for item"
        );
    }

    logger.info(`price-updater: run complete – ${updatedCount} item(s) updated`);
    return updatedCount;
}
