# GitLab and Bitbucket summary runner

The provider runner reads review data through authenticated APIs and maintains one comment owned by the token account.
It never checks out the review branch or executes repository scripts.
Its deterministic review items use the shared provider model, real source anchors and canonical provider links.
Comment ownership is a durable user ID from the authenticated `/user` response, never a display name, marker or heading alone.
Before updating a comment it reads the comment again and verifies the same owner and marker.

The templates require a published trusted image, protected credentials, branch restrictions and a trusted trigger.
No public CI component or named Pipe version is supplied yet.

## Build

Run `pnpm --filter @geld/action build` to generate both standalone CommonJS bundles: the GitHub Action at `dist/index.js` and the provider runner at `dist/provider.cjs`.
The standalone bundle is copied by `Dockerfile.providers`.
Use `apps/action` as the Docker build context and `Dockerfile.providers` as the Dockerfile.
Supply a reviewed Node 20 or newer image pinned by immutable digest as the required `NODE_IMAGE` build argument.
Build and inspect the image, then configure `GELD_TRUSTED_IMAGE` with its immutable digest.
The GitLab job and Bitbucket custom pipeline use that prebuilt image and disable source checkout.
The image's default command runs `/geld/provider.cjs`, while both job templates invoke it explicitly after their provider checks.

## Inputs

| Variable | Meaning |
| --- | --- |
| `GELD_PROVIDER` | `gitlab` or `bitbucket` |
| `GELD_REPOSITORY` | Full nested GitLab project path, or Bitbucket `workspace/repository` |
| `GELD_REVIEW_NUMBER` | Positive MR IID or PR number |
| `GELD_TOKEN` | Protected masked secret, never a committed variable |
| `GELD_PROVIDER_ORIGIN` | GitLab HTTPS origin, default `CI_SERVER_URL` or `https://gitlab.com`. Bitbucket Cloud requires `https://bitbucket.org` |
| `GELD_API_BASE` | Must match that GitLab origin plus `/api/v4`, or exactly `https://api.bitbucket.org/2.0` |
| `GELD_TOKEN_TYPE` | `bearer` by default. Bitbucket user API tokens can explicitly select `basic` |
| `GELD_BITBUCKET_USERNAME` | Required for Basic authentication, usually the token user's Atlassian email |

The runner also accepts `CI_MERGE_REQUEST_PROJECT_PATH`/`CI_PROJECT_PATH`, `CI_MERGE_REQUEST_IID`, `BITBUCKET_REPO_FULL_NAME` and `BITBUCKET_PR_ID` when explicit Geld identity variables are absent.
The trusted default-branch examples use explicit review identity variables supplied by a trusted trigger because they do not execute in the source review pipeline.

The token needs read access to every discussion, note/comment, reviewer, approval, current-head pipeline/job or status, activity and task source used by its provider, plus create/update access to its own summary comments.
The authenticated user endpoint must return a durable identity.
A repository/workspace token that cannot establish its posting identity is rejected rather than guessed.
Bitbucket app passwords are not supported.
HTTPS, response size bounds, schema checks, complete pagination, origin checks and head rechecks apply before writing.
Authentication failures, incomplete data or a changed head fail the job and leave the previous summary intact.

## Trusted execution and serialization

Use the GitLab example only from the protected default branch.
Keep the secret protected and masked, and trigger that branch from trusted orchestration with the target project path and MR IID.
The `resource_group` serializes jobs for the review.
Do not enable this privileged job in a merge request's own configuration or run arbitrary fork/source code before the runner.

For Bitbucket, restrict the `Geld summary` deployment environment to the trusted default branch before supplying credentials.
Set `GELD_TRUSTED_BRANCH` to that branch and use the custom pipeline on it.
The runtime branch test supplements that provider-enforced restriction.
A branch test alone cannot protect a secret from modified source-branch pipeline configuration.
The fixed concurrency group serializes summary jobs.
Installation into a named Pipe requires publishing the reviewed image and adding its actual immutable image reference to Pipe metadata.
Pin named Pipe metadata and CI component versions to the reviewed immutable artifact when publishing them.

## Remaining parity and verification

The adapters have protocol tests with documented API shapes, while authenticated CI writes still need integration verification.
Confirm GitLab reviewer endpoint/version availability and the selected token's permissions in a test project before enabling triggers.
The rendered HTML payload carrier has not been verified against either provider's sanitizer, so browser adapters must retain their native-data fallback.
Provider-specific bot identities/triggers, optional AI rewriting, incremental AI carry-over and manual summary-checkbox carry-over are not implemented by this runner yet.
No AI service is contacted.
Unknown automation accounts are not given GitHub bot identities or verdicts.
GitLab required approvals and CI counts are supplementary human-readable lines.
Bitbucket task states remain separate from discussion resolution, and approval requirements are not invented from participant counts.
Native activity is acquired completely but is not yet serialized into provider-specific push rounds in the summary payload.
