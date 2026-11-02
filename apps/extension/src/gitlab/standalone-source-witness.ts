import { jsonAttribute, record, SHA } from './page';
import type { readGitLabPageFrame } from './page';
import type { ProviderStandalonePage } from '../providers/types';
import { providerNativeSourceElement, providerSourceId, providerSourcePath, providerSourceSubject, providerSourceSubjectKey } from '../providers/source-facts';
import type { ProviderNativeSourceFrame } from '../providers/source-facts';

type StandaloneFrame = Omit<NonNullable<ReturnType<typeof readGitLabPageFrame>>, 'page'> & { readonly page: ProviderStandalonePage };
const HEADER = ':scope > article.rd-diff-file > .rd-diff-file-header-sticky > header[data-testid="rd-diff-file-header"] > .rd-diff-file-header-main > h2.rd-diff-file-title > a.rd-diff-file-link';
const COMPARE_ROOT = '[data-gitlab-vue3-app="CompareAppRoot"]';
const FORM = ':scope > [data-testid="base-layout-content"] > form.js-signature-container';
const BODY_FIELDS: readonly string[] = ['data-project-full-path', 'data-project-id', 'data-page', 'data-page-type-id'];
const bodyKey = (body: HTMLElement): string => JSON.stringify(BODY_FIELDS.map((field) => body.getAttribute(field)));

function nativeUrl(value: unknown, origin: string): URL | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const url = new URL(value, origin);
    return url.origin === origin && url.username === '' && url.password === '' && url.hash === '' ? url : null;
  } catch { return null; }
}

function resource(value: unknown, page: ProviderStandalonePage, head: string, path: string, kind: 'blob' | 'raw' | 'lines'): boolean {
  const url = nativeUrl(value, page.repository.origin);
  const owner = page.repository.path.split('/').map(encodeURIComponent).join('/');
  const file = path.split('/').map(encodeURIComponent).join('/');
  return url !== null && url.search === '' && url.pathname === `/${owner}/-/${kind === 'raw' ? 'raw' : 'blob'}/${head}/${file}${kind === 'lines' ? '/diff_lines' : ''}`;
}

function endpoints(app: Record<string, unknown>, page: ProviderStandalonePage, head: string): boolean {
  const owner = page.repository.path.split('/').map(encodeURIComponent).join('/');
  const prefix = `/${owner}/-/${page.kind === 'commit' ? `commit/${head}` : 'compare'}/`;
  const suffixes = { diff_files_endpoint: 'diff_files_metadata', diffs_stats_endpoint: 'diffs_stats', diff_file_endpoint: 'diff_file', reload_stream_url: 'diffs_stream', diffs_stream_url: 'diffs_stream' };
  for (const [field, suffix] of Object.entries(suffixes)) {
    if (field === 'diffs_stream_url' && (app[field] === null || !Object.hasOwn(app, field))) continue;
    const url = nativeUrl(app[field], page.repository.origin);
    if (url === null || url.pathname !== prefix + suffix) return false;
    const params = url.searchParams;
    for (const key of params.keys()) if (!['from', 'to', 'straight', 'view', 'w'].includes(key) || params.getAll(key).length !== 1) return false;
    if (page.kind === 'commit') {
      if (params.has('from') || params.has('to') || params.has('straight')) return false;
    } else if (params.get('from') !== page.from.toLowerCase() || params.get('to') !== head || params.get('straight') !== (page.straight ? 'true' : null)) return false;
    if (params.has('view') && (!['inline', 'parallel'].includes(params.get('view') ?? '') || params.get('view') !== app.diff_view_type)) return false;
    if (params.has('w') && params.get('w') !== (new URL(page.diffPageUrl).searchParams.get('w') ?? '0')) return false;
  }
  return true;
}

