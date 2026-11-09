// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { providerAgentNotes, renderProviderAgentNote } from './agent-notes';
import { ProviderDescription } from './description';

const body = (): HTMLElement => {
  const host = document.createElement('div');host.innerHTML = '<p>Author introduction</p><h2>Summary by CodeRabbit</h2><p>Tool summary.</p><h2>Author notes</h2><p>Kept by the author.</p>';
  document.body.append(host);return host;
};
afterEach(() => document.body.replaceChildren());

it('finds tool sections without consuming the next author heading', () => {
  const source = body(), notes = providerAgentNotes(source);
  expect(notes).toHaveLength(1);expect(notes[0]?.id).toBe('coderabbit');expect(notes[0]?.preview).toBe('Tool summary.');
  expect(notes[0]?.blocks).toHaveLength(2);expect(notes[0]?.content.map(block => block.textContent)).toEqual(['Tool summary.']);
});

it('renders inert current content without duplicating source IDs, controls or unsafe URLs', () => {
  const source = body();source.children[2]!.innerHTML = '<a id="source" href="javascript:alert(1)" onclick="bad()">unsafe</a><a href="https://example.com/report">Report</a><script>bad()</script><button>Write</button><img src="javascript:bad()" onerror="bad()" alt="Image">';
  const note = providerAgentNotes(source)[0];if (note === undefined) throw new Error('Missing note');
  const host = document.createElement('div');renderProviderAgentNote(note, host);
  expect(host.querySelector('script,button,[id],[onclick],[onerror],[href^="javascript:"],[src^="javascript:"]')).toBeNull();
  expect(host.querySelector('a[href]')?.getAttribute('href')).toBe('https://example.com/report');
  expect(source.querySelector('#source')).not.toBeNull();
});

it('moves only visibility ownership to the digest and restores the native tool section', () => {
  const source = body(), notes = providerAgentNotes(source);const view = new ProviderDescription();
  const nodes = [...source.children];view.update(source, 'mr', notes, true, false);
  expect(nodes[0]?.hasAttribute('hidden')).toBe(false);expect(nodes[1]?.getAttribute('hidden')).toBe('until-found');expect(nodes[2]?.getAttribute('hidden')).toBe('until-found');
  expect(nodes[3]?.hasAttribute('hidden')).toBe(false);expect(nodes[4]?.hasAttribute('hidden')).toBe(false);
  expect(providerAgentNotes(source)[0]?.signature).toBe(notes[0]?.signature);
  view.update(source, 'mr', notes, false, false);expect(source.querySelector('[hidden]')).toBeNull();
  view.clear();expect([...source.children]).toEqual(nodes);
});

it('reveals a selected tool note without altering the other native author content', () => {
  const source = body(), notes = providerAgentNotes(source);const view = new ProviderDescription();
  view.update(source, 'mr', notes, true);const first = notes[0]?.blocks[0];if (first === undefined) throw new Error('Missing source');
  view.reveal(first);expect(first.hasAttribute('hidden')).toBe(false);expect(notes[0]?.blocks[1]?.hasAttribute('hidden')).toBe(false);
  view.clear();
});
