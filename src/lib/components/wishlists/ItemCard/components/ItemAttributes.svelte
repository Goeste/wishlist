<script lang="ts">
    import Markdown from "$lib/components/Markdown.svelte";
    import { getFormatter } from "$lib/i18n";
    import { formatPrice, formatNumberAsPrice } from "$lib/price-formatter";
    import { shouldShowName, getClaimedName } from "../../util";
    import type { ItemCardProps } from "../ItemCard.svelte";

    interface Props extends Pick<
        ItemCardProps,
        "item" | "onPublicList" | "user" | "showClaimForOwner" | "showClaimedName" | "showNameAcrossGroups" | "showFor"
    > {
        showDetail?: boolean;
        fullNotes?: boolean;
    }

    const t = getFormatter();
    const {
        item,
        onPublicList,
        user,
        showClaimedName,
        showNameAcrossGroups = false,
        showClaimForOwner = false,
        showFor,
        showDetail = false,
        fullNotes = false
    }: Props = $props();

    let expandClaims = $state(false);

    const hostnameOf = (url: string) => {
        try {
            return new URL(url).hostname.replace(/^www\./, "");
        } catch {
            return url;
        }
    };
</script>

<!-- Price with fallback -->
{#if item.price || item.itemPrice}
    <div class="flex items-center gap-x-2">
        <iconify-icon icon="ion:pricetag"></iconify-icon>
        <span data-testid="price">
            {formatPrice(item)}
        </span>
    </div>
{/if}

<!-- UVP (price comparison feature) -->
{#if item.rrpValue && item.rrpCurrency}
    <div class="flex items-center gap-x-2">
        <iconify-icon icon="ion:pricetags-outline"></iconify-icon>
        <span data-testid="rrp">
            {$t("wishes.rrp", { values: { price: formatNumberAsPrice(item.rrpCurrency, item.rrpValue) } })}
        </span>
    </div>
{/if}

<!-- Cheapest offer (price comparison feature) -->
{#if item.bestPriceValue && item.bestPriceCurrency && item.bestPriceUrl}
    <div class="flex items-center gap-x-2">
        <iconify-icon icon="ion:trending-down"></iconify-icon>
        <a
            class="anchor"
            data-testid="best-price"
            href={item.bestPriceUrl}
            onclick={(e) => e.stopPropagation()}
            rel="noopener noreferrer nofollow"
            target="_blank"
        >
            {$t("wishes.best-price", {
                values: {
                    price: formatNumberAsPrice(item.bestPriceCurrency, item.bestPriceValue),
                    shop: item.bestPriceShop ?? "Shop"
                }
            })}
        </a>
    </div>
    {#if item.bestPriceRefValue}
        {@const diff = ((item.bestPriceValue - item.bestPriceRefValue) / item.bestPriceRefValue) * 100}
        {@const rounded = Math.round(diff * 10) / 10}
        <div class="flex items-center gap-x-2 text-sm" data-testid="best-price-trend">
            <iconify-icon
                class={rounded < 0 ? "text-success-700-300" : rounded > 0 ? "text-error-700-300" : "text-subtle"}
                icon={rounded < 0 ? "ion:arrow-down" : rounded > 0 ? "ion:arrow-up" : "ion:remove"}
            ></iconify-icon>
            <span
                class={[
                    "font-bold",
                    rounded < 0 && "text-success-700-300",
                    rounded > 0 && "text-error-700-300",
                    rounded === 0 && "text-subtle"
                ]}
            >
                {$t(item.bestPriceRefWindow === "30d" ? "wishes.best-price-trend" : "wishes.best-price-trend-all", {
                    values: {
                        percent: `${rounded > 0 ? "+" : ""}${rounded.toLocaleString(undefined, { maximumFractionDigits: 1 })} %`,
                        price: formatNumberAsPrice(item.bestPriceCurrency, item.bestPriceRefValue)
                    }
                })}
            </span>
        </div>
    {/if}
{/if}

<!-- Original shop link stays available next to the cheapest offer -->
{#if item.url && item.bestPriceUrl && item.bestPriceUrl !== item.url}
    <div class="flex items-center gap-x-2">
        <iconify-icon icon="ion:storefront-outline"></iconify-icon>
        <a
            class="anchor"
            data-testid="original-shop"
            href={item.url}
            onclick={(e) => e.stopPropagation()}
            rel="noopener noreferrer"
            target="_blank"
        >
            {$t("wishes.original-shop", { values: { shop: hostnameOf(item.url) } })}
        </a>
    </div>
{/if}

<!-- Quantity with fallback -->
<div class="flex items-center gap-2" data-testid="quantity">
    <iconify-icon icon="ion:gift"></iconify-icon>
    <div class="flex flex-row flex-wrap gap-x-2">
        <span data-testid="quantity-desired">
            {#if item.quantity}
                {$t("wishes.quantity-desired", { values: { quantity: item.quantity } })}
            {:else}
                {$t("wishes.no-limit")}
            {/if}
        </span>
        {#if item.quantity && (user?.id !== item.userId || showClaimForOwner)}
            <span>·</span>
            <span class="text-secondary-900-100 font-bold" data-testid="quantity-claimed">
                {$t("wishes.quantity-claimed", { values: { quantity: item.claimedQuantity } })}
            </span>
        {/if}
    </div>
</div>
{#if showDetail && showClaimedName && item.claims.length > 0 && (item.userId !== user?.id || showClaimForOwner)}
    <div class="card text-sm">
        <button
            class="flex w-full items-center justify-start! gap-2 p-2 text-start! text-sm"
            onclick={() => (expandClaims = !expandClaims)}
        >
            <iconify-icon icon={expandClaims ? "ion:chevron-up" : "ion:chevron-down"}></iconify-icon>
            <span>{expandClaims ? $t("wishes.hide-claims") : $t("wishes.show-claims")}</span>
        </button>

        {#if expandClaims}
            <div class="max-h-32 overflow-auto px-2 pb-2">
                {#each item.claims as claim}
                    {@const showName = shouldShowName(
                        item,
                        showClaimedName,
                        showNameAcrossGroups,
                        showClaimForOwner,
                        user,
                        claim
                    )}
                    <div class="flex items-center justify-between py-1">
                        <span>{showName ? getClaimedName(claim) : $t("wishes.anonymous")}</span>
                        <span>
                            {$t("wishes.claims", { values: { claimCount: claim.quantity } })}
                        </span>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
{/if}

<!-- Added by / For (claims page) -->
<div class="flex items-center gap-2">
    <iconify-icon icon="ion:person"></iconify-icon>
    <span class="text-wrap" data-testid="added-by">
        {#if showFor}
            {@html $t("wishes.for", { values: { name: item.user.name, class: "text-secondary-900-100 font-bold" } })}
        {:else if !onPublicList}
            {@html $t("wishes.added-by", {
                values: { name: item.addedBy.name, class: "text-secondary-900-100 font-bold" }
            })}
        {:else}
            {@html item.addedBy.id === item.user.id
                ? $t("wishes.added-by", {
                      values: { name: item.addedBy.name, class: "text-secondary-900-100 font-bold" }
                  })
                : $t("wishes.added-by-somebody-else", { values: { class: "text-secondary-900-100 font-bold" } })}
        {/if}
    </span>
</div>

<!-- Notes -->
{#if item.note}
    <div class="grid flex-none grid-cols-[auto_1fr] items-center gap-2">
        <iconify-icon icon="ion:reader"></iconify-icon>
        <div class={["whitespace-pre-wrap print:line-clamp-none", fullNotes ? "" : "line-clamp-2"]} data-testid="notes">
            <Markdown source={item.note} />
        </div>
    </div>
{/if}
