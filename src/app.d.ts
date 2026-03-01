import type { HTMLAttributes } from "svelte/elements";

declare global {
    // See https://kit.svelte.dev/docs/types#app
    // for information about these interfaces
    // and what to do when importing types
    /// <reference types="@sveltejs/kit" />
    declare namespace App {
        // Locals must be an interface and not a type
        interface Locals {
            user: LocalUser | null;
            isProxyUser: boolean;
            session: import("$lib/generated/prisma/client").Session | null;
            locale: string;
        }
    }

    // App version
    declare const __VERSION__: string;
    // git commit sha
    declare const __COMMIT_SHA__: string;
    // Date built
    declare const __LASTMOD__: string;

    interface SMTPConfig {
        enable: boolean;
        host?: string;
        port?: number;
        user?: string;
        pass?: string;
        from?: string;
        fromName?: string;
    }

    interface OIDCConfig {
        enable: boolean;
        discoveryUrl?: string;
        clientId?: string;
        clientSecret?: string;
        providerName?: string;
        autoRedirect?: boolean;
        autoRegister?: boolean;
        enableSync?: boolean;
        disableEmailVerification?: boolean;
    }

    interface PriceUpdateConfig {
        enable: boolean;
        intervalHours: number;
        scheduledTime?: string;
    }

    interface Config {
        enableSignup: boolean;
        suggestions: {
            enable: boolean;
            method: string;
        };
        smtp: SMTPConfig;
        claims: {
            showName: boolean;
            showNameAcrossGroups: boolean;
            showForOwner: boolean;
            requireEmail: boolean;
        };
        listMode: string;
        security: {
            passwordStrength: number;
            disablePasswordLogin: boolean;
        };
        defaultGroup?: string;
        enableDefaultListCreation: boolean;
        allowPublicLists: boolean;
        oidc: OIDCConfig;
        priceUpdate: PriceUpdateConfig;
    }

    interface LocalUser {
        id: string;
        username: string;
        name: string;
        email: string;
        picture: string | null;
        roleId: number;
        preferredLanguage: string | null;
    }

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
}

type IconifyIconLoaderCallback = (
    loaded: IconifyIconName[],
    missing: IconifyIconName[],
    pending: IconifyIconName[],
    unsubscribe: IconifyIconLoaderAbort
) => void;

export type IconifyIconLoaderAbort = () => void;

export {};
