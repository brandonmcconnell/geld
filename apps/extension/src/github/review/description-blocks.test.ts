// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { sectionResetsOf, toolBlocksOf } from './description-blocks';

function blocksOf(html: string): Element[] {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return [...holder.children];
}

// Trimmed from the rendered descriptions of public pull requests (Nov 2026), comments already stripped by GitHub.
const CODERABBIT = '<h2 dir="auto">Summary by CodeRabbit</h2><ul dir="auto"><li><strong>Breaking Changes</strong></li></ul>';
const SOURCERY = '<h2 dir="auto">Summary by Sourcery</h2><p dir="auto">Documentation:</p><ul dir="auto"><li>Document the build.</li></ul>';
const CUBIC =
  '<h2 dir="auto">Summary by cubic</h2><p dir="auto">Adds Alp to the webring.</p>' +
  '<p dir="auto"><sup>Written for commit <a class="commit-link" href="https://github.com/o/r/commit/78dffef"><tt>78dffef</tt></a>. Summary will update on new commits.</sup></p>' +
  '<p dir="auto"><a href="https://cubic.dev/pr/o/r/pull/23?utm_source=github"><picture><img alt="View guided diff" src="x.svg"></picture></a></p>';
const GREPTILE =
  '<details open=""><summary>Greptile Summary</summary><p>This PR removes overflow protection.</p></details>' +
  '<details open=""><summary>Confidence Score: 4/5</summary><p>Not safe to merge yet.</p></details>' +
  '<details open=""><summary>Important Files Changed</summary><table><tr><td>a.tsx</td></tr></table></details>' +
  '<p dir="auto"><sub>Reviews (1): Last reviewed commit: <a href="https://github.com/o/r/commit/36f8632">"Stop the tile…"</a> | <a href="https://app.greptile.com/api/retrigger?id=65056935">Re-trigger Greptile</a></sub></p>' +
  '<blockquote><p dir="auto">Greptile also left <strong>1 inline comment</strong> on this PR.</p></blockquote>';
const ELLIPSIS =
  '<table role="table"><thead><tr><th>🚀 This description was created by <a href="https://www.ellipsis.dev">Ellipsis</a> for commit <tt>a00b53a</tt></th></tr></thead></table>' +
  '<h3 dir="auto">Summary:</h3><p dir="auto">This PR updates the setup script.</p><hr>' +
  '<p dir="auto">Generated with ❤️ by <a href="https://www.ellipsis.dev">ellipsis.dev</a></p>';
const BUGBOT =
  '<div class="markdown-alert markdown-alert-note" dir="auto"><p class="markdown-alert-title" dir="auto">Note</p><p dir="auto"><strong>Low Risk</strong><br>Metadata only.</p>' +
  '<p dir="auto"><sup>Written by <a href="https://cursor.com/dashboard?tab=bugbot">Cursor Bugbot</a> for commit <tt>3c2c48b</tt>. This will update automatically on new commits.</sup></p></div>';
const CURSOR_AGENT =
  '<div><a href="https://cursor.com/agents/bc-f4c8?cursor_ref=pr_footer"><picture><img alt="Open in Web" src="w.png"></picture></a>&nbsp;' +
  '<a href="https://cursor.com/background-agent?bcId=bc-f4c8"><picture><img alt="Open in Cursor" src="c.png"></picture></a>&nbsp;</div>';
const CLAUDE = '<p dir="auto">🤖 Generated with <a href="https://claude.com/claude-code">Claude Code</a></p>';
const DEVIN = '<p dir="auto">Link to Devin session: <a href="https://app.devin.ai/sessions/854b1146">https://app.devin.ai/sessions/854b1146</a></p>';

describe('toolBlocksOf', () => {
  it('finds a heading-led summary with no closing line as its heading alone, not bounded', () => {
    expect(toolBlocksOf(blocksOf(`<p>mine</p>${CODERABBIT}`))).toEqual([{ id: 'coderabbit', start: 1, end: 1, bounded: false }]);
    expect(toolBlocksOf(blocksOf(SOURCERY))).toEqual([{ id: 'sourcery', start: 0, end: 0, bounded: false }]);
  });

  it('runs a summary to its closing block, trailing notes included', () => {
    expect(toolBlocksOf(blocksOf(`${CUBIC}<p>after</p>`))).toEqual([{ id: 'cubic', start: 0, end: 3, bounded: true }]);
    expect(toolBlocksOf(blocksOf(`<p>mine</p>${GREPTILE}<p>after</p>`))).toEqual([{ id: 'greptile', start: 1, end: 5, bounded: true }]);
    expect(toolBlocksOf(blocksOf(ELLIPSIS))).toEqual([{ id: 'ellipsis', start: 0, end: 4, bounded: true }]);
  });

  it('finds one-block notes and footers', () => {
    expect(toolBlocksOf(blocksOf(`${BUGBOT}<p>mine</p>${CURSOR_AGENT}${CLAUDE}${DEVIN}`))).toEqual([
      { id: 'bugbot', start: 0, end: 0, bounded: true },
      { id: 'cursor-agent', start: 2, end: 2, bounded: true },
      { id: 'claude-code', start: 3, end: 3, bounded: true },
      { id: 'devin', start: 4, end: 4, bounded: true },
    ]);
  });

  it('leaves an author’s own words alone, even when they mention a tool', () => {
    const blocks = blocksOf(
      '<h2>Summary</h2><p>CodeRabbit and Greptile reviewed this.</p><p>See <a href="https://cursor.com/docs">the docs</a> on Cursor.</p>' +
        '<details><summary>Notes</summary><p>a</p></details><p>Generated with care, not Claude Code.</p>',
    );
    expect(toolBlocksOf(blocks)).toEqual([]);
  });
});

describe('sectionResetsOf', () => {
  it('ends every section where a tool starts, and after one that is known to stop', () => {
    const tools = toolBlocksOf(blocksOf(`<p>mine</p>${CODERABBIT}<p>more</p>${CUBIC}<p>after</p>`));
    // 0 mine, 1–2 CodeRabbit, 3 more, 4–7 cubic, 8 after.
    expect([...sectionResetsOf(tools)].sort((a, b) => a - b)).toEqual([1, 4, 8]);
  });
});
