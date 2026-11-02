# Dashboard interface review

This gallery shows the actual Geld dashboard with synthetic local fixture responses.
It covers app-owned routes, sign-in and account creation, password recovery, connection setup, review modes, dialogs, and empty, loading and error states.
No real provider login, email, AI generation, billing or infrastructure operation was performed.

Open [the visual gallery](./index.html) to filter screenshots by device and view.
The production application follows the operating system’s color scheme.

## Screenshots

| View | Route | Desktop | Mobile | Dark |
| --- | --- | --- | --- | --- |
| Review queue | `/` | [View](./screenshots/desktop/queue.png) | [View](./screenshots/mobile/queue.png) | [View](./screenshots/dark/queue.png) |
| Repositories | `/repositories` | [View](./screenshots/desktop/repositories.png) | [View](./screenshots/mobile/repositories.png) | — |
| Provider organization | `/github/acme` | [View](./screenshots/desktop/organization.png) | [View](./screenshots/mobile/organization.png) | — |
| Repository queue | `/github/acme/platform` | [View](./screenshots/desktop/repository.png) | [View](./screenshots/mobile/repository.png) | — |
| Repository settings | `/github/acme/platform/~settings` | [View](./screenshots/desktop/repository-settings.png) | [View](./screenshots/mobile/repository-settings.png) | — |
| Organization settings | `/github/acme/~settings` | [View](./screenshots/desktop/organization-settings.png) | [View](./screenshots/mobile/organization-settings.png) | — |
| Teams | `/teams` | [View](./screenshots/desktop/teams.png) | [View](./screenshots/mobile/teams.png) | — |
| Team administration | `/teams/00000000-0000-4000-8000-000000000001` | [View](./screenshots/desktop/team.png) | [View](./screenshots/mobile/team.png) | — |
| Team review defaults and tracker | `/teams/00000000-0000-4000-8000-000000000001/settings` | [View](./screenshots/desktop/review-defaults.png) | [View](./screenshots/mobile/review-defaults.png) | — |
| Inbox | `/inbox` | [View](./screenshots/desktop/inbox.png) | [View](./screenshots/mobile/inbox.png) | — |
| Connections and repository selection | `/connect` | [View](./screenshots/desktop/connect.png) | [View](./screenshots/mobile/connect.png) | — |
| Settings overview | `/settings` | [View](./screenshots/desktop/settings.png) | [View](./screenshots/mobile/settings.png) | — |
| Account and identity settings | `/settings/account` | [View](./screenshots/desktop/account.png) | [View](./screenshots/mobile/account.png) | [View](./screenshots/dark/account.png) |
| AI providers and local companion | `/settings/providers` | [View](./screenshots/desktop/providers.png) | [View](./screenshots/mobile/providers.png) | [View](./screenshots/dark/providers.png) |
| Model selection | `/settings/models` | [View](./screenshots/desktop/models.png) | [View](./screenshots/mobile/models.png) | — |
| Plans and billing | `/settings/billing` | [View](./screenshots/desktop/billing.png) | [View](./screenshots/mobile/billing.png) | [View](./screenshots/dark/billing.png) |
| Audit log | `/settings/security` | [View](./screenshots/desktop/security.png) | [View](./screenshots/mobile/security.png) | — |
| Enterprise instances | `/settings/enterprise` | [View](./screenshots/desktop/enterprise.png) | [View](./screenshots/mobile/enterprise.png) | — |
| Review preferences | `/settings/review` | [View](./screenshots/desktop/preferences.png) | [View](./screenshots/mobile/preferences.png) | — |
| Privacy information | `/privacy` | [View](./screenshots/desktop/privacy.png) | [View](./screenshots/mobile/privacy.png) | — |
| Page not found | `/not-a-dashboard-page` | [View](./screenshots/desktop/not-found.png) | [View](./screenshots/mobile/not-found.png) | — |
| Add AI provider | `/settings/providers` | [View](./screenshots/desktop/provider-dialog.png) | [View](./screenshots/mobile/provider-dialog.png) | — |
| Add local companion | `/settings/providers` | [View](./screenshots/desktop/companion-dialog.png) | [View](./screenshots/mobile/companion-dialog.png) | — |
| Geld AI cost confirmation | `/settings/providers` | [View](./screenshots/desktop/ai-cost-confirmation.png) | [View](./screenshots/mobile/ai-cost-confirmation.png) | — |
| Team deletion preview | `/teams/00000000-0000-4000-8000-000000000001` | [View](./screenshots/desktop/team-deletion.png) | [View](./screenshots/mobile/team-deletion.png) | — |
| Outside collaborator audit | `/teams/00000000-0000-4000-8000-000000000001` | [View](./screenshots/desktop/collaborator-audit.png) | [View](./screenshots/mobile/collaborator-audit.png) | — |
| Advanced preferences | `/settings/review` | [View](./screenshots/desktop/advanced-preferences.png) | [View](./screenshots/mobile/advanced-preferences.png) | — |
| Guided review start | `/github/acme/platform/pull/128` | [View](./screenshots/desktop/guide-start.png) | [View](./screenshots/mobile/guide-start.png) | — |
| All changes with file navigation | `/github/acme/platform/pull/128` | [View](./screenshots/desktop/changes.png) | [View](./screenshots/mobile/changes.png) | [View](./screenshots/dark/changes.png) |
| Wrapped code lines | `/github/acme/platform/pull/128` | [View](./screenshots/desktop/changes-wrap.png) | [View](./screenshots/mobile/changes-wrap.png) | — |
| Submit review composer | `/github/acme/platform/pull/128` | [View](./screenshots/desktop/review-submit.png) | [View](./screenshots/mobile/review-submit.png) | — |
| Comment on a changed line | `/github/acme/platform/pull/128` | [View](./screenshots/desktop/line-comment.png) | [View](./screenshots/mobile/line-comment.png) | — |
| Expanded supporting changes | `/github/acme/platform/pull/128` | [View](./screenshots/desktop/supporting-changes.png) | [View](./screenshots/mobile/supporting-changes.png) | — |
| Provider action menu | `/github/acme/platform/pull/128` | [View](./screenshots/desktop/provider-actions.png) | [View](./screenshots/mobile/provider-actions.png) | — |
| Pull request conversation | `/github/acme/platform/pull/128` | [View](./screenshots/desktop/conversation.png) | [View](./screenshots/mobile/conversation.png) | — |
| Review assistant | `/github/acme/platform/pull/128` | [View](./screenshots/desktop/assistant.png) | [View](./screenshots/mobile/assistant.png) | — |
| Privacy preferences | `/` | [View](./screenshots/desktop/privacy-dialog.png) | [View](./screenshots/mobile/privacy-dialog.png) | — |
| First visit privacy choices | `/` | [View](./screenshots/desktop/privacy-banner.png) | [View](./screenshots/mobile/privacy-banner.png) | — |
| Loading review queue | `/` | [View](./screenshots/desktop/queue-loading.png) | [View](./screenshots/mobile/queue-loading.png) | — |
| Guided review step | `/github/acme/platform/pull/128` | [View](./screenshots/desktop/guided-step.png) | [View](./screenshots/mobile/guided-step.png) | [View](./screenshots/dark/guided-step.png) |
| Flag a guided review step | `/github/acme/platform/pull/128` | [View](./screenshots/desktop/flag-step.png) | [View](./screenshots/mobile/flag-step.png) | — |
| Completed guided review | `/github/acme/platform/pull/128` | [View](./screenshots/desktop/guide-complete.png) | [View](./screenshots/mobile/guide-complete.png) | — |
| Sign in with email code | `/sign-in` | [View](./screenshots/desktop/sign-in.png) | [View](./screenshots/mobile/sign-in.png) | [View](./screenshots/dark/sign-in.png) |
| Password sign in | `/sign-in` | [View](./screenshots/desktop/password-sign-in.png) | [View](./screenshots/mobile/password-sign-in.png) | — |
| Company SSO sign in | `/sign-in` | [View](./screenshots/desktop/sso-sign-in.png) | [View](./screenshots/mobile/sso-sign-in.png) | — |
| Magic link sent | `/sign-in` | [View](./screenshots/desktop/magic-link-sent.png) | [View](./screenshots/mobile/magic-link-sent.png) | — |
| Create account | `/sign-up` | [View](./screenshots/desktop/sign-up.png) | [View](./screenshots/mobile/sign-up.png) | — |
| Verify email code | `/sign-up` | [View](./screenshots/desktop/verify-email.png) | [View](./screenshots/mobile/verify-email.png) | — |
| Password recovery | `/forgot-password` | [View](./screenshots/desktop/forgot-password.png) | [View](./screenshots/mobile/forgot-password.png) | — |
| Password recovery sent | `/forgot-password` | [View](./screenshots/desktop/reset-link-sent.png) | [View](./screenshots/mobile/reset-link-sent.png) | — |
| Set new password | `/settings/account/reset-password` | [View](./screenshots/desktop/reset-password.png) | [View](./screenshots/mobile/reset-password.png) | — |
| Password reset success | `/settings/account/reset-password` | [View](./screenshots/desktop/reset-password-saved.png) | [View](./screenshots/mobile/reset-password-saved.png) | — |
| Empty queue | `/` | [View](./screenshots/desktop/queue-empty.png) | [View](./screenshots/mobile/queue-empty.png) | — |
| Queue connection error | `/` | [View](./screenshots/desktop/queue-error.png) | [View](./screenshots/mobile/queue-error.png) | — |
| Pull request connection error | `/github/acme/platform/pull/128` | [View](./screenshots/desktop/pull-error.png) | [View](./screenshots/mobile/pull-error.png) | — |
| Empty model catalog | `/settings/models` | [View](./screenshots/desktop/models-empty.png) | [View](./screenshots/mobile/models-empty.png) | — |
| Partial model catalog | `/settings/models` | [View](./screenshots/desktop/models-partial.png) | [View](./screenshots/mobile/models-partial.png) | — |
| Connect your first provider | `/connect` | [View](./screenshots/desktop/onboarding.png) | [View](./screenshots/mobile/onboarding.png) | — |
| Sign-in configuration unavailable | `/sign-in` | [View](./screenshots/desktop/auth-unavailable.png) | [View](./screenshots/mobile/auth-unavailable.png) | — |
| Invalid email code | `/sign-in` | [View](./screenshots/desktop/auth-error.png) | [View](./screenshots/mobile/auth-error.png) | — |
| Changed file navigation | `/github/acme/platform/pull/128` | — | [View](./screenshots/mobile/files-menu.png) | — |
| Mobile workspace navigation | `/` | — | [View](./screenshots/mobile/navigation.png) | — |

## Reproduce

Start a local production build on port 3001.
Run the capture script from the repository root with Playwright available to Node.
The script intercepts API requests with the included fixtures and verifies that screenshots have no page overflow or browser runtime errors.

```sh
GELD_PLAYWRIGHT_MODULE=/path/to/playwright \
GELD_CHROMIUM_PATH=/path/to/chromium \
node apps/dashboard/scripts/design-capture.mjs
node apps/dashboard/scripts/design-gallery.mjs
```

`GELD_DESIGN_URL` optionally selects a different local server URL.
The two module and executable overrides are optional when Playwright and Chromium are already available at the default locations.
Only synthetic responses are used during capture.
Review actions, sign-in operations and billing interactions in these captures never reach their real services.

Projects and roadmap remain disabled feature stubs and are not part of the enabled dashboard views.
Git provider and identity-provider pages outside Geld are not included.
