/**
 * Geld presses some of GitHub's controls itself while a page loads: "Load
 * more" so compact mode has the whole timeline to fold, "Expand checks" so
 * the checks list renders its gear. GitHub's `behaviors` bundle listens for
 * clicks on the document and, when the page was opened on a permalink
 * (`#pullrequestreview-…`), treats any click outside the targeted element
 * as the reader moving on: it drops the hash from the URL. A press Geld
 * made is not the reader moving on.
 *
 * The content script runs at `document_start`, before GitHub's bundles, so
 * a bubble-phase click listener of ours on the document runs before any of
 * GitHub's document-level ones. For a click Geld dispatched it stops the
 * event there: the control's own listeners and React's root listener (both
 * below the document) have already run, and a submit button's form still
 * submits, since activation is not propagation. Only what GitHub delegates
 * at the document itself is skipped, and for these controls that is the
 * hash handling.
 */

let quietDepth = 0;

function installed(): void {
  document.addEventListener('click', (event) => {
    if (quietDepth > 0) event.stopImmediatePropagation();
  });
}

installed();

/** Click `control` on Geld's behalf, without GitHub reading it as the reader clicking away. */
export function quietClick(control: HTMLElement): void {
  quietDepth += 1;
  try {
    control.click();
  } finally {
    quietDepth -= 1;
  }
}
