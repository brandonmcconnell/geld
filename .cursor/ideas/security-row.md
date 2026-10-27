# Idea: a Security row beside Reports

Status: parked (Oct 2026). No code change yet.

## What

Split the security reporters out of the panel's Reports row into a row of their own ("Security"): Socket, GitGuardian, Semgrep, Aikido, Gecko, GitHub code scanning, Snyk, and whatever else reports a *security* finding rather than a test, visual or coverage result.

## Why it might be worth it

- A red Reports row today can mean "a visual test changed" or "a secret was committed", and those deserve different urgency. A row named Security, red only for security findings, would make the second unmissable.
- Security tools cluster: a repository that runs one usually runs two or three (Socket + code scanning + a secrets scanner), so the row would rarely be a single pill.
- The vocabulary differs (alerts, secrets, vulnerabilities, policy breaks, Block / Warn actions) and a dedicated row could get a dedicated short form and a severity-aware light (critical / high as its own tone) without crowding the test-oriented pills.

## Why not yet

- Reports would thin out: with security gone it holds Blacksmith, Chromatic / Percy / Argos / Happo / Applitools / Lost Pixel, Codecov, Cypress Cloud, Lighthouse. Plenty of catalogue, but on any one pull request usually one or two pills.
- Two rows that are both "shown only when someone posted" double the empty-state surface and the vertical cost on PRs that have both.
- The classification exists already: `CheckReporter` / `Reporter` could carry a `kind: 'security' | 'tests' | 'visual' | 'coverage' | …`, so the split is a rendering decision that can be taken later without re-reading anything.

## If we do it

- Add `kind` to the reporter catalogues in `@geld/review/reporters.ts`; `latestReports` keeps working per key.
- `panel.ts`: a `securityRow` sibling of `reportsRow` (same pill, line, hover card and `onOpenReport` plumbing, filtered by kind); `REPORTS_LABEL`-style label, a shield glyph (`ICON_SHIELD`), health from the security reports alone.
- Decide the order: Security above Reports (urgency) or below (frequency).
- Consider a severity tone for the row light: any critical / high finding → danger, medium / low → attention, none → done.
- Bugbot's appsec stays a review bot (it opens findings as threads); only *reporters* move.

## Where the security reporters live today

`packages/review/src/reporters.ts`: `REPORTERS` (comment readers: Socket, GitGuardian) and `CHECK_REPORTERS` (Socket, GitGuardian, Semgrep, Aikido, Gecko, code scanning, Snyk), rendered by `reportsRow` in `apps/extension/src/github/review/panel.ts`.
