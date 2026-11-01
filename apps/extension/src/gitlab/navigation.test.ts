// @vitest-environment happy-dom
import { gitLabPathNavigator } from './navigation';

const BASE = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334/diffs';

beforeEach(() => {
  window.location.href = `${BASE}?diff_id=2158520123&w=1`;
  document.body.innerHTML = `<section data-testid="file-tree-container"><a data-testid="file-row" data-file-row="native-file-hash" href="${BASE}?diff_id=2158520123&w=1&file_path=src%2Fmounted.rb#native-file-hash">mounted.rb</a></section>`;
});

function tree(): HTMLElement | null { return document.querySelector('[data-testid="file-tree-container"]'); }

it('uses the actual native file_path route for an unmounted source path without retaining another file hash', () => {
  const navigate = gitLabPathNavigator(document, tree());
  const clicked: string[] = [];
  const listener = (event: MouseEvent): void => {
    if (event.target instanceof HTMLAnchorElement && event.target.hasAttribute('data-geld-ui')) {
      clicked.push(event.target.href);
      expect(event.target.isConnected).toBe(true);
      event.preventDefault();
    }
  };
  document.addEventListener('click', listener, true);
  try {
    expect(navigate?.('spec/a b?#é_spec.rb')).toBe(true);
    const target = new URL(clicked[0] ?? 'https://example.com');
    expect(target.pathname).toBe(new URL(BASE).pathname);
    expect([...target.searchParams]).toEqual([['diff_id', '2158520123'], ['w', '1'], ['file_path', 'spec/a b?#é_spec.rb']]);
    expect(target.hash).toBe('');
    expect(target.href).toContain('file_path=spec%2Fa+b%3F%23%C3%A9_spec.rb');
    expect(document.querySelector('[data-geld-ui]')).toBeNull();
    expect(document.querySelector('a[data-testid="file-row"]')?.getAttribute('href')).toContain('#native-file-hash');
  } finally { document.removeEventListener('click', listener, true); }
});

it('rejects cross-review, foreign origin, duplicate and incompatible selection templates', () => {
  const link = document.querySelector('a');
  for (const href of [BASE.replace('266334', '266335') + '?diff_id=2158520123&w=1&file_path=a', BASE.replace('gitlab.com', 'example.com') + '?diff_id=2158520123&w=1&file_path=a', `${BASE}?diff_id=9&w=1&file_path=a`, `${BASE}?diff_id=2158520123&w=0&file_path=a`, `${BASE}?diff_id=2158520123&diff_id=9&w=1&file_path=a`]) {
    link?.setAttribute('href', href);
    expect(gitLabPathNavigator(document, tree())).toBeNull();
  }
});

it('rechecks native ownership, location and revision before initiating navigation', () => {
  const navigate = gitLabPathNavigator(document, tree());
  expect(navigate).not.toBeNull();
  for (const path of ['', '/absolute', '../escape', 'a/../escape', 'a\u0000b', 'a//b']) expect(navigate?.(path)).toBe(false);
  document.querySelector('a')?.setAttribute('href', `${BASE}?diff_id=9&file_path=a`);
  expect(navigate?.('src/other.rb')).toBe(false);
  document.querySelector('a')?.remove();
  expect(navigate?.('src/other.rb')).toBe(false);
});

it('accepts a native template pinned to the current displayed version on an unversioned URL', () => {
  window.location.href = `${BASE}?w=1`;
  document.body.insertAdjacentHTML('beforeend', '<article data-rapid-diffs data-app-data=\'{"versions":{"source_versions":[{"id":2158520123,"selected":true}]}}\'></article>');
  const navigate = gitLabPathNavigator(document, tree());
  expect(navigate).not.toBeNull();
  window.location.href = `${BASE}?diff_id=9&w=1`;
  expect(navigate?.('src/other.rb')).toBe(false);
  document.querySelector('article')?.setAttribute('data-app-data', '{"versions":{"source_versions":[{"id":9,"selected":true}]}}');
  expect(gitLabPathNavigator(document, tree())).toBeNull();
});
