import { browser } from 'wxt/browser';
import type { HiddenCategory, PatternGroup } from '../../src/lib/categories';
import { CATEGORIES } from '../../src/lib/categories';
import { compileGlobs } from '../../src/lib/glob';
import { createMatcher } from '../../src/lib/matcher';
import { compileRepoRules, decideRepo } from '../../src/lib/repo-rules';
import type { GeldSettings } from '../../src/lib/settings';
import { grantedHosts, originPattern } from '../../src/lib/enterprise';
import { DEFAULT_SETTINGS, isCategoryEnabled, isTestGroupEnabled, normalizeHost, normalizeSettings, parsePatternList } from '../../src/lib/settings';
import { settingsItem } from '../../src/lib/storage';
import { isTestPatternGroupId } from '../../src/lib/test-patterns';
import { bindSwitch, requireElement } from '../../src/ui/switch';

/* ------------------------------------------------------------------ helpers */

type Tone = 'success' | 'error' | 'neutral';

function statusReporter(element: HTMLElement): (message: string, tone: Tone) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (message, tone) => {
    element.textContent = message;
    if (tone === 'neutral') delete element.dataset.tone;
    else element.dataset.tone = tone;
    if (timer !== null) clearTimeout(timer);
    if (tone !== 'error' && message !== '') {
      timer = setTimeout(() => {
        element.textContent = '';
        delete element.dataset.tone;
      }, 2200);
    }
  };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  children: ReadonlyArray<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  node.append(...children);
  return node;
}

function switchButton(id: string, checked: boolean, labelId: string, helpId: string): HTMLButtonElement {
  const button = el('button', 'geld-switch');
  button.id = id;
  button.type = 'button';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(checked));
  button.setAttribute('aria-labelledby', labelId);
  button.setAttribute('aria-describedby', helpId);
  return button;
}

interface SettingRow {
  readonly id: string;
  readonly label: string;
  readonly help: string;
  readonly get: (settings: GeldSettings) => boolean;
  readonly patch: (value: boolean) => Partial<GeldSettings>;
}

