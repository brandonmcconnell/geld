import { describeGitLabPage } from './page';

const SELECTION = ['diff_id', 'start_sha', 'commit_id', 'only_context_commits', 'w', 'view', 'from', 'to', 'straight', 'from_project_id'] as const;

function filePath(path: string): boolean {
  return path.length > 0 && path.length <= 8192 && !/[\u0000-\u001f\u007f]/.test(path)
    && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

export function gitLabPathNavigator(doc: Document, tree: HTMLElement | null): ((path: string) => boolean) | null {
  if (tree === null || !tree.isConnected) return null;
  const current = new URL(doc.location.href);
  const page = describeGitLabPage(current, doc);
  if (current.protocol !== 'https:' || current.username !== '' || current.password !== '' || page?.kind !== 'diff') return null;
  const selected = new URL(page.diffPageUrl);
  const template = [...tree.querySelectorAll<HTMLAnchorElement>('a[data-testid="file-row"][data-file-row][href]')].find((link) => {
    if (link.closest('[data-geld-ui]') !== null) return false;
    try {
      const target = new URL(link.href, current);
      const path = target.searchParams.get('file_path');
      return target.origin === current.origin && target.username === '' && target.password === '' && target.pathname === current.pathname
        && path !== null && filePath(path) && target.searchParams.getAll('file_path').length === 1
        && SELECTION.every((name) => target.searchParams.getAll(name).length <= 1 && current.searchParams.getAll(name).length <= 1
          && target.searchParams.get(name) === (current.searchParams.get(name) ?? (name === 'diff_id' ? selected.searchParams.get(name) : null)));
    } catch { return false; }
  });
  if (template === undefined) return null;
  const href = template.href;
  return (path) => {
    if (!filePath(path) || doc.hidden || doc.location.href !== current.href || !tree.isConnected || !template.isConnected
      || !tree.contains(template) || template.closest('[data-geld-ui]') !== null || template.href !== href
      || describeGitLabPage(new URL(doc.location.href), doc)?.version !== page.version || doc.body === null) return false;
    const target = new URL(href);
    target.searchParams.set('file_path', path);
    target.hash = '';
    const link = doc.createElement('a');
    link.href = target.href;
    link.hidden = true;
    link.tabIndex = -1;
    link.setAttribute('data-geld-ui', '');
    doc.body.append(link);
    try { link.click(); } finally { link.remove(); }
    return true;
  };
}
