// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { authorWordsAfter, toolBlocksOf, verdictOf } from './description-blocks';

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
// The wording since Nov 2026 (mintlify/mint#14335), as GitHub renders it.
const BUGBOT_REVIEWED =
  '<div class="markdown-alert markdown-alert-note" dir="auto"><p class="markdown-alert-title" dir="auto">Note</p><p dir="auto"><strong>Medium Risk</strong><br>Touches public asset classification.</p>' +
  '<p dir="auto"><sup>Reviewed by <a href="https://cursor.com/bugbot" rel="nofollow">Cursor Bugbot</a> for commit f98e39d. Bugbot is set up for automated code reviews on this repo. Configure <a href="https://www.cursor.com/dashboard/bugbot" rel="nofollow">here</a>.</sup></p></div>';
const CURSOR_AGENT =
  '<div><a href="https://cursor.com/agents/bc-f4c8?cursor_ref=pr_footer"><picture><img alt="Open in Web" src="w.png"></picture></a>&nbsp;' +
  '<a href="https://cursor.com/background-agent?bcId=bc-f4c8"><picture><img alt="Open in Cursor" src="c.png"></picture></a>&nbsp;</div>';
const CLAUDE = '<p dir="auto">🤖 Generated with <a href="https://claude.com/claude-code">Claude Code</a></p>';
const DEVIN = '<p dir="auto">Link to Devin session: <a href="https://app.devin.ai/sessions/854b1146">https://app.devin.ai/sessions/854b1146</a></p>';

const at = (id: string, start: number, end: number, title: number | null = null): { id: string; start: number; end: number; title: number | null } => ({ id, start, end, title });
const spans = (html: string): ReturnType<typeof at>[] => toolBlocksOf(blocksOf(html)).map(({ id, start, end, title }) => ({ id, start, end, title }));

describe('toolBlocksOf', () => {
  it('runs a heading-led summary with no closing line as its heading’s section does', () => {
    expect(spans(`<p>mine</p>${CODERABBIT}`)).toEqual([at('coderabbit', 1, 2, 1)]);
    expect(spans(`${SOURCERY}<h2>Mine</h2><p>m</p>`)).toEqual([at('sourcery', 0, 2, 0)]);
  });

  it('runs a summary to its closing block, trailing notes included', () => {
    expect(spans(`${CUBIC}<p>after</p>`)).toEqual([at('cubic', 0, 3, 0)]);
    expect(spans(`<p>mine</p>${GREPTILE}<p>after</p>`)).toEqual([at('greptile', 1, 5)]);
    expect(spans(ELLIPSIS)).toEqual([at('ellipsis', 0, 4)]);
  });

  it('finds Bugbot’s note signed "Reviewed by", with the rule above it', () => {
    expect(spans(`<p>mine</p><hr>${BUGBOT_REVIEWED}`)).toEqual([at('bugbot', 1, 2)]);
  });

  it('finds one-block notes and footers, with the rule just above a footer', () => {
    expect(spans(`${BUGBOT}<p>mine</p>${CURSOR_AGENT}<hr>${CLAUDE}${DEVIN}`)).toEqual([
      at('bugbot', 0, 0),
      at('cursor-agent', 2, 2),
      at('claude-code', 3, 4),
      at('devin', 5, 5),
    ]);
  });

  it('names each tool and the mark it wears', () => {
    const tools = toolBlocksOf(blocksOf(`${CODERABBIT}${BUGBOT}${CURSOR_AGENT}${CLAUDE}`));
    expect(tools.map(({ name, bot }) => [name, bot])).toEqual([
      ['CodeRabbit', 'coderabbit'],
      ['Cursor Bugbot', 'bugbot'],
      ['Cursor', 'bugbot'],
      ['Claude Code', 'claude'],
    ]);
  });

  it('ends a heading-led summary at the next tool', () => {
    expect(spans(`${CODERABBIT}<p>more</p>${BUGBOT}`)).toEqual([at('coderabbit', 0, 2, 0), at('bugbot', 3, 3)]);
  });

  it('leaves an author’s own words alone, even when they mention a tool', () => {
    const blocks = blocksOf(
      '<h2>Summary</h2><p>CodeRabbit and Greptile reviewed this.</p><p>See <a href="https://cursor.com/docs">the docs</a> on Cursor.</p>' +
        '<details><summary>Notes</summary><p>a</p></details><p>Generated with care, not Claude Code.</p>',
    );
    expect(toolBlocksOf(blocks)).toEqual([]);
  });
});

