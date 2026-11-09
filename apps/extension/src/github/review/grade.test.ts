// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { findingSeverity } from '@geld/review';
import { blockText } from './crawler';

// On the page a badge is an image: the words alone lose the grade, so the crawler reads it with the alts kept.
describe('a finding’s grade as the page renders it', () => {
  const graded = (html: string): ReturnType<typeof findingSeverity> => {
    const body = document.createElement('div');
    body.innerHTML = html;
    return findingSeverity(blockText(body, true));
  };
  it('keeps the badges that carry it', () => {
    expect(graded('<p><a href="#"><img alt="P1" src="https://x/p1.svg" align="top"></a> <strong>Approval erases known findings</strong></p>')).toBe('high');
    expect(graded('<p><strong><sub><sub><img alt="P2 Badge" src="https://img.shields.io/badge/P2-yellow"></sub></sub> Preserve the briefing</strong></p>')).toBe('medium');
    expect(graded('<p><img alt="high" src="https://www.gstatic.com/codereviewagent/high-priority.svg"></p><p>The Render API uses…</p>')).toBe('high');
    expect(graded('<p><img alt="Action required" src="https://img.shields.io/badge/High-634FD1"></p><p>1. The check never runs</p>')).toBe('high');
    expect(graded('<p><img alt="MAJOR" src="x"> <img alt="STATE" src="y"> <strong>Record a stuck plane</strong></p>')).toBe('high');
    expect(graded('<p>🟠 <strong>High</strong> <code>src/findings.ts:117</code></p><p>A finding with…</p>')).toBe('high');
    expect(graded('<p><strong><picture><img alt="" src="x"></picture> Minor</strong> · <strong>Functional Correctness</strong></p>')).toBe('medium');
  });
  it('reads nothing from words that only mention a level', () => {
    expect(graded('<p><img alt="avatar" src="x"> The retry loop never exits under high load.</p>')).toBeNull();
    const body = document.createElement('div');
    body.innerHTML = '<p><img alt="P1" src="x"> <strong>Title</strong></p>';
    expect(blockText(body)).not.toContain('P1');
  });
});
