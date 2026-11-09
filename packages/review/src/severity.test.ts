import { describe, expect, it } from 'vitest';
import { findingSeverity, verdictsFrom } from './bots';
import type { BotComment } from './bots';

// Each bot's own way of grading a finding, as surveyed on public pull requests (Nov 2026): the raw Markdown the Action
// reads, and the page's text with badge images kept as `![alt]` (`blockText(…, true)`), which the extension reads.
describe('findingSeverity', () => {
  const cases: readonly (readonly [string, string, 'high' | 'medium' | 'low' | null])[] = [
    ['Bugbot', '### Worker re-exec hits argument length limits\n\n**High Severity**\n\nThe argv grows…', 'high'],
    ['Bugbot', '### Library sidecar still maps to tests\n\n**Medium Severity**', 'medium'],
    ['Capy', '### Mirrored releases may overwrite counters\n\n**Medium Severity · Investigate**', 'medium'],
    ['Cursor security review', '<!-- CURSOR_AUTOMATION_ID: 1 -->\n🔒 **Agentic Security Review**\nSeverity: HIGH\nThe live-host allowlist…', 'high'],
    ['Cursor security review', '🔒 **Agentic Security Review**\nSeverity: MEDIUM\nThis worker entrypoint…', 'medium'],
    ['Macroscope', '<!-- MURMUR_IGNORE -->\n🟠 **High** `src/findings.ts:117`\n\nA finding with…', 'high'],
    ['Macroscope', '🔴 **Critical** `controllers/register.controller.ts:40`', 'high'],
    ['Macroscope', '🟢 **Low** `http2_stream.go:265`', 'low'],
    ['Sourcery', '**🟡 Medium · Older Inkscape keeps running**\n\nWhen windows has…', 'medium'],
    ['Sourcery', '**🟠 高 · 错误的收藏项仍处于选中状态**', 'high'],
    ['Sourcery', '**⚪ Low · Error names the wrong path**', 'low'],
    ['CodeRabbit', '**<picture><img src="https://x/amber-16.svg" alt=""></picture> Major** · **Functional Correctness** · **Quick win**', 'high'],
    ['CodeRabbit', '**Minor** · **Stability & Availability** · **Quick win**\n\n**Scope the call…**', 'medium'],
    ['CodeRabbit', '**Trivial** · **Maintainability & Code Quality**', 'low'],
    ['CodeRabbit, older', '_⚠️ Potential issue_ | _🔴 Critical_\n\n**Unbounded retry…**', 'high'],
    ['Codex', '**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Replace the deadline polling**', 'high'],
    ['Codex', '**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Preserve exterior briefing**', 'medium'],
    ['Codex, page', '**![P1 Badge] Replace the deadline polling**', 'high'],
    ['Greptile', '<a href="#"><img alt="P1" src="https://x/p1.svg" align="top"></a> **Subdivision clicks go missing**', 'high'],
    ['Greptile', '<a href="#"><img alt="P2" src="https://x/p2.svg" align="top"></a> **Long beats disappear**', 'medium'],
    ['Greptile, page', '![P1] **Approval erases known findings**', 'high'],
    ['cubic', 'P1: Custom agent: **VEIL Critical Bug Review**\n\nRevalidate the live control…', 'high'],
    ['cubic', 'P3: This fixture is inconsistent', 'low'],
    ['Gemini', '![high](https://www.gstatic.com/codereviewagent/high-priority.svg)\n\nThe Render API uses…', 'high'],
    ['Gemini, page', '![medium]\n\nPerforming an exact dictionary equality check…', 'medium'],
    ['Entelligence', '![MAJOR](https://x/major.svg) ![STATE](https://x/state.svg) **Record a stuck plane**', 'high'],
    ['Entelligence', '![NIT](https://x/nit.svg) ![BUILD_FAILURE](https://x/b.svg) **Import NodeError**', 'low'],
    ['Qodo', '<img src="https://img.shields.io/badge/High-634FD1?style=flat-square" height="20px" alt="Action required">\n\n1\\. The new verification check never runs', 'high'],
    ['Qodo', '<img src="https://img.shields.io/badge/P1-634FD1?style=flat-square" height="20px" alt="Remediation recommended">', 'medium'],
    ['Qodo, page', '![Action required]\n\n1. The new verification check never runs 🐞 Bug', 'high'],
    ['Claude', '🔴 The chat-tap allow for a take-the-lead card skips three checks', 'high'],
    ['Claude', '**bestax-migrate still says Message always wraps its children** — 🟡 Minor · Correctness', 'medium'],
    ['Claude', '### K1 · 🟢 `[nit]` · `CONFIRMED`', 'low'],
    ['Devin', '🔴 **Pre-construction inscription misattributed to complex**', 'high'],
    ['Devin', '🟡 **Short magics can skip notebook formatting**', 'medium'],
    ['Amazon Q', ':stop_sign: **Logic Error**: The assertion on line 69 tests for the string…', 'high'],
    // No grade of its own: the bot's words, or a title that only starts with a level word.
    ['Devin, investigate', '🔍 **Interrupted captures leave orphaned sidecars**', null],
    ['Ellipsis', '`exsectionformat=raw` makes every novel description garbage', null],
    ['Greptile title', '<a href="#"><img alt="P2" src="x"></a> **Critical section not released**', 'medium'],
    ['plain title', '**Critical section not released on error**\n\nThe lock is held…', null],
    ['prose', 'The retry loop never exits. Later on, high load makes it worse.', null],
    ['a later line', 'The guard is fine.\n\nIt reads the config.\n\n**High Severity**', null],
    // An explicit grade wins over prose that mentions a severity.
    ['Greptile over prose', '![P2](x)\nThis can hide high severity findings.', 'medium'],
    ['prose about severity', 'The retry loop never exits.\nThis is a high severity issue in practice.', null],
  ];
  for (const [bot, body, expected] of cases) {
    it(`${bot}: ${expected ?? 'none'}`, () => expect(findingSeverity(body)).toBe(expected));
  }
});

