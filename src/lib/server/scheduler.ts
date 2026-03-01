import { logger } from "./logger";
import { getConfig } from "./config";
import { runPriceUpdate } from "./price-updater";

/**
 * Singleton price-update scheduler.
 * Uses setTimeout (not setInterval) so each run re-reads the config,
 * meaning admin changes take effect without a server restart.
 */
class PriceUpdateScheduler {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private started = false;

    start(): void {
        if (this.started) return;
        this.started = true;
        logger.info("scheduler: price update scheduler started");
