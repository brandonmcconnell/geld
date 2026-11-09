---
name: Related links
overview: 'A "Related links" sidebar section under Assignees listing the tickets, chat threads, agent sessions, review views and docs a pull request links to (done), then real names and a context card for each link, read with the reader''s own access where a service allows it and through the Geld dashboard where it needs an app (Slack).'
todos:
  - id: registry
    content: '@geld/review related-links.ts: exact URL patterns for tickets, chat, agent sessions, review views, docs, errors; dedupe by key, web over desktop'
    status: done
  - id: sidebar
    content: 'Extension related-links.ts: section under Assignees, found by heading, Rails and React shapes, setting relatedLinks'
    status: done
  - id: replicas-note
    content: 'Agent notes: Replicas footer and its co-author lines'
    status: done
  - id: card
    content: 'Click opens a context card (what the link says, where it was found, the service''s answer once connected); Cmd/Ctrl-click and middle-click keep opening the URL'
    status: pending
  - id: atlassian-session
    content: 'Jira and Confluence titles and status through the reader''s own Atlassian session (optional host permission per site, asked from the card)'
    status: pending
  - id: linear-names
    content: 'Linear titles, state and assignee through the team''s existing dashboard tracker connection, else a personal API key kept in storage.local'
    status: pending
  - id: slack-app
    content: 'Slack: a Geld Slack app connected through the dashboard (user token, read scopes), resolving channel name, thread root author and first line; interim manifest for an internal app'
    status: pending
  - id: agent-sessions
    content: 'Agent session status and title where a public API exists (Devin, Cursor, Jules), with the reader''s own key'
    status: pending
isProject: false
---

# Related links

## Done in the first step

- `@geld/review/related-links.ts` reads a link by an exact pattern over its whole hostname, whole pathname and the query parameters it needs.
  Nothing on the same site that is not the thing itself matches: settings pages, docs, image badges, `sessions/new`, a trace's `/ban` action.
