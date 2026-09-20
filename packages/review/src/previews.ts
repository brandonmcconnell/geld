/**
 * Preview deployments posted to a pull request by hosting bots. Every host
 * writes its own comment shape, but they all say the same few things: which
 * project, whether it is ready, where it is, where to look when it is not.
 * This module reads those out of a comment reduced to its text, links and
 * images (`PreviewDoc`) — the Action builds that from markdown, the
 * extension from the rendered DOM — into one `Preview` per project, then
 * keeps only the latest per project (`latestPreviews`), the rest archived.
 *
 * Formats seen on public repositories (Sep 2026):
 * - Vercel (`vercel[bot]`): one comment for every project, a table row each:
 *   project link · `![Ready](…/status/ready.svg) [Ready](inspector)` ·
 *   `[Preview](url)` (or "Visit Preview"). A `[vc]: #sig:base64` reference
 *   definition carries the same as JSON (`projects[].name/previewUrl/
 *   inspectorUrl/nextCommitStatus`) — present in markdown, dropped by the
 *   renderer, so it is a bonus, not the path.
 * - Netlify (`netlify[bot]`): "Deploy Preview for *name* ready!", rows
 *   "Latest deploy log" and "Deploy Preview | https://deploy-preview-N--name.netlify.app".
 * - Cloudflare (`cloudflare-workers-and-pages[bot]`, older `cloudflare-pages[bot]`):
 *   "Deploying <name> with Cloudflare Pages", Status ✅/❌/⚡️, "Preview URL", "Branch Preview URL";
 *   the Workers variant is a table `Status | Name | Latest Commit`.
 * - Mintlify (`mintlify[bot]`): table `Project | Status (🟢 Ready) | Preview ([View Preview])`.
 * - Railway (`railway-app[bot]`): table `Service | Status (✅ Success) | Web ([Web](url))`.
 * - Render (`render[bot]`): "Your Render PR Server URL is https://….onrender.com".
 * - Amplify (`aws-amplify-*[bot]`): "Access this pull request here: https://pr-N.….amplifyapp.com".
 * - Azure Static Web Apps (github-actions): "Azure Static Web Apps: Your stage site is ready! Visit it here: url".
 * - Chromatic (`chromatic-com[bot]`): "Storybook Publish" link to *.chromatic.com; UI Tests status.
 * - Read the Docs (`read-the-docs-community[bot]`): "Preview build" link to *.readthedocs.build.
 * - CodeSandbox (`codesandbox[bot]`): "Open Preview" link; `pkg-pr-new[bot]`: "Open in StackBlitz".
 * - Actions in general (surge-preview, MDN, Cloudflare docs): "Preview URL:" / "Preview" + a link.
 */

import type { PreviewRecord, PreviewStatusRecord } from './model';

export type PreviewStatus = PreviewStatusRecord;

export interface PreviewDoc {
  /** The comment's author login. */
  readonly author: string;
  /** Anchor of the comment on the page (`issuecomment-N`). */
  readonly anchor: string;
  /** Plain text with block boundaries as line breaks. */
  readonly text: string;
  readonly links: readonly PreviewLink[];
  readonly images: readonly PreviewImage[];
  /** When the comment was posted or last edited, ISO, when known. */
  readonly updatedAt?: string;
}

export interface PreviewLink {
  readonly href: string;
  readonly text: string;
}

export interface PreviewImage {
  readonly src: string;
  readonly alt: string;
}

/**
 * `host` is the host id (`vercel`, `netlify`, …) or `generic`; `project` what
 * the host calls the deployed thing (project, site, service); `url` where the
 * preview is when it is somewhere; `inspectUrl` the logs/inspector/dashboard.
 */
export type Preview = PreviewRecord;

export interface PreviewHost {
  readonly id: string;
  readonly title: string;
  /** Logins (lower-case) that post for this host; `*` at the end matches a prefix. */
  readonly logins: readonly string[];
  readonly parse: (doc: PreviewDoc) => readonly Preview[];
}

const STATUS_WORDS: ReadonlyArray<readonly [RegExp, PreviewStatus]> = [
  [/\b(ready|success(?:ful)?|deployed|live|published|passed|complete[d]?)\b|✅|🟢/i, 'ready'],
  [/\b(fail(?:ed|ure)?|error(?:ed)?|broken)\b|❌|🔴/i, 'failed'],
  [/\b(building|deploying|in progress|running|pending|queued|testing)\b|⚡|⏳|🟡/i, 'building'],
  [/\b(skipped|cancel(?:l)?ed|ignored)\b|⚪/i, 'skipped'],
];

