// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { notePreview, notesFrom } from './agent-notes';

function blocksOf(html: string): Element[] {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return [...holder.children];
}

const coderabbit = (words: string): string => `<h2>Summary by CodeRabbit</h2><ul><li>${words}</li></ul>`;
const CURSOR = '<div><a href="https://cursor.com/agents/bc-1"><img alt="Open in Web" src="w.png"></a></div>';
const GREPTILE =
  '<details open=""><summary>Greptile Summary</summary><p>Removes overflow protection.</p></details>' +
  '<p><sub><a href="https://app.greptile.com/api/retrigger?id=1">Re-trigger Greptile</a></sub></p>';

const shape = (notes: ReturnType<typeof notesFrom>): unknown =>
  notes.map((note) => ({ id: note.id, present: note.present, versions: note.versions.map((version) => [version.at, version.current, version.blocks.map((block) => block.textContent?.trim()).join(' | ')]) }));

describe('notesFrom', () => {
  it('lists each tool once per distinct reading, skipping identical ones and those without it', () => {
    const live = blocksOf(`<p>mine</p>${CURSOR}${coderabbit('Fixes B')}`);
    const readings = [
      { at: '2026-11-01T00:00:00Z', blocks: blocksOf(`<p>mine</p>${coderabbit('Fixes A')}`) },
      { at: '2026-11-02T00:00:00Z', blocks: blocksOf('<p>mine</p>') },
      { at: '2026-11-03T00:00:00Z', blocks: blocksOf(`<p>mine, edited</p>${CURSOR}${coderabbit('Fixes A')}`) },
      { at: '2026-11-04T00:00:00Z', blocks: blocksOf(`<p>mine</p>${CURSOR}${coderabbit('Fixes B')}`) },
    ];
    expect(shape(notesFrom(live, readings))).toEqual([
      // Cursor's badges never changed: one reading, the current one, from when they first appeared.
      { id: 'cursor-agent', present: true, versions: [['2026-11-03T00:00:00Z', true, '']] },
      {
        id: 'coderabbit',
        present: true,
        versions: [
          ['2026-11-01T00:00:00Z', false, 'Fixes A'],
          ['2026-11-04T00:00:00Z', true, 'Fixes B'],
        ],
      },
    ]);
  });

  it('keeps a tool the description no longer has, with its past readings, after the ones it has now', () => {
    const live = blocksOf(`<p>mine</p>${CURSOR}`);
    const readings = [{ at: '2026-11-01T00:00:00Z', blocks: blocksOf(`<p>mine</p>${GREPTILE}${CURSOR}`) }];
    const notes = notesFrom(live, readings);
    expect(notes.map((note) => [note.id, note.present])).toEqual([
      ['cursor-agent', true],
      ['greptile', false],
    ]);
    expect(notes[1]?.preview).toBe('Removes overflow protection.');
  });

  it('gives a description never edited one reading per tool, the page’s own', () => {
    expect(shape(notesFrom(blocksOf(coderabbit('Fixes A')), []))).toEqual([{ id: 'coderabbit', present: true, versions: [[null, true, 'Fixes A']] }]);
  });

  it('adds the page’s reading as the newest when the history has not caught up with it', () => {
    const readings = [{ at: '2026-11-01T00:00:00Z', blocks: blocksOf(coderabbit('Fixes A')) }];
    expect(shape(notesFrom(blocksOf(coderabbit('Fixes B')), readings))).toEqual([
      {
        id: 'coderabbit',
        present: true,
        versions: [
          ['2026-11-01T00:00:00Z', false, 'Fixes A'],
          [null, true, 'Fixes B'],
        ],
      },
    ]);
  });

  it('ends CodeRabbit’s note where the author’s words resume, live and in the history alike', () => {
    const markdown =
      '<!-- This is an auto-generated comment: release notes by coderabbit.ai -->\n## Summary by CodeRabbit\n* Fixes A\n' +
      '<!-- end of auto-generated comment: release notes by coderabbit.ai -->\n\nTested twice.';
    const html = `${coderabbit('Fixes A')}<p>Tested twice.</p>`;
    const readings = [{ at: '2026-11-01T00:00:00Z', blocks: blocksOf(html), markdown }];
    expect(shape(notesFrom(blocksOf(html), readings, markdown))).toEqual([{ id: 'coderabbit', present: true, versions: [['2026-11-01T00:00:00Z', true, 'Fixes A']] }]);
  });
});

describe('notePreview', () => {
  it('reads the first sentence without the tool’s own title, or the badges’ words', () => {
    expect(notePreview(blocksOf(coderabbit('Bug fixes. More.')))).toBe('Bug fixes.');
    expect(notePreview(blocksOf(GREPTILE))).toBe('Removes overflow protection.');
    expect(notePreview(blocksOf('<div><a href="https://cursor.com/agents/1"><img alt="Open in Web"></a> <a href="https://cursor.com/background-agent?bcId=1"><img alt="Open in Cursor"></a></div>'))).toBe('Open in Web · Open in Cursor');
  });
});
