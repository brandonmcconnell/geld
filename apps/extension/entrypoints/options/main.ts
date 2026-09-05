import { browser } from 'wxt/browser';
import type { HiddenCategory, PatternGroup } from '@geld/core';
import { CATEGORIES } from '@geld/core';
import { compileGlobs } from '@geld/core';
import { createMatcher } from '@geld/core';
import { compileRepoRules, decideRepo } from '@geld/core';
import { grantedHosts, originPattern } from '../../src/lib/enterprise';
import { DEFAULT_SETTINGS, isCategoryEnabled, isTestGroupEnabled, normalizeHost, parsePatternList } from '@geld/core';
import type { ListField, SettingsSectionId, ToggleField } from '@geld/core';
import { listFields, sectionsFor, serializeSettingsPayload, splitInlineCode, toggleFields, validateSettingsDocument } from '@geld/core';
import { settingsItem } from '../../src/lib/storage';
import { isTestPatternGroupId } from '@geld/core';
import { BUILT_IN_CLIENT_ID, oauthClientIdItem } from '../../src/lib/account';
import { mountAccountWidget } from '../../src/ui/account-widget';
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

/** Render schema copy, turning `backticks` into <code>. */
function richText(copy: string): Node[] {
  return splitInlineCode(copy).map((run) => (run.kind === 'code' ? el('code', '', [run.text]) : document.createTextNode(run.text)));
}

const sections = sectionsFor('extension');

/**
 * Fill a card's title, intro and (for list settings) textarea from the schema,
 * so the copy is written once in `@geld/core` and shared with geld.sh.
 */
function applySchemaCopy(sectionId: SettingsSectionId): { textarea: HTMLTextAreaElement | null; field: ListField | null } {
  const section = sections.find((candidate) => candidate.id === sectionId);
  const card = document.querySelector<HTMLElement>(`[data-section="${sectionId}"]`);
  if (section === undefined || card === null) throw new Error(`Options page is missing the "${sectionId}" section.`);
  const title = card.querySelector<HTMLElement>('.options__title');
  if (title !== null) title.textContent = section.title;
  const intro = card.querySelector<HTMLParagraphElement>('.options__intro');
  if (intro !== null && section.intro !== '') intro.replaceChildren(...richText(section.intro));
  const [field] = listFields(section.fields);
  const textarea = card.querySelector('textarea');
  if (textarea !== null && field !== undefined) {
    textarea.placeholder = field.placeholder;
    textarea.rows = field.rows;
    textarea.setAttribute('aria-label', field.label);
    const save = card.querySelector<HTMLButtonElement>('button.geld-button--primary');
    if (save !== null) save.textContent = field.saveLabel;
  }
  return { textarea, field: field ?? null };
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

/* ------------------------------------------------------------------- main */

async function main(): Promise<void> {
  let settings = await settingsItem.getValue();

  /* General: one switch per boolean setting the extension surface exposes. */
  applySchemaCopy('general');
  const generalSection = sections.find((section) => section.id === 'general');
  const shortcutHint = import.meta.env.FIREFOX
    ? 'Change it under Add-ons → Manage Extension Shortcuts.'
    : 'Change it at chrome://extensions/shortcuts (edge://extensions/shortcuts on Edge).';
  // Copy that only makes sense inside a browser is appended here, not kept in core.
  const surfaceNotes: Partial<Record<ToggleField['key'], string>> = { shortcutEnabled: shortcutHint };

  const generalStatus = statusReporter(el('span'));
  const generalHost = requireElement('general-rows', HTMLDivElement);
  const generalSwitches: Array<{ field: ToggleField; set: (checked: boolean) => void }> = [];
  toggleFields(generalSection?.fields ?? []).forEach((field, index) => {
    if (index > 0) generalHost.append(el('hr', 'options__divider'));
    const label = el('span', 'geld-label', [field.label]);
    label.id = `${field.key}-label`;
    const note = surfaceNotes[field.key];
    const help = el('p', 'geld-help', richText(note === undefined ? field.description : `${field.description} ${note}`));
    help.id = `${field.key}-help`;
    const button = switchButton(field.key, settings[field.key], label.id, help.id);
    generalHost.append(el('div', 'geld-row', [el('div', '', [label, help]), button]));
    const bound = bindSwitch(button, settings[field.key], async (value) => {
      settings = await settingsItem.patch({ [field.key]: value });
      generalStatus('Saved', 'success');
    });
    generalSwitches.push({ field, set: bound.set });
  });
  applySchemaCopy('hide');

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
      const checkbox = el('input', 'geld-checkbox');
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
    const chevron = el('span', 'geld-chevron');
    chevron.setAttribute('aria-hidden', 'true');
    const details = el('details', 'options__group', [el('summary', '', [heading, count, chevron]), patterns]);
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
    const chevron = el('span', 'geld-chevron');
    chevron.setAttribute('aria-hidden', 'true');
    const card = el('details', 'options__category', [
      el('summary', 'options__category-summary', [chevron, el('div', 'options__category-text', [label, help])]),
      groups,
    ]);
    // The switch sits in the summary but must not toggle the accordion.
    const summary = card.querySelector('summary');
    button.addEventListener('click', (event) => event.stopPropagation());
    summary?.append(button);
    categoriesHost.append(card);
  }

  /* Custom patterns */
  applySchemaCopy('custom-patterns');
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
  applySchemaCopy('repositories');
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
  applySchemaCopy('enterprise');
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

  /* GitHub account */
  mountAccountWidget(requireElement('account', HTMLDivElement), {
    variant: 'full',
    promptHost: requireElement('account-prompt', HTMLDivElement),
  });
  const oauthStatus = statusReporter(requireElement('oauth-status', HTMLSpanElement));
  const oauthInput = requireElement('oauth-client-id', HTMLInputElement);
  oauthInput.value = await oauthClientIdItem.getValue();
  oauthInput.placeholder = BUILT_IN_CLIENT_ID !== '' ? `${BUILT_IN_CLIENT_ID} (built in)` : 'Ov23li…';
  requireElement('save-oauth', HTMLButtonElement).addEventListener('click', async () => {
    const value = oauthInput.value.trim();
    if (value !== '' && !/^[A-Za-z0-9._-]{8,}$/.test(value)) {
      oauthStatus('That does not look like a GitHub OAuth client id.', 'error');
      return;
    }
    await oauthClientIdItem.setValue(value);
    oauthStatus(value === '' ? 'Using the built-in client id.' : 'Saved. Sign out and back in to use it.', 'success');
  });

  /* Backup & maintenance */
  const maintenanceStatus = statusReporter(requireElement('maintenance-status', HTMLParagraphElement));
  requireElement('export', HTMLButtonElement).addEventListener('click', () => {
    // Same document the gist holds, so an export can be dropped straight into a gist and vice versa.
    const blob = new Blob([serializeSettingsPayload(settings)], { type: 'application/json' });
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
    const result = validateSettingsDocument(await file.text());
    if (!result.ok) {
      const shown = result.issues.slice(0, 3).map((issue) => `${issue.path}: ${issue.message}`);
      const more = result.issues.length - shown.length;
      maintenanceStatus(`Could not import. ${shown.join(' ')}${more > 0 ? ` (+${more} more)` : ''}`, 'error');
      return;
    }
    await settingsItem.setValue(result.settings);
    maintenanceStatus('Settings imported', 'success');
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
    for (const { field, set } of generalSwitches) set(next[field.key]);
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
