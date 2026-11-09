// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { forgetViewFocusElsewhere, requestViewFocus, takeViewFocus } from './view-focus';

describe('view focus', () => {
  it('goes to the control that stands for the chosen view, once', () => {
    requestViewFocus('panel');
    expect(takeViewFocus('off-line')).toBe(false);
    expect(takeViewFocus('panel')).toBe(true);
    expect(takeViewFocus('panel')).toBe(false);
  });

  it('is withdrawn when its write fails, but a newer choice keeps its own request', () => {
    const withdrawFirst = requestViewFocus('off-line');
    withdrawFirst();
    expect(takeViewFocus('off-line')).toBe(false);
    const withdrawOlder = requestViewFocus('panel');
    requestViewFocus('off-line');
    withdrawOlder();
    expect(takeViewFocus('off-line')).toBe(true);
  });

  it('is dropped once the reader is on another page', () => {
    history.replaceState(null, '', '/o/r/pull/1');
    requestViewFocus('panel');
    history.replaceState(null, '', '/o/r/pull/1/files');
    forgetViewFocusElsewhere();
    history.replaceState(null, '', '/o/r/pull/1');
    expect(takeViewFocus('panel')).toBe(false);
  });
});
