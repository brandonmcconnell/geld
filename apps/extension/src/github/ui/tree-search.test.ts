// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { fileFilterQuery, panelForSearch } from './tree-search';

const ORDER = ['changes', 'tests', 'generated', 'docs'];

describe('panelForSearch', () => {
  it('keeps the reader on their panel while it has a match', () => {
    expect(panelForSearch('tests', ORDER, new Map([['changes', 3], ['tests', 1]]))).toBe('tests');
  });

  it('opens the first panel in sidebar order that has a match', () => {
    expect(panelForSearch('changes', ORDER, new Map([['changes', 0], ['generated', 2], ['docs', 5]]))).toBe('generated');
    expect(panelForSearch('docs', ORDER, new Map([['changes', 4], ['docs', 0]]))).toBe('changes');
  });

  it('stays put when nothing matches anywhere', () => {
    expect(panelForSearch('tests', ORDER, new Map([['changes', 0]]))).toBe('tests');
  });

  it('goes back to the reader panel as soon as it matches again', () => {
    const narrowed = panelForSearch('tests', ORDER, new Map([['changes', 2], ['tests', 0]]));
    const widened = panelForSearch('tests', ORDER, new Map([['changes', 6], ['tests', 3]]));
    expect([narrowed, widened]).toEqual(['changes', 'tests']);
  });
});

describe('fileFilterQuery', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it("reads the classic view's field by its id", () => {
    document.body.innerHTML = `
      <div class="subnav-search"><input type="text" id="file-tree-filter-field" placeholder="Filter changed files"></div>
      <file-tree><ul role="tree" id="tree"></ul></file-tree>`;
    const input = document.getElementById('file-tree-filter-field');
    if (!(input instanceof HTMLInputElement)) throw new Error('fixture');
    input.value = '  spec  ';
    expect(fileFilterQuery(document.getElementById('tree') ?? document.body)).toBe('spec');
  });

  it('finds a filter field near the tree by its label', () => {
    document.body.innerHTML = `
      <div><div><input aria-label="Filter files…" id="f"></div><nav><ul role="tree" id="tree"></ul></nav></div>`;
    const input = document.getElementById('f');
    if (!(input instanceof HTMLInputElement)) throw new Error('fixture');
    input.value = 'test';
    expect(fileFilterQuery(document.getElementById('tree') ?? document.body)).toBe('test');
  });

  it('is empty when there is no filter field or nothing typed', () => {
    document.body.innerHTML = `<div><input aria-label="Search" value="x"><ul role="tree" id="tree"></ul></div>`;
    expect(fileFilterQuery(document.getElementById('tree') ?? document.body)).toBe('');
  });
});
