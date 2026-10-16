# Common Review Format (CRF)

**Status: draft v0.** Lives in the Geld repository for now (`@geld/crf`) and will move to its own repository and npm package once the shape settles (`common-review-format` is free on npm and as a GitHub organisation; the bare `crf` package name is taken).

CRF is a small, versioned JSON block that a code review bot hides in each comment it posts on a pull request. People see the bot's comment exactly as before. Tools see a machine-readable account of the review: which commit was reviewed, whether the run is still going, what it found, why it refused, and how to view or rerun it.

```html
Found 2 issues in this pull request. …the bot's usual comment…

<!-- crf:v0 {"schema":"crf/v0","bot":{"name":"Greptile","app":"greptile-apps"},"kind":"summary","run":{"id":"rv_8f2c","state":"completed","headSha":"4b1e9d0c7a2f1e3d5c6b7a8f9e0d1c2b3a4f5e6d"},"result":{"verdict":"findings","counts":{"medium":1,"low":1}}} -->
```

## Why

Every review bot writes its verdict in its own words. A tool that wants to show "Greptile: 4/5, 2 findings · Bugbot: skipped, usage limit · CodeRabbit: still running" has to parse each bot's prose and keep up as it changes: "Actionable comments posted: 0" means clean for one bot, a "Findings" heading means findings for another, a status line edited in place means a run finished for a third. Geld does this today for ten bots, with regular expressions and a decision model as a fallback, and it breaks whenever a bot rewords a sentence.