export function statusFromText(text: string): PreviewStatus {
  for (const [pattern, status] of STATUS_WORDS) if (pattern.test(text)) return status;
  return 'unknown';
}

function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href) && !/(^|\.)github\.com\//i.test(href) && !/githubusercontent\.com/i.test(href);
}

function hostOf(href: string): string {
  try {
    return new URL(href).hostname;
  } catch {
    return '';
  }
}

function lines(doc: PreviewDoc): readonly string[] {
  return doc.text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
}

function linkWhere(doc: PreviewDoc, textPattern: RegExp, hrefPattern: RegExp | null = null): PreviewLink | null {
  return doc.links.find((link) => textPattern.test(link.text.trim()) && (hrefPattern === null || hrefPattern.test(link.href))) ?? null;
}

function linkByHref(doc: PreviewDoc, hrefPattern: RegExp): PreviewLink | null {
  return doc.links.find((link) => hrefPattern.test(link.href)) ?? null;
}

/** Hosts sometimes write a URL without its scheme (Vercel's header does). */
function withScheme(url: string | null): string | null {
  if (url === null || url === '') return null;
  return /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
}

function preview(host: string, doc: PreviewDoc, project: string, status: PreviewStatus, rawUrl: string | null, rawInspectUrl: string | null): Preview {
  const url = withScheme(rawUrl);
  const inspectUrl = withScheme(rawInspectUrl);
  const base: Preview = { host, project: project.trim() || hostOf(url ?? inspectUrl ?? '') || host, status, url, inspectUrl, anchor: doc.anchor };
  return doc.updatedAt === undefined ? base : { ...base, updatedAt: doc.updatedAt };
}

/* ---- Vercel ------------------------------------------------------------- */

interface VercelProject {
  readonly name: string;
  readonly previewUrl: string;
  readonly inspectorUrl: string;
  readonly nextCommitStatus: string;
}

function isVercelProject(value: unknown): value is VercelProject {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'name') === 'string' && typeof Reflect.get(value, 'nextCommitStatus') === 'string';
}

