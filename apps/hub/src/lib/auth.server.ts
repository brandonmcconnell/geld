import "@tanstack/react-start/server-only";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  type GenericOAuthConfig,
  genericOAuth,
} from "better-auth/plugins/generic-oauth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { getDb } from "../db";
import { account, rateLimit, session, user, verification } from "../db/schema";
import {
  GITHUB_OAUTH_PROVIDER_ID,
  getGitHubOAuthConfig,
} from "./github-app.server";
import { platform } from "#/platform";
import { getGitHubEmulatorUrl } from "./github-emulator.server";

const GITHUB_OAUTH_SCOPES = ["read:user", "repo", "read:org", "user:email"];

type GitHubProfile = {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
};

type GitHubEmail = { email: string; primary: boolean; verified: boolean };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...value }
    : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseGitHubProfile(value: unknown): GitHubProfile | null {
  const record = asRecord(value);
  if (
    !record ||
    typeof record.id !== "number" ||
    typeof record.login !== "string"
  ) {
    return null;
  }
  return {
    id: record.id,
    login: record.login,
    name: nullableString(record.name),
    email: nullableString(record.email),
    avatar_url: nullableString(record.avatar_url) ?? "",
  };
}

function parseGitHubEmails(value: unknown): GitHubEmail[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item: unknown) => {
    const record = asRecord(item);
    if (!record || typeof record.email !== "string") {
      return [];
    }
    return [
      {
        email: record.email,
        primary: record.primary === true,
        verified: record.verified === true,
      },
    ];
  });
}

/**
 * Sign-in is the dashboard's `github-oauth` grant: one authorization gives the
 * Geld session and the token the hub reads GitHub with. It is a generic OAuth
 * provider so demo mode can point the same flow at the emulator.
 */
