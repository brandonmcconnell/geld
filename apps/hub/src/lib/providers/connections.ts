import type { Provider } from "@geld/domain";

/** The Git providers a Geld account can carry, in the order they are listed. */
export const CONNECTABLE_PROVIDERS = [
  "github",
  "gitlab",
  "bitbucket",
] as const satisfies readonly Provider[];

export type ConnectableProvider = (typeof CONNECTABLE_PROVIDERS)[number];

export const PROVIDER_NAMES: Record<ConnectableProvider, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
};

/**
 * Identities (`identities.providerId`) that give API access to a provider,
 * best first. They are the dashboard's ids, so a connection made in either
 * app is one connection.
 */
export const PROVIDER_IDENTITIES: Record<
  ConnectableProvider,
  readonly string[]
> = {
  github: ["github-repository", "github-oauth"],
  gitlab: ["gitlab"],
  bitbucket: ["bitbucket"],
};

/** The identity a new connection is made with. */
export const CONNECT_IDENTITY: Record<ConnectableProvider, string> = {
  github: "github-oauth",
  gitlab: "gitlab",
  bitbucket: "bitbucket",
};

export type ProviderReach =
  | { status: "ok"; repositories: number; more: boolean }
  | { status: "reconnect" }
  | { status: "unavailable" }
  /** GitHub in demo mode, where the provider is the local emulator. */
  | { status: "unchecked" };

export type ProviderConnection = {
  provider: ConnectableProvider;
  /** Whether this server has the provider's OAuth app. */
  available: boolean;
  connected: boolean;
  reach: ProviderReach | null;
};

export function isConnectableProvider(
  value: unknown
): value is ConnectableProvider {
  return CONNECTABLE_PROVIDERS.some((provider) => provider === value);
}

/** What a connection row says under the provider's name. */
export function connectionStatus(connection: ProviderConnection): {
  text: string;
  tone: "good" | "warn" | "muted";
} {
  if (!connection.connected) {
    return connection.available
      ? { text: "Not connected", tone: "muted" }
      : { text: "Not set up on this server", tone: "muted" };
  }
  const reach = connection.reach;
  if (!connection.available && reach?.status === "reconnect") {
    return {
      text: "Connected to your Geld account · not set up on this server",
      tone: "muted",
    };
  }
  switch (reach?.status) {
    case "ok": {
      const count = `${reach.repositories}${reach.more ? "+" : ""}`;
      const noun =
        reach.repositories === 1 && !reach.more ? "repository" : "repositories";
      return { text: `Connected · ${count} ${noun} in reach`, tone: "good" };
    }
    case "reconnect":
      return { text: "Access has lapsed. Connect again.", tone: "warn" };
    case "unavailable":
      return {
        text: `Connected · ${PROVIDER_NAMES[connection.provider]} could not be reached just now`,
        tone: "warn",
      };
    default:
      return { text: "Connected", tone: "good" };
  }
}
