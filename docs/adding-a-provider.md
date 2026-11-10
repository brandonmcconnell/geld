# Adding a provider

This guide is for adding a code host to Geld beside GitHub, GitLab and Bitbucket.
It is written one sentence per line, like `AGENTS.md`.
Read `docs/digest-parity.md` first: it says what the digest shows on each host and which shared model drives it.

## 1. What a provider is

A provider is one `ProviderAdapter` (`apps/extension/src/providers/types.ts`) plus a content script that hands it to the shared controller.
GitLab's lives in `src/gitlab/` and Bitbucket's in `src/bitbucket/`, and both are the pattern to copy.
The adapter reads the host and never draws: the controller and `providers/review-panel.ts` draw, in the host's own tokens from its `theme.css`.

Required members:

- `id`, `describe(url, doc)`, `readDiff(doc)`, `headerTargets(doc)`, `listRows(doc)` and `fetchDiff(page, signal)`.

Everything else is optional and switches a feature on: `fetchReview` turns on the digest, `reviewHost` places it, `statusAction` gives the status menu, `diffFlowHost` gives Flow, and so on.
Leave a member out rather than return a guess: a feature the host cannot back stays off.

## 2. The review contract

`fetchReview` returns a `ProviderReviewSnapshot`.
Its review facts are turned into the shared `DigestDocument` (`packages/review/src/digest-document.ts`) by `digestFromProvider`, and the adapter is held to that document by `readProviderDigest` (`providers/digest-conformance.ts`).
Every adapter's review test must call `readProviderDigest` on a full read and on a read with a source missing, and expect no issues, as `gitlab/review.test.ts` and `bitbucket/review.test.ts` do.

The contract, in the order the conformance check reads it:

1. The subject is the review page itself: `providerReviewUrl(subject)` must be the URL a reader opens, and the head is a full or abbreviated hex SHA.
2. Every comment, thread comment and event links to the review host over https.
3. Event ids are unique.
4. A source that could not be read is reported in `unavailable`, labelled with a digest area (`comments`, `threads`, `reviews`, `checks`, `activity`, `tasks`, `bots`, `previews`) or one of the labels in `AREA_ALIASES`.
   An unknown label fails the document, so a new label is added to the alias table in the same change.
5. An unavailable area lists nothing: no reviewers while `reviews` is unavailable, no checks while `checks` is, no items while `threads` is.
   Unread is never empty, so do not return `[]` for a source that failed.
6. Each reviewer appears once, keyed by the host's durable account id, never by display name.
7. An account the host marks as automated is passed with `automated: true` and lands in the Review bots row, never in Reviews.

## 3. Native first

Prefer the host's own nodes and controls over copies.
A native control is relayed only when it is present, enabled and bound to the current review, head and account, and the relay is never reported as the server's success.
Native counts, labels and badges are rewritten in place and put back on teardown.
Colours, fonts and radii come from the host's design tokens, mapped to `--geld-provider-*` in the provider's `theme.css`.

## 4. Testing

- Unit-test the reader against API fixtures shaped like the host's documented responses, including a failed source.
- Add the conformance assertions above.
- Add an installed-browser case in `apps/extension/scripts/browser-e2e.mjs` against a public review, within the host's request budget (see `AGENTS.md`, "Browser cooldown attribution").
- Record in `docs/digest-parity.md` which rows the host supports and which it cannot.

## 5. Permissions

Host access is optional and requested from the popup or options page, as GitLab and Bitbucket are.
Never add a host to the required permissions: Chrome disables an extension on update until a new required host is approved.
