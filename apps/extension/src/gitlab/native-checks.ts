/**
 * GitLab's own pipeline section in its merge widget, for the CI row (`providers/native-checks.ts`): the status, the
 * pipeline's link and its stage mini-graph with GitLab's own menus. Only once it shows a pipeline (its mini-graph or
 * its pipeline line), never while it says "Checking pipeline status", and only one of it. While it is on loan it
 * stands in Geld's holder, where it is found again.
 */
export function gitLabNativeChecks(doc: Document): HTMLElement | null {
  const lent = [...doc.querySelectorAll<HTMLElement>('[data-geld-native-checks] > .mr-widget-section')];
  const home = [...doc.querySelectorAll<HTMLElement>('[data-testid="pipeline-container"] > .mr-widget-section')].filter((node) => node.closest('[data-geld-ui]') === null);
  const found = [...lent, ...home];
  if (found.length !== 1) return null;
  const section = found[0] ?? null;
  return section !== null && section.querySelector('[data-testid="pipeline-mini-graph"], [data-testid="pipeline-info-container"]') !== null ? section : null;
}