describe('severity on the verdict', () => {
  const HEAD = 'a'.repeat(40);
  const thread = (anchor: string, body: string, resolved: boolean, grade?: 'high' | 'medium' | 'low'): BotComment => ({
    author: 'greptile-apps[bot]',
    body,
    anchor,
    createdAt: '2026-11-08T12:00:00Z',
    resolved,
    ...(grade === undefined ? {} : { grade }),
  });
  it('carries the worst open grade, and drops it once that finding is resolved', () => {
    const p1 = '<a href="#"><img alt="P1" src="x"></a> **Approval erases known findings**';
    const p2 = '<a href="#"><img alt="P2" src="x"></a> **HTML examples vanish**';
    expect(verdictsFrom([], [thread('discussion_r1', p1, false), thread('discussion_r2', p2, false)], HEAD)[0]).toMatchObject({ verdict: 'findings', count: 2, severity: 'high' });
    expect(verdictsFrom([], [thread('discussion_r1', p1, true), thread('discussion_r2', p2, false)], HEAD)[0]).toMatchObject({ count: 1, severity: 'medium' });
    expect(verdictsFrom([], [thread('discussion_r1', p1, true), thread('discussion_r2', p2, true)], HEAD)[0]).toMatchObject({ count: 0 });
  });

  it("takes the page's grade, read with the badges, over the words that lost them", () => {
    // On the page the P1 badge is an image: its words alone carry no grade, the crawler's `grade` does.
    expect(verdictsFrom([], [thread('discussion_r1', '**Approval erases known findings**', false, 'high')], HEAD)[0]?.severity).toBe('high');
    expect(verdictsFrom([], [thread('discussion_r1', '**Approval erases known findings**', false)], HEAD)[0]?.severity).toBeUndefined();
  });
});
