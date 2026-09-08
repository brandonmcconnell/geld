import { browser } from 'wxt/browser';
import type { BuiltInCategory, CategoriesField, CategoryIconName, CustomCategoriesField, CustomCategory, GeldSettings, HiddenCategory, PatternGroup } from '@geld/core';
import {
  CATEGORIES,
  CATEGORY_ICON_NAMES,
  categoryIconLabel,
  categoryPatternLines,
  compileGlobs,
  compileRepoRules,
  createMatcher,
  customCategoryId,
  DEFAULT_SETTINGS,
  decideRepo,
  groupKey,
  hasAdvancedSettings,
  hiddenCategoryFromCustom,
  isCategoryEnabled,
  isGroupEnabled,
  listFields,
  normalizeHost,
  parsePatternList,
  sectionsFor,
  serializeSettingsPayload,
  splitInlineCode,
  toggleFields,
  validateSettingsDocument,
  withCustomCategory,
  withoutCustomCategory,
} from '@geld/core';
import type { ListField, SettingsSectionId, ToggleField } from '@geld/core';
import { grantedHosts, originPattern } from '../../src/lib/enterprise';
import { settingsItem } from '../../src/lib/storage';
import { BUILT_IN_CLIENT_ID, oauthClientIdItem } from '../../src/lib/account';
import { svgFromString } from '../../src/github/dom';
import { categoryIcon } from '../../src/github/ui/icons';
import { mountAccountWidget } from '../../src/ui/account-widget';
import { bindSwitch, requireElement } from '../../src/ui/switch';

/* ------------------------------------------------------------------ helpers */

type Tone = 'success' | 'error' | 'neutral';

interface StatusReporter {
  (message: string, tone: Tone): void;
  /** Redirect output to another element (for reporters created before their node). */
  attach(target: HTMLElement): void;
}

