# Read-only issue tracker links

The shared core recognizes tickets in titles, descriptions, branch names and URLs. Fenced and inline code are ignored. A configured team tracker takes precedence over repository `.github/geld.yml` `issueTracker`, then personal settings. A bare `#123` always targets the PR's own Git provider. External keys are restricted to the configured list, and repository links are restricted to the PR's repository or explicitly allowed repository scopes. No ticket write endpoint exists.

| Tracker | Recognized form | Scope configuration |
| --- | --- | --- |
| Linear | `ENG-123`, `https://linear.app/workspace/issue/ENG-123/...` | Team keys and workspace slug |
| Jira | `APP-123`, configured origin `/browse/APP-123` | Project keys and HTTPS origin |
| GitHub Issues | `#123`, `/owner/repo/issues/123` | PR repository or allowed repositories |
| GitHub Projects | `/orgs/owner/projects/123`, `/users/owner/projects/123` | `owner/number` entries |
| GitLab issues | `#123`, `/group/subgroup/repo/-/issues/123` | PR repository or allowed repositories |
| Bitbucket issues | `#123`, `/workspace/repo/issues/123` | PR repository or allowed repositories |
| YouTrack | `Api_32-143`, configured origin `/issue/Api_32-143` | Project short names and HTTPS origin |
| Asana | `/0/project/task`, `/1/workspace/task/id`, `/1/workspace/project/id/task/id` | Project or workspace IDs matching the URL form |
| Monday | configured origin `/boards/board/pulses/item` | Board IDs |

Built-in issue status uses the user's provider token source. GitHub Projects reads open/closed state through GraphQL. External trackers use a team connection with fixed GET requests or fixed read-only GraphQL queries. Credentials are encrypted and never reach the extension. Without a connection, links remain usable and no status is invented. Jira Cloud and YouTrack Cloud are allowed API origins. Other YouTrack hosts need operator registration through `TRACKER_ALLOWED_HOSTS`; private instances use the Enterprise connector rather than arbitrary server fetches.

The extension adds a links row on github.com and supported Enterprise pages with no Geld account required. Shared sign-in requests optional access to `https://app.geld.sh/*` on the user's click, then reads the existing Better Auth session. The selected team determines connected tracker status. The existing device-local GitHub gist flow remains available for migration. The website's main sign-in and settings links use the dashboard. Set `GELD_LEGACY_SITE_AUTH=true` only during an intentional legacy-site migration.

Tracker brand assets identify links without implying endorsement. See the [asset provenance](../../packages/core/assets/tracker-icons/NOTICE.md). No license file has been added or changed. Distribution notices are prepared privately for owner approval before publication. Asana's asset is distributed through a third-party catalog with the official brand page as its source and needs that final publication review.

Candidates for later verification include Shortcut and Azure DevOps. No speculative identifier parser or ticket mutation is shipped for them.

Primary format references checked November 1, 2026:

- [Linear issue references](https://linear.app/docs/github)
- [YouTrack issue IDs](https://www.jetbrains.com/help/youtrack/devportal/resource-api-issues.html)
- [Asana task reference and URLs](https://developers.asana.com/reference/tasks)
- [Asana current task links](https://developers.asana.com/reference/gettask)
- [Monday item IDs and URL structure](https://support.monday.com/hc/en-us/articles/360000225709-Where-to-find-board-ID-item-ID-and-column-ID)
- [Monday read-only status queries](https://developer.monday.com/api-reference/reference/status)
- [Firefox optional data declarations](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)

Read-only OAuth is wired for Linear, Jira, Asana and Monday. Setup state is single-use and bound to the signed-in admin and team. Linear and Asana use PKCE. Refresh tokens are encrypted and rotated under a database lock. Jira selects only the authorized cloud resource matching the saved site origin, and Linear verifies the saved workspace slug. Changing the provider, origin or workspace clears the old connection. YouTrack supports an explicitly supplied restricted permanent token. Customer-managed tokens are an advanced option; normal OAuth tokens are not treated as permanent API keys.

The two requested GitHub PRs were read through the connected GitHub source: [wxt#2544](https://github.com/wxt-dev/wxt/pull/2544), head `1a0b7c22e822c5d2de5ab8fab76b94f41185d66a`, and [vitest#10554](https://github.com/vitest-dev/vitest/pull/10554), head `29c13b88420fd086319e75a44ee927fc6a31bbdc`. Both were merged when checked. The execution environment cannot reach provider API origins directly, so authenticated dashboard/provider flows remain fixture-tested. The attempted public Bitbucket PR page and API were inaccessible through the research tool; Bitbucket verification remains limited to documented API shapes and fetch fixtures.
