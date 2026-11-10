# GitLab and Bitbucket summary runner

The provider runner reads review data through authenticated APIs and maintains one comment owned by the token account.
It never checks out the review branch or executes repository scripts.
Its deterministic review items use the shared provider model, real source anchors and canonical provider links.
Comment ownership is a durable user ID from the authenticated `/user` response, never a display name, marker or heading alone.
Before updating a comment it reads the comment again and verifies the same owner and marker.

The ordinary GitLab template is an inert source configuration until its trusted copied YAML is configured with a real reviewed image digest and explicitly enabled.
The Bitbucket example requires an operator-supplied trusted image.
Both require protected credentials and trusted orchestration.
No public CI component address, named Pipe version or published Geld image is supplied.

## Build

Run `pnpm --filter @geld/action build` to generate both standalone CommonJS bundles: the GitHub Action at `dist/index.js` and the provider runner at `dist/provider.cjs`.
The standalone bundle is copied by `Dockerfile.providers`.
Use `apps/action` as the Docker build context and `Dockerfile.providers` as the Dockerfile.
Supply a reviewed Node 20 or newer image pinned by immutable digest as the required `NODE_IMAGE` build argument.
Build and inspect the image, then put its real literal `image@sha256:<64 hex characters>` reference in the trusted copied GitLab template.
Do not obtain that GitLab image from `GELD_TRUSTED_IMAGE` or any trigger/project variable.
The Bitbucket custom-pipeline example separately uses `GELD_TRUSTED_IMAGE`.
Both use the prebuilt runner and disable source checkout.
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

## Install the ordinary GitLab template

Copy [`templates/gitlab-summary.yml`](templates/gitlab-summary.yml) from a **full reviewed Geld commit SHA** into `.gitlab/ci/geld-summary.yml` in your own protected default-branch repository.
Copy [`examples/gitlab-ci.yml`](examples/gitlab-ci.yml) into that repository's `.gitlab-ci.yml`, or add its ordinary `include:local` to your trusted pipeline.
Both files must be on the same branch; GitLab resolves the configuration before the job, independently of `GIT_STRATEGY: none`.
Run this installation command from the target repository working directory; `-C /path/to/reviewed-geld` points at your separately reviewed Geld checkout.
Replace `REVIEWED_FULL_COMMIT` with the actual full commit SHA you reviewed:

```sh
mkdir -p .gitlab/ci
git -C /path/to/reviewed-geld show REVIEWED_FULL_COMMIT:apps/action/templates/gitlab-summary.yml > .gitlab/ci/geld-summary.yml
```

This is an installation-time copy, not a job checkout or a remotely published GitLab component.
Do not follow a mutable branch/tag or copy review-branch configuration into a privileged job.
The template uses the ordinary `test` stage; a trusted pipeline with custom stages must include that stage or deliberately adapt it.

The copied template deliberately has **no image** and starts with an unconditional `when: never` rule.
Nonempty target variables or an image variable cannot enable that shipped job.
Before removing that first rule, add an `image` mapping directly to the trusted copied `geld-summary` job: `name` must be your actual reviewed literal image reference ending in `@sha256:` plus its 64-character lowercase hexadecimal digest, and `entrypoint` must be `[""]`.
No example image identity is supplied because none has been published or audited here.
A digest pins bytes; it does not establish publisher trust.
An in-image check runs too late to establish pre-job image authority.
Keep the remaining rules and literal `node /geld/provider.cjs` script, and review the resulting configuration before enabling it.

## Trusted execution and serialization

Use a protected default branch, protected masked `GELD_TOKEN`, and an audited ephemeral runner.
The prepared rule admits only a nonempty default-branch context with `CI_COMMIT_REF_PROTECTED == "true"`, explicit `web`/`api`/`trigger`/`pipeline` sources, a positive MR IID and a conservative ASCII project path with nonempty slash-separated segments.
These are context and target-shape checks, **not caller authorization** or proof that an arbitrary edited parent configuration is safe.
Do not enable the job in an MR's own pipeline.
The entire enclosing configuration, includes, runner hooks and any same-name job overrides must be trusted and reviewed.

Restrict who may invoke each enabled entrypoint and who controls upstream/trigger projects and tokens.
Use GitLab's **Minimum role to use pipeline variables** restriction for an appropriate trusted Maintainer/Owner population, and enforce an orchestration allowlist: callers may supply only the approved `GELD_REPOSITORY` and `GELD_REVIEW_NUMBER` target values.
Validate the permitted projects/reviews in that trusted orchestration before creating the pipeline.
Do not let callers override the image, token, provider/API origin, `CI_*`, `GIT_*`, `NODE_*`, shell/runtime variables or any other job settings.
Pipeline variables have high precedence and can override predefined or job variables; the YAML rules and job variable declarations do not prevent that.
Keep protected credentials out of trigger payloads and committed YAML.

`inherit:default: false` excludes inherited default image, services, scripts, hooks, cache and artifact settings.
Explicit empty before/after scripts, source hooks and cache avoid running inherited YAML commands or restoring its cache; `dependencies: []` prevents automatic earlier-job artifact downloads.
`inherit:variables: false` excludes YAML default variables only; it does not remove or secure project/group/predefined/pipeline variables.
These settings do not neutralize an untrusted parent job override or runner administrator configuration.
The literal runner is bundled in the reviewed image, and `GIT_STRATEGY: none` avoids source checkout when the trusted invoker respects that configuration.
The full target project path plus MR IID form the `resource_group`, serializing concurrent summaries for that review within the orchestration project.
Use one such orchestration project for a target review; independent projects do not share a resource lock.

The configuration forms follow GitLab's [YAML reference](https://docs.gitlab.com/ci/yaml/), [rules expressions](https://docs.gitlab.com/ci/jobs/job_rules/) and [pipeline-variable restrictions](https://docs.gitlab.com/ci/variables/#restrict-pipeline-variables).
Local YAML/selection tests verify this template's contract; they are not GitLab CI-lint, image execution, credential authorization or authenticated note-write acceptance.

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