function statusReporter(initial: HTMLElement): StatusReporter {
  let element = initial;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const report = (message: string, tone: Tone): void => {
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
  const reporter: StatusReporter = Object.assign(report, {
    attach(target: HTMLElement): void {
      element = target;
    },
  });
  return reporter;
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

function requireCategoryFields(): { readonly categoriesField: CategoriesField; readonly customField: CustomCategoriesField } {
  const hideSection = sections.find((section) => section.id === 'hide');
  const categoriesField = hideSection?.fields.find((field): field is CategoriesField => field.kind === 'categories');
  const customSection = sections.find((section) => section.id === 'custom-categories');
  const customField = customSection?.fields.find((field): field is CustomCategoriesField => field.kind === 'custom-categories');
  if (categoriesField === undefined || customField === undefined) throw new Error('Settings schema is missing the category fields.');
  return { categoriesField, customField };
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

  /* Categories: built-ins with an "advanced" disclosure, then the user's own. */
  const { categoriesField, customField } = requireCategoryFields();
  applySchemaCopy('custom-categories');

  const categoriesHost = requireElement('categories', HTMLDivElement);
  const customHost = requireElement('custom-categories', HTMLDivElement);
  const customStatus = statusReporter(requireElement('custom-categories-status', HTMLSpanElement));

  function iconNode(icon: CategoryIconName): SVGElement {
    const node = svgFromString(categoryIcon(icon));
    node.classList.add('options__category-icon');
    return node;
  }

  function patternChips(patterns: readonly string[]): HTMLUListElement {
    return el(
      'ul',
      'options__patterns',
      patterns.map((pattern) => el('li', '', [el('code', '', [pattern])])),
    );
  }

  /** One built-in pattern group: checkbox, label, count, expandable pattern list. */
  function renderGroup(category: BuiltInCategory, group: PatternGroup): HTMLElement {
    const title = el('span', 'options__group-title', [group.label]);
    const description = el('span', 'options__group-description', [group.description]);
    const checkbox = el('input', 'geld-checkbox options__checkbox');
    checkbox.type = 'checkbox';
    checkbox.checked = isGroupEnabled(settings, category.id, group.id);
    checkbox.addEventListener('change', async () => {
      settings = await settingsItem.update((current) => ({ groups: { ...current.groups, [groupKey(category.id, group.id)]: checkbox.checked } }));
      runTester();
    });
    const heading = el('label', 'options__group-heading options__group-heading--checkbox', [checkbox, el('span', '', [title, description])]);
    const count = el('span', 'options__group-count', [`${group.patterns.length}`]);
    return el('details', 'options__group', [el('summary', '', [el('span', 'options__chevron', ['\u203a']), heading, count]), patternChips(group.patterns)]);
  }

  /** Textarea + save button for a pattern list; `onSave` receives the cleaned lines. */
  function patternEditor(
    copy: { readonly label: string; readonly description: string; readonly placeholder: string; readonly rows: number; readonly syntax: readonly string[]; readonly saveLabel: string },
    lines: readonly string[],
    onSave: (lines: readonly string[]) => Promise<string | null>,
  ): { readonly root: HTMLElement; readonly textarea: HTMLTextAreaElement } {
    const label = el('span', 'geld-label', [copy.label]);
    const help = el('p', 'geld-help', [copy.description]);
    const textarea = el('textarea', 'geld-textarea geld-code options__textarea');
    textarea.rows = copy.rows;
    textarea.placeholder = copy.placeholder;
    textarea.spellcheck = false;
    textarea.value = lines.join('\n');
    textarea.setAttribute('aria-label', copy.label);
    const syntax = el(
      'ul',
      'geld-help options__syntax',
      copy.syntax.map((line) => el('li', '', richText(line))),
    );
    const status = statusReporter(el('span', 'geld-status'));
    const save = el('button', 'geld-button geld-button--primary geld-button--small', [copy.saveLabel]);
    save.type = 'button';
    textarea.addEventListener('input', () => status(parsePatternList(textarea.value).join('\n') !== lines.join('\n') ? 'Unsaved changes' : '', 'neutral'));
    save.addEventListener('click', async () => {
      const cleaned = parsePatternList(textarea.value);
      const problem = validatePatterns(cleaned);
      if (problem !== null) {
        status(problem, 'error');
        return;
      }
      const failure = await onSave(cleaned);
      if (failure !== null) {
        status(failure, 'error');
        return;
      }
      textarea.value = cleaned.join('\n');
      status(`Saved ${cleaned.length} line${cleaned.length === 1 ? '' : 's'}`, 'success');
    });
    const statusNode = el('span', 'geld-status');
    status.attach(statusNode);
    return {
      root: el('div', 'options__editor', [label, help, textarea, syntax, el('div', 'geld-row options__actions', [statusNode, save])]),
      textarea,
    };
  }

  /** A built-in category: switch in the summary, groups and extra patterns behind "Advanced". */
  function renderBuiltIn(category: BuiltInCategory): HTMLElement {
    const label = el('span', 'geld-label', [category.title]);
    label.id = `category-${category.id}-label`;
    const help = el('p', 'geld-help', [category.description]);
    help.id = `category-${category.id}-help`;
    const button = switchButton(`category-${category.id}`, isCategoryEnabled(settings, category.id), label.id, help.id);
    bindSwitch(button, isCategoryEnabled(settings, category.id), async (value) => {
      settings = await settingsItem.update((current) => ({ categories: { ...current.categories, [category.id]: value } }));
      runTester();
    });
    button.addEventListener('click', (event) => event.stopPropagation());

    const groups = el('div', 'options__groups', [
      el('p', 'options__advanced-title', [el('span', 'geld-label', [categoriesField.advanced.groupsLabel]), el('span', 'geld-help', [categoriesField.advanced.groupsDescription])]),
      ...category.groups.map((group) => renderGroup(category, group)),
    ]);
    const editor = patternEditor(categoriesField.extraPatterns, categoryPatternLines(settings, category.id), async (lines) => {
      settings = await settingsItem.update((current) => {
        const categoryPatterns = { ...current.categoryPatterns };
        if (lines.length === 0) delete categoryPatterns[category.id];
        else categoryPatterns[category.id] = lines;
        return { categoryPatterns };
      });
      runTester();
      return null;
    });
    const body = el('div', 'options__advanced', [el('p', 'geld-help options__advanced-intro', [categoriesField.advanced.description]), groups, editor.root]);
    const card = el('details', 'options__category', [
      el('summary', 'options__category-summary', [
        el('span', 'options__chevron', ['\u203a']),
        iconNode(category.icon),
        el('div', 'options__category-text', [label, help]),
        el('span', 'options__advanced-badge', [categoriesField.advanced.label]),
        button,
      ]),
      body,
    ]);
    card.dataset.categoryId = category.id;
    // Open when anything beyond the switch is in use, so those settings are seen.
    card.open = hasAdvancedSettings(settings, category.id);
    return card;
  }

  /** Icon picker: a grid of radio-like buttons. */
  function iconPicker(current: CategoryIconName, onPick: (icon: CategoryIconName) => void): HTMLElement {
    const grid = el('div', 'options__icon-grid');
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', customField.iconLabel);
    let selected = current;
    const buttons = new Map<CategoryIconName, HTMLButtonElement>();
    for (const name of CATEGORY_ICON_NAMES) {
      const option = el('button', 'options__icon-option', [iconNode(name)]);
      option.type = 'button';
      option.title = categoryIconLabel(name);
      option.setAttribute('role', 'radio');
      option.setAttribute('aria-label', categoryIconLabel(name));
      option.setAttribute('aria-checked', String(name === selected));
      option.addEventListener('click', () => {
        buttons.get(selected)?.setAttribute('aria-checked', 'false');
        selected = name;
        option.setAttribute('aria-checked', 'true');
        onPick(name);
      });
      buttons.set(name, option);
      grid.append(option);
    }
    return grid;
  }

  /** A custom category: switch + editor (name, icon, count label, patterns, delete). */
  function renderCustom(existing: CustomCategory | null): HTMLElement {
    let title = existing?.title ?? '';
    let icon: CategoryIconName = existing?.icon ?? 'tag';
    let noun = existing?.noun ?? '';
    let nounPlural = existing?.nounPlural ?? '';
    const hidden: HiddenCategory | null = existing === null ? null : hiddenCategoryFromCustom(existing);

    const label = el('span', 'geld-label', [existing?.title ?? 'New category']);
    const help = el('p', 'geld-help', [existing === null ? 'Not saved yet.' : `${existing.patterns.length} pattern${existing.patterns.length === 1 ? '' : 's'}`]);
    const summaryIcon = iconNode(icon);
    const summaryChildren: Array<Node | string> = [el('span', 'options__chevron', ['\u203a']), summaryIcon, el('div', 'options__category-text', [label, help])];
    if (existing !== null) {
      label.id = `category-${existing.id}-label`;
      help.id = `category-${existing.id}-help`;
      const button = switchButton(`category-${existing.id}`, isCategoryEnabled(settings, existing.id), label.id, help.id);
      bindSwitch(button, isCategoryEnabled(settings, existing.id), async (value) => {
        settings = await settingsItem.update((current) => ({ categories: { ...current.categories, [existing.id]: value } }));
        runTester();
      });
      button.addEventListener('click', (event) => event.stopPropagation());
      summaryChildren.push(button);
    }

    const nameInput = el('input', 'geld-input options__input');
    nameInput.type = 'text';
    nameInput.value = title;
    nameInput.placeholder = customField.titlePlaceholder;
    nameInput.maxLength = 40;
    nameInput.setAttribute('aria-label', customField.titleLabel);
    nameInput.addEventListener('input', () => {
      title = nameInput.value;
      label.textContent = title.trim() === '' ? 'New category' : title.trim();
    });
    const nounInput = el('input', 'geld-input options__input options__input--short');
    nounInput.type = 'text';
    nounInput.value = noun;
    nounInput.placeholder = 'token';
    nounInput.setAttribute('aria-label', 'Count label, singular');
    nounInput.addEventListener('input', () => {
      noun = nounInput.value;
    });
    const nounPluralInput = el('input', 'geld-input options__input options__input--short');
    nounPluralInput.type = 'text';
    nounPluralInput.value = nounPlural;
    nounPluralInput.placeholder = 'tokens';
    nounPluralInput.setAttribute('aria-label', 'Count label, plural');
    nounPluralInput.addEventListener('input', () => {
      nounPlural = nounPluralInput.value;
    });
    const picker = iconPicker(icon, (next) => {
      icon = next;
      summaryIcon.replaceWith(iconNode(next));
    });

    const editor = patternEditor(customField.patterns, existing?.patterns ?? [], async (lines) => {
      const cleanTitle = title.trim();
      if (cleanTitle === '') return `Give the category a ${customField.titleLabel.toLowerCase()} first.`;
      const taken = new Set(settings.customCategories.map((custom) => custom.id));
      const id = existing?.id ?? customCategoryId(cleanTitle, taken);
      const custom: CustomCategory = {
        id,
        title: cleanTitle,
        icon,
        patterns: lines,
        ...(noun.trim() !== '' ? { noun: noun.trim() } : {}),
        ...(nounPlural.trim() !== '' ? { nounPlural: nounPlural.trim() } : {}),
      };
      settings = await settingsItem.update((current) => ({ customCategories: withCustomCategory(current, custom).customCategories }));
      customStatus(existing === null ? `Added “${cleanTitle}”` : 'Saved', 'success');
      renderAll();
      return null;
    });

    const remove = el('button', 'geld-button geld-button--small geld-button--danger', [existing === null ? 'Discard' : customField.deleteLabel]);
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (existing === null) {
        // Discard the unsaved draft.
        renderAll();
        return;
      }
      if (!confirm(customField.deleteConfirm)) return;
      settings = await settingsItem.update((current) => withoutCustomCategory(current, existing.id));
      customStatus(`Deleted “${existing.title}”`, 'success');
      renderAll();
    });

    const body = el('div', 'options__advanced options__custom-editor', [
      el('div', 'options__field', [el('span', 'geld-label', [customField.titleLabel]), nameInput]),
      el('div', 'options__field', [el('span', 'geld-label', [customField.iconLabel]), picker]),
      el('div', 'options__field', [
        el('span', 'geld-label', [customField.nounLabel]),
        el('p', 'geld-help', [customField.nounDescription]),
        el('div', 'options__noun-row', [nounInput, nounPluralInput]),
      ]),
      editor.root,
      el('div', 'geld-row options__actions options__actions--start', [remove]),
    ]);
    const card = el('details', 'options__category options__category--custom', [el('summary', 'options__category-summary', summaryChildren), body]);
    if (hidden !== null) card.dataset.categoryId = hidden.id;
    // A new draft opens ready to edit; saved categories reopen through renderAll's bookkeeping.
    card.open = existing === null;
    return card;
  }

  /** Rebuild both category lists from the current settings, keeping open disclosures open. */
  function renderAll(): void {
    const wasOpen = new Set(
      Array.from(document.querySelectorAll<HTMLDetailsElement>('details.options__category[open]')).map((card) => card.dataset.categoryId ?? ''),
    );
    categoriesHost.replaceChildren(...CATEGORIES.map(renderBuiltIn));
    // Re-rendering drops an unsaved draft; the Add button starts a fresh one.
    const customCards = settings.customCategories.map((custom) => renderCustom(custom));
    if (customCards.length === 0) customHost.replaceChildren(el('p', 'geld-help options__empty', [customField.emptyLabel]));
    else customHost.replaceChildren(...customCards);
    for (const card of document.querySelectorAll<HTMLDetailsElement>('details.options__category')) {
      const id = card.dataset.categoryId ?? '';
      if (wasOpen.has(id)) card.open = true;
    }
  }
  renderAll();
  requireElement('add-category', HTMLButtonElement).addEventListener('click', () => {
    if (customHost.querySelector('details.options__category--custom:not([data-category-id])') !== null) return;
    if (settings.customCategories.length === 0) customHost.replaceChildren();
    const card = renderCustom(null);
    customHost.append(card);
    card.querySelector('input')?.focus();
  });

  /** Signature of everything the two category lists render, to skip needless rebuilds. */
  const categorySignature = (value: GeldSettings): string =>
    JSON.stringify([value.categories, value.groups, value.categoryPatterns, value.customCategories]);

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

  /* Keep the page in sync with changes made elsewhere (popup, other windows, gist sync). */
  let lastSignature = categorySignature(settings);
  settingsItem.watch((next) => {
    settings = next;
    for (const { field, set } of generalSwitches) set(next[field.key]);
    const signature = categorySignature(next);
    // Rebuilding while someone types in a pattern box would eat their input.
    if (signature !== lastSignature && !(document.activeElement instanceof HTMLTextAreaElement && document.activeElement.closest('.options__categories') !== null)) {
      lastSignature = signature;
      renderAll();
    }
    if (document.activeElement !== rulesArea) rulesArea.value = next.repoRules.join('\n');
    if (document.activeElement !== hostsArea) hostsArea.value = next.enterpriseHosts.join('\n');
    runTester();
  });
}

void main();
