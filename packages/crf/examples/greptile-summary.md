<!-- greptile_summary -->

## Confidence Score: 5/5

[Retrigger](https://app.greptile.com/api/retrigger?id=86326225) · [View in Greptile](https://app.greptile.com/geld/github/brandonmcconnell/geld/-/pull/68)

**[Low impact]** The PR appears safe to merge, with one non-blocking fence-reading edge case.

## Findings

1. **P2** · **Fenced examples become review claims** [▶](https://github.com/brandonmcconnell/geld/pull/68#discussion_r4390820048)

<details><summary><h3>Summary</h3></summary>

Adds the draft `@geld/crf` package for shared, machine-readable review comments.
</details>

<!-- greptile_confidence_score:5 -->

<sub>Reviews (3) · Last reviewed commit: 581af4d</sub>

<!-- crf:v0 {"schema":"crf/v0","bot":{"name":"Greptile","app":"greptile-apps"},"links":{"view":{"type":"url","url":"https://app.greptile.com/geld/github/brandonmcconnell/geld/-/pull/68","label":"View in Greptile"},"rerun":{"type":"url","url":"https://app.greptile.com/api/retrigger?id=86326225","label":"Retrigger"}},"kind":"summary","run":{"id":"greptile-86326225","state":"completed","headSha":"581af4d4a399402a68856431cdcefe5ea6f36f89","sequence":3},"result":{"verdict":"findings","score":{"value":5,"max":5},"risk":"low","counts":{"medium":1},"findings":[{"id":"fenced-examples-become-claims","title":"Fenced examples become review claims","severity":"medium","location":{"path":"packages/crf/src/carrier.ts","line":45,"side":"RIGHT"},"category":"bug","vendorSeverity":"P2","commentId":4390820048}]}} -->
