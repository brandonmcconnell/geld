import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "#/db";
import { createTestPlatform } from "#/platform/testing";
import { createTestDatabase } from "../testing/postgres";
import { connectionStatus } from "./connections";

const testPlatform = createTestPlatform({
  BETTER_AUTH_SECRET: "a-shared-secret-of-at-least-32-characters",
  GITHUB_OAUTH_CLIENT_ID: "client",
  GITHUB_OAUTH_CLIENT_SECRET: "secret",
});
const database: { current: Database | null } = { current: null };

vi.mock("#/platform", () => ({ platform: testPlatform.platform }));
vi.mock("../../db", () => ({
  getDb: () => {
    if (!database.current) {
      throw new Error("no test database");
    }
    return database.current;
  },
}));

let client: PGlite;

async function seedIdentity(providerId: string, accessToken: string) {
  const { sealToken } = await import("../account-tokens.server");
  await client.query(
    `INSERT INTO identities (id, "accountId", "providerId", "userId", "accessToken")
		 VALUES ($1, $2, $3, 'u1', $4)`,
    [
      `id-${providerId}`,
      `acct-${providerId}`,
      providerId,
      await sealToken(accessToken),
    ]
  );
}

function connection(
  connections: Awaited<ReturnType<typeof list>>,
  provider: string
) {
  const found = connections.find((entry) => entry.provider === provider);
  if (!found) {
    throw new Error(`no ${provider}`);
  }
  return found;
}

async function list() {
  const { listProviderConnections } = await import("./connections.server");
  return listProviderConnections("u1");
}

beforeEach(async () => {
  const test = await createTestDatabase();
  client = test.client;
  database.current = test.db;
  await client.exec(
    `INSERT INTO users (id, name, email, "emailVerified") VALUES ('u1', 'Ada', 'ada@example.com', true)`
  );
  testPlatform.config.GITLAB_CLIENT_ID = undefined;
  testPlatform.config.GITLAB_CLIENT_SECRET = undefined;
  testPlatform.config.BITBUCKET_CLIENT_ID = "id";
  testPlatform.config.BITBUCKET_CLIENT_SECRET = "secret";
});

function setUpGitLab() {
  testPlatform.config.GITLAB_CLIENT_ID = "id";
  testPlatform.config.GITLAB_CLIENT_SECRET = "secret";
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a Geld account's provider connections", () => {
  it("lists every provider, and offers only those this server is set up for", async () => {
    const connections = await list();

    expect(connections.map((entry) => entry.provider)).toEqual([
      "github",
      "gitlab",
      "bitbucket",
    ]);
    expect(connection(connections, "github")).toMatchObject({
      available: true,
      connected: false,
      reach: null,
    });
    expect(connection(connections, "gitlab").available).toBe(false);

    setUpGitLab();
    expect(connection(await list(), "gitlab").available).toBe(true);
  });

  it("reads GitLab with the identity the dashboard stores, decrypted", async () => {
    setUpGitLab();
    await seedIdentity("gitlab", "glpat-secret");
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        const headers = new Headers(
          input instanceof Request ? input.headers : init?.headers
        );
        expect(new URL(url).hostname).toBe("gitlab.com");
        expect(headers.get("authorization")).toBe("Bearer glpat-secret");
        return Response.json([]);
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const gitlab = connection(await list(), "gitlab");

    expect(fetchMock).toHaveBeenCalled();
    expect(gitlab.connected).toBe(true);
    expect(gitlab.reach).toEqual({
      status: "ok",
      repositories: 0,
      more: false,
    });
  });

  it("asks for a new connection when the provider refuses the token", async () => {
    await seedIdentity("bitbucket", "expired");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 401 }))
    );

    expect(connection(await list(), "bitbucket").reach).toEqual({
      status: "reconnect",
    });
  });

  it("says the provider is out of reach when it does not answer", async () => {
    setUpGitLab();
    await seedIdentity("gitlab", "glpat-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 }))
    );

    expect(connection(await list(), "gitlab").reach).toEqual({
      status: "unavailable",
    });
  });

  it("asks for a new connection when this server cannot use the identity", async () => {
    await seedIdentity("gitlab", "glpat-secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(connection(await list(), "gitlab").reach).toEqual({
      status: "reconnect",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives no client for a provider that is not connected", async () => {
    const { providerClientFor } = await import("./connections.server");
    expect(await providerClientFor("u1", "gitlab")).toBeNull();
  });
});

describe("connectionStatus", () => {
  const base = {
    provider: "gitlab",
    available: true,
    connected: true,
  } as const;

  it("counts what is in reach, singular and capped", () => {
    expect(
      connectionStatus({
        ...base,
        reach: { status: "ok", repositories: 1, more: false },
      }).text
    ).toBe("Connected · 1 repository in reach");
    expect(
      connectionStatus({
        ...base,
        reach: { status: "ok", repositories: 100, more: true },
      }).text
    ).toBe("Connected · 100+ repositories in reach");
  });

  it("tells an unconnected provider from one this server lacks", () => {
    expect(
      connectionStatus({ ...base, connected: false, reach: null }).text
    ).toBe("Not connected");
    expect(
      connectionStatus({
        ...base,
        available: false,
        connected: false,
        reach: null,
      }).text
    ).toBe("Not set up on this server");
  });

  it("does not ask to reconnect where this server cannot connect", () => {
    expect(
      connectionStatus({
        ...base,
        available: false,
        reach: { status: "reconnect" },
      }).text
    ).toBe("Connected to your Geld account · not set up on this server");
  });

  it("warns when access has lapsed", () => {
    expect(
      connectionStatus({ ...base, reach: { status: "reconnect" } })
    ).toEqual({
      text: "Access has lapsed. Connect again.",
      tone: "warn",
    });
  });
});
