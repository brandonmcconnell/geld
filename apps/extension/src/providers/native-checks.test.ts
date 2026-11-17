// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { NativeChecksLoan } from './native-checks';
import { gitLabNativeChecks } from '../gitlab/native-checks';

function page(): { home: HTMLElement; native: HTMLElement; slot: HTMLElement } {
  document.body.innerHTML = '<div data-testid="pipeline-container"><div class="mr-widget-section"><div data-testid="pipeline-mini-graph"></div></div><!----></div><div data-geld-ui><div id="slot"></div></div>';
  return { home: document.querySelector('[data-testid="pipeline-container"]')!, native: document.querySelector('.mr-widget-section')!, slot: document.getElementById('slot')! };
}

describe('NativeChecksLoan', () => {
  it('lends the host’s section into the row and sends it back to its place', () => {
    const { home, native, slot } = page();
    const loan = new NativeChecksLoan(vi.fn());
    loan.sync(slot, native);
    expect(slot.querySelector('[data-geld-native-checks] > .mr-widget-section')).toBe(native);
    expect(home.firstChild?.nodeType).toBe(Node.COMMENT_NODE);
    // Found again while away, so the same loan stands.
    expect(gitLabNativeChecks(document)).toBe(native);
    loan.sync(slot, native);
    expect(slot.querySelectorAll('[data-geld-native-checks]')).toHaveLength(1);
    loan.return();
    expect(home.firstElementChild).toBe(native);
    expect(home.innerHTML).toBe('<div class="mr-widget-section"><div data-testid="pipeline-mini-graph"></div></div><!---->');
    expect(slot.childNodes).toHaveLength(0);
  });

  it('takes home whatever the framework put beside the lent node, and nothing to a home that went', () => {
    const { home, native, slot } = page();
    const loan = new NativeChecksLoan(vi.fn());
    loan.sync(slot, native);
    // Vue replaces a node where it stands: the replacement lands in the holder.
    const replacement = document.createElement('div');
    replacement.className = 'mr-widget-section';
    native.replaceWith(replacement);
    loan.return();
    expect(home.firstElementChild).toBe(replacement);
    loan.sync(slot, replacement);
    home.remove();
    loan.return();
    expect(slot.childNodes).toHaveLength(0);
  });

  it('reads no section while GitLab is still checking the pipeline', () => {
    document.body.innerHTML = '<div data-testid="pipeline-container"><div class="mr-widget-section"><p data-testid="monitoring-pipeline-message">Checking pipeline status.</p></div></div>';
    expect(gitLabNativeChecks(document)).toBeNull();
  });

  it('asks the row again when the framework rebuilds the section at home', async () => {
    const { home, native, slot } = page();
    const changed = vi.fn();
    const loan = new NativeChecksLoan(changed);
    loan.sync(slot, native);
    home.append(document.createElement('div'));
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    loan.return();
  });
});
