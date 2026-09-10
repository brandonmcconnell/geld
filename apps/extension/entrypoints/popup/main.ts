import { browser } from 'wxt/browser';
import { allCategories } from '@geld/core';
import { formatCount, pluralize } from '@geld/core';
import type { EnsureContentMessage, GetTabStateMessage, RevealFileMessage, TabState } from '../../src/lib/messages';
import { isEnsureContentResponse, isTabState, REVEAL_HASH_PREFIX } from '../../src/lib/messages';
import { fitMiddleTruncated } from '../../src/ui/middle-truncate';
import { compileRepoRules, decideRepo, ownerProbe, repoFromPathname, withRepoRule } from '@geld/core';
import { allHosts, fieldsFor, isCategoryEnabled } from '@geld/core';
import type { CategoriesField, ToggleField } from '@geld/core';
import type { TabRepoConfig, TabRepoConfigFile } from '../../src/lib/messages';
import { loadCatalog } from '../../src/lib/catalog';
import { repoConfigChoicesItem } from '../../src/lib/local-state';
import { settingsItem } from '../../src/lib/storage';
import { mountAccountWidget } from '../../src/ui/account-widget';
import { polyfillCornerShape } from '../../src/ui/corner-shape';
import { bindSwitch, requireElement } from '../../src/ui/switch';

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

  function renderToggle(field: ToggleField): HTMLElement {
    const label = document.createElement('span');
    label.className = 'geld-label';
    label.id = `${field.key}-label`;
    label.textContent = field.label;
    const help = document.createElement('p');
    help.className = 'geld-help';
    help.id = `${field.key}-help`;
    help.textContent = field.popupDescription ?? field.description;
    const text = document.createElement('div');
    text.append(label, help);
    const button = document.createElement('button');
    button.id = field.key;
    button.className = 'geld-switch';
    button.type = 'button';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-checked', String(settings[field.key]));
    button.setAttribute('aria-labelledby', label.id);
    button.setAttribute('aria-describedby', help.id);
    const bound = bindSwitch(button, settings[field.key], async (value) => {
      settings = await settingsItem.patch({ [field.key]: value });
      saved();
    });
    toggles.push({ field, set: bound.set });
    const row = document.createElement('div');
    row.className = 'geld-row';
    row.append(text, button);
    const section = document.createElement('section');
    section.className = 'popup__section';
    section.append(row);
    return section;
  }

  function renderCategories(field: CategoriesField): HTMLElement {
    const section = document.createElement('section');
    section.className = 'popup__section popup__categories';
    section.setAttribute('aria-label', 'Categories');
    const heading = document.createElement('p');
    heading.className = 'geld-eyebrow popup__categories-title';
    heading.textContent = field.label;
    const grid = document.createElement('div');
    grid.className = 'popup__categories-grid';
    // Built-in and user-defined categories alike; a new custom category appears here after a reload of the popup.
    for (const category of allCategories(settings, catalog)) {
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
      label.title = category.description;
      const text = document.createElement('span');
      text.textContent = category.title;
      label.append(input, text);
      grid.append(label);
    }
    section.append(heading, grid);
    return section;
  }

  for (const field of fieldsFor('extension', true)) {
    if (field.kind === 'toggle') settingsHost.append(renderToggle(field));
    else if (field.kind === 'categories') settingsHost.append(renderCategories(field));
    // Test groups and list fields are never flagged for the popup; the options page renders them.
  }

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

  /**
   * Repository-provided config: what it is, whether it is in use, and the
   * one-time question when the setting is "ask". Hidden when there is nothing.
   */
  function renderRepoConfig(config: TabRepoConfig | null): void {
    repoConfigHost.replaceChildren();
    if (config === null || config.mode === 'never' || (config.files.length === 0 && !config.loading)) {
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
    if (config.files.length === 0) {
      eyebrow.textContent = 'Repository config';
      text.textContent = 'Looking for a repository config…';
      title.dataset.tone = 'muted';
    } else if (config.decision === 'use') {
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

    for (const file of broken) {
      const issues = document.createElement('ul');
      issues.className = 'geld-alert__list';
      for (const issue of file.issues) {
        const item = document.createElement('li');
        const path = document.createElement('code');
        path.className = 'geld-alert__path';
        path.textContent = broken.length > 1 ? `${file.path}: ${issue.path}` : issue.path;
        item.append(path, document.createTextNode(` ${issue.message}`));
        issues.append(item);
      }
      box.append(issues);
    }

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

  async function refreshContext(): Promise<void> {
    if (tab === null) return;
    const state = await requestTabState(tab.id);
    repo = state?.repo ?? repo;
    contextRepo.textContent = repo === null ? tab.url.hostname : tab.url.hostname === 'github.com' ? repo : `${tab.url.hostname}/${repo}`;

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
      statHidden.textContent = `${formatCount(state.hiddenCount)} hidden`;
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
    for (const category of allCategories(next, catalog)) {
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

polyfillCornerShape();
void main();
