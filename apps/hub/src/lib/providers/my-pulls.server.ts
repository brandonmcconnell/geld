import "@tanstack/react-start/server-only";
import type { MyPullsResult } from "../github.types";
import { connectedProviders, providerTokenFor } from "./connections.server";
import {
  bitbucketMyPulls,
  gitlabMyPulls,
  type ProviderGet,
  type ProviderPulls,
  withProviderPulls,
} from "./my-pulls";

const PROVIDER_TIMEOUT_MS = 8000;

const READERS = {
  gitlab: { base: "https://gitlab.com/api/v4/", read: gitlabMyPulls },
  bitbucket: { base: "https://api.bitbucket.org/2.0/", read: bitbucketMyPulls },
} as const;

type OtherProvider = keyof typeof READERS;

function getWith(base: string, token: string): ProviderGet {
  return async (path) => {
    const response = await fetch(`${base}${path}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    }).catch(() => null);
    return response?.ok ? response.json().catch(() => null) : null;
  };
}

async function readProvider(
  userId: string,
  provider: OtherProvider
): Promise<ProviderPulls | null> {
  const token = await providerTokenFor(userId, provider);
  if (!token) {
    return null;
  }
  const { base, read } = READERS[provider];
  return read(getWith(base, token)).catch(() => null);
}

/**
 * Adds the reader's GitLab and Bitbucket pull requests to GitHub's. A
 * provider that does not answer is named, never an error: the list is still
 * worth showing without it.
 */
export async function withConnectedProviderPulls(
  userId: string,
  result: MyPullsResult
): Promise<MyPullsResult> {
  const connected = await connectedProviders(userId).catch(() => []);
  const others = connected.flatMap((provider): OtherProvider[] =>
    provider === "gitlab" || provider === "bitbucket" ? [provider] : []
  );
  if (others.length === 0) {
    return result;
  }
  const read = await Promise.all(
    others.map(async (provider) => ({
      provider,
      pulls: await readProvider(userId, provider),
    }))
  );
  const unreachable = read.flatMap(({ provider, pulls }) =>
    pulls ? [] : [provider]
  );
  const merged = withProviderPulls(
    result,
    read.flatMap(({ pulls }) => (pulls ? [pulls] : []))
  );
  return unreachable.length > 0
    ? { ...merged, unreachableProviders: unreachable }
    : merged;
}
