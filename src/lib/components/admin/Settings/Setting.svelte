<script lang="ts">
    import type { Snippet } from "svelte";

    interface Props {
        children: Snippet;
        description?: Snippet;
        class?: string | (string | boolean | null | undefined)[];
    }

    const { children, description, class: className }: Props = $props();
</script>

<div class={className ?? "flex flex-col gap-1 py-2"}>
    <div>
        {@render children()}
    </div>
    {#if description}
        <p class="text-surface-500-400 text-sm">
            {@render description()}
        </p>
    {/if}
</div>
