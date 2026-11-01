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
  it('adds accessible totals without exposing or replacing aria-hidden native visuals and restores them on disable', () => {
    const group = document.createElement('div');
    group.innerHTML = '<h5>Lines updated</h5><span aria-hidden="true"><b>+46</b><b>−29</b></span>';
    document.body.append(group);
    const native = group.querySelector('span');
    const counts = new ProviderCounts();
    counts.writeSummary(group, { files: 1, additions: 1, deletions: 0 });
    expect(group.querySelector('.geld-provider-accessible-counts')?.textContent).toBe('1 file changed. Added 1 line. Removed 0 lines.');
    expect(native?.getAttribute('aria-hidden')).toBe('true');
    counts.writeSummary(group, { files: 0, additions: 0, deletions: 2 });
    expect(group.querySelectorAll('.geld-provider-accessible-counts')).toHaveLength(1);
    expect(group.querySelector('.geld-provider-accessible-counts')?.textContent).toBe('0 files changed. Added 0 lines. Removed 2 lines.');
    counts.restore();
    expect(group.querySelector('.geld-provider-accessible-counts')).toBeNull();
    expect(group.querySelector('span')).toBe(native);
    expect(group.textContent).toBe('Lines updated+46−29');
  });

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

  it('keeps spoken line counts consistent and restores the newest native wording', () => {
    const count = host();
    count.setAttribute('aria-label', 'Added 1,204 lines.');
    const counts = new ProviderCounts();
    counts.write(count, 1);
    counts.writeAttribute(count, 'aria-label', 1);
    expect(count.textContent).toBe('1 addition');
    expect(count.getAttribute('aria-label')).toBe('Added 1 line.');
    count.setAttribute('aria-label', 'Added 208 lines.');
    counts.writeAttribute(count, 'aria-label', 0);
    expect(count.getAttribute('aria-label')).toBe('Added 0 lines.');
    counts.restore();
    expect(count.getAttribute('aria-label')).toBe('Added 208 lines.');
  });

  it('rewrites both spoken line counts in a combined native label and restores later native totals', () => {
    const count = host();
    const counts = new ProviderCounts();
    count.setAttribute('aria-label', 'Added 36 lines. Removed 1 line.');
    counts.writeLineAttribute(count, 'aria-label', { additions: 1, deletions: 0 });
    expect(count.getAttribute('aria-label')).toBe('Added 1 line. Removed 0 lines.');
    count.setAttribute('aria-label', 'Added 50 lines. Removed 8 lines.');
    counts.writeLineAttribute(count, 'aria-label', { additions: 4, deletions: 2 });
    expect(count.getAttribute('aria-label')).toBe('Added 4 lines. Removed 2 lines.');
    counts.restore();
    expect(count.getAttribute('aria-label')).toBe('Added 50 lines. Removed 8 lines.');
  });

  it('does not rewrite aggregate labels or overwrite later native accessibility changes', () => {
    const count = host();
    const counts = new ProviderCounts();
    count.title = '3 files, 36 additions';
    counts.writeAttribute(count, 'title', 4);
    expect(count.title).toBe('3 files, 36 additions');
    count.setAttribute('aria-label', 'Added 36 lines.');
    counts.writeAttribute(count, 'aria-label', 4);
    count.setAttribute('aria-label', 'Added 80 lines.');
    counts.restore();
    expect(count.getAttribute('aria-label')).toBe('Added 80 lines.');
  });
});
