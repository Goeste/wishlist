<script lang="ts">
    import SettingsGroup from "./SettingsGroup.svelte";
    import Setting from "./Setting.svelte";
    import { getFormatter } from "$lib/i18n";

    interface Props {
        config: Config;
        hidden?: boolean;
    }

    const { config, hidden = false }: Props = $props();
    const t = getFormatter();
</script>

<div class={{ hidden, "flex flex-col gap-4": !hidden }}>
    <h2 class="h2">{$t("admin.price-update")}</h2>

    <SettingsGroup title={$t("admin.price-update-automatic")}>
        <Setting>
            <label class="checkbox-label">
                <input
                    id="enablePriceUpdate"
                    name="enablePriceUpdate"
                    class="checkbox"
                    type="checkbox"
                    checked={config.priceUpdate.enable}
                    onchange={(e) => (config.priceUpdate.enable = e.currentTarget.checked)}
                />
                <span>{$t("admin.price-update-enable")}</span>
            </label>

            {#snippet description()}
                {$t("admin.price-update-enable-tooltip")}
            {/snippet}
        </Setting>

        <Setting>
            <label class="label w-full">
                <span>{$t("admin.price-update-interval-hours")}</span>
                <input
                    id="priceUpdateIntervalHours"
                    name="priceUpdateIntervalHours"
                    class="input"
                    type="number"
                    min="1"
                    max="8760"
                    value={config.priceUpdate.intervalHours}
                    disabled={!config.priceUpdate.enable}
                />
            </label>

            {#snippet description()}
                {$t("admin.price-update-interval-hours-tooltip")}
            {/snippet}
        </Setting>

        <Setting>
            <label class="label w-full">
                <span>{$t("admin.price-update-scheduled-time")}</span>
                <input
                    id="priceUpdateScheduledTime"
                    name="priceUpdateScheduledTime"
                    class="input"
                    type="time"
                    value={config.priceUpdate.scheduledTime ?? ""}
                    disabled={!config.priceUpdate.enable}
                />
            </label>

            {#snippet description()}
                {$t("admin.price-update-scheduled-time-tooltip")}
            {/snippet}
        </Setting>
    </SettingsGroup>
</div>
