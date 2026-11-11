import { describe, expect, it } from "vitest";
import type {
  PullComment,
  PullReviewComment,
  PullStatus,
} from "#/lib/github.types";
import {
  buildPullDigest,
  type DigestSource,
  digestInputFrom,
} from "./digest";

function actor(login: string) {
  return { login, avatarUrl: "", url: "", type: "User" };
}

function reviewComment(
  id: number,
  login: string,
  body: string,
  inReplyToId: number | null = null
): PullReviewComment {
  return {
    id,
    nodeId: `PRRC_${id}`,
    pullRequestReviewId: 1,
    body,
    path: "src/queue.ts",
    line: 12,
    startLine: null,
    side: "RIGHT",
    createdAt: `2026-11-0${Math.min(id, 9)}T10:00:00Z`,
    updatedAt: `2026-11-0${Math.min(id, 9)}T10:00:00Z`,
    author: actor(login),
    inReplyToId,
    diffHunk: "",
  };
}

function comment(id: number, login: string, body: string): PullComment {
  return {
    id,
    body,
    createdAt: "2026-11-01T09:00:00Z",
    author: actor(login),
  };
}

function source(overrides: Partial<DigestSource> = {}): DigestSource {
  return {
    owner: "acme",
    repo: "app",
    number: 7,
    title: "Retry the queue",
    headSha: "a".repeat(40),
    comments: [],
    reviewComments: [],
    threads: [],
    status: undefined,
    ...overrides,
  };
}

const NOW = new Date("2026-11-10T00:00:00Z");

describe("digestInputFrom", () => {
  it("groups review comments into threads with their resolved state", () => {
    const input = digestInputFrom(
      source({
        reviewComments: [
          reviewComment(2, "sam", "Agreed, fixing.", 1),
          reviewComment(1, "lena", "This drops the last retry."),
          reviewComment(3, "lena", "Rename this."),
        ],
        threads: [
          { threadId: "T1", isResolved: false, firstCommentId: 1 },
          { threadId: "T3", isResolved: true, firstCommentId: 3 },
        ],
      })
    );
    expect(input.threads).toHaveLength(2);
    const first = input.threads.find(
      (thread) => thread.comments[0]?.databaseId === 1
    );
    expect(first?.comments.map((entry) => entry.author)).toEqual([
      "lena",
      "sam",
    ]);
    expect(first?.isResolved).toBe(false);
    expect(
      input.threads.find((thread) => thread.comments[0]?.databaseId === 3)
        ?.isResolved
    ).toBe(true);
  });

  it("gives every check the head it ran on", () => {
    const status: PullStatus = {
      ...emptyStatus(),
      checkRuns: [
        {
          id: 1,
          name: "Cursor Bugbot",
          status: "completed",
          conclusion: "success",
          appAvatarUrl: null,
          outputTitle: null,
          startedAt: null,
          htmlUrl: null,
          required: false,
          workflowRunId: null,
        },
      ],
    };
    const input = digestInputFrom(source({ status }));
    expect(input.checks[0]?.sha).toBe("a".repeat(40));
  });
});

function emptyStatus(): PullStatus {
  return {
    reviews: [],
    checks: {
      total: 0,
      passed: 0,
      failed: 0,
      pending: 0,
      skipped: 0,
      expected: 0,
    },
    checkRuns: [],
    pendingWorkflowApprovals: [],
    mergeable: null,
    mergeableState: null,
    conflictingFiles: [],
    behindBy: null,
    baseRefName: "main",
    canUpdateBranch: false,
    canBypassProtections: false,
    canMerge: false,
  };
}

describe("buildPullDigest", () => {
  it("counts threads and splits open from settled", () => {
    const digest = buildPullDigest(
      source({
        reviewComments: [
          reviewComment(1, "lena", "This drops the last retry."),
          reviewComment(3, "lena", "Rename this."),
        ],
        threads: [
          { threadId: "T1", isResolved: false, firstCommentId: 1 },
          { threadId: "T3", isResolved: true, firstCommentId: 3 },
        ],
      }),
      NOW
    );
    expect(digest.threads).toEqual({ total: 2, open: 1 });
    expect(digest.open).toHaveLength(1);
    expect(digest.settled).toHaveLength(1);
    expect(digest.open[0]?.path).toBe("src/queue.ts");
  });

  it("reads a review bot's verdict from its threads", () => {
    const digest = buildPullDigest(
      source({
        reviewComments: [
          reviewComment(
            1,
            "cursor[bot]",
            "### Retry counter never resets\n\n**High Severity**\n\nThe counter keeps its value."
          ),
        ],
        threads: [{ threadId: "T1", isResolved: false, firstCommentId: 1 }],
      }),
      NOW
    );
    expect(digest.bots).toHaveLength(1);
    expect(digest.bots[0]?.name).toBe("Bugbot");
    expect(digest.bots[0]?.tone).not.toBe("good");
  });

  it("is empty for a pull request nobody reviewed", () => {
    const digest = buildPullDigest(
      source({ comments: [comment(1, "sam", "Thanks for this.")] }),
      NOW
    );
    expect(digest.threads.total).toBe(0);
    expect(digest.bots).toEqual([]);
  });
});
