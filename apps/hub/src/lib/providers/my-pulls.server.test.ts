import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "#/db";
import { createTestPlatform } from "#/platform/testing";
import type { MyPullsResult } from "../github.types";
import { createTestDatabase } from "../testing/postgres";

const testPlatform = createTestPlatform({
  BETTER_AUTH_SECRET: "a-shared-secret-of-at-least-32-characters",
  GITHUB_OAUTH_CLIENT_ID: "client",
  GITHUB_OAUTH_CLIENT_SECRET: "secret",
  GITLAB_CLIENT_ID: "id",
  GITLAB_CLIENT_SECRET: "secret",
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

const empty: MyPullsResult = {
  reviewRequested: [],
  assigned: [],
  authored: [],
  mentioned: [],
  involved: [],
};

let client: Awaited<ReturnType<typeof createTestDatabase>>["client"];

beforeEach(async () => {
  const test = await createTestDatabase();
  database.current = test.db;
  client = test.client;
  await test.client.exec(
    `INSERT INTO users (id, name, email, "emailVerified") VALUES ('u1', 'Ada', 'ada@example.com', true)`
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("withConnectedProviderPulls", () => {
  it("asks no provider for a reader with GitHub alone", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { withConnectedProviderPulls } = await import("./my-pulls.server");

    expect(await withConnectedProviderPulls("u1", empty)).toBe(empty);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds a connected GitLab's merge requests", async () => {
    await connectGitLabInto(client);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith("/user")) return Response.json({ username: "ada" });
        return Response.json(
          url.includes("created_by_me")
            ? [
                {
                  id: 1,
                  title: "Add limits",
                  state: "opened",
                  created_at: "2026-11-01T10:00:00Z",
                  web_url: "https://gitlab.com/lumen/api/-/merge_requests/3",
                },
              ]
            : []
        );
      })
    );
    const { withConnectedProviderPulls } = await import("./my-pulls.server");

    const result = await withConnectedProviderPulls("u1", empty);

    expect(result.authored.map((pull) => pull.provider)).toEqual(["gitlab"]);
    expect(result.unreachableProviders).toBeUndefined();
  });

  it("names a provider that does not answer and still returns the lists", async () => {
    await connectGitLabInto(client);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 }))
    );
    const { withConnectedProviderPulls } = await import("./my-pulls.server");

    const result = await withConnectedProviderPulls("u1", empty);

    expect(result.authored).toEqual([]);
    expect(result.unreachableProviders).toEqual(["gitlab"]);
  });
});

async function connectGitLabInto(client: {
  query: (sql: string, params: unknown[]) => Promise<unknown>;
}) {
  const { sealToken } = await import("../account-tokens.server");
  await client.query(
    `INSERT INTO identities (id, "accountId", "providerId", "userId", "accessToken")
		 VALUES ('i1', 'a1', 'gitlab', 'u1', $1)`,
    [await sealToken("glpat-secret")]
  );
}
