# @geld/action

GitHub Action that maintains **one** Geld review-summary comment on a pull request.

It reads review threads, issue comments, reviews and checks through the GitHub API, clusters them with `@geld/review`, and upserts a markdown comment. The structured payload the extension reads rides in the `title` of an empty `<span title='geld:…'>` in the comment's footer: GitHub strips HTML comments from the rendered page but keeps that attribute, and an empty span shows nothing, so readers without the extension see only the summary. (Older summaries carried a fenced `geld` code block. The extension still reads those, and the Action no longer writes them.)

## Safety

- Use `pull_request_target` so fork PRs run with the base repository's token.
- **Never check out the pull request head.** This action only calls the API.
- Editing its own comment fires `issue_comment.edited`; that loop is skipped. A human ticking a task-list checkbox is a different actor and is applied as `done-manual`.

## Install

Copy [`examples/geld.yml`](examples/geld.yml) to `.github/workflows/geld.yml` in the repository that should get summaries.

```yaml
- uses: brandonmcconnell/geld/apps/action@main
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    # optional:
    # ai-key: ${{ secrets.GELD_AI_KEY }}
    # model: gpt-4.1-mini
```

`@main` runs whatever is on `main` at the time. To change versions only when you choose, pin the `uses:` line to a commit SHA (`brandonmcconnell/geld/apps/action@<sha>`).

## Optional AI (bring your own key)

No request is made unless `ai-key` and `model` are both set. `ai-base-url` defaults to the Vercel AI Gateway (`https://ai-gateway.vercel.sh`; model ids look like `openai/gpt-4.1-mini`); any OpenAI-compatible origin works.

With AI on, the Action consolidates **bot-only** findings (people's comments keep their words): one title per concern, merged context when several bots report the same thing, an optional fix (`suggested-fixes`: `all`, `bots` — the default, only a bot's own ```suggestion block —, `ai`, `off`), and a TL;DR at the top of the comment. Work is incremental: items whose sources did not change since the last comment keep their wording, an item that gained a source is re-asked with the previous wording as baseline, and the TL;DR is rewritten only when the set of open items changed.

## Start review bots by API

The example workflow has a second job, `trigger`, that starts review bots through their own APIs when someone with write access comments `/geld run greptile` (or `bugbot`, `devin`, several separated by spaces). It helps when a bot is not picking up its own tag comment, since the bot never has to read the comment.

Every bot is off until you turn it on. Store the bot's key as a repository secret (Settings > Secrets and variables > Actions), then put that secret's **name** in the workflow's `env` block:

| Bot | Workflow setting | Where the key comes from |
|---|---|---|
| `greptile` | `GELD_GREPTILE_SECRET_NAME` | Greptile, Settings > Organization > API Keys. Calls `trigger_code_review` on `api.greptile.com/mcp`. |
| `bugbot` | `GELD_BUGBOT_SECRET_NAME` | Cursor Dashboard > API Keys, admin scope (Cursor Enterprise). Calls `POST api.cursor.com/bugbot/review`. |
| `devin` | `GELD_DEVIN_SECRET_NAME` (and `GELD_DEVIN_ORG_ID` for an enterprise-wide key) | A Devin service user with `UseReviewManual`. Its organization is read from the key (`GET /v3/self`); an enterprise-wide key spans several, so name the organization id (not a secret). Calls `POST api.devin.ai/v3/organizations/{org}/pr-reviews`. |

```yaml
env:
  GELD_GREPTILE_SECRET_NAME: GREPTILE_API_KEY # the name of your secret, never the key
```

- **Names only:** a value that isn't shaped like a secret's name as GitHub lists it (capital letters, digits, underscores) is refused with a 😕, without being repeated anywhere: it is most likely a key pasted into a committed file. Remove it from the workflow and rotate that key.

- **Who can trigger:** secrets are available to every comment's run, so the job checks the commenter's permission first and refuses anyone without write access, and comments from bot accounts.
- **Whose key it is:** every bot acts for the organization or team the key belongs to, not for the person who commented: none of the three APIs takes a requester. Who asked is on GitHub, in the comment and in the run's log (`review queued for <login>`). Use an organization's key, not a personal one: a Devin personal access token acts as the person who made it, and a Cursor API key belongs to the team.
- **GitHub Enterprise Server:** Greptile is sent the server's address (`remoteUrl`) so it finds the repository there. Bugbot and Devin take the pull request's own link.
- **Parallel:** the `trigger` job has no concurrency group, so every command runs, alongside the others and the summary. The `summary` job keeps its own group, which cancels older summary runs so only the newest rewrites the comment.
- **Result:** a 🚀 reaction on the comment when every bot was queued, 😕 otherwise, with the reason in the run's log. A queued review still runs on the bot's side and posts as usual.
- **From the extension:** with a bot ticked under "Start review bots by API" in Geld's settings, Rerun and Request a review post `/geld run <bot>` on repositories whose Geld workflow names a secret for that bot (the extension reads the workflow file for the names, never the keys) and the bot's own tag comment everywhere else. The digest reads the workflow's 🚀 as the bot taking the run and its 😕 as no run.

Repositories that copied an earlier version of `examples/geld.yml` need to copy it again to get this job: `uses: …@main` updates the Action's code, not the workflow file.

`dist/index.js` is a committed esbuild bundle (GitHub Actions require built JavaScript). Rebuild with `pnpm --filter @geld/action build`.