Most bots already hide metadata in their comments for their own use (see [Prior art](#prior-art)). CRF asks them to hide one more thing, in a shape every tool can read.

## Where the block goes

One HTML comment, normally at the end of the bot's comment, on a line of its own:

```html
<!-- crf:v0 {…JSON…} -->
```

- **Invisible to readers.** GitHub strips HTML comments from the rendered page, so nobody sees it and no bot has to change its UI.
- **Kept in the raw source.** The comment's raw Markdown still holds it. Tools read it from the API (`body` on issue comments, review comments and reviews) or, on github.com, from the comment's own "Copy Markdown" menu item, whose `value` attribute is the raw body (present on every comment kind, verified signed out on the classic conversation page in Oct 2026).
- **Escaped so it cannot end early.** Writers escape `<` and `>` inside the JSON as `\u003c` and `\u003e`. That is still the same JSON, and it means a `-->` inside a finding's title cannot close the HTML comment. `encodeBlock` does this.

The marker follows the convention bots already use for their own markers (`codex-review-state:v1 {…}`): a name, a version, then JSON.

## Block kinds

Every comment a bot posts on a pull request carries exactly one block. `kind` says what the comment is.

| `kind` | The comment is… | Carries |
|---|---|---|
| `summary` | The run's report: the walkthrough, the verdict, the score | `run`, and `result` once the run has completed |
| `status` | A progress note: "Reviewing…", "Currently processing new changes" | `run` with `state: "queued"` or `"running"` |
| `refusal` | The bot declining to run: disabled, out of quota, no access | `run` with `state: "refused"`, and `refusal` |
| `finding` | A review thread comment on a line of code | `run.id` and the `finding` |
| `reply` | Conversation: answering a question, narrating its own work | Nothing more. It makes no claim about the review |

A comment with no block makes no claim either, so a reader never mistakes chatter for a verdict.

### Findings and threads

A finding has one shape, used in two places:

- in the summary's `result.findings[]`, the high-level list, and
- in the `finding` block on the thread comment where the bot raised it.

The two are linked by `finding.id`, and by `finding.commentId` on the summary side once the bot knows the thread comment's id. Bots that post threads before their summary and bots that post them after are both covered. A finding has one `location`, matching the line or range its thread is anchored to, and optional `related` locations for "this also affects…".

### Links

Links are actions a reader can take, and each is either a URL to open or a comment to post:

```json
{ "type": "url", "url": "https://…", "label": "View in Greptile" }
{ "type": "comment", "body": "@greptileai", "label": "Rerun" }
```

| Link | Meaning | Kinds |
|---|---|---|
| `view` | The run, or a finding, on the bot's own site | URL |
| `rerun` | Run the review again: a trigger comment, or a URL that reruns directly or leads to a button that does | URL or comment |
| `fix` | Have the bot or an agent fix it: "Fix in Cursor", an autofix command | URL or comment |
| `settings` | Where the bot's setup is fixed: what a refusal points to | URL |

Blocks carry `links`, and each finding can carry its own `view` and `fix`.

## Fields

Required unless marked optional. Unknown fields are ignored by readers, so a bot may add its own.

### Block (every kind)

| Field | Type | |
|---|---|---|
| `schema` | `"crf/v0"` | Required |
| `kind` | `summary` · `status` · `refusal` · `finding` · `reply` | Required |
| `bot.name` | string | Required. The product's name: "Greptile", "Bugbot" |
| `bot.app` | string | Optional. The GitHub App's slug |
| `bot.version` | string | Optional |
| `links` | `Links` | Optional |

### `run`

Required on `summary`, `status` and `refusal`. A `finding` carries `{ id }` alone, and a `reply` may.

| Field | Type | |
|---|---|---|
| `id` | string | Required. Stable for the run, the same on every comment the run posts |
| `state` | `queued` · `running` · `completed` · `superseded` · `refused` · `failed` · `cancelled` | Required. `superseded`: a newer commit made this run's result stale |
| `headSha` | 40-character SHA | Required. The commit that was reviewed |
| `sequence` | positive integer | Optional. Goes up each time the comment is edited in place, so a reader can tell a rewrite from the original |
| `track` | `code` · `security` | Optional. For bots that run separate reviews of each |
| `baseSha` | SHA | Optional |
| `scope` | `full` · `incremental` | Optional. `incremental`: only what changed since the bot's last run |
| `coverage` | `{ from?: SHA, to: SHA }` | Optional. The commits an incremental run covered |
| `part` | `{ index, total }` | Optional. For a review published across several comments |
| `startedAt`, `completedAt` | ISO 8601 date-time | Optional |
| `trigger` | `{ type, commentId?, by? }` | Optional. `type`: `push` · `comment` · `check` · `schedule` · `manual` · `api` |

### `result` (on a `summary`, expected once `run.state` is `completed`)

| Field | Type | |
|---|---|---|
| `verdict` | `clean` · `findings` | Required |
| `score` | `{ value, max }` | Optional. "Confidence 4/5" is `{ "value": 4, "max": 5 }` |
| `risk` | `minimal` · `low` · `moderate` · `high` | Optional. A merge-risk label, separate from the findings |
| `counts` | `{ critical?, high?, medium?, low?, info? }` | Optional. Stays right when `findings` is cut short |
| `findings` | `Finding[]` | Optional |
| `truncated` | boolean | Optional. `findings` lists only some of them |
| `resolvedSinceLast` | integer | Optional. Findings from the previous run now fixed |
| `previouslyMissed` | integer | Optional. Findings an earlier run should have raised |
| `gate` | `{ blocking, threshold? }` | Optional. Whether the bot is holding the merge, and from which severity |
| `recommendation` | `approve` · `comment` · `request_changes` | Optional. What the bot would submit as a GitHub review |

### `Finding`

| Field | Type | |
|---|---|---|
| `id` | string | Required. The same in the summary and on the thread |
| `title` | string | Required. One line, inline Markdown allowed |
| `severity` | `critical` · `high` · `medium` · `low` · `info` | Required. The shared scale |
| `fingerprint` | string | Optional. Stable across runs, so a repeat finding is recognised |
| `location` | `{ path, line?, startLine?, side? }` | Optional. The thread's anchor. No `line` means a file-level comment |
| `related` | `Location[]` | Optional. Other places the finding involves |
| `category` | string | Optional. `bug`, `security`, `performance`, `style`, `test`, `docs`… |
| `vendorSeverity` | string | Optional. The bot's own label: "P1", "Major" |
| `confidence` | number, 0 to 1 | Optional |
| `state` | `new` · `persisting` · `fixed` · `withdrawn` | Optional. Compared with the bot's previous run. Resolving a thread is GitHub's, not the bot's |
| `rule` | `{ source: repo · bot, id?, path? }` | Optional. Whether it came from the repository's own rules |
| `commentId` | integer | Optional. The thread comment's id |
| `links` | `{ view?, fix? }` | Optional |

### `refusal`

| Field | Type | |
|---|---|---|
| `code` | `disabled` · `not_installed` · `quota` · `billing` · `permissions` · `too_large` · `skipped_by_config` · `other` | Required |
| `message` | string | Required. The bot's own words |
| `retryable` | boolean | Optional. Whether asking again could work without changing anything |

## Examples

A summary:

```json
{
  "schema": "crf/v0",
  "bot": { "name": "Greptile", "app": "greptile-apps" },
  "kind": "summary",
  "run": {
    "id": "rv_8f2c",
    "state": "completed",
    "headSha": "4b1e9d0c7a2f1e3d5c6b7a8f9e0d1c2b3a4f5e6d",
    "sequence": 3,
    "startedAt": "2026-10-16T07:20:11Z",
    "completedAt": "2026-10-16T07:24:40Z",
    "trigger": { "type": "comment", "commentId": 2410000000, "by": "branmcconnell" }
  },
  "result": {
    "verdict": "findings",
    "score": { "value": 4, "max": 5 },
    "counts": { "medium": 1, "low": 1 },
    "findings": [
      {
        "id": "f1",
        "title": "Missing null check before `user.id`",
        "severity": "medium",
        "category": "bug",
        "location": { "path": "src/auth.ts", "line": 42, "side": "RIGHT" },
        "commentId": 2410000123
      },
      { "id": "f2", "title": "Unused import", "severity": "low", "location": { "path": "src/util.ts", "line": 3 } }
    ]
  },
  "links": {
    "view": { "type": "url", "url": "https://app.greptile.com/review/123" },
    "rerun": { "type": "comment", "body": "@greptileai" }
  }
}
```

The same finding on its thread comment:

```json
{
  "schema": "crf/v0",
  "bot": { "name": "Greptile", "app": "greptile-apps" },
  "kind": "finding",
  "run": { "id": "rv_8f2c" },
  "finding": {
    "id": "f1",
    "title": "Missing null check before `user.id`",
    "severity": "medium",
    "location": { "path": "src/auth.ts", "line": 42, "side": "RIGHT" }
  }
}
```

A status line, then a refusal:

```json
{
  "schema": "crf/v0",
  "bot": { "name": "CodeRabbit", "app": "coderabbitai" },
  "kind": "status",
  "run": { "id": "rv_91aa", "state": "running", "headSha": "4b1e9d0c7a2f1e3d5c6b7a8f9e0d1c2b3a4f5e6d", "scope": "incremental" }
}
```

```json
{
  "schema": "crf/v0",
  "bot": { "name": "Bugbot", "app": "cursor" },
  "kind": "refusal",
  "run": { "id": "rv_77d0", "state": "refused", "headSha": "4b1e9d0c7a2f1e3d5c6b7a8f9e0d1c2b3a4f5e6d" },
  "refusal": { "code": "quota", "message": "Usage limit reached", "retryable": false },
  "links": { "settings": { "type": "url", "url": "https://cursor.com/dashboard" } }
}
```

## Rules

1. **One block per comment.** If a comment holds several, readers use the last.
2. **Every comment a bot posts on a pull request carries a block**, including status lines and refusals.
3. **Editing a comment in place updates its block** and bumps `run.sequence`. A new run gets a new `run.id`. A status comment later rewritten into the summary changes `kind` from `status` to `summary`.
4. **Readers ignore fields they do not know.** Bots may add their own, ideally under one key named for themselves.
5. **A block that fails validation makes no claim.** Readers fall back to whatever they did before.
6. **Keep it small.** GitHub limits a comment's size, and the block shares that room with the bot's own text. List at most about 50 findings in a summary, set `truncated`, and keep `counts` whole.
7. **Versions:** additions that old readers can ignore stay in `v0` while it is a draft. A change that would make an old reader misread a block gets a new version (`crf:v1`, `"schema": "crf/v1"`).

## Validating

The schema is written in [Zod](https://zod.dev) and published three ways.

**TypeScript and Zod:**

```ts
import { CrfBlock, encodeBlock, parseBlock } from '@geld/crf';

const block: CrfBlock = CrfBlock.parse(json);
const html = encodeBlock(block); // '<!-- crf:v0 {…} -->'
const read = parseBlock(commentBody); // CrfBlock | undefined
```

**Any [Standard Schema](https://standardschema.dev) library.** `CrfBlock` is itself a Standard Schema, and the readers take any Standard Schema, so a team using Valibot, ArkType or their own validator plugs straight in:

```ts
import { readBlock, checkConformance } from '@geld/crf';

const block = await readBlock(commentBody, myValibotSchema);
const mismatches = await checkConformance(myValibotSchema); // [] means it accepts and rejects what the spec does
```

`checkConformance` runs the spec's fixtures (`FIXTURES`: valid and invalid blocks for every kind) through the schema it is given and names every fixture it disagrees with.

**JSON Schema**, for bots written in Python, Go or anything else: [`schema/crf-v0.schema.json`](./schema/crf-v0.schema.json) (draft 2020-12), also exported as `@geld/crf/schema.json`. It is generated from the Zod schema (`pnpm --filter @geld/crf schema`) and a test fails when it is out of date. Its objects stay open, like the readers.

## Prior art

A survey of five recent public pull requests per bot (Oct 2026) found most review bots already hiding metadata in HTML comments. It is what shaped the optional fields above.

| Bot | Hidden in its comments | Became |
|---|---|---|
| Codex | `codex-review-state:v1 {"code_review":{"commit_sha","has_any_findings","has_unresolved_findings","status"},"security_review":{…}}`, `codex-security-review:v1 {"blockingSeverityThreshold":"P0","mergeGateEnabled",…}` | The marker's shape, `run.track`, `result.gate` |
| Devin | `devin-review-comment {"id","file_path","start_line","end_line","side","based_on_repo_rules","kind"}` on every thread | The `finding` block, `finding.rule` |
| Bugbot | `BUGBOT_BUG_ID`, `LOCATIONS START … LOCATIONS END`, `BUGBOT_REVIEW_STALE`, fix-in-Cursor links per finding and for all | `finding.id`, `related`, `superseded`, `links.fix` |
| CodeRabbit | `cr-indicator-types:potential_issue`, `fingerprinting:…`, `final_review_risk_coverage {"sourceCommitId","coveredCommitId"}`, a merge-risk label, `coderabbit-review-publication v1 … batch=1/1`, `review_comment_withdrawn` | `category`, `fingerprint`, `coverage`, `risk`, `part`, `withdrawn` |
| Greptile | `greptile_summary`, `greptile_confidence_score:5` | `score` |
| Copilot | `ccr-overview-v2`, with "N open findings · N resolved since last review · Previously missed" in the visible text | `resolvedSinceLast`, `previouslyMissed` |
| Replicas | `replicas:automation-run:<uuid>` | `run.id` |
| Capy | `capy-badge:start` / `capy-badge:end` around its badge | |
| Gemini, Claude | Nothing found | |

## Package contents

| Export | |
|---|---|
| `CrfBlock` and every part (`Finding`, `Run`, `Result`, `Links`…) | Zod schemas, each with its inferred TypeScript type of the same name |
| `encodeBlock(block)` | The HTML comment to append, validated and escaped |
| `extractBlocks(markdown)` | Every CRF block in a comment, JSON-parsed, any version |
| `parseBlock(markdown)` | The comment's block, validated, or `undefined` |
| `readBlock(markdown, schema)` | The same through any Standard Schema |
| `FIXTURES`, `checkConformance(schema)` | The conformance suite |
| `crfJsonSchema()`, `@geld/crf/schema.json` | JSON Schema |
