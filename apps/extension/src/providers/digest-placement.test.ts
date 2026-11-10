// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { placeProviderDigest } from './digest-placement';

afterEach(() => document.body.replaceChildren());

it('keeps the complete description and reactions first and can restore the above placement without moving native nodes', () => {
  document.body.innerHTML = '<main><article><p>Description</p></article><div id="reactions">Reactions</div><section><button>View</button></section></main>';
  const host = document.querySelector('main')!;
  const description = document.querySelector('p')!;
  const native = document.querySelector('article')!;
  const reactions = document.getElementById('reactions')!;
  const panel = document.querySelector('section')!;
  const focus = panel.querySelector('button')!;
  focus.focus();
  placeProviderDigest(host, panel, description, true);
  expect(host.firstElementChild).toBe(panel);
  expect(document.activeElement).toBe(focus);
  placeProviderDigest(host, panel, description, false);
  expect([...host.children]).toEqual([native, reactions, panel]);
  expect(document.activeElement).toBe(focus);
  const observer = new MutationObserver(() => undefined);
  observer.observe(host, { childList: true });
  placeProviderDigest(host, panel, description, false);
  expect(observer.takeRecords()).toEqual([]);
  observer.disconnect();
});

it('keeps a digest before activity when the description lives outside its host', () => {
  document.body.innerHTML = '<article>Description</article><main><div>Native activity</div><section>Digest</section></main>';
  const host = document.querySelector('main')!;
  const panel = document.querySelector('section')!;
  placeProviderDigest(host, panel, document.querySelector('article'), false);
  expect(host.firstElementChild).toBe(panel);
});