/** The `[vc]: #<sig>:<base64 json>` reference definition Vercel puts first, when the text still has it (markdown, not the rendered page). */
export function vercelHeader(text: string): readonly VercelProject[] | null {
  const match = /\[vc\]:\s*#[^:\s]+:([A-Za-z0-9+/=]+)/.exec(text);
  if (match?.[1] === undefined) return null;
  try {
    const binary = atob(match[1]);
    // atob yields one char per byte; the JSON is UTF-8 (project names may be), so decode it as such.
    const decoded = decodeURIComponent(Array.from(binary, (char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
    const parsed: unknown = JSON.parse(decoded);
    const projects = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'projects') : null;
    if (!Array.isArray(projects)) return null;
    return projects.filter(isVercelProject);
  } catch {
    return null;
  }
}

/** Vercel's status words: `nextCommitStatus` in the header, the inspector link's text and the status image's alt in the table. */
function vercelStatus(word: string): PreviewStatus {
  const upper = word.trim().toUpperCase();
  if (upper === 'READY') return 'ready';
  if (upper === 'ERROR' || upper === 'FAILED') return 'failed';
  if (upper === 'SKIPPED' || upper === 'CANCELED' || upper === 'CANCELLED' || upper === 'IGNORED') return 'skipped';
  if (upper === 'BUILDING' || upper === 'QUEUED' || upper === 'PENDING' || upper === 'INITIALIZING') return 'building';
  return statusFromText(word);
}

/** The table row (as `| a | b | c |` text) naming `project`, when the comment has one. */
function tableRowFor(doc: PreviewDoc, project: string): string | null {
  return lines(doc).find((line) => line.startsWith('|') && line.includes(`| ${project} |`)) ?? null;
}

function parseVercel(doc: PreviewDoc): readonly Preview[] {
  const header = vercelHeader(doc.text);
  if (header !== null && header.length > 0) {
    return header.map((project) => preview('vercel', doc, project.name, vercelStatus(project.nextCommitStatus), project.previewUrl === '' ? null : project.previewUrl, project.inspectorUrl === '' ? null : project.inspectorUrl));
  }
  // Rendered: one table row per project — the project link to vercel.com/<team>/<project>, the status image's
  // alt with the inspector link beside it, the Preview link.
  const out: Preview[] = [];
  const projectLinks = doc.links.filter((link) => /^https:\/\/vercel\.com\/[^/]+\/[^/?#]+\/?$/.test(link.href) && link.text.trim() !== '');
  for (const link of projectLinks) {
    const name = link.text.trim();
    if (out.some((entry) => entry.project === name)) continue;
    // The inspector is the deployment's page under the project's: `vercel.com/<team>/<project>/<deployment>`, whatever its text says.
    const inspector = doc.links.find((candidate) => candidate.href.startsWith(`${link.href.replace(/\/$/, '')}/`) && candidate !== link);
    // The status: the inspector's text ("Ready", "Ignored", "Error"), else the status image's alt, else the words of the
    // project's own table row. On the rendered page the image's src is a camo proxy, so its alt is what carries the word.
    const row = tableRowFor(doc, name);
    let status = inspector === undefined ? 'unknown' : vercelStatus(inspector.text);
    if (status === 'unknown') {
      const image = doc.images.find((candidate) => /vercel\.com\/static\/status\//.test(candidate.src) && candidate.alt.trim() !== '');
      if (image !== undefined && projectLinks.length === 1) status = vercelStatus(image.alt);
    }
    if (status === 'unknown' && row !== null) status = statusFromText(row.replace(`| ${name} |`, '|'));
    // The preview link follows the project's row; the nearest "Preview"/"Visit Preview" after the inspector in link order.
    const at = inspector === undefined ? doc.links.indexOf(link) : doc.links.indexOf(inspector);
    const visit = doc.links.slice(at + 1).find((candidate) => /^(visit )?preview$/i.test(candidate.text.trim()) && isExternal(candidate.href));
    // A row that offers a preview to visit but states no status is a deployment that is up.
    if (status === 'unknown' && visit !== undefined) status = 'ready';
    out.push(preview('vercel', doc, name, status, visit?.href ?? null, inspector?.href ?? null));
  }
  if (out.length === 0 && /attempting to deploy a commit/i.test(doc.text)) {
    const team = /to the \*{0,2}([^*\n]+?)\*{0,2} Team/i.exec(doc.text)?.[1] ?? 'Vercel';
    return [preview('vercel', doc, team.trim(), 'building', null, linkWhere(doc, /authorize it/i)?.href ?? null)];
  }
  return out;
}

/* ---- Netlify ------------------------------------------------------------ */

function parseNetlify(doc: PreviewDoc): readonly Preview[] {
  const head = /Deploy Preview for \*?([^*\n]+?)\*?\s+(ready|failed|processing|building|canceled|errored)/i.exec(doc.text);
  const name = head?.[1]?.trim() ?? '';
  const status = head?.[2] === undefined ? statusFromText(doc.text) : statusFromText(head[2]);
  const site = linkByHref(doc, /\.netlify\.app\/?$/i) ?? linkByHref(doc, /--[^.]+\.netlify\.app/i);
  const log = linkByHref(doc, /app\.netlify\.com\/(projects|sites)\/[^/]+\/deploys\//i);
  if (name === '' && site === null) return [];
  return [preview('netlify', doc, name, status, site?.href ?? null, log?.href ?? null)];
}

/* ---- Cloudflare ----------------------------------------------------------- */

function parseCloudflare(doc: PreviewDoc): readonly Preview[] {
  const pages = /Deploying\s+(\S+)\s+with\s+.*Cloudflare Pages/i.exec(doc.text) ?? /Deploying\s+(\S+)\s+with/i.exec(doc.text);
  const previewUrl = (() => {
    const after = /Preview URL:?\s*\n?\s*(https?:\/\/\S+)/i.exec(doc.text)?.[1];
    return after ?? linkByHref(doc, /^https:\/\/[a-z0-9-]+\.[^.]+\.pages\.dev/i)?.href ?? null;
  })();
  const statusLine = lines(doc).find((line) => /^Status:?/i.test(line) || /Deploy(ment)? (successful|failed)|Building/i.test(line)) ?? '';
  const logs = linkWhere(doc, /view logs/i) ?? linkByHref(doc, /dash\.cloudflare\.com/i);
  const out: Preview[] = [];
  if (pages?.[1] !== undefined || previewUrl !== null) {
    out.push(preview('cloudflare', doc, pages?.[1] ?? '', statusLine === '' ? (previewUrl === null ? 'unknown' : 'ready') : statusFromText(statusLine), previewUrl, logs?.href ?? null));
  }
  // Workers table: "| ❌ Deployment failed <br>[View logs](…) | alloflow-cdn | 0370a813 | … |"
  if (out.length === 0) {
    for (const line of lines(doc)) {
      const cells = line
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell !== '');
      if (cells.length < 3 || !/deploy|building|success|fail/i.test(cells[0] ?? '')) continue;
      out.push(preview('cloudflare', doc, cells[1] ?? '', statusFromText(cells[0] ?? ''), null, logs?.href ?? null));
    }
  }
  return out;
}

/* ---- table hosts: Mintlify, Railway ------------------------------------------ */

/** Table rows as cells, from text with `|` separators (markdown or a rendered table read back as lines). */
function tableRows(doc: PreviewDoc): readonly string[][] {
  return lines(doc)
    .filter((line) => line.includes('|') && !/^\|?\s*:?-+/.test(line))
    .map((line) =>
      line
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell !== ''),
    );
}

function parseMintlify(doc: PreviewDoc): readonly Preview[] {
  const out: Preview[] = [];
  const projectLinks = doc.links.filter((link) => /app\.mintlify\.com\//.test(link.href) && link.text.trim() !== '');
  const previews = doc.links.filter((link) => /^view preview$/i.test(link.text.trim()) || /\.mintlify\.(site|app)\//i.test(link.href));
  const rows = tableRows(doc).filter((cells) => cells.length >= 3 && !/^project$/i.test(cells[0] ?? ''));
  projectLinks.forEach((link, index) => {
    const name = link.text.trim();
    const row = rows.find((cells) => cells.some((cell) => cell.includes(name))) ?? rows[index];
    const statusCell = row?.find((cell) => /ready|building|failed|error|🟢|🟡|🔴/i.test(cell)) ?? '';
    out.push(preview('mintlify', doc, name, statusFromText(statusCell), previews[index]?.href ?? previews[0]?.href ?? null, link.href));
  });
  if (out.length === 0 && previews.length > 0) out.push(preview('mintlify', doc, 'docs', 'ready', previews[0]?.href ?? null, null));
  return out;
}

function parseRailway(doc: PreviewDoc): readonly Preview[] {
  const out: Preview[] = [];
  const webLinks = doc.links.filter((link) => /^web$/i.test(link.text.trim()) || /\.up\.railway\.app/i.test(link.href));
  const logLinks = doc.links.filter((link) => /view logs/i.test(link.text));
  const rows = tableRows(doc).filter((cells) => cells.length >= 2 && !/^service$/i.test(cells[0]?.replace(/\*/g, '') ?? ''));
  rows.forEach((cells, index) => {
    const name = (cells[0] ?? '').replace(/<[^>]+>/g, '').trim();
    const statusCell = cells[1] ?? '';
    if (name === '' || !/success|fail|build|deploy|✅|❌|⏳/i.test(statusCell)) return;
    out.push(preview('railway', doc, name, statusFromText(statusCell), webLinks[index]?.href ?? null, logLinks[index]?.href ?? null));
  });
  return out;
}

/* ---- one-liners: Render, Amplify, Azure, Read the Docs, CodeSandbox, Chromatic, StackBlitz ---- */

function parseRender(doc: PreviewDoc): readonly Preview[] {
  const url = /PR Server URL is\s+(https?:\/\/\S+?)\.?(\s|$)/i.exec(doc.text)?.[1] ?? linkByHref(doc, /\.onrender\.com/i)?.href ?? null;
  if (url === null) return [];
  const dash = linkByHref(doc, /dashboard\.render\.com/i)?.href ?? /(https?:\/\/dashboard\.render\.com\/\S+?)\.?(\s|$)/i.exec(doc.text)?.[1] ?? null;
  return [preview('render', doc, hostOf(url).split('.')[0] ?? '', 'ready', url, dash)];
}

function parseAmplify(doc: PreviewDoc): readonly Preview[] {
  const url = /Access this pull request here:\s*(https?:\/\/\S+)/i.exec(doc.text)?.[1] ?? linkByHref(doc, /\.amplifyapp\.com/i)?.href ?? null;
  if (url === null) return [];
  return [preview('amplify', doc, hostOf(url).split('.')[1] ?? 'amplify', 'ready', url, null)];
}

function parseAzureSwa(doc: PreviewDoc): readonly Preview[] {
  const url = /Azure Static Web Apps:.*?Visit it here:\s*(https?:\/\/\S+)/i.exec(doc.text)?.[1] ?? linkByHref(doc, /\.azurestaticapps\.net/i)?.href ?? null;
  if (url === null) return [];
  return [preview('azure-swa', doc, hostOf(url).split('.')[0] ?? 'static web app', statusFromText(doc.text), url, null)];
}

function parseReadTheDocs(doc: PreviewDoc): readonly Preview[] {
  const build = linkWhere(doc, /preview build/i) ?? linkByHref(doc, /\.readthedocs\.build\//i);
  if (build === null) return [];
  const project = linkByHref(doc, /app\.readthedocs\.org\/projects\/[^/]+\/?$/i);
  const log = linkByHref(doc, /readthedocs\.org\/projects\/[^/]+\/builds\//i);
  return [preview('readthedocs', doc, project?.text.trim() ?? 'docs', statusFromText(doc.text) === 'failed' ? 'failed' : 'ready', build.href, log?.href ?? null)];
}

function parseCodeSandbox(doc: PreviewDoc): readonly Preview[] {
  const open = linkWhere(doc, /^preview$/i, /codesandbox\.io/i) ?? linkByHref(doc, /codesandbox\.io\/p\/devtool\/preview/i);
  if (open === null) return [];
  return [preview('codesandbox', doc, 'CodeSandbox', 'ready', open.href, linkWhere(doc, /web editor/i)?.href ?? null)];
}

function parseChromatic(doc: PreviewDoc): readonly Preview[] {
  const storybook = linkWhere(doc, /storybook publish/i) ?? linkByHref(doc, /^https:\/\/[a-z0-9-]+\.(staging-)?chromatic\.com\/?$/i);
  const tests = linkWhere(doc, /ui tests/i);
  if (storybook === null && tests === null) return [];
  const status = /need review|changes must be accepted/i.test(doc.text) ? 'building' : statusFromText(doc.text);
  return [preview('chromatic', doc, 'Storybook', storybook === null ? status : 'ready', storybook?.href ?? null, tests?.href ?? null)];
}

function parseStackBlitz(doc: PreviewDoc): readonly Preview[] {
  const open = linkWhere(doc, /open in stackblitz/i);
  if (open === null) return [];
  return [preview('pkg-pr-new', doc, 'StackBlitz', 'ready', open.href, null)];
}

/* ---- generic: an Action that says "Preview" and links somewhere ------------------ */

function parseGeneric(doc: PreviewDoc): readonly Preview[] {
  if (!/\bpreview\b/i.test(doc.text)) return [];
  const external = doc.links.filter((link) => isExternal(link.href));
  const named = external.find((link) => /^(🔗\s*)?(visit |view |open )?(the )?preview( url| site| build)?$/i.test(link.text.trim())) ?? null;
  const fromText = /Preview URL:?\*{0,2}\s*(https?:\/\/\S+)/i.exec(doc.text)?.[1] ?? null;
  const url = named?.href ?? fromText ?? external.find((link) => link.text.trim() === link.href || /^https?:\/\//.test(link.text.trim()))?.href ?? null;
  if (url === null) return [];
  const logs = linkWhere(doc, /view logs|build log|deploy log|logs/i)?.href ?? null;
  return [preview('generic', doc, hostOf(url), statusFromText(doc.text), url, logs)];
}

export const PREVIEW_HOSTS: readonly PreviewHost[] = [
  { id: 'vercel', title: 'Vercel', logins: ['vercel[bot]'], parse: parseVercel },
  { id: 'netlify', title: 'Netlify', logins: ['netlify[bot]'], parse: parseNetlify },
  { id: 'cloudflare', title: 'Cloudflare', logins: ['cloudflare-workers-and-pages[bot]', 'cloudflare-pages[bot]'], parse: parseCloudflare },
  { id: 'mintlify', title: 'Mintlify', logins: ['mintlify[bot]'], parse: parseMintlify },
  { id: 'railway', title: 'Railway', logins: ['railway-app[bot]'], parse: parseRailway },
  { id: 'render', title: 'Render', logins: ['render[bot]'], parse: parseRender },
  { id: 'amplify', title: 'Amplify', logins: ['aws-amplify-*'], parse: parseAmplify },
  { id: 'readthedocs', title: 'Read the Docs', logins: ['read-the-docs-community[bot]', 'readthedocs[bot]', 'readthedocs-*'], parse: parseReadTheDocs },
  { id: 'codesandbox', title: 'CodeSandbox', logins: ['codesandbox[bot]'], parse: parseCodeSandbox },
  { id: 'chromatic', title: 'Chromatic', logins: ['chromatic-com[bot]', 'chromatic-com-*'], parse: parseChromatic },
  { id: 'pkg-pr-new', title: 'pkg.pr.new', logins: ['pkg-pr-new[bot]'], parse: parseStackBlitz },
  { id: 'azure-swa', title: 'Azure Static Web Apps', logins: ['github-actions[bot]'], parse: parseAzureSwa },
  { id: 'generic', title: 'Preview', logins: ['github-actions[bot]', '*[bot]'], parse: parseGeneric },
];

function loginMatches(pattern: string, login: string): boolean {
  const lower = login.toLowerCase();
  if (pattern.endsWith('*')) return lower.startsWith(pattern.slice(0, -1));
  if (pattern.startsWith('*')) return lower.endsWith(pattern.slice(1));
  return lower === pattern;
}

export function previewHostFor(login: string): PreviewHost | null {
  return PREVIEW_HOSTS.find((host) => host.logins.some((pattern) => loginMatches(pattern, login))) ?? null;
}

export function previewHostById(id: string): PreviewHost | null {
  return PREVIEW_HOSTS.find((host) => host.id === id) ?? null;
}

/** Every preview a comment announces; empty for comments that are not about previews. */
export function parsePreviews(doc: PreviewDoc): readonly Preview[] {
  const hosts = PREVIEW_HOSTS.filter((host) => host.logins.some((pattern) => loginMatches(pattern, doc.author)));
  for (const host of hosts) {
    const found = host.parse(doc);
    if (found.length > 0) return found;
  }
  return [];
}

/** Identity of the deployed thing across comments: the same host's same project supersedes itself. */
export function previewKey(entry: Preview): string {
  return `${entry.host}:${entry.project.toLowerCase()}`;
}

/**
 * The latest preview per project (comment order is timeline order, so the
 * last one wins) and the superseded ones, archived, newest first.
 */
export function latestPreviews(all: readonly Preview[]): { readonly latest: readonly Preview[]; readonly archived: readonly Preview[] } {
  const latestByKey = new Map<string, Preview>();
  for (const entry of all) latestByKey.set(previewKey(entry), entry);
  const latest = [...latestByKey.values()];
  const archived = all.filter((entry) => latestByKey.get(previewKey(entry)) !== entry).reverse();
  return { latest, archived };
}

/** Build a `PreviewDoc` from a comment's markdown source (the Action's side). */
export function previewDocFromMarkdown(author: string, anchor: string, markdown: string, updatedAt?: string): PreviewDoc {
  const links: PreviewLink[] = [];
  const images: PreviewImage[] = [];
  for (const match of markdown.matchAll(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g)) images.push({ alt: match[1] ?? '', src: match[2] ?? '' });
  for (const match of markdown.matchAll(/<img\b[^>]*\balt=["']([^"']*)["'][^>]*\bsrc=["']([^"']+)["']|<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*\balt=["']([^"']*)["']/gi)) {
    images.push({ alt: match[1] ?? match[4] ?? '', src: match[2] ?? match[3] ?? '' });
  }
  for (const match of markdown.matchAll(/(?<!!)\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g)) links.push({ text: match[1]?.replace(/<[^>]+>/g, '').trim() ?? '', href: match[2] ?? '' });
  for (const match of markdown.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) links.push({ href: match[1] ?? '', text: (match[2] ?? '').replace(/<[^>]+>/g, '').trim() });
  // A <br> inside a markdown table cell stays on the row's line; anywhere else it is a line break.
  const text = markdown
    .split(/\r?\n/)
    .map((line) => (line.trimStart().startsWith('|') ? line.replace(/<br\s*\/?>/gi, ' ') : line))
    .join('\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(tr|p|li|h[1-6]|div|details|summary)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  const doc: PreviewDoc = { author, anchor, text, links, images };
  return updatedAt === undefined ? doc : { ...doc, updatedAt };
}
