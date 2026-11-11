import { describe, expect, it } from "vitest";
import type { MyPullsResult, PullSummary } from "../github.types";
import {
  bitbucketMyPulls,
  bitbucketPull,
  gitlabMyPulls,
  gitlabPull,
  withProviderPulls,
} from "./my-pulls";

const mergeRequest = {
  id: 9001,
  iid: 12,
  title: "Draft: Add rate limits",
  state: "opened",
  draft: true,
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-02T10:00:00Z",
  user_notes_count: 3,
  web_url: "https://gitlab.com/lumen/platform/api/-/merge_requests/12",
  author: {
    username: "ada",
    avatar_url: "https://gitlab.com/a.png",
    web_url: "https://gitlab.com/ada",
  },
  labels: ["backend", 7],
  source_branch: "limits",
  target_branch: "main",
};

const bitbucketRequest = {
  id: 4,
  title: "Fix the export",
  state: "OPEN",
  created_on: "2026-11-03T10:00:00Z",
  updated_on: "2026-11-04T10:00:00Z",
  comment_count: 1,
  links: {
    html: { href: "https://bitbucket.org/lumen/reports/pull-requests/4" },
  },
  author: { nickname: "ada", links: { avatar: { href: "https://b/a.png" } } },
  source: { branch: { name: "export" } },
  destination: {
    branch: { name: "main" },
    repository: { full_name: "lumen/reports" },
  },
};

describe("gitlabPull", () => {
  it("reads a merge request as a row that opens on GitLab", () => {
    expect(gitlabPull(mergeRequest)).toMatchObject({
      provider: "gitlab",
      number: 12,
      title: "Draft: Add rate limits",
      state: "open",
      isDraft: true,
      comments: 3,
      url: mergeRequest.web_url,
      author: { login: "ada" },
      labels: [{ name: "backend" }],
      repository: {
        owner: "lumen/platform",
        name: "api",
        fullName: "lumen/platform/api",
      },
      baseRefName: "main",
      headRefName: "limits",
    });
  });

  it("keeps its id apart from GitHub's", () => {
    expect(gitlabPull(mergeRequest)?.id).toBeLessThan(0);
  });

  it("passes over what is not a gitlab.com merge request", () => {
    expect(gitlabPull(null)).toBeNull();
    expect(gitlabPull({ ...mergeRequest, title: "" })).toBeNull();
    expect(
      gitlabPull({
        ...mergeRequest,
        web_url: "https://example.com/x/y/-/merge_requests/1",
      })
    ).toBeNull();
  });
});

describe("bitbucketPull", () => {
  it("reads a pull request as a row that opens on Bitbucket", () => {
    expect(bitbucketPull(bitbucketRequest)).toMatchObject({
      provider: "bitbucket",
      number: 4,
      state: "open",
      comments: 1,
      url: "https://bitbucket.org/lumen/reports/pull-requests/4",
      author: { login: "ada" },
      repository: { owner: "lumen", name: "reports" },
      baseRefName: "main",
      headRefName: "export",
    });
  });

  it("gives two repositories' pull request 4 different ids", () => {
    const other = bitbucketPull({
      ...bitbucketRequest,
      destination: { repository: { full_name: "lumen/billing" } },
    });
    expect(other?.id).not.toBe(bitbucketPull(bitbucketRequest)?.id);
  });

  it("passes over a pull request with no repository", () => {
    expect(bitbucketPull({ ...bitbucketRequest, destination: {} })).toBeNull();
  });
});

describe("gitlabMyPulls", () => {
  it("asks for the reader's authored, assigned and review-requested merge requests", async () => {
    const asked: string[] = [];
    const result = await gitlabMyPulls(async (path) => {
      asked.push(path);
      if (path === "user") return { username: "ada lovelace" };
      return path.includes("created_by_me") ? [mergeRequest] : [];
    });

    expect(result?.authored).toHaveLength(1);
    expect(result?.assigned).toEqual([]);
    expect(asked.some((path) => path.includes("scope=assigned_to_me"))).toBe(
      true
    );
    expect(
      asked.some((path) => path.includes("reviewer_username=ada%20lovelace"))
    ).toBe(true);
  });

  it("is unreachable when GitLab refuses any list, never half a reading", async () => {
    const result = await gitlabMyPulls(async (path) => {
      if (path === "user") return { username: "ada" };
      return path.includes("assigned_to_me") ? null : [mergeRequest];
    });
    expect(result).toBeNull();
  });

  it("is unreachable when GitLab does not say who the reader is", async () => {
    expect(await gitlabMyPulls(async () => null)).toBeNull();
  });
});

describe("bitbucketMyPulls", () => {
  it("lists what the reader opened", async () => {
    const asked: string[] = [];
    const result = await bitbucketMyPulls(async (path) => {
      asked.push(path);
      return path === "user"
        ? { uuid: "{u-1}" }
        : { values: [bitbucketRequest] };
    });

    expect(result?.authored).toHaveLength(1);
    expect(result?.reviewRequested).toEqual([]);
    expect(asked[1]).toBe("pullrequests/%7Bu-1%7D?state=OPEN&pagelen=50");
  });

  it("is unreachable when the list is refused", async () => {
    expect(
      await bitbucketMyPulls(async (path) =>
        path === "user" ? { uuid: "u" } : null
      )
    ).toBeNull();
  });
});

describe("withProviderPulls", () => {
  const github: PullSummary = {
    id: 1,
    number: 7,
    title: "On GitHub",
    state: "open",
    isDraft: false,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-03T00:00:00Z",
    closedAt: null,
    mergedAt: null,
    comments: 0,
    url: "https://github.com/lumen/app/pull/7",
    author: null,
    labels: [],
    repository: {
      name: "app",
      owner: "lumen",
      fullName: "lumen/app",
      url: "https://github.com/lumen/app",
      isPrivate: false,
    },
  };
  const base: MyPullsResult = {
    reviewRequested: [],
    assigned: [],
    authored: [github],
    mentioned: [github],
    involved: [],
  };

  it("lays other providers' rows in by last update, newest first", () => {
    const older = gitlabPull(mergeRequest);
    const newer = bitbucketPull(bitbucketRequest);
    if (!older || !newer) throw new Error("fixtures");
    const merged = withProviderPulls(base, [
      { authored: [older], assigned: [], reviewRequested: [] },
      { authored: [newer], assigned: [], reviewRequested: [] },
    ]);

    expect(merged.authored.map((pull) => pull.provider ?? "github")).toEqual([
      "bitbucket",
      "github",
      "gitlab",
    ]);
    expect(merged.mentioned).toEqual([github]);
  });

  it("returns GitHub's lists untouched with nothing to add", () => {
    expect(withProviderPulls(base, [])).toBe(base);
  });
});
