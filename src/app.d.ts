import type { HTMLAttributes } from "svelte/elements";

declare global {
    /// <reference types="@sveltejs/kit" />
    declare namespace App {
        interface Locals {
            user: LocalUser | null;
            isProxyUser: boolean;
            session: import("$lib/generated/prisma/client").Session | null;
            locale: string;
        }
    }

    declare const __VERSION__: string;
    declare const __COMMIT_SHA__: string;
    declare const __LASTMOD__: string;

    interface IconifyIconHTMLElement extends HTMLAttributes<HTMLElement> {
        icon: string;
        width?: string | number;
        height?: string | number;
        rotate?: string | number;
        flip?: string;
        mode?: "style" | "bg" | "mask" | "svg";
        inline?: boolean;
        noobserver?: boolean;
        loadIcons?: (icons: string[], callback?: IconifyIconLoaderCallback) => IconifyIconLoaderAbort;
    }

    declare namespace svelteHTML {
        interface IntrinsicElements {
            "iconify-icon": IconifyIconHTMLElement;
        }
    }

    interface PriceUpdateConfig {
        enable: boolean;
        intervalHours: number;
        scheduledTime: string | null;
    }
}

type IconifyIconLoaderCallback = (
    loaded: IconifyIconName[],
    missing: IconifyIconName[],
    pending: IconifyIconName[],
    unsubscribe: IconifyIconLoaderAbort
) => void;

export type IconifyIconLoaderAbort = () => void;

export {};
