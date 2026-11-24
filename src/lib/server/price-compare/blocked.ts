/**
 * Detection of bot-protection / challenge / error pages (Cloudflare, Vercel, Akamai,
 * Shopify, Amazon, ...) whose titles must never end up as item names.
 */
const BLOCKED_TITLE = new RegExp(
    [
        "just a moment",
        "verify(ing)? (that )?(you are|you're) (a )?human",
        "verify your browser",
        "checking (if the site connection is secure|your browser)",
        "security check",
        "attention required",
        "access denied",
        "access to this page has been denied",
        "pardon our interruption",
        "are you a robot",
        "robot check",
        "bot (verification|protection)",
        "captcha",
        "ddos[- ]guard",
        "request unsuccessful",
        "one moment, please",
        "please wait",
        "nicht gefunden",
        "page not found",
        "^not found$",
        // bare shop names (e.g. "Amazon.de") are what blocked pages show as title
        "^(www\\.)?amazon\\.[a-z.]+$"
    ].join("|"),
    "i"
);

export const isBlockedTitle = (title: string | null | undefined) => !!title && BLOCKED_TITLE.test(title.trim());

/** Title of an HTML document, if any */
export const htmlTitle = (html: string) => html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;

/** Challenge pages that are served with status 200 */
export const isChallengePage = (html: string) =>
    isBlockedTitle(htmlTitle(html)) ||
    /__shopify_bv_challenge|cf-chl-|challenge-platform|_Incapsula_Resource|px-captcha/i.test(html.slice(0, 20_000));

/** "https://www.amazon.de/Sony-WH-1000XM5-Kopfhörer/dp/B09XS7JWHH" -> "Sony WH 1000XM5 Kopfhörer" */
export const queryFromUrl = (url: URL | string): string | null => {
    let parsed: URL;
    try {
        parsed = typeof url === "string" ? new URL(url) : url;
    } catch {
        return null;
    }
    let path = parsed.pathname;
    try {
        path = decodeURIComponent(path);
    } catch {
        // keep encoded path
    }
    const segments = path
        .split("/")
        .filter((s) => /[a-zA-ZäöüÄÖÜ]{3,}/.test(s) && /[-_]/.test(s))
        .sort((a, b) => b.length - a.length);
    const query = segments[0]
        ?.replace(/\.html?$/, "")
        .replace(/[-_]+/g, " ")
        .trim();
    return query || null;
};

/** Readable name from the URL as a last resort: ".../products/flipper-zero" -> "Flipper Zero" */
export const nameFromUrl = (url: URL | string): string | null => {
    const query = queryFromUrl(url);
    if (!query) return null;
    return query
        .split(/\s+/)
        .map((w) => (/^[a-zäöü]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w))
        .join(" ");
};
