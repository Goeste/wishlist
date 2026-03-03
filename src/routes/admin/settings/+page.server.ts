import { Role } from "$lib/schema";
import { client } from "$lib/server/prisma";
import { getConfig, writeConfig } from "$lib/server/config";
import { fail, type Actions } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { sendTest } from "$lib/server/email";
import { settingSchema } from "$lib/server/validations";
import { z } from "zod";
import { requireRole } from "$lib/server/auth";
import { priceUpdateScheduler } from "$lib/server/scheduler";
import { updatePrices } from "$lib/server/price-updater";

export const load: PageServerLoad = async () => {
    await requireRole(Role.ADMIN);

    const config = await getConfig(undefined, true);

    const groups = await client.group.findMany({
        select: {
            id: true,
            name: true
        }
    });

    return {
        config,
        groups
    };
};

export const actions: Actions = {
    "send-test": async () => {
        const user = await requireRole(Role.ADMIN);

        const resp = await sendTest(user.email ?? "");
        return { action: "send-test", ...resp };
    },
    "update-prices": async () => {
        await requireRole(Role.ADMIN);

        const updated = await updatePrices();
        return { action: "update-prices", success: true, updated };
    },
    settings: async ({ request }) => {
        await requireRole(Role.ADMIN);

        const formData = Object.fromEntries(await request.formData());
        const configData = settingSchema.safeParse(formData);

        if (!configData.success) {
            return fail(400, { action: "settings", error: z.prettifyError(configData.error) });
        }

        const newConfig = generateConfig(configData.data);
        await writeConfig(newConfig);

        priceUpdateScheduler.restart();

        return { action: "settings", success: true };
    }
};

const generateConfig = (configData: z.infer<typeof settingSchema>): Config => {
    const smtpConfig: SMTPConfig = configData.enableSMTP
        ? {
              enable: true,
              host: configData.smtpHost!,
              port: configData.smtpPort!,
              user: configData.smtpUser,
              pass: configData.smtpPass,
              from: configData.smtpFrom!,
              fromName: configData.smtpFromName!
          }
        : {
              enable: false,
              host: configData.smtpHost,
              port: configData.smtpPort,
              user: configData.smtpUser,
              pass: configData.smtpPass,
              from: configData.smtpFrom,
              fromName: configData.smtpFromName
          };

    const oidcConfig: OIDCConfig = configData.enableOIDC
        ? {
              enable: true,
              discoveryUrl: configData.oidcDiscoveryUrl!,
              clientId: configData.oidcClientId!,
              clientSecret: configData.oidcClientSecret!,
              providerName: configData.oidcProviderName,
              autoRedirect: configData.oidcAutoRedirect,
              autoRegister: configData.oidcAutoRegister,
              enableSync: configData.oidcEnableSync,
              disableEmailVerification: configData.oidcDisableEmailVerification
          }
        : {
              enable: false,
              discoveryUrl: configData.oidcDiscoveryUrl,
              clientId: configData.oidcClientId,
              clientSecret: configData.oidcClientSecret,
              providerName: configData.oidcProviderName,
              autoRedirect: configData.oidcAutoRedirect,
              autoRegister: configData.oidcAutoRegister,
              enableSync: configData.oidcEnableSync,
              disableEmailVerification: configData.oidcDisableEmailVerification
          };

    const priceUpdateConfig: PriceUpdateConfig = {
        enable: configData.enablePriceUpdate,
        intervalHours: configData.priceUpdateIntervalHours,
        scheduledTime: configData.priceUpdateScheduledTime ?? null
    };

    return {
        enableSignup: configData.enableSignup,
        suggestions: {
            enable: configData.enableSuggestions,
            method: configData.suggestionMethod
        },
        smtp: smtpConfig,
        claims: {
            showName: configData.claimsShowName,
            showNameAcrossGroups: configData.claimsShowNameAcrossGroups,
            showForOwner: configData.claimsShowForOwner,
            requireEmail: configData.claimsRequireEmail
        },
        listMode: "standard",
        security: {
            passwordStrength: configData.passwordStrength,
            disablePasswordLogin: configData.disablePasswordLogin
        },
        defaultGroup: configData.defaultGroup,
        enableDefaultListCreation: configData.enableDefaultListCreation,
        allowPublicLists: configData.allowPublicLists,
        oidc: oidcConfig,
        priceUpdate: priceUpdateConfig
    };
};
