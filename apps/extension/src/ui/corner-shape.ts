/**
 * Load the `corner-shape` polyfill (hyperellipse) in browsers without the
 * native property — Safari, for this extension. The dynamic import lands in
 * its own chunk, so Chrome, Edge and Firefox builds never fetch it; `base.css`
 * carries the `--corner-shape` twin the polyfill reads.
 */
export function polyfillCornerShape(): void {
  if (typeof CSS === 'undefined' || CSS.supports('corner-shape', 'bevel')) return;
  void import('hyperellipse').then(({ registerHyperellipse }) => registerHyperellipse());
}
