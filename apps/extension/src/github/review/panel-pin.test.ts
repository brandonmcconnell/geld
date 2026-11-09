// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { pinPanelHost, releasePanelPin } from './panel';

function page(loaned: boolean, minHeight = ''): { host: HTMLElement; slot: HTMLElement } {
  document.body.innerHTML = `
    <div class="TimelineItem-body" id="host" style="${minHeight === '' ? '' : `min-height: ${minHeight}`}">
      <div class="timeline-comment">Description</div>
      <section class="geld-review" data-geld-review-panel>
        <div data-geld-slot="bots"><div class="geld-review__slot-body" id="slot">${loaned ? '<div data-geld-teleported="t1">comment</div>' : ''}</div></div>
      </section>
    </div>`;
  const host = document.getElementById('host');
  const slot = document.getElementById('slot');
  if (host === null || slot === null) throw new Error('fixture');
  host.getBoundingClientRect = () => new DOMRect(0, 0, 900, 1340);
  return { host, slot };
}

afterEach(() => releasePanelPin());

describe('pinPanelHost', () => {
  it('holds the panel container at its height while the open slot lends nodes, until released', () => {
    const { host, slot } = page(true);
    pinPanelHost(slot);
    expect(host.style.minHeight).toBe('1340px');
    releasePanelPin();
    expect(host.style.minHeight).toBe('');
  });

  it('gives back a min-height the container already had', () => {
    const { host, slot } = page(true, '200px');
    pinPanelHost(slot);
    expect(host.style.minHeight).toBe('1340px');
    releasePanelPin();
    expect(host.style.minHeight).toBe('200px');
  });

  it('keeps the first pin when asked again in the same pass', () => {
    const { host, slot } = page(true);
    pinPanelHost(slot);
    host.getBoundingClientRect = () => new DOMRect(0, 0, 900, 300);
    pinPanelHost(slot);
    expect(host.style.minHeight).toBe('1340px');
  });

  it('pins nothing when no node is on loan, since nothing leaves the page', () => {
    const { host, slot } = page(false);
    pinPanelHost(slot);
    expect(host.style.minHeight).toBe('');
  });
});
