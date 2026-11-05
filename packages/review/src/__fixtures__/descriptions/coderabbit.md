<!-- Add the related story/sub-task/bug number, like Resolves #123, or remove if NA -->
**Related issue:** Resolves #57317 

# Checklist for submitter

If some of the following don't apply, delete the relevant line.

- [x] Changes file added for user-visible changes in `changes/`, `orbit/changes/` or `ee/fleetd-chrome/changes`.
  See [Changes files](https://github.com/fleetdm/fleet/blob/main/docs/Contributing/guides/committing-changes.md#changes-files) for more information.

## Testing

- [x] Added/updated automated tests
- [x] QA'd all new/changed functionality manually

<!-- This is an auto-generated comment: release notes by coderabbit.ai -->
<!-- coderabbit-ai-generated:v1 -->

## Summary by CodeRabbit

## Summary by CodeRabbit

* **Breaking Changes**
  * Legacy team API endpoints for creating, viewing, updating, and deleting teams—and managing their users, secrets, and agent options—now return **410 Gone**.
  * Use the corresponding fleet endpoints instead. See the Fleet 5 migration guide for details.
<!-- end of auto-generated comment: release notes by coderabbit.ai -->