interface CompareSelection {
  readonly root: HTMLElement;
  readonly parent: Node | null;
  readonly form: HTMLFormElement;
  readonly formParent: HTMLElement | null;
  readonly inputs: readonly HTMLInputElement[];
  readonly values: string;
  readonly formKey: string;
}
function compareSelection(doc: Document, page: ProviderStandalonePage, projectId: string): CompareSelection | null {
  if (page.kind !== 'compare') return null;
  const roots = [...doc.querySelectorAll(COMPARE_ROOT)].filter(providerNativeSourceElement);
  const root = roots[0];
  if (roots.length !== 1 || !(root instanceof HTMLElement)) return null;
  const forms = root.querySelectorAll(FORM);
  const form = forms[0];
  if (forms.length !== 1 || !(form instanceof HTMLFormElement) || form.hidden || form.inert || form.getAttribute('aria-hidden') === 'true'
    || form.parentElement === null || !providerNativeSourceElement(form.parentElement) || form.getAttribute('method')?.toUpperCase() !== 'POST') return null;
  const action = nativeUrl(form.getAttribute('action'), page.repository.origin);
  const owner = page.repository.path.split('/').map(encodeURIComponent).join('/');
  if (action === null || action.search !== '' || action.pathname !== `/${owner}/-/compare`) return null;
  const inputs: HTMLInputElement[] = [];
  for (const [name, expected] of [['to_project_id', projectId], ['from_project_id', projectId], ['to', page.to.toLowerCase()], ['from', page.from.toLowerCase()]]) {
    const matches: NodeListOf<HTMLInputElement> = form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`);
    const input: HTMLInputElement | undefined = matches[0];
    if (matches.length !== 1 || !(input instanceof HTMLInputElement) || input.type !== 'hidden' || input.closest('form') !== form || input.value !== expected) return null;
    inputs.push(input);
  }
  const radios = [...form.querySelectorAll('input[name="straight"]')];
  if (radios.length !== 2 || !radios.every((input) => input instanceof HTMLInputElement && input.type === 'radio' && input.closest('form') === form)) return null;
  for (const input of radios) {
    if (!(input instanceof HTMLInputElement) || !['true', 'false'].includes(input.value)) return null;
    inputs.push(input);
  }
  if (new Set(radios.map((input) => input.getAttribute('value'))).size !== 2) return null;
  const selected = inputs.slice(4).filter((input) => input.checked);
  if (selected.length !== 1 || selected[0]?.value !== String(page.straight)) return null;
  return { root, parent: root.parentNode, form, formParent: form.parentElement, inputs,
    values: JSON.stringify(inputs.map((input) => [input.name, input.type, input.value, input.checked])),
    formKey: JSON.stringify([form.getAttribute('action'), form.getAttribute('method'), form.getAttribute('class')]) };
}

/** Server-native standalone pages omit the MR project/ref fields; their own document and generated file resources establish this distinct format. */
export function readGitLabStandaloneSourceFrame(doc: Document, appRoot: HTMLElement, frame: StandaloneFrame): ProviderNativeSourceFrame | null {
  const { page, appData: app, url, serialized } = frame;
  const body = doc.body;
  const projectId = providerSourceId(body.getAttribute('data-project-id'));
  if (!body.isConnected || !providerNativeSourceElement(body) || projectId === null || body.getAttribute('data-project-full-path') !== page.repository.path
    || body.getAttribute('data-page') !== `projects:${page.kind}:show` || Object.hasOwn(app, 'project_path') && app.project_path !== page.repository.path
    || Object.hasOwn(app, 'mr_path') || Object.hasOwn(app, 'versions') || Object.hasOwn(app, 'is_fork') && app.is_fork !== false && app.is_fork !== 'false') return null;
  let head: string;
  if (page.kind === 'commit') {
    const value = body.getAttribute('data-page-type-id');
    if (value === null || !SHA.test(value) || !SHA.test(page.ref) || value.toLowerCase() !== page.ref.toLowerCase()
      || Object.hasOwn(app, 'noteable_type') && app.noteable_type !== 'Commit') return null;
    head = value.toLowerCase();
  } else {
    if (!SHA.test(page.from) || !SHA.test(page.to) || page.targetProjectId !== undefined || body.hasAttribute('data-page-type-id') || Object.hasOwn(app, 'noteable_type')) return null;
    head = page.to.toLowerCase();
  }
  if (page.headSha !== head || !endpoints(app, page, head)) return null;
  const comparison = page.kind === 'compare' ? compareSelection(doc, page, projectId) : null;
  if (page.kind === 'compare' && comparison === null) return null;
  const signature = bodyKey(body);
  const parent = appRoot.parentNode;
  const subject = providerSourceSubject(page);
  const basicCurrent = (): boolean => {
    if (doc.URL !== url || doc.body !== body || !body.isConnected || bodyKey(body) !== signature || !providerNativeSourceElement(body)
      || !appRoot.isConnected || appRoot.ownerDocument !== doc || appRoot.parentNode !== parent || !appRoot.hasAttribute('data-rapid-diffs')
      || !providerNativeSourceElement(appRoot) || appRoot.getAttribute('data-app-data') !== serialized) return false;
    if (comparison !== null) {
      if (!comparison.root.isConnected || comparison.root.parentNode !== comparison.parent || !providerNativeSourceElement(comparison.root)
        || !comparison.root.matches(COMPARE_ROOT) || !comparison.form.isConnected || comparison.form.parentElement !== comparison.formParent
        || comparison.form.hidden || comparison.form.inert || comparison.form.getAttribute('aria-hidden') === 'true'
        || !comparison.formParent || !providerNativeSourceElement(comparison.formParent)
        || JSON.stringify([comparison.form.getAttribute('action'), comparison.form.getAttribute('method'), comparison.form.getAttribute('class')]) !== comparison.formKey
        || JSON.stringify(comparison.inputs.map((input) => [input.name, input.type, input.value, input.checked])) !== comparison.values
        || comparison.inputs.some((input) => !input.isConnected || input.closest('form') !== comparison.form)) return false;
    }
    return true;
  };
  return {
    key: JSON.stringify([providerSourceSubjectKey(subject), 'gitlab-standalone', signature, comparison?.values ?? null]),
    current: () => {
      if (!basicCurrent()) return false;
      const apps = [...doc.querySelectorAll('[data-rapid-diffs][data-app-data]')].filter(providerNativeSourceElement);
      if (apps.length !== 1 || apps[0] !== appRoot) return false;
      if (comparison !== null) {
        const next = compareSelection(doc, page, projectId);
        if (next === null || next.root !== comparison.root || next.form !== comparison.form || next.inputs.some((input, index) => input !== comparison.inputs[index])) return false;
      }
      return true;
    },
    read: (entry) => {
      const root = entry.root;
      if (!basicCurrent() || !root.isConnected || root.ownerDocument !== doc || root.localName !== 'diff-file'
        || root.closest('[data-rapid-diffs]') !== appRoot || !providerNativeSourceElement(root)) return null;
      const fileParent = root.parentNode;
      const fileData = root.getAttribute('data-file-data');
      const data = jsonAttribute(root, 'data-file-data');
      if (!providerSourcePath(data?.new_path) || data.viewer !== 'text_inline' || Object.hasOwn(data, 'old_path') && !providerSourcePath(data.old_path)
        || data.deleted_file === true || data.submodule === true || !resource(data.diff_lines_path, page, head, data.new_path, 'lines')) return null;
      if (Object.hasOwn(data, 'blob_raw_path') && !resource(data.blob_raw_path, page, head, data.new_path, 'raw')) return null;
      if (Object.hasOwn(data, 'diff_refs')) {
        const refs = data.diff_refs;
        if (!record(refs) || typeof refs.head_sha !== 'string' || !SHA.test(refs.head_sha) || refs.head_sha.toLowerCase() !== head
          || ['base_sha', 'start_sha'].some((key) => Object.hasOwn(refs, key) && (typeof refs[key] !== 'string' || !SHA.test(refs[key])))) return null;
      }
      const links = root.querySelectorAll(HEADER);
      const link = links[0];
      if (links.length !== 1 || !(link instanceof HTMLAnchorElement) || !providerNativeSourceElement(link)
        || link.closest('diff-file') !== root || !resource(link.getAttribute('href'), page, head, data.new_path, 'blob')) return null;
      const href = link.getAttribute('href');const linkParent = link.parentNode;
      const fresh = root.querySelectorAll(HEADER);
      if (!basicCurrent() || root.parentNode !== fileParent || !providerNativeSourceElement(root) || root.getAttribute('data-file-data') !== fileData
        || fresh.length !== 1 || fresh[0] !== link || link.parentNode !== linkParent || link.getAttribute('href') !== href) return null;
      return { subject, repository: page.repository, path: data.new_path, headSha: head, comparison: { kind: 'gitlab-standalone' } };
    },
  };
}
