// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { editedMark } from './edited-mark';

const LOG = '/user_content_edits/show_edit_history_log/IC_kwDOUOpwns8AAAABhvX2ag';

describe('editedMark', () => {
  beforeEach(() => {
    document.body.innerHTML = '<tool-tip for="x">GitHub\u2019s own</tool-tip>';
  });

  it('puts the tooltip beside the history menu, outside the closed details that would hide it', () => {
    const mark = editedMark('2026-11-03T10:16:17Z', '2026-11-03T10:12:20Z', LOG);
    document.body.append(mark);
    const details = mark.querySelector('details');
    const summary = details?.querySelector('summary');
    const tip = mark.querySelector('tool-tip');
    expect(details).not.toBeNull();
    expect(tip).not.toBeNull();
    expect(details?.contains(tip)).toBe(false);
    expect(tip?.getAttribute('for')).toBe(summary?.id);
  });

  it('keeps the history menu itself when the page has no tool-tip', () => {
    document.body.innerHTML = '';
    const mark = editedMark('2026-11-03T10:16:17Z', '2026-11-03T10:12:20Z', LOG);
    expect(mark.tagName).toBe('DETAILS');
    expect(mark.querySelector('summary')?.getAttribute('title')).toMatch(/^Originally posted /);
  });
});
