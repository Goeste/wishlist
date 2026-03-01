import { logger } from "./logger";
import { getConfig } from "./config";
import { runPriceUpdate } from "./price-updater";

/**
 * Singleton price-update scheduler.
 * Reads config on each tick so changes take effect without restart.
 */
class PriceUpdateScheduler {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private running = false;

    start(): void {
        if (this.running) return;
        this.running = true;
        logger.info("scheduler: price update scheduler started");
        this.scheduleNext();
    }

    stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.running = false;
        logger.info("scheduler: price update scheduler stopped");
    }

    private scheduleNext(): void {
        if (!this.running) return;

        // Check config asynchronously, then set the timer
        this.computeNextDelayMs()
            .then((delayMs) => {
                if (delayMs === null) {
                    // Feature disabled – check again in 1 hour
                    this.timer = setTimeout(() => this.scheduleNext(), 60 * 60 * 1_000);
                    return;
                }

                logger.info(
                    `scheduler: next price update in ${Math.round(delayMs / 60_000)} minute(s)`
                );

                this.timer = setTimeout(async () => {
                    try {
                        await runPriceUpdate();
                    } catch (err) {
                        logger.error({ err }, "scheduler: unhandled error during price update");
                    } finally {
                        this.scheduleNext();
                    }
                }, delayMs);
            })
            .catch((err) => {
                logger.error({ err }, "scheduler: failed to compute next delay, retrying in 1h");
                this.timer = setTimeout(() => this.scheduleNext(), 60 * 60 * 1_000);
            });
    }

    private async computeNextDelayMs(): Promise<number | null> {
        const config = await getConfig();

        if (!config.priceUpdate?.enable) return null;

        const intervalHours = config.priceUpdate.intervalHours ?? 24;
        const scheduledTime = config.priceUpdate.scheduledTime ?? null;

        const now = new Date();

        if (scheduledTime) {
            // scheduledTime is "HH:MM" – find the next occurrence that is
            // at least (intervalHours) from now, aligned to the configured clock time.
            const [hStr, mStr] = scheduledTime.split(":");
            const h = parseInt(hStr, 10);
            const m = parseInt(mStr, 10);

            if (isNaN(h) || isNaN(m)) {
                logger.warn(
                    { scheduledTime },
                    "scheduler: invalid scheduledTime format, expected HH:MM"
                );
                return intervalHours * 60 * 60 * 1_000;
            }

            // Build candidate: today at HH:MM
            const candidate = new Date(now);
            candidate.setHours(h, m, 0, 0);

            // If that moment is in the past, advance by one day
            if (candidate <= now) {
                candidate.setDate(candidate.getDate() + 1);
            }

            return candidate.getTime() - now.getTime();
        }

        // No scheduled time – just use the interval directly
        return intervalHours * 60 * 60 * 1_000;
    }
}

export const priceUpdateScheduler = new PriceUpdateScheduler();
