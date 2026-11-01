import { describeGitLabPage, selectedVersion } from './page';

const SELECTION = ['diff_id', 'start_sha', 'commit_id', 'only_context_commits', 'w', 'view', 'from', 'to', 'straight', 'from_project_id'] as const;

interface NativeRoute {
  readonly url: string;
  readonly version: string;
  readonly displayed: string;
  readonly href: string;
  readonly template: HTMLAnchorElement;
}

const routes = new WeakMap<Document, NativeRoute>();

function displayedVersion(doc: Document): string {
  const version = selectedVersion(doc);
  return JSON.stringify([version?.id ?? null, version?.head_sha ?? null]);
}

function filePath(path: string): boolean {
  return path.length > 0 && path.length <= 8192 && !/[\u0000-\u001f\u007f]/.test(path)
    && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

export function gitLabPathNavigator(doc: Document, tree: HTMLElement | null): ((path: string) => boolean) | null {
  const current = new URL(doc.location.href);
  const page = describeGitLabPage(current, doc);
  if (current.protocol !== 'https:' || current.username !== '' || current.password !== '' || page?.kind !== 'diff') { routes.delete(doc); return null; }
  let route = routes.get(doc);
  const displayed = displayedVersion(doc);
  if (route !== undefined && (route.url !== current.href || route.version !== page.version || route.displayed !== displayed)) { routes.delete(doc); route = undefined; }
  if (tree === null || !tree.isConnected || tree.closest('[data-geld-ui]') !== null) return null;
  if (route !== undefined && route.template.isConnected && (route.template.href !== route.href || !tree.contains(route.template) || route.template.closest('[data-geld-ui]') !== null)) {
    routes.delete(doc);
    return null;
  }
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
  if (template !== undefined && (route?.template !== template || route.href !== template.href)) {
    route = { url: current.href, version: page.version, displayed, href: template.href, template };
    routes.set(doc, route);
  }
  if (route === undefined) return null;
  const snapshot = route;
  return (path) => {
    if (doc.location.href !== snapshot.url || describeGitLabPage(new URL(doc.location.href), doc)?.version !== snapshot.version || displayedVersion(doc) !== snapshot.displayed
      || (snapshot.template.isConnected && (!tree.contains(snapshot.template) || snapshot.template.closest('[data-geld-ui]') !== null || snapshot.template.href !== snapshot.href))) {
      if (routes.get(doc) === snapshot) routes.delete(doc);
      return false;
    }
    if (!filePath(path) || doc.hidden || !tree.isConnected || tree.closest('[data-geld-ui]') !== null || routes.get(doc) !== snapshot || doc.body === null) return false;
    const target = new URL(snapshot.href);
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