- The extension lists what the description links to (Agent notes' blocks included) and Linear's linkback comment, under Assignees, one row per thing.
- Replicas' footer is an Agent note.
- No network request is made for any of it.

## Survey (Nov 2026)

Read from public pull request bodies through `gh api search/issues` (up to 50 bodies per query), URL shapes normalised, each kept pattern pinned in `related-links.test.ts`.

| Service | Shape in pull request bodies | Where it comes from |
|---|---|---|
| Replicas | `app.replicas.dev/workspaces/<uuid>` (older `replicas.dev/workspaces/<uuid>`), badge alt "Replicas Workspace" | Centred footer "Created by … with Replicas", plus "Slack Thread" and "Linear <KEY>" badges when asked there |
| Devin | `app.devin.ai/sessions/<32 hex>`, `app.devin.ai/desktop/session/<32 hex>?variant=devin`, `app.devin.ai/review/<owner>/<repo>/pull/<n>` | "Link to Devin session:", "Open in Devin Desktop:", the Devin Review badge block |
| Cursor | `cursor.com/agents/bc-<uuid>?cursor_ref=pr_footer…`, `cursor.com/background-agent?bcId=bc-<uuid>…`, `cursor.com/automations/<uuid>` | "Open in Web", "Open in Cursor", "View Automation" badges |
| Codex | `chatgpt.com/codex/tasks/task_e_<32 hex>` (and a uuid form) | "Codex Task" / "Codex Cloud task" lines |
| Claude Code | `claude.ai/code/session_<base62>` | `Claude-Session:` trailer line; bare `claude.ai/code` and `claude.com/claude-code` are the product, not a session |
| Jules | `jules.google.com/session/<digits>`, `jules.google.com/task/<digits>` | "PR created automatically by Jules for task …" |
| Copilot coding agent | `github.com/copilot/tasks/pull/PR_<node id>?session_id=<uuid>` | Bodies quoting a task; the session link GitHub itself shows ("View session") is in the signed-in timeline, not the body |
| Factory | `app.factory.ai/automations?editAutomationId=<uuid>`; `sessions/new?prompt=…` is a call to action | Footer buttons |
| Amp | `ampcode.com/threads/T-<uuid>` | "Amp-Thread:" lines |
| OpenHands | `app.all-hands.dev/conversations/<id>`, `/canvas/conversations/<id>` | Body lines |
| Codegen | `codegen.com/agent/trace/<n>` (`/ban`, `/remove-from-pr` are actions) | Footer |
| Tembo | `app.tembo.io/sessions/<uuid>`, `reviews/redirect?sessionId=<uuid>` | Footer buttons |
| Terragon | `www.terragonlabs.com/task/<uuid>` | Footer |
| Warp / Oz | `app.warp.dev/conversation/<uuid>`, `oz.warp.dev/runs/<uuid>`, `platform.warp.dev/runs/<uuid>`, `app.warp.dev/drive/notebook/<id>` | "Conversation:", "Run:", "Plan:" lines |
| Cosine | `cosine.sh/<org>/<repo>/task/<12 chars>` | Footer |
| opencode | `opencode.ai/s/<8 chars>` | Share links |
| Lovable, v0 | `lovable.dev/projects/<uuid>`, `v0.app/<team>/chat/<id>` | Footer |
| Graphite | `app.graphite.dev/github/pr/<owner>/<repo>/<n>`, `background-agents/<owner>/<repo>/task/bgt_…` | Stack and agent links |
| Greptile, CodeRabbit, cubic | The review view links already read by `AGENT_VIEW_LINKS` | Their summaries, sometimes in the description |
| Linear | `linear.app/<ws>/issue/<KEY>[/<slug>]`, `/project/<slug>-<12 hex>`, `/document/<slug>-<12 hex>` | Authors, Replicas badges, `linear[bot]`'s `<!-- linear-linkback -->` comment |
| Jira, Confluence | `<site>.atlassian.net/browse/<KEY>`, boards with `selectedIssue`, `/wiki/spaces/<S>/pages/<id>/<slug>` | Authors, autolinks |
| Slack | `<ws>.slack.com/archives/<C/D/G…>/p<16 digits>[?thread_ts=…&cid=…]`, `app.slack.com/client/<T>/<C>/thread/<C>-<ts>` | Authors and agents started from Slack (Replicas, Cursor, Devin, Codex) |
| Others | Shortcut, Asana, ClickUp, Trello, YouTrack, Notion, Figma, Google Docs, Loom, Discord, Teams, Sentry | Authors |

Then run over every URL in 8,820 public pull request bodies (two pages of search results per service): 8,972 links read, the misses read by shape, and the real ones added (titles in non-Latin scripts, Cursor's `agents?id=`, Claude Code project threads, Codex `cloud/tasks`, Tembo tasks, Warp sessions and staging hosts, Cosine's pull request view, Asana task sub-paths, Discord threads, YouTrack previews and articles, Sentry sub-pages, Confluence short links, Shortcut epics, ClickUp docs, Height, Plane, `app.notion.com`, `jira.atlassian.com` and self-hosted Jira and YouTrack, Devin Enterprise, `app.graphite.com`, GitLab and Bitbucket issues and merge or pull requests).
Dependency updates (520 of the bodies) are skipped: their links are upstream release notes.
One real pull request per service and shape (59) was then loaded in Chrome with the built extension, and each showed its link.

Not found in bodies: Factory sessions (only `sessions/new`), Sweep and Charlie session links, a Copilot session in the body.

## Second step: names and a context card

Today a row says "LIM-1391 <slug words>" when the link names an identifier or title, and "Open thread in Slack" or "View workspace in Replicas" when it names neither.
The aim is "{id} {title} {description}" from the service itself (the issue's title and state, the channel and the thread's first line, the session's title and status) on the same truncated line, a card on click, with Cmd/Ctrl-click and middle-click still opening the URL as any link does.

### What each service allows

- **Jira and Confluence: the reader's own session works.**
  The REST API answers GETs with the browser's Atlassian session cookie (`GET https://<site>.atlassian.net/rest/api/3/issue/<KEY>?fields=summary,status,assignee`, `GET /wiki/api/v2/pages/<id>`), and an extension's background fetch to a host it holds permission for carries those cookies.
  So the extension needs only an optional host permission per site, asked from the card ("Show details from acme.atlassian.net"), and no app or token.
  Writes need an XSRF header and are not wanted.
  The dashboard's Jira OAuth (`apps/dashboard/lib/tracker-oauth.ts`, `read:jira-work`) is the team-wide route for readers who are not signed in to Jira.
- **Linear: the dashboard connection, else a personal key.**
  Linear's documented API is GraphQL at `api.linear.app/graphql` with OAuth or a personal API key (`issue(id: "LIM-1391") { title state { name color } assignee { name } }`).
  The web app's own session talks to an undocumented endpoint and is not something to build on.
  The dashboard already holds a team's Linear OAuth token (`read` scope) and answers `/api/extension/status` for tracker URLs, so adding `title` and `assignee` to that answer covers teams that connected Linear there.
  For a reader on their own, a personal API key kept in `storage.local` (like the AI gateway key, never synced) with an optional `https://api.linear.app/*` permission is the setup-free path.
- **Slack: an app is required.**
  There is no supported way to read Slack with the reader's browser session: the web client's token lives in Slack's own page storage and using it from an extension breaks Slack's terms.
  A Geld Slack app with user-token scopes (`channels:history`, `groups:history`, `im:history`, `mpim:history`, `channels:read`, `groups:read`, `users:read`) answers `conversations.info` (the channel's name), `conversations.replies` with `ts` = the thread and `limit=1` (the root message, its author and first line) and `team.info` (the team id a `slack://channel?team=T…&id=C…&message=…` deep link needs).
  The OAuth redirect and the token belong in the dashboard (encrypted as tracker tokens are, `encryptCredential`), and the extension asks the dashboard with the link, as it does for tracker statuses.
  Two constraints shape it.
  Slack limits `conversations.history` and `conversations.replies` to one request a minute and 15 messages for apps distributed outside the Slack Marketplace (new installs since May 29, 2025, every install since March 3, 2026, per Slack's changelog), so a public Geld app needs Marketplace approval before thread previews are usable; internal (customer-built) apps keep the normal limits.
  And many workspaces require an admin to approve an app.
  Until the Marketplace review is through, a team can create its own internal app from a manifest Geld publishes and paste its token in the dashboard.
  Message text is shown and never stored: the dashboard keeps no PR or chat content.
- **Agent sessions: per-service keys, where an API exists.**
  Devin (`GET https://api.devin.ai/v1/session/<id>`, API key), Cursor (Cloud Agents API, `GET /v0/agents/<id>`, API key) and Jules (`jules.googleapis.com/v1alpha/sessions/<id>`, API key) give a title and status.
  Codex, Claude Code, Replicas, Amp and the rest publish no session API today, so their card shows what the link says.
  Each key would be personal, in `storage.local`, with an optional host permission.

### The card

- A click on a row opens a Geld popover (the digest's hovercard style) with the service's mark, the name, what the link says, where it was found ("Replicas footer", "Linear linkback", "Description"), and the service's answer once connected: state, assignee, the thread's first line.
- Its foot holds "Open in <service>" (the web URL) and, where one exists, the app deep link (`slack://…`, `linear://…`, Cursor's and Devin Desktop's links already found beside the web ones).
- A row stays a real link, so Cmd/Ctrl-click, middle-click and "Copy link" behave as anywhere on GitHub; only a plain click is taken.
- A service the reader has not connected shows one line saying what connecting adds and where (dashboard, or the host permission), never a modal of its own.