function githubOAuthProvider(
  origins: { web: string; api: string },
  credentials: { clientId: string; clientSecret: string }
): GenericOAuthConfig {
  const githubFetch = async (
    path: string,
    accessToken: string
  ): Promise<unknown> => {
    const response = await fetch(`${origins.api}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "geld-hub",
      },
    });
    return response.ok ? response.json() : null;
  };

  return {
    providerId: GITHUB_OAUTH_PROVIDER_ID,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    authorizationUrl: `${origins.web}/login/oauth/authorize`,
    tokenUrl: `${origins.web}/login/oauth/access_token`,
    authentication: "post",
    scopes: GITHUB_OAUTH_SCOPES,
    async getUserInfo(tokens) {
      const accessToken = tokens.accessToken;
      if (!accessToken) {
        return null;
      }
      const profile = parseGitHubProfile(
        await githubFetch("/user", accessToken)
      );
      if (!profile) {
        return null;
      }
      // An account is matched to a Geld user by email, so only an
      // address GitHub has verified may stand for one.
      const verified = parseGitHubEmails(
        await githubFetch("/user/emails", accessToken)
      ).filter((entry) => entry.verified);
      const email = (verified.find((entry) => entry.primary) ?? verified[0])
        ?.email;
      if (!email) {
        return null;
      }
      return {
        id: String(profile.id),
        name: profile.name || profile.login,
        email,
        image: profile.avatar_url,
        emailVerified: true,
      };
    },
  };
}

type BitbucketEmail = { email: string; primary: boolean; confirmed: boolean };

function parseBitbucketEmails(value: unknown): BitbucketEmail[] {
  const values = asRecord(value)?.values;
  if (!Array.isArray(values)) {
    return [];
  }
  return values.flatMap((item: unknown) => {
    const record = asRecord(item);
    if (!record || typeof record.email !== "string") {
      return [];
    }
    return [
      {
        email: record.email,
        primary: record.is_primary === true,
        confirmed: record.is_confirmed === true,
      },
    ];
  });
}

/** The dashboard's `bitbucket` identity: same endpoints, scopes and subject. */
function bitbucketProvider(credentials: {
  clientId: string;
  clientSecret: string;
}): GenericOAuthConfig {
  const bitbucketFetch = async (
    path: string,
    accessToken: string
  ): Promise<unknown> => {
    const response = await fetch(`https://api.bitbucket.org/2.0/${path}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return response.ok ? response.json() : null;
  };

  return {
    providerId: "bitbucket",
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    authorizationUrl: "https://bitbucket.org/site/oauth2/authorize",
    tokenUrl: "https://bitbucket.org/site/oauth2/access_token",
    authentication: "basic",
    pkce: false,
    scopes: ["account", "email", "repository", "pullrequest:write"],
    async getUserInfo(tokens) {
      const accessToken = tokens.accessToken;
      if (!accessToken) {
        return null;
      }
      const profile = asRecord(await bitbucketFetch("user", accessToken));
      const uuid = nullableString(profile?.uuid);
      if (!profile || !uuid) {
        return null;
      }
      const confirmed = parseBitbucketEmails(
        await bitbucketFetch("user/emails", accessToken)
      ).filter((entry) => entry.confirmed);
      const email = (confirmed.find((entry) => entry.primary) ?? confirmed[0])
        ?.email;
      if (!email) {
        return null;
      }
      return {
        id: uuid,
        name: nullableString(profile.display_name) ?? uuid,
        email,
        image:
          nullableString(asRecord(asRecord(profile.links)?.avatar)?.href) ??
          undefined,
        emailVerified: true,
      };
    },
  };
}

function pair(clientId: string | undefined, clientSecret: string | undefined) {
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

const GELD_COOKIE_DOMAIN = ".geld.sh";
const GELD_ORIGINS = ["https://app.geld.sh", "https://www.geld.sh"];

/**
 * The options every Geld app that shares the account tables must agree on:
 * table names, the cookie and how tokens are stored. They mirror
 * `apps/dashboard/lib/auth.ts`, and a session made by either app is read by
 * the other only while they match and both use the same `BETTER_AUTH_SECRET`.
 */
export function sharedAccountOptions(baseURL: string) {
  const shareCookie = new URL(baseURL).hostname.endsWith(GELD_COOKIE_DOMAIN);
  return {
    appName: "Geld",
    trustedOrigins: shareCookie ? [baseURL, ...GELD_ORIGINS] : [baseURL],
    user: { modelName: "users" },
    session: { modelName: "sessions", cookieCache: { enabled: false } },
    account: {
      modelName: "identities",
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        allowDifferentEmails: false,
        trustedProviders: [],
      },
    },
    verification: { modelName: "verifications" },
    advanced: {
      cookiePrefix: "geld",
      ipAddress: { disableIpTracking: true },
      crossSubDomainCookies: shareCookie
        ? { enabled: true, domain: GELD_COOKIE_DOMAIN }
        : { enabled: false },
    },
    rateLimit: { enabled: true, storage: "database" },
  } satisfies Partial<BetterAuthOptions>;
}

export function getAuth() {
  const github = getGitHubOAuthConfig();
  const emulatorUrl = getGitHubEmulatorUrl();
  const config = platform.config();
  const gitlab = pair(config.GITLAB_CLIENT_ID, config.GITLAB_CLIENT_SECRET);
  const bitbucket = pair(
    config.BITBUCKET_CLIENT_ID,
    config.BITBUCKET_CLIENT_SECRET
  );

  return betterAuth({
    ...sharedAccountOptions(config.BETTER_AUTH_URL),
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        users: user,
        sessions: session,
        identities: account,
        verifications: verification,
        rateLimit,
      },
    }),
    databaseHooks: {
      session: {
        create: {
          before: async (created) => ({
            data: { ...created, ipAddress: null, userAgent: null },
          }),
        },
      },
    },
    // GitLab is read with `api`, as the dashboard asks for it. No `openid`:
    // an id token would have to be encrypted the dashboard's way first.
    ...(gitlab
      ? {
          socialProviders: {
            gitlab: { ...gitlab, scope: ["read_user", "api"] },
          },
        }
      : {}),
    plugins: [
      genericOAuth({
        config: [
          githubOAuthProvider(
            emulatorUrl
              ? { web: emulatorUrl, api: emulatorUrl }
              : { web: "https://github.com", api: "https://api.github.com" },
            github
          ),
          ...(bitbucket ? [bitbucketProvider(bitbucket)] : []),
        ],
      }),
      tanstackStartCookies(),
    ],
  });
}
