Stop the metric detail tile from scrolling horizontally.


<!-- greptile_comment -->

<!-- greptile_summary -->

<details open><summary>Greptile Summary</summary>

This PR removes horizontal-overflow protection from the metric detail description.
- Removes explicit horizontal clipping.
- Removes forced wrapping for long, unbroken help text.
- As written, the change can restore horizontal scrolling rather than prevent it.
</details>


<details open><summary>Confidence Score: 4/5</summary>

This PR is not safe to merge until metric descriptions are prevented from overflowing horizontally.

Unbounded metric help text can contain long unbroken content, and retaining vertical auto-overflow while removing wrapping and horizontal clipping makes the description horizontally scrollable.

**Files Needing Attention:** public/app/features/explore/SignalExplorer/MetricDetailPanel.tsx
</details>


<details open><summary>Important Files Changed</summary>




| Filename | Overview |
|----------|----------|
| public/app/features/explore/SignalExplorer/MetricDetailPanel.tsx | Removes wrapping and horizontal-overflow constraints from unbounded metric help text, allowing the description region to scroll horizontally. |

</details>

<sub>Reviews (1): Last reviewed commit: ["Stop the metric detail tile from scrolli..."](https://github.com/goosy-benchmark/grafana-greptile/commit/36f863274eb601214b83fe47fa5d59ee35a0cdbb) | [Re-trigger Greptile](https://app.greptile.com/api/retrigger?id=65056935)</sub>

> Greptile also left **1 inline comment** on this PR.

<!-- /greptile_comment -->
