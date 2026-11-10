import { browser } from 'wxt/browser';
import { allCategories } from '@geld/core';
import { formatCount, pluralize } from '@geld/core';
import type { EnsureContentMessage, GetTabStateMessage, RevealFileMessage, TabState } from '../../src/lib/messages';
import { isEnsureContentResponse, isTabState, REVEAL_HASH_PREFIX } from '../../src/lib/messages';
import { fitMiddleTruncated } from '../../src/ui/middle-truncate';
import { compileRepoRules, decideRepo, ownerProbe, repoFromPathname, withRepoRule } from '@geld/core';
import { allHosts, isAutoViewedForAll, isCategoryEnabled, isCategoryInPicker, plainText, sectionsFor, withAutoViewedForAll } from '@geld/core';
import type { AnyCategoryId, CategoriesField, GeldSettings, ToggleField } from '@geld/core';
import type { TabRepoConfig, TabRepoConfigFile } from '../../src/lib/messages';
import { loadCatalog } from '../../src/lib/catalog';
import { repoConfigChoicesItem } from '../../src/lib/local-state';
import { settingsItem } from '../../src/lib/storage';
import { mountAccountWidget } from '../../src/ui/account-widget';
import { polyfillCornerShape } from '../../src/ui/corner-shape';
import { popupMaxHeight, popupNeedsScroll } from '../../src/ui/popup-size';
import { bindSwitch, requireElement } from '../../src/ui/switch';
import { svgFromString } from '../../src/github/dom';
import { ICON_BEAKER, ICON_EYE_CLOSED, ICON_INFO } from '../../src/github/ui/icons';
import { wireFeedbackLink } from '../../src/ui/feedback-link';
import { installErrorCapture } from '../../src/lib/error-capture';
import { mountNightlyPopup } from '../../src/nightly/popup';

installErrorCapture('popup');

interface ActiveTab {
  readonly id: number;
  readonly url: URL;
}

async function activeGitHubTab(hosts: readonly string[]): Promise<ActiveTab | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || tab.url === undefined) return null;
  try {
    const url = new URL(tab.url);
    return hosts.includes(url.hostname) ? { id: tab.id, url } : null;
  } catch {
    return null;
  }
}

async function pingTab(tabId: number): Promise<TabState | null> {
  const message: GetTabStateMessage = { type: 'geld:get-tab-state' };
  try {
    const response: unknown = await browser.tabs.sendMessage(tabId, message);
    return isTabState(response) ? response : null;
  } catch {
    return null;
  }
}

/**
 * Ask the tab what Geld is doing. No answer usually means the tab was open
 * before Geld was installed or updated, so the background injects the content
 * script and we ask once more after it has had a moment to run.
 */
