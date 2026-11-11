import "@tanstack/react-start/server-only";
import type { ProviderClient } from "@geld/domain";
import type { TokenAccess, TokenSource } from "@geld/github";
import { createProviderClient } from "@geld/providers";
import { and, eq, inArray } from "drizzle-orm";
import { platform } from "#/platform";
import { getDb } from "../../db";
import { account } from "../../db/schema";
import { getAuth } from "../auth.server";
import { getGitHubEmulatorUrl } from "../github-emulator.server";
import {
  CONNECTABLE_PROVIDERS,
  type ConnectableProvider,
  PROVIDER_IDENTITIES,
  type ProviderConnection,
  type ProviderReach,
} from "./connections";

function isAvailable(provider: ConnectableProvider) {
  const config = platform.config();
  switch (provider) {
    case "github":
      return true;
    case "gitlab":
      return Boolean(config.GITLAB_CLIENT_ID && config.GITLAB_CLIENT_SECRET);
    case "bitbucket":
      return Boolean(
        config.BITBUCKET_CLIENT_ID && config.BITBUCKET_CLIENT_SECRET
      );
  }
}

async function identitiesOf(userId: string) {
  const ids = CONNECTABLE_PROVIDERS.flatMap(
    (provider) => PROVIDER_IDENTITIES[provider]
  );
  return getDb()
    .select({ id: account.id, providerId: account.providerId })
    .from(account)
    .where(and(eq(account.userId, userId), inArray(account.providerId, ids)));
}

function bestIdentity(
  provider: ConnectableProvider,
  identities: ReadonlyArray<{ id: string; providerId: string }>
) {
  for (const providerId of PROVIDER_IDENTITIES[provider]) {
    const match = identities.find((row) => row.providerId === providerId);
    if (match) {
      return match;
    }
  }
  return null;
}

/**
 * A token for one identity, read through Better Auth so it is decrypted and,
 * when it has expired, refreshed and stored again exactly as the dashboard
 * would do it.
 */
function identityTokenSource(userId: string, accountId: string): TokenSource {
  return {
    async get(): Promise<TokenAccess> {
      try {
        const result = await getAuth().api.getAccessToken({
          body: { accountId, userId },
        });
        return result?.accessToken
          ? { status: "ok", token: result.accessToken, refreshed: false }
          : { status: "signed-out", reason: "No token for this connection" };
      } catch {
        return {
          status: "signed-out",
          reason: "The connection's token could not be read or refreshed",
        };
      }
    },
  };
}

/** A token for one of a person's connections, or null without one that works. */
export async function providerTokenFor(
  userId: string,
  provider: ConnectableProvider
): Promise<string | null> {
  const identity = bestIdentity(provider, await identitiesOf(userId));
  if (!identity) {
    return null;
  }
  const access = await identityTokenSource(userId, identity.id).get();
  return access.status === "ok" ? access.token : null;
}

export async function connectedProviders(
  userId: string
): Promise<ConnectableProvider[]> {
  const identities = await identitiesOf(userId);
  return CONNECTABLE_PROVIDERS.filter(
    (provider) => bestIdentity(provider, identities) !== null
  );
}

/** The shared provider client for one of a person's connections, or null without one. */
export async function providerClientFor(
  userId: string,
  provider: ConnectableProvider
): Promise<ProviderClient | null> {
  const identity = bestIdentity(provider, await identitiesOf(userId));
  if (!identity) {
    return null;
  }
  return createProviderClient({
    provider,
    source: identityTokenSource(userId, identity.id),
  });
}

async function reachOf(
  userId: string,
  provider: ConnectableProvider
): Promise<ProviderReach> {
  if (provider === "github" && getGitHubEmulatorUrl()) {
    return { status: "unchecked" };
  }
  const client = await providerClientFor(userId, provider);
  if (!client) {
    return { status: "reconnect" };
  }
  const result = await client.repositories().catch(() => null);
  if (!result) {
    return { status: "unavailable" };
  }
  if (result.ok) {
    return {
      status: "ok",
      repositories: result.value.items.length,
      more: result.value.cursor !== null,
    };
  }
  return result.reason === "signed_out" || result.reason === "permission"
    ? { status: "reconnect" }
    : { status: "unavailable" };
}

export async function listProviderConnections(
  userId: string
): Promise<ProviderConnection[]> {
  const identities = await identitiesOf(userId);
  return Promise.all(
    CONNECTABLE_PROVIDERS.map(async (provider) => {
      const connected = bestIdentity(provider, identities) !== null;
      return {
        provider,
        available: isAvailable(provider),
        connected,
        reach: connected ? await reachOf(userId, provider) : null,
      };
    })
  );
}
