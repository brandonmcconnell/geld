import { browser } from 'wxt/browser';
import { CATEGORIES } from '../../src/lib/categories';
import { formatCount, pluralize } from '../../src/lib/format';
import type { GetTabStateMessage, TabState } from '../../src/lib/messages';
import { isTabState } from '../../src/lib/messages';
import { compileRepoRules, decideRepo, ownerProbe, repoFromPathname, withRepoRule } from '../../src/lib/repo-rules';
import { isCategoryEnabled } from '../../src/lib/settings';
import { settingsItem } from '../../src/lib/storage';
import { bindSwitch, requireElement } from '../../src/ui/switch';

interface ActiveTab {
  readonly id: number;
  readonly url: URL;
}

async function activeGitHubTab(): Promise<ActiveTab | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || tab.url === undefined) return null;
  try {
    const url = new URL(tab.url);
    return url.hostname === 'github.com' ? { id: tab.id, url } : null;
  } catch {
    return null;
  }
}

async function requestTabState(tabId: number): Promise<TabState | null> {
  const message: GetTabStateMessage = { type: 'geld:get-tab-state' };
  try {
    const response: unknown = await browser.tabs.sendMessage(tabId, message);
    return isTabState(response) ? response : null;
  } catch {
    return null;
  }
}

function orgOf(repo: string): string {
  return repo.split('/')[0] ?? repo;
}

async function main(): Promise<void> {
  let settings = await settingsItem.getValue();
  const status = requireElement('status', HTMLSpanElement);
  const saved = (): void => {
    status.textContent = 'Saved';
    status.dataset.tone = 'success';
    setTimeout(() => {
      status.textContent = '';
      delete status.dataset.tone;
    }, 1200);
  };

  /* Global switches */
  const enabledSwitch = bindSwitch(requireElement('enabled', HTMLButtonElement), settings.enabled, async (enabled) => {
    settings = await settingsItem.patch({ enabled });
    saved();
  });
  const expandedSwitch = bindSwitch(requireElement('expanded', HTMLButtonElement), settings.expandedByDefault, async (expandedByDefault) => {
    settings = await settingsItem.patch({ expandedByDefault });
    saved();
  });

  /* Category checkboxes */
  const categoriesHost = requireElement('categories', HTMLElement);
  const categoryInputs = new Map<string, HTMLInputElement>();
  const heading = document.createElement('p');
  heading.className = 'popup__categories-title';
  heading.textContent = 'Hide';
  categoriesHost.append(heading);
  const grid = document.createElement('div');
  grid.className = 'popup__categories-grid';
  for (const category of CATEGORIES) {
    const input = document.createElement('input');
    input.type = 'checkbox';
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
  categoriesHost.append(grid);

  /* Tab context */
  const contextRepo = requireElement('context-repo', HTMLParagraphElement);
  const summary = requireElement('context-summary', HTMLParagraphElement);
  const stats = requireElement('context-stats', HTMLDivElement);
  const statHidden = requireElement('context-hidden', HTMLSpanElement);
  const statAdd = requireElement('context-add', HTMLSpanElement);
  const statDel = requireElement('context-del', HTMLSpanElement);
  const files = requireElement('context-files', HTMLDetailsElement);
  const filesSummary = requireElement('context-files-summary', HTMLSpanElement);
  const fileList = requireElement('context-file-list', HTMLUListElement);
  const actions = requireElement('context-actions', HTMLDivElement);
  const toggleRepo = requireElement('toggle-repo', HTMLButtonElement);
  const toggleOrg = requireElement('toggle-org', HTMLButtonElement);

  const tab = await activeGitHubTab();
  let repo: string | null = tab === null ? null : repoFromPathname(tab.url.pathname);

  async function refreshContext(): Promise<void> {
    if (tab === null) return;
    const state = await requestTabState(tab.id);
    repo = state?.repo ?? repo;
    contextRepo.textContent = repo ?? 'github.com';

    const rules = compileRepoRules(settings.repoRules);
    const decision = repo === null ? { allowed: true, rule: null } : decideRepo(rules, repo);

    if (!settings.enabled) {
      summary.textContent = 'Geld is turned off.';
    } else if (!decision.allowed) {
      summary.textContent = `Off in ${repo ?? 'this repository'} because of the rule "${decision.rule?.raw ?? ''}".`;
    } else if (state === null || !state.hasDiff) {
      summary.textContent = repo === null ? 'Open a pull request, commit or PR list to see what Geld is doing.' : 'No diff on this page.';
    } else if (state.hiddenCount === 0) {
      summary.textContent = 'Nothing hidden on this page.';
    } else {
      const parts = state.categories.map((entry) => `${formatCount(entry.count)} ${entry.title.toLowerCase()}`);
      summary.textContent = `${pluralize(state.hiddenCount, 'file', 'files')} hidden on this page${
        state.categories.length > 1 ? ` (${parts.join(', ')})` : ''
      }${state.expanded ? ', currently shown' : ''}.`;
    }

    const showStats = settings.enabled && decision.allowed && state !== null && state.hasDiff && state.visible !== null && state.all !== null;
    stats.hidden = !showStats;
    if (showStats && state !== null && state.visible !== null && state.all !== null) {
      statHidden.textContent = `${formatCount(state.hiddenCount)} hidden`;
      statAdd.textContent = `+${formatCount(state.visible.additions)}`;
      statDel.textContent = `\u2212${formatCount(state.visible.deletions)}`;
      stats.title = `Including hidden files: +${formatCount(state.all.additions)} \u2212${formatCount(state.all.deletions)} in ${pluralize(state.all.files, 'file', 'files')}`;
    }

    const paths = state?.categories.flatMap((entry) => entry.paths.map((path) => ({ path, title: entry.title }))) ?? [];
    files.hidden = !(showStats && paths.length > 0);
    if (!files.hidden) {
      filesSummary.textContent = pluralize(paths.length, 'hidden file', 'hidden files');
      fileList.replaceChildren(
        ...paths.map(({ path, title }) => {
          const item = document.createElement('li');
          item.title = title;
          item.textContent = path;
          return item;
        }),
      );
    }

    actions.hidden = repo === null || !settings.enabled;
    if (repo !== null) {
      const org = orgOf(repo);
      const orgDecision = decideRepo(rules, ownerProbe(org));
      toggleRepo.textContent = decision.allowed ? `Turn off for ${repo}` : `Turn on for ${repo}`;
      toggleOrg.textContent = orgDecision.allowed ? `Turn off for ${org}/*` : `Turn on for ${org}/*`;
      toggleRepo.dataset.target = repo;
      toggleRepo.dataset.allow = String(!decision.allowed);
      toggleOrg.dataset.target = org;
      toggleOrg.dataset.allow = String(!orgDecision.allowed);
    }
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
    enabledSwitch.set(next.enabled);
    expandedSwitch.set(next.expandedByDefault);
    for (const category of CATEGORIES) {
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

void main();