/** Validate each pattern separately so the message can point at the bad line. */
function validatePatterns(lines: readonly string[]): string | null {
  for (const line of lines) {
    if (/^\[.*\]$/.test(line)) continue;
    try {
      compileGlobs([line]);
    } catch (error) {
      return `Invalid pattern "${line}": ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return null;
}

/** Exports are wrapped as `{ geld: 1, settings }`; accept a bare settings object too. */
function unwrapExport(parsed: unknown): unknown {
  if (typeof parsed !== 'object' || parsed === null) return parsed;
  const record: Record<string, unknown> = { ...parsed };
  return 'settings' in record ? record.settings : parsed;
}

/* ------------------------------------------------------------------- main */

async function main(): Promise<void> {
  let settings = await settingsItem.getValue();
  const shortcutHint = import.meta.env.FIREFOX
    ? 'Change it under Add-ons → Manage Extension Shortcuts.'
    : 'Change it at chrome://extensions/shortcuts (edge://extensions/shortcuts on Edge).';

  const generalRows: SettingRow[] = [
    { id: 'enabled', label: 'Enabled on GitHub', help: 'Turn Geld off to see GitHub exactly as it ships.', get: (s) => s.enabled, patch: (enabled) => ({ enabled }) },
    { id: 'expanded', label: 'Show hidden files expanded', help: 'Hidden files still move to the bottom and are excluded from the counts, but stay visible. Pages where every file is hidden always start expanded.', get: (s) => s.expandedByDefault, patch: (expandedByDefault) => ({ expandedByDefault }) },
    { id: 'list-stats', label: 'Line counts in pull request lists', help: 'Adds "N tests +A −D" to each PR on list pages such as /pulls, with the breakdown on hover. Diffs are fetched only for rows you scroll to.', get: (s) => s.showListStats, patch: (showListStats) => ({ showListStats }) },
    { id: 'whitespace', label: 'Hide whitespace changes', help: "Uses GitHub's own “hide whitespace” option (the ?w=1 view) on every diff you open, so indentation-only changes never clutter a review. GitHub does not remember it, so Geld adds it on your way in.", get: (s) => s.hideWhitespace, patch: (hideWhitespace) => ({ hideWhitespace }) },
    { id: 'shortcut', label: 'Keyboard shortcut (Alt+Shift+T)', help: `Shows or hides the hidden files on the current page until you leave it; it never changes your saved settings. ${shortcutHint}`, get: (s) => s.shortcutEnabled, patch: (shortcutEnabled) => ({ shortcutEnabled }) },
    { id: 'badge', label: 'Count on the toolbar icon', help: 'Shows how many files are hidden on the current tab.', get: (s) => s.showBadge, patch: (showBadge) => ({ showBadge }) },
  ];

  const generalStatus = statusReporter(el('span'));
  const generalHost = requireElement('general-rows', HTMLDivElement);
  const generalSwitches: Array<{ row: SettingRow; set: (checked: boolean) => void }> = [];
  generalRows.forEach((row, index) => {
    if (index > 0) generalHost.append(el('hr', 'options__divider'));
    const label = el('span', 'geld-label', [row.label]);
    label.id = `${row.id}-label`;
    const help = el('p', 'geld-help', [row.help]);
    help.id = `${row.id}-help`;
    const button = switchButton(row.id, row.get(settings), label.id, help.id);
    generalHost.append(el('div', 'geld-row', [el('div', '', [label, help]), button]));
    const bound = bindSwitch(button, row.get(settings), async (value) => {
      settings = await settingsItem.patch(row.patch(value));
      generalStatus('Saved', 'success');
    });
    generalSwitches.push({ row, set: bound.set });
  });

  /* Categories */
  const categoriesHost = requireElement('categories', HTMLDivElement);
  const categorySwitches = new Map<string, (checked: boolean) => void>();
  const groupChecks = new Map<string, HTMLInputElement>();

  function renderGroup(category: HiddenCategory, group: PatternGroup): HTMLElement {
    const patterns = el(
      'ul',
      'options__patterns',
      group.patterns.map((pattern) => el('li', '', [el('code', '', [pattern])])),
    );
    const title = el('span', 'options__group-title', [group.label]);
    const description = el('span', 'options__group-description', [group.description]);
    let heading: HTMLElement;
    if (category.id === 'tests' && isTestPatternGroupId(group.id)) {
      const groupId = group.id;
      const checkbox = el('input', 'options__checkbox');
      checkbox.type = 'checkbox';
      checkbox.checked = isTestGroupEnabled(settings, groupId);
      checkbox.addEventListener('change', async () => {
        settings = await settingsItem.update((current) => ({ testGroups: { ...current.testGroups, [groupId]: checkbox.checked } }));
      });
      groupChecks.set(groupId, checkbox);
      heading = el('label', 'options__group-heading options__group-heading--checkbox', [checkbox, el('span', '', [title, description])]);
    } else {
      heading = el('div', 'options__group-heading', [el('span', '', [title, description])]);
    }
    const count = el('span', 'options__group-count', [`${group.patterns.length}`]);
    const details = el('details', 'options__group', [
      el('summary', '', [el('span', 'options__chevron', ['\u203a']), heading, count]),
      patterns,
    ]);
    return details;
  }

  for (const category of CATEGORIES) {
    const label = el('span', 'geld-label', [category.title]);
    label.id = `category-${category.id}-label`;
    const help = el('p', 'geld-help', [category.description]);
    help.id = `category-${category.id}-help`;
    const button = switchButton(`category-${category.id}`, isCategoryEnabled(settings, category.id), label.id, help.id);
    const bound = bindSwitch(button, isCategoryEnabled(settings, category.id), async (value) => {
      settings = await settingsItem.update((current) => ({ categories: { ...current.categories, [category.id]: value } }));
    });
    categorySwitches.set(category.id, bound.set);

    const groups = el('div', 'options__groups', category.groups.map((group) => renderGroup(category, group)));
    const card = el('details', 'options__category', [
      el('summary', 'options__category-summary', [
        el('span', 'options__chevron', ['\u203a']),
        el('div', 'options__category-text', [label, help]),
      ]),
      groups,
    ]);
    // The switch sits in the summary but must not toggle the accordion.
    const summary = card.querySelector('summary');
    button.addEventListener('click', (event) => event.stopPropagation());
    summary?.append(button);
    categoriesHost.append(card);
  }

  /* Custom patterns */
  const patternsStatus = statusReporter(requireElement('patterns-status', HTMLSpanElement));
  const patternsArea = requireElement('custom-patterns', HTMLTextAreaElement);
  patternsArea.value = settings.customPatterns.join('\n');
  patternsArea.addEventListener('input', () => {
    patternsStatus(patternsArea.value.trim() !== settings.customPatterns.join('\n') ? 'Unsaved changes' : '', 'neutral');
  });
  requireElement('save-patterns', HTMLButtonElement).addEventListener('click', async () => {
    const customPatterns = parsePatternList(patternsArea.value);
    const problem = validatePatterns(customPatterns);
    if (problem !== null) {
      patternsStatus(problem, 'error');
      return;
    }
    settings = await settingsItem.patch({ customPatterns });
    patternsArea.value = customPatterns.join('\n');
    patternsStatus(`Saved ${customPatterns.length} line${customPatterns.length === 1 ? '' : 's'}`, 'success');
    runTester();
  });

  /* Repository rules */
  const rulesStatus = statusReporter(requireElement('rules-status', HTMLSpanElement));
  const rulesArea = requireElement('repo-rules', HTMLTextAreaElement);
  rulesArea.value = settings.repoRules.join('\n');
  rulesArea.addEventListener('input', () => {
    rulesStatus(rulesArea.value.trim() !== settings.repoRules.join('\n') ? 'Unsaved changes' : '', 'neutral');
  });
  requireElement('save-rules', HTMLButtonElement).addEventListener('click', async () => {
    const repoRules = parsePatternList(rulesArea.value);
    const problem = validatePatterns(repoRules.map((rule) => rule.replace(/^!/, '')));
    if (problem !== null) {
      rulesStatus(problem, 'error');
      return;
    }
    settings = await settingsItem.patch({ repoRules });
    rulesArea.value = repoRules.join('\n');
    rulesStatus(`Saved ${repoRules.length} rule${repoRules.length === 1 ? '' : 's'}`, 'success');
    runTester();
  });

  /* GitHub Enterprise Server hosts */
  const hostsStatus = statusReporter(requireElement('hosts-status', HTMLSpanElement));
  const hostsArea = requireElement('enterprise-hosts', HTMLTextAreaElement);
  hostsArea.value = settings.enterpriseHosts.join('\n');
  hostsArea.addEventListener('input', () => {
    hostsStatus(hostsArea.value.trim() !== settings.enterpriseHosts.join('\n') ? 'Unsaved changes' : '', 'neutral');
  });
  requireElement('save-hosts', HTMLButtonElement).addEventListener('click', async () => {
    const lines = parsePatternList(hostsArea.value);
    const hosts: string[] = [];
    for (const line of lines) {
      const host = normalizeHost(line);
      if (host === null) {
        hostsStatus(`"${line}" is not a hostname Geld can use.`, 'error');
        return;
      }
      if (!hosts.includes(host)) hosts.push(host);
    }

    // One permission prompt covering every new host (must run inside this click).
    const alreadyGranted = await grantedHosts(hosts);
    const missing = hosts.filter((host) => !alreadyGranted.includes(host));
    if (missing.length > 0) {
      let granted = false;
      try {
        granted = await browser.permissions.request({ origins: missing.map(originPattern) });
      } catch (error) {
        hostsStatus(`Could not request access: ${error instanceof Error ? error.message : String(error)}`, 'error');
        return;
      }
      if (!granted) {
        hostsStatus('Access was not granted, so those hosts were not saved.', 'error');
        return;
      }
    }

    // Release permissions for hosts that were removed.
    const removed = settings.enterpriseHosts.filter((host) => !hosts.includes(host));
    if (removed.length > 0) {
      await browser.permissions.remove({ origins: removed.map(originPattern) }).catch(() => false);
    }

    settings = await settingsItem.patch({ enterpriseHosts: hosts });
    hostsArea.value = hosts.join('\n');
    hostsStatus(hosts.length === 0 ? 'Saved; only github.com is used.' : `Saved ${hosts.length} host${hosts.length === 1 ? '' : 's'}. Reload open tabs on those hosts.`, 'success');
  });

  /* Tester */
  const testerRepo = requireElement('tester-repo', HTMLInputElement);
  const testerPath = requireElement('tester-path', HTMLInputElement);
  const testerResult = requireElement('tester-result', HTMLParagraphElement);
  function runTester(): void {
    const path = testerPath.value.trim();
    const repo = testerRepo.value.trim() || null;
    testerResult.dataset.tone = '';
    if (path === '') {
      testerResult.textContent = 'Type a path to see what happens to it.';
      return;
    }
    if (repo !== null) {
      const decision = decideRepo(compileRepoRules(settings.repoRules), repo);
      if (!decision.allowed) {
        testerResult.textContent = `Geld is off in ${repo} because of the rule "${decision.rule?.raw ?? ''}".`;
        return;
      }
    }
    const verdict = createMatcher(settings, repo).explain(path);
    if (verdict.category === null) {
      testerResult.textContent =
        verdict.rescuedBy !== null
          ? `Visible: rescued by your custom pattern ${verdict.rescuedBy}.`
          : 'Visible: no enabled pattern matches this path.';
      return;
    }
    testerResult.textContent = `Hidden as ${verdict.category.title.toLowerCase()} — matched ${verdict.source} pattern "${verdict.pattern}".`;
    testerResult.dataset.tone = 'hidden';
  }
  testerRepo.addEventListener('input', runTester);
  testerPath.addEventListener('input', runTester);

  /* Backup & maintenance */
  const maintenanceStatus = statusReporter(requireElement('maintenance-status', HTMLParagraphElement));
  requireElement('export', HTMLButtonElement).addEventListener('click', () => {
    const blob = new Blob([`${JSON.stringify({ geld: 1, settings }, null, 2)}\n`], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'geld-settings.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    maintenanceStatus('Exported geld-settings.json', 'success');
  });
  const importInput = requireElement('import-file', HTMLInputElement);
  requireElement('import', HTMLButtonElement).addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (file === undefined) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const next = normalizeSettings(unwrapExport(parsed));
      await settingsItem.setValue(next);
      maintenanceStatus('Settings imported', 'success');
    } catch (error) {
      maintenanceStatus(`Could not import: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  });
  requireElement('clear-cache', HTMLButtonElement).addEventListener('click', async () => {
    await browser.storage.local.remove('diffCache');
    maintenanceStatus('Cached diffs cleared', 'success');
  });
  requireElement('reset', HTMLButtonElement).addEventListener('click', async () => {
    await settingsItem.setValue(DEFAULT_SETTINGS);
    maintenanceStatus('Restored default settings', 'success');
  });

  /* Keep the page in sync with changes made elsewhere (popup, other windows). */
  settingsItem.watch((next) => {
    settings = next;
    for (const { row, set } of generalSwitches) set(row.get(next));
    for (const category of CATEGORIES) categorySwitches.get(category.id)?.(isCategoryEnabled(next, category.id));
    for (const [groupId, checkbox] of groupChecks) {
      if (isTestPatternGroupId(groupId)) checkbox.checked = isTestGroupEnabled(next, groupId);
    }
    if (document.activeElement !== patternsArea) patternsArea.value = next.customPatterns.join('\n');
    if (document.activeElement !== rulesArea) rulesArea.value = next.repoRules.join('\n');
    if (document.activeElement !== hostsArea) hostsArea.value = next.enterpriseHosts.join('\n');
    runTester();
  });
}

void main();
