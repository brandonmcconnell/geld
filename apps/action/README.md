# @geld/action

GitHub Action that maintains **one** Geld review-summary comment on a pull request.

It reads review threads, issue comments, reviews and checks through the GitHub API, clusters them with `@geld/review`, and upserts a markdown comment that also carries a fenced `geld` JSON payload the extension can read from the rendered page.

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

Optional AI rewrites bot-only titles. No request is made unless `ai-key` and `model` are both set.

`dist/index.js` is a committed esbuild bundle (GitHub Actions require built JavaScript). Rebuild with `pnpm --filter @geld/action build`.