async function requestTabState(tabId: number): Promise<TabState | null> {
  const state = await pingTab(tabId);
  if (state !== null) return state;
  const ensure: EnsureContentMessage = { type: 'geld:ensure-content', tabId };
  try {
    const response: unknown = await browser.runtime.sendMessage(ensure);
    if (!isEnsureContentResponse(response) || !response.injected) return null;
  } catch {
    return null;
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  return pingTab(tabId);
}

function orgOf(repo: string): string {
  return repo.split('/')[0] ?? repo;
}

async function main(): Promise<void> {
  let settings = await settingsItem.getValue();
  // Titles and descriptions come from the active catalog; the popup is short-lived, so one read is enough.
  const catalog = await loadCatalog();
  const status = requireElement('status', HTMLSpanElement);
  mountAccountWidget(requireElement('account', HTMLDivElement), {
    variant: 'compact',
    promptHost: requireElement('account-prompt', HTMLDivElement),
  });
  const saved = (): void => {
    status.textContent = 'Saved';
    status.dataset.tone = 'success';
    setTimeout(() => {
      status.textContent = '';
      delete status.dataset.tone;
    }, 1200);
  };

  /* Settings flagged for the popup, in schema order. */
  const settingsHost = requireElement('popup-settings', HTMLDivElement);
  const toggles: Array<{ field: ToggleField; set: (checked: boolean) => void }> = [];
  const categoryInputs = new Map<string, HTMLInputElement>();

  /** A section's eyebrow with its glyph before the word: the eye with a slash for Hide, the beaker for Experiments. */
  function eyebrow(text: string, icon: string, className: string): HTMLParagraphElement {
    const heading = document.createElement('p');
    heading.className = `geld-eyebrow popup__eyebrow ${className}`;
    // The glyph sits in a checkbox-sized box, so it is centred on the column of checkboxes below it.
    const box = document.createElement('span');
    box.className = 'popup__eyebrow-icon';
    box.setAttribute('aria-hidden', 'true');
    box.append(svgFromString(icon));
    heading.append(box, document.createTextNode(text));
    return heading;
  }

  /**
   * An experiment in the popup: one per row, shaped like a Hide row (checkbox,
   * then the title, which has the whole width), the description as the row's
   * tooltip rather than a paragraph.
   */
  function renderExperiment(field: ToggleField): HTMLElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'geld-checkbox';
    input.id = field.key;
    input.checked = settings[field.key];
    input.addEventListener('change', async () => {
      settings = await settingsItem.patch({ [field.key]: input.checked });
      saved();
    });
    toggles.push({
      field,
      set: (checked) => {
        input.checked = checked;
      },
    });
    const text = document.createElement('span');
    text.className = 'popup__experiment-label';
    text.textContent = field.label;
    const row = document.createElement('label');
    row.className = 'popup__experiment';
    row.title = plainText(field.popupDescription ?? field.description);
    row.append(input, text);
    return row;
  }

  /* One tooltip for every info icon, shown at once on hover or focus, with a caret pointing at the icon. */
  const tip = document.createElement('div');
  tip.className = 'popup__tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);

  function showTip(anchor: HTMLElement, text: string): void {
    tip.textContent = text;
    tip.hidden = false;
    const box = anchor.getBoundingClientRect();
    const margin = 8;
    const gap = 8;
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const centre = box.left + box.width / 2;
    const left = Math.min(Math.max(margin, centre - width / 2), window.innerWidth - margin - width);
    const below = box.bottom + gap + height + margin <= window.innerHeight || box.top - gap - height < margin;
    tip.dataset.side = below ? 'bottom' : 'top';
    tip.style.left = `${left}px`;
    tip.style.top = `${below ? box.bottom + gap : box.top - gap - height}px`;
    tip.style.setProperty('--caret-x', `${Math.min(Math.max(10, centre - left), width - 10)}px`);
  }

  function hideTip(): void {
    tip.hidden = true;
  }

  // The tooltip is shared, so it follows the hovered icon, else the focused one, and hides only when neither exists.
  interface TipSource {
    readonly anchor: HTMLElement;
    readonly text: string;
  }
  let hoveredTip: TipSource | null = null;
  let focusedTip: TipSource | null = null;
  function refreshTip(): void {
    const active = hoveredTip ?? focusedTip;
    if (active === null) hideTip();
    else showTip(active.anchor, active.text);
  }

  interface SwitchSpec {
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly checked: boolean;
    readonly onChange: (value: boolean) => Promise<void>;
  }

  /** A setting on one line: its title, an info icon whose tooltip carries the description, and a small switch. */
  function switchRow(spec: SwitchSpec): { readonly row: HTMLElement; readonly set: (checked: boolean) => void } {
    const description = spec.description;
    const label = document.createElement('label');
    label.className = 'popup__switch-label';
    label.id = `${spec.id}-label`;
    label.htmlFor = spec.id;
    label.textContent = spec.label;
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'popup__info';
    info.setAttribute('aria-label', `About ${spec.label}`);
    info.append(svgFromString(ICON_INFO));
    const source: TipSource = { anchor: info, text: description };
    info.addEventListener('pointerenter', () => {
      hoveredTip = source;
      refreshTip();
    });
    info.addEventListener('pointerleave', () => {
      if (hoveredTip === source) hoveredTip = null;
      refreshTip();
    });
    info.addEventListener('focus', () => {
      focusedTip = source;
      refreshTip();
    });
    info.addEventListener('blur', () => {
      if (focusedTip === source) focusedTip = null;
      refreshTip();
    });
    const help = document.createElement('span');
    help.className = 'popup__sr-only';
    help.id = `${spec.id}-help`;
    help.textContent = description;
    info.setAttribute('aria-describedby', help.id);
    const button = document.createElement('button');
    button.id = spec.id;
    button.className = 'geld-switch geld-switch--small';
    button.type = 'button';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-checked', String(spec.checked));
    button.setAttribute('aria-labelledby', label.id);
    button.setAttribute('aria-describedby', help.id);
    const bound = bindSwitch(button, spec.checked, async (value) => {
      await spec.onChange(value);
      saved();
    });
    const row = document.createElement('div');
    row.className = 'popup__switch';
    row.append(label, info, help, button);
    return { row, set: bound.set };
  }

  function renderSwitch(field: ToggleField): HTMLElement {
    const { row, set } = switchRow({
      id: field.key,
      label: field.label,
      description: plainText(field.popupDescription ?? field.description),
      checked: settings[field.key],
      onChange: async (value) => {
        settings = await settingsItem.patch({ [field.key]: value });
      },
    });
    toggles.push({ field, set });
    return row;
  }

  /** Every category's `autoViewed` at once; the options page and geld.sh set it per category. */
  let setAutoViewedSwitch: ((checked: boolean) => void) | null = null;
  const categoryIds = (current: GeldSettings): readonly AnyCategoryId[] => allCategories(current, catalog).map((category) => category.id);
  function renderAutoViewedSwitch(field: CategoriesField): HTMLElement {
    const { row, set } = switchRow({
      id: 'autoViewed',
      label: field.autoViewed.popupLabel,
      description: field.autoViewed.popupDescription,
      checked: isAutoViewedForAll(settings, categoryIds(settings)),
      onChange: async (value) => {
        settings = await settingsItem.update((current) => ({ autoViewed: withAutoViewedForAll(current, categoryIds(current), value).autoViewed }));
      },
    });
    setAutoViewedSwitch = set;
    return row;
  }

  function renderCategories(field: CategoriesField): HTMLElement {
    const section = document.createElement('section');
    section.className = 'popup__section popup__categories';
    section.setAttribute('aria-label', 'Categories');
    const heading = eyebrow(field.label, ICON_EYE_CLOSED, 'popup__categories-title');
    const grid = document.createElement('div');
    grid.className = 'popup__categories-grid';
    // Built-in and user-defined categories alike; a new custom category appears here after a reload of the popup.
    for (const category of allCategories(settings, catalog).filter(isCategoryInPicker)) {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'geld-checkbox';
      input.checked = isCategoryEnabled(settings, category.id);
      input.addEventListener('change', async () => {
        settings = await settingsItem.update((current) => ({ categories: { ...current.categories, [category.id]: input.checked } }));
        saved();
      });
      categoryInputs.set(category.id, input);
      const label = document.createElement('label');
      label.className = 'popup__category';
      label.title = plainText(category.description);
      const text = document.createElement('span');
      text.textContent = category.title;
      label.append(input, text);
      grid.append(label);
    }
    section.append(heading, grid);
    return section;
  }

  // Sections whose popup fields are experiments get a heading, so an experiment is never taken for a settled setting.
  let switches: HTMLElement | null = null;
  const switchesSection = (): HTMLElement => {
    if (switches === null) {
      switches = document.createElement('section');
      switches.className = 'popup__section popup__switches';
      settingsHost.append(switches);
    }
    return switches;
  };
  for (const section of sectionsFor('extension')) {
    const fields = section.fields.filter((field) => field.popup);
    if (fields.length === 0) continue;
    if (section.id === 'experiments') {
      switches = null;
      const experiments = document.createElement('section');
      experiments.className = 'popup__section popup__experiments';
      experiments.setAttribute('aria-label', section.title);
      experiments.append(eyebrow(section.title, ICON_BEAKER, 'popup__categories-title'));
      for (const field of fields) if (field.kind === 'toggle') experiments.append(renderExperiment(field));
      settingsHost.append(experiments);
      continue;
    }
    for (const field of fields) {
      if (field.kind === 'toggle') {
        // Neighbouring switches share one section, a line each.
        switchesSection().append(renderSwitch(field));
        continue;
      }
      // The viewed switch closes the row of switches above Hide, since it acts on every category at once.
      if (field.kind === 'categories') switchesSection().append(renderAutoViewedSwitch(field));
      switches = null;
      if (field.kind === 'categories') settingsHost.append(renderCategories(field));
      // Test groups and list fields are never flagged for the popup; the options page renders them.
    }
  }
  requireElement('popup-body', HTMLDivElement).addEventListener('scroll', hideTip, { passive: true });

  /* Tab context */
  const contextRepo = requireElement('context-repo', HTMLSpanElement);
  const summary = requireElement('context-summary', HTMLParagraphElement);
  const stats = requireElement('context-stats', HTMLElement);
  const statHidden = requireElement('context-hidden', HTMLSpanElement);
  const statAdd = requireElement('context-add', HTMLSpanElement);
  const statDel = requireElement('context-del', HTMLSpanElement);
  const files = requireElement('context-files', HTMLDetailsElement);
  const fileList = requireElement('context-file-list', HTMLUListElement);
  // With nothing hidden the row is informational only; do not let it toggle.
  stats.addEventListener('click', (event) => {
    if (stats.hasAttribute('data-empty')) event.preventDefault();
  });
  // Rows only have a width once the list is open.
  files.addEventListener('toggle', () => {
    if (files.open) requestAnimationFrame(fitFileRows);
  });
  function fitFileRows(): void {
    for (const element of fileList.querySelectorAll<HTMLElement>('.popup__file-path')) fitMiddleTruncated(element);
  }

  function iconButton(icon: 'copy' | 'goto', label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'geld-button geld-button--icon';
    button.title = label;
    button.setAttribute('aria-label', label);
    const glyph = document.createElement('span');
    glyph.className = `geld-button__icon geld-button__icon--${icon}`;
    glyph.setAttribute('aria-hidden', 'true');
    button.append(glyph);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      onClick();
    });
    return button;
  }

  /** Open the file in the tab: in place when the diffs are on this page, else via the PR's files tab. */
  async function goToFile(path: string, state: TabState): Promise<void> {
    if (tab === null) return;
    if (state.onDiffPage) {
      const message: RevealFileMessage = { type: 'geld:reveal', path };
      await browser.tabs.sendMessage(tab.id, message).catch(() => undefined);
    } else if (state.diffPageUrl !== null) {
      await browser.tabs.update(tab.id, { url: `${state.diffPageUrl}${REVEAL_HASH_PREFIX}${encodeURIComponent(path)}` });
    } else {
      return;
    }
    window.close();
  }

  function fileRow(path: string, category: string, state: TabState): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'popup__file';
    const text = document.createElement('span');
    text.className = 'popup__file-path';
    text.dataset.full = path;
    text.textContent = path;
    text.setAttribute('aria-label', `${path} (${category})`);
    const actions = document.createElement('span');
    actions.className = 'popup__file-actions';
    const copy = iconButton('copy', 'Copy path', () => {
      void navigator.clipboard?.writeText(path).then(() => {
        copy.dataset.done = '';
        copy.title = 'Copied';
        setTimeout(() => {
          delete copy.dataset.done;
          copy.title = 'Copy path';
        }, 1200);
      });
    });
    actions.append(copy, iconButton('goto', 'Go to file', () => void goToFile(path, state)));
    item.append(text, actions);
    return item;
  }
  const actions = requireElement('context-actions', HTMLDivElement);
  const toggleRepo = requireElement('toggle-repo', HTMLButtonElement);
  const toggleOrg = requireElement('toggle-org', HTMLButtonElement);
  const repoConfigHost = requireElement('repo-config', HTMLDivElement);

  function smallButton(label: string, onClick: () => void, primary = false): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `geld-button geld-button--small${primary ? ' geld-button--primary' : ''}`;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  /** Who provides the config, for prose: the repository itself, or its organisation's `.github` repository. */
  function providerOf(config: TabRepoConfig): string {
    const own = config.files.find((file) => file.kind === 'repo' || file.kind === 'gitattributes');
    return own?.repo ?? config.files[0]?.repo ?? config.repo;
  }

  function fileRowFor(file: TabRepoConfigFile): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'popup__repo-config-file';
    const link = document.createElement('a');
    link.href = file.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = file.kind === 'org' ? `${file.repo}/${file.path}` : file.path;
    link.title = `Open ${file.repo}/${file.path} on GitHub`;
    const note = document.createElement('span');
    if (file.issues.length > 0) note.textContent = pluralize(file.issues.length, 'problem', 'problems');
    else note.textContent = file.kind === 'gitattributes' ? 'linguist-generated' : file.summary;
    item.append(link, note);
    return item;
  }

  /** Problems shown per broken file before the list collapses into "and N more". */
  const MAX_SHOWN_ISSUES = 6;

  /** Octicon `alert`: the message itself lives in the title, so the row stays one line. */
  function warningIcon(message: string): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', message);
    svg.classList.add('popup__repo-config-warning');
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = message;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute(
      'd',
      'M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
    );
    svg.append(title, path);
    return svg;
  }

  /**
   * A broken file's problems, compactly: where (line/column or settings path)
   * plus a warning icon whose title carries the message. A hand-edited file can
   * fail in dozens of places; past a handful the count says enough.
   */
  function issueListFor(file: TabRepoConfigFile, prefixWithFile: boolean): HTMLUListElement {
    const issues = document.createElement('ul');
    issues.className = 'geld-alert__list popup__repo-config-issues';
    for (const issue of file.issues.slice(0, MAX_SHOWN_ISSUES)) {
      const item = document.createElement('li');
      const where = issue.path === '$' ? 'whole file' : issue.path;
      const path = document.createElement('code');
      path.className = 'geld-alert__path';
      path.textContent = prefixWithFile ? `${file.path}: ${where}` : where;
      path.title = issue.message;
      item.append(path, warningIcon(issue.message));
      issues.append(item);
    }
    const hidden = file.issues.length - MAX_SHOWN_ISSUES;
    if (hidden > 0) {
      const more = document.createElement('li');
      more.className = 'popup__repo-config-more';
      more.textContent = `and ${pluralize(hidden, 'more problem', 'more problems')}`;
      issues.append(more);
    }
    return issues;
  }

  /**
   * Repository-provided config: what it is, whether it is in use, and the
   * one-time question when the setting is "ask". Hidden when there is nothing.
   */
  function renderRepoConfig(config: TabRepoConfig | null): void {
    repoConfigHost.replaceChildren();
    // Nothing found, or still looking: nothing to say. A lookup can be under way whenever the page re-applies (the
    // cache runs out after 30 min), and a "Looking for…" box appearing mid-visit only moved everything below it.
    if (config === null || config.mode === 'never' || config.files.length === 0) {
      repoConfigHost.hidden = true;
      return;
    }
    repoConfigHost.hidden = false;
    const provider = providerOf(config);
    const broken = config.files.filter((file) => file.issues.length > 0);
    const usable = config.files.filter((file) => file.issues.length === 0);
    const box = document.createElement('div');
    box.className = `geld-alert${broken.length > 0 ? ' geld-alert--error' : ''}`;

    const title = document.createElement('div');
    title.className = 'popup__repo-config-title';
    const eyebrow = document.createElement('p');
    eyebrow.className = 'geld-eyebrow';
    const text = document.createElement('p');
    text.className = 'geld-alert__text';
    if (config.decision === 'use') {
      eyebrow.textContent = usable.length > 0 ? 'Using repository config' : 'Repository config';
      const brokenNames = broken.map((file) => file.path).join(' and ');
      text.textContent =
        broken.length === 0
          ? `Files hidden by ${provider}’s config are counted and listed like your own.`
          : `${provider}’s ${brokenNames} has problems and is not applied${usable.length > 0 ? '; the rest is in use.' : '.'}`;
      title.dataset.tone = usable.length > 0 ? 'ok' : 'error';
    } else if (config.decision === 'ignore') {
      eyebrow.textContent = 'Repository config ignored';
      text.textContent = `${provider} provides a Geld config; only your own settings apply here.`;
      title.dataset.tone = 'muted';
    } else {
      eyebrow.textContent = 'Repository config found';
      text.textContent = `${provider} provides a Geld config for everyone reviewing it. Use it here? Your answer is remembered for this repository.`;
      title.dataset.tone = 'muted';
    }
    title.append(eyebrow);
    box.append(title, text);

    const list = document.createElement('ul');
    list.className = 'popup__repo-config-files';
    list.append(...config.files.map(fileRowFor));
    box.append(list);

    for (const file of broken) box.append(issueListFor(file, broken.length > 1));

    if (config.mode === 'ask' && config.files.length > 0) {
      const buttons = document.createElement('div');
      buttons.className = 'geld-alert__actions';
      const choose = (choice: 'use' | 'ignore') => async (): Promise<void> => {
        await repoConfigChoicesItem.setValue({ ...(await repoConfigChoicesItem.getValue()), [config.repo]: choice });
        // The content script re-publishes once it has applied the answer.
        setTimeout(() => void refreshContext(), 150);
      };
      if (config.decision === 'undecided') {
        buttons.append(smallButton('Use it', choose('use'), true), smallButton('Ignore', choose('ignore')));
      } else if (config.decision === 'use') {
        buttons.append(smallButton('Stop using', choose('ignore')));
      } else {
        buttons.append(smallButton('Use it', choose('use'), true));
      }
      box.append(buttons);
    }
    repoConfigHost.append(box);
  }

  const tab = await activeGitHubTab(allHosts(settings));
  let repo: string | null = tab === null ? null : repoFromPathname(tab.url.pathname);
  wireFeedbackLink(requireElement('feedback-link', HTMLAnchorElement), tab === null ? {} : { tabId: tab.id });

  async function refreshContext(): Promise<void> {
    if (tab === null) return;
    const state = await requestTabState(tab.id);
    repo = state?.repo ?? repo;
    contextRepo.textContent = repo === null ? tab.url.hostname : tab.url.hostname === 'github.com' ? repo : `${tab.url.hostname}/${repo}`;
    // Marks the subtitle as live context (kept when signed in) rather than the generic tagline (hidden once signed in).
    contextRepo.dataset.context = 'repo';

    const rules = compileRepoRules(settings.repoRules);
    const decision = repo === null ? { allowed: true, rule: null } : decideRepo(rules, repo);

    const showStats = settings.enabled && decision.allowed && state !== null && state.hasDiff && state.visible !== null && state.all !== null;

    // One line says it all when there are numbers; prose only when there are none.
    if (!settings.enabled) {
      summary.textContent = 'Geld is turned off.';
    } else if (!decision.allowed) {
      summary.textContent = `Off in ${repo ?? 'this repository'} because of the rule "${decision.rule?.raw ?? ''}".`;
    } else if (state === null || !state.hasDiff) {
      summary.textContent = repo === null ? 'Open a GitHub repo to see what Geld is doing.' : 'No diff on this page.';
    } else if (!showStats) {
      summary.textContent = state.hiddenCount === 0 ? 'Nothing hidden on this page.' : `${pluralize(state.hiddenCount, 'file', 'files')} hidden on this page.`;
    }
    summary.hidden = showStats;

    files.hidden = !showStats;
    const paths = state?.categories.flatMap((entry) => entry.paths.map((path) => ({ path, title: entry.title }))) ?? [];
    if (showStats && state !== null && state.visible !== null && state.all !== null) {
      // One category describing every hidden file names it ("3 generated"); a mix says "N hidden" and the title lists the split.
      const only = state.categories.length === 1 ? state.categories[0] : undefined;
      statHidden.textContent = only === undefined ? `${formatCount(state.hiddenCount)} hidden` : pluralize(state.hiddenCount, only.shortNoun, only.shortNounPlural);
      statAdd.textContent = `+${formatCount(state.visible.additions)}`;
      statDel.textContent = `\u2212${formatCount(state.visible.deletions)}`;
      const parts = state.categories.map((entry) => `${formatCount(entry.count)} ${entry.title.toLowerCase()}`);
      stats.title = `${state.categories.length > 1 ? `${parts.join(', ')}. ` : ''}Including hidden files: +${formatCount(state.all.additions)} \u2212${formatCount(
        state.all.deletions,
      )} in ${pluralize(state.all.files, 'file', 'files')}${state.expanded ? '. Currently shown on the page' : ''}`;
      stats.toggleAttribute('data-empty', paths.length === 0);
      if (paths.length === 0) files.open = false;
      const current = state;
      fileList.replaceChildren(...paths.map(({ path, title }) => fileRow(path, title, current)));
      if (files.open) requestAnimationFrame(fitFileRows);
    }

    actions.hidden = repo === null || !settings.enabled;
    renderRepoConfig(settings.enabled && decision.allowed ? (state?.repoConfig ?? null) : null);
    if (repo !== null) {
      const org = orgOf(repo);
      const orgDecision = decideRepo(rules, ownerProbe(org));
      renderRuleButton(toggleRepo, repo, decision.allowed, repo);
      renderRuleButton(toggleOrg, `${org}/*`, orgDecision.allowed, org);
    }
  }

  /** "✓ owner/repo" when Geld runs there, "✕ owner/repo" when a rule turns it off; click flips it. */
  function renderRuleButton(button: HTMLButtonElement, label: string, on: boolean, target: string): void {
    const icon = document.createElement('span');
    icon.className = `geld-button__icon geld-button__icon--${on ? 'check' : 'x'}`;
    icon.setAttribute('aria-hidden', 'true');
    button.replaceChildren(icon, document.createTextNode(label));
    button.setAttribute('aria-pressed', String(on));
    button.title = on ? `Geld is on for ${label}. Click to turn it off.` : `Geld is off for ${label}. Click to turn it on.`;
    button.dataset.target = target;
    button.dataset.allow = String(!on);
  }

  async function toggleRules(button: HTMLButtonElement): Promise<void> {
    const target = button.dataset.target;
    if (target === undefined) return;
    const allow = button.dataset.allow === 'true';
    settings = await settingsItem.update((current) => ({ repoRules: withRepoRule(current.repoRules, target, allow) }));
    saved();
    await refreshContext();
  }
  toggleRepo.addEventListener('click', () => void toggleRules(toggleRepo));
  toggleOrg.addEventListener('click', () => void toggleRules(toggleOrg));

  await refreshContext();
  // The content script re-applies asynchronously after a settings change.
  settingsItem.watch((next) => {
    settings = next;
    for (const { field, set } of toggles) set(next[field.key]);
    setAutoViewedSwitch?.(isAutoViewedForAll(next, categoryIds(next)));
    for (const category of allCategories(next, catalog).filter(isCategoryInPicker)) {
      const input = categoryInputs.get(category.id);
      if (input !== undefined) input.checked = isCategoryEnabled(next, category.id);
    }
    setTimeout(() => void refreshContext(), 250);
  });

  requireElement('open-options', HTMLButtonElement).addEventListener('click', () => {
    void browser.runtime.openOptionsPage();
    window.close();
  });
}

document.documentElement.style.setProperty('--geld-popup-max-height', `${popupMaxHeight(window.screen.availHeight)}px`);
const popupBody = document.querySelector<HTMLElement>('.popup__body');
if (popupBody !== null) {
  const updateScrollState = (): void => {
    popupBody.toggleAttribute('data-scrollable', popupNeedsScroll(popupBody.scrollHeight, popupBody.clientHeight));
  };
  // The body's own box stops growing at the popup's cap, so its contents are watched too.
  const observer = new ResizeObserver(updateScrollState);
  observer.observe(popupBody);
  for (const child of popupBody.children) observer.observe(child);
  requestAnimationFrame(updateScrollState);
}
polyfillCornerShape();
if (__GELD_NIGHTLY__ && popupBody !== null) mountNightlyPopup(popupBody);
void main();
