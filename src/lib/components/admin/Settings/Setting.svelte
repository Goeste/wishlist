<script lang="ts">
    import type { Snippet } from "svelte";

    interface Props {
        children: Snippet;
        description?: Snippet;
    }

    const { children, description }: Props = $props();
</script>

<div class="flex flex-col gap-1 py-2">
    <div>
        {@render children()}
    </div>
    {#if description}
        <p class="text-surface-500-400 text-sm">
            {@render description()}
        </p>
    {/if}
</div>