describe('authorWordsAfter', () => {
  it('reads the author’s words after each marked block, up to the next one', () => {
    const markdown =
      'Intro\n\n<!-- This is an auto-generated comment: release notes by coderabbit.ai -->\n## Summary by CodeRabbit\n* x\n' +
      '<!-- end of auto-generated comment: release notes by coderabbit.ai -->\n\n## Testing notes\nRan the [suite](https://x.test) twice.\n\n' +
      '<!-- CURSOR_SUMMARY -->\n> [!NOTE]\n> Low Risk\n<!-- /CURSOR_SUMMARY -->';
    expect(authorWordsAfter(markdown)).toEqual(new Map([['coderabbit', ['testing notes ran the suite twice']]]));
  });

  it('has nothing for blocks that run into the next tool or the end', () => {
    expect(authorWordsAfter('<!-- greptile_comment -->a<!-- /greptile_comment -->\n<!-- CURSOR_SUMMARY -->b<!-- /CURSOR_SUMMARY -->').size).toBe(0);
  });

  it('stops a heading-led summary where the author’s words resume', () => {
    const html = `${CODERABBIT}<p dir="auto">Ran the suite twice.</p>`;
    expect(spans(html)).toEqual([at('coderabbit', 0, 2, 0)]);
    const markdown = '<!-- This is an auto-generated comment: release notes by coderabbit.ai -->x<!-- end of auto-generated comment: release notes by coderabbit.ai -->\nRan the suite twice.';
    expect(toolBlocksOf(blocksOf(html), markdown).map(({ id, start, end }) => ({ id, start, end }))).toEqual([{ id: 'coderabbit', start: 0, end: 1 }]);
  });
});

describe('authorWordsAfter with entities', () => {
  it('reads the author’s words as they render, entities decoded', () => {
    const markdown = '<!-- CURSOR_SUMMARY -->\n> [!NOTE]\n<!-- /CURSOR_SUMMARY -->\n## R&amp;D rollout &#8212; phase&nbsp;2\nTom &amp; Jerry, &bogus; kept.';
    expect(authorWordsAfter(markdown)).toEqual(new Map([['bugbot', ['r d rollout phase 2 tom']]]));
  });

  it('stops a heading-led summary where the author’s words resume, written with an entity', () => {
    const html = `${CODERABBIT}<p dir="auto">R&amp;D signed off on it.</p>`;
    const markdown = '<!-- This is an auto-generated comment: release notes by coderabbit.ai -->x<!-- end of auto-generated comment: release notes by coderabbit.ai -->\nR&amp;D signed off on it.';
    expect(toolBlocksOf(blocksOf(html), markdown).map(({ id, start, end }) => ({ id, start, end }))).toEqual([{ id: 'coderabbit', start: 0, end: 1 }]);
  });
});

describe('authorWordsAfter with links', () => {
  it('finds the author’s words again when they hold a bare URL, autolinked on the page', () => {
    const html = `${CODERABBIT}<p dir="auto">Tested at <a href="https://x.test">https://x.test</a> and passed.</p>`;
    const markdown = '<!-- This is an auto-generated comment: release notes by coderabbit.ai -->x<!-- end of auto-generated comment: release notes by coderabbit.ai -->\nTested at https://x.test and passed.';
    expect(toolBlocksOf(blocksOf(html), markdown).map(({ id, start, end }) => ({ id, start, end }))).toEqual([{ id: 'coderabbit', start: 0, end: 1 }]);
  });
});

describe('verdictOf', () => {
  it('reads Greptile’s score and Bugbot’s risk', () => {
    expect(verdictOf('greptile', blocksOf(GREPTILE))).toBe('4/5');
    expect(verdictOf('bugbot', blocksOf(BUGBOT))).toBe('Low Risk');
    expect(verdictOf('coderabbit', blocksOf(CODERABBIT))).toBe(null);
  });
});
