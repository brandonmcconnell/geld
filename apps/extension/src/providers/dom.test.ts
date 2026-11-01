// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { ProviderCounts } from './dom';

beforeEach(() => { document.body.innerHTML = ''; });

function host(): HTMLElement {
  const count = document.createElement('span');
  count.innerHTML = '<svg aria-label="Added"><path d="M1 1"></path></svg><strong>1,204 additions</strong>';
  document.body.append(count);
  return count;
}

describe('native provider count ownership', () => {
  it('restores native wording while preserving the original icon and child element identities', () => {
    const count = host();
    const icon = count.querySelector('svg');
    const label = count.querySelector('strong');
    const counts = new ProviderCounts();
    counts.write(count, 18);
    expect(count.textContent).toBe('18 additions');
    expect(count.querySelector('svg')).toBe(icon);
    expect(count.querySelector('strong')).toBe(label);
    counts.restore();
    expect(count.textContent).toBe('1,204 additions');
    expect(count.querySelector('svg')).toBe(icon);
    expect(count.querySelector('strong')).toBe(label);
  });

  it('keeps count wording grammatical when the filtered result has one line or file', () => {
    const count = host();
    const counts = new ProviderCounts();
    counts.write(count, 1);
    expect(count.textContent).toBe('1 addition');
    count.innerHTML = '<strong>3 files changed</strong>';
    counts.write(count, 1);
    expect(count.textContent).toBe('1 file changed');
    counts.restore();
    expect(count.textContent).toBe('3 files changed');
  });

  it('adopts a native count update instead of restoring an obsolete number', () => {
    const count = host();
    const label = count.querySelector('strong');
    if (label?.firstChild === null || label?.firstChild === undefined) throw new Error('Missing native count');
    const text = label.firstChild;
    const counts = new ProviderCounts();
    counts.write(count, 18);
    text.textContent = '208 additions';
    counts.write(count, 24);
    expect(count.textContent).toBe('24 additions');
    counts.restore();
    expect(count.textContent).toBe('208 additions');
  });

  it('does not overwrite native text that changed after the last managed write', () => {
    const count = host();
    const counts = new ProviderCounts();
    counts.write(count, 18);
    const label = count.querySelector('strong');
    if (label === null) throw new Error('Missing native label');
    label.textContent = '600 additions';
    counts.restore();
    expect(count.textContent).toBe('600 additions');
  });

  it('follows a replaced native counter without retaining detached text or destroying the new icon', () => {
    const count = host();
    const counts = new ProviderCounts();
    counts.write(count, 18);
    count.innerHTML = '<svg aria-label="Updated icon"></svg><em>333 additions</em>';
    const replacement = count.querySelector('svg');
    counts.write(count, 8);
    expect(count.textContent).toBe('8 additions');
    expect(count.querySelector('svg')).toBe(replacement);
    counts.restore();
    expect(count.textContent).toBe('333 additions');
    expect(count.querySelector('svg')).toBe(replacement);
  });
});
