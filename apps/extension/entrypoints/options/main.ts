import { browser } from 'wxt/browser';
import type { BuiltInCategory, Catalog, CategoriesField, CategoryIconName, CustomCategoriesField, CustomCategory, GeldSettings, HiddenCategory, PatternGroup } from '@geld/core';
import {
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
  describeAdvancedSettings,
  hasAdvancedSettings,
  hiddenCategoryFromCustom,
  isCategoryEnabled,
  isCategoryInPicker,
  isGroupEnabled,
  choiceFields,
  listFields,
  normalizeAiBaseUrl,
  normalizeHost,
  parsePatternList,
  actionsFor,
  authorRuleProblem,
  pluralize,
  sectionsFor,
  serializeSettingsPayload,
  splitInlineCode,
  toggleFields,
  validateSettingsDocument,
  withCustomCategory,
  withoutCustomCategory,
} from '@geld/core';
import type { ActionsField, ListField, MaintenanceActionId, SettingsSectionId, TextField, ToggleField } from '@geld/core';
import { catalogFromCache, catalogItem, catalogStatusItem, describeCatalog, describeCatalogOutcome } from '../../src/lib/catalog';
import type { CachedCatalog, CatalogStatus } from '../../src/lib/catalog';
import { grantedHosts, originPattern } from '../../src/lib/enterprise';
import { hasGatewayPermission, requestGatewayPermission } from '../../src/lib/ai-gateway';
import type { AiModelsRequest } from '../../src/lib/messages';
import { isAiModelsResponse } from '../../src/lib/messages';
import type { CatalogCheckMessage } from '../../src/lib/messages';
import { settingsItem } from '../../src/lib/storage';
import { aiGatewayItem, aiKeyItem, jevKeyItem } from '../../src/lib/local-state';
import { isEvaluationModel, jevModelIn, TYPESAFE_API } from '@geld/review';
import { accountItem, appClientIdItem, BUILT_IN_CLIENT_ID, EMPTY_SYNC_STATE, syncStateItem } from '../../src/lib/account';
import type { GitHubAccount, SyncState } from '../../src/lib/account';
import { svgFromString } from '../../src/github/dom';
import { categoryIcon } from '../../src/github/ui/icons';
import { mountAccountWidget } from '../../src/ui/account-widget';
import { polyfillCornerShape } from '../../src/ui/corner-shape';
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
  return splitInlineCode(copy).map((run) => (run.kind === 'code' ? el('code', '', [run.text]) : run.kind === 'strong' ? el('strong', '', [run.text]) : document.createTextNode(run.text)));
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
  // The active pattern catalog: bundled, or the newer signed copy the background fetched.
  let cachedCatalog = await catalogItem.getValue();
  let catalog: Catalog = catalogFromCache(cachedCatalog);

  /* Standalone toggle sections (general preferences and the large-diff warning). */
  const shortcutHint = import.meta.env.FIREFOX
    ? 'Change it under Add-ons → Manage Extension Shortcuts.'
    : 'Change it at chrome://extensions/shortcuts (edge://extensions/shortcuts on Edge).';
  // Copy that only makes sense inside a browser is appended here, not kept in core.
  const surfaceNotes: Partial<Record<ToggleField['key'], string>> = { shortcutEnabled: shortcutHint };
  const toggleSwitches: Array<{ field: ToggleField; set: (checked: boolean) => void }> = [];

  function renderToggleSection(sectionId: SettingsSectionId, hostId: string): void {
    applySchemaCopy(sectionId);
    const section = sections.find((candidate) => candidate.id === sectionId);
    const host = requireElement(hostId, HTMLDivElement);
    const saved = statusReporter(el('span'));
    toggleFields(section?.fields ?? []).forEach((field, index) => {
      if (index > 0) host.append(el('hr', 'options__divider'));
      const label = el('span', 'geld-label', [field.label]);
      label.id = `${field.key}-label`;
      const note = surfaceNotes[field.key];
      const help = el('p', 'geld-help', richText(note === undefined ? field.description : `${field.description} ${note}`));
      help.id = `${field.key}-help`;
      const button = switchButton(field.key, settings[field.key], label.id, help.id);
      host.append(el('div', 'geld-row', [el('div', '', [label, help]), button]));
      const bound = bindSwitch(button, settings[field.key], async (value) => {
        settings = await settingsItem.patch({ [field.key]: value });
        saved('Saved', 'success');
      });
      toggleSwitches.push({ field, set: bound.set });
    });
  }

  renderToggleSection('general', 'general-rows');
  applySchemaCopy('hide');
  renderToggleSection('large-diffs', 'large-diffs-rows');

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
    // Change-kind groups are decided from the diff: nothing to expand, no count.
    if (group.patterns.length === 0) return el('div', 'options__group options__group--static', [heading]);
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
    const customised = describeAdvancedSettings(settings, category.id, catalog);
    const help = el('p', 'geld-help options__category-description', richText(category.description));
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
        ...(customised === null ? [] : [el('span', 'options__customised', [customised])]),
        button,
      ]),
      body,
    ]);
    card.dataset.categoryId = category.id;
    // Open when anything beyond the switch is in use, so those settings are seen.
    card.open = hasAdvancedSettings(settings, category.id, catalog);
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
    categoriesHost.replaceChildren(...catalog.categories.filter(isCategoryInPicker).map(renderBuiltIn));
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

  /* Pattern catalog: where the built-in patterns come from, and a way to look for newer ones. */
  const catalogSummary = requireElement('catalog-summary', HTMLSpanElement);
  const catalogNote = requireElement('catalog-note', HTMLParagraphElement);
  const catalogCheck = requireElement('catalog-check', HTMLButtonElement);
  let catalogStatus: CatalogStatus = await catalogStatusItem.getValue();

  function renderCatalogStatus(): void {
    catalogSummary.textContent = describeCatalog(cachedCatalog);
    catalogCheck.textContent = catalogStatus.checking ? 'Checking…' : 'Check now';
    catalogCheck.disabled = catalogStatus.checking;
    const note = describeCatalogOutcome(catalogStatus);
    catalogNote.hidden = note === null;
    catalogNote.textContent = note?.text ?? '';
    if (note?.tone === 'error') catalogNote.dataset.tone = 'error';
    else delete catalogNote.dataset.tone;
  }
  renderCatalogStatus();
  catalogCheck.addEventListener('click', () => {
    // The background does the fetching so the result outlives this page; the outcome arrives via the status watch.
    const message: CatalogCheckMessage = { type: 'geld:catalog-check' };
    void browser.runtime.sendMessage(message).catch(() => undefined);
  });
  catalogStatusItem.watch((next) => {
    catalogStatus = next;
    renderCatalogStatus();
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

  /* Repository configs (and any other choice field of the section). */
  const choiceHost = requireElement('repository-choices', HTMLDivElement);
  const choiceSetters: Array<(value: GeldSettings) => void> = [];
  for (const field of choiceFields(sections.find((section) => section.id === 'repositories')?.fields ?? [])) {
    const label = el('span', 'geld-label', [field.label]);
    label.id = `${field.key}-label`;
    const help = el('p', 'geld-help', richText(field.description));
    help.id = `${field.key}-help`;
    const note = el('p', 'options__choice-note');
    const group = el('div', 'options__segments');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', label.id);
    group.setAttribute('aria-describedby', help.id);
    const buttons = new Map<string, HTMLButtonElement>();
    const show = (value: GeldSettings): void => {
      const current = value[field.key];
      for (const [option, button] of buttons) {
        button.setAttribute('aria-checked', String(option === current));
        button.setAttribute('aria-pressed', String(option === current));
      }
      note.textContent = field.options.find((option) => option.value === current)?.description ?? '';
    };
    for (const option of field.options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'geld-button geld-button--small';
      button.setAttribute('role', 'radio');
      button.textContent = option.label;
      button.title = option.description;
      button.addEventListener('click', async () => {
        settings = await settingsItem.patch({ [field.key]: option.value });
        show(settings);
      });
      buttons.set(option.value, button);
      group.append(button);
    }
    show(settings);
    choiceSetters.push(show);
    choiceHost.append(el('div', 'options__choice', [el('div', 'geld-row', [el('div', '', [label, help]), group]), note]));
  }

  /* Pull request lists: authors to hide */
  applySchemaCopy('lists');
  const authorsStatus = statusReporter(requireElement('authors-status', HTMLSpanElement));
  const authorsArea = requireElement('hidden-authors', HTMLTextAreaElement);
  authorsArea.value = settings.hiddenAuthors.join('\n');
  authorsArea.addEventListener('input', () => {
    authorsStatus(authorsArea.value.trim() !== settings.hiddenAuthors.join('\n') ? 'Unsaved changes' : '', 'neutral');
  });
  requireElement('save-authors', HTMLButtonElement).addEventListener('click', async () => {
    const hiddenAuthors = parsePatternList(authorsArea.value);
    const problem = hiddenAuthors.map(authorRuleProblem).find((entry): entry is string => entry !== null) ?? null;
    if (problem !== null) {
      authorsStatus(problem, 'error');
      return;
    }
    settings = await settingsItem.patch({ hiddenAuthors });
    authorsArea.value = hiddenAuthors.join('\n');
    authorsStatus(`Saved ${pluralize(hiddenAuthors.length, 'author', 'authors')}`, 'success');
  });

  /* Experiments — the pull request conversation digest: panel, timeline, extra bots, and the AI that can write for it. */
  applySchemaCopy('experiments');
  const reviewSection = sections.find((candidate) => candidate.id === 'experiments');
  const reviewStack = requireElement('review-stack', HTMLDivElement);
  const reviewSwitches: Array<{ field: ToggleField; set: (checked: boolean) => void }> = [];
  /** One block per field, in the schema's order, so every separator and every gap is the same one. */
  const block = (children: ReadonlyArray<Node>, modifier = ''): HTMLDivElement => {
    const node = el('div', `options__block${modifier === '' ? '' : ` options__block--${modifier}`}`, children);
    reviewStack.append(node);
    return node;
  };
  const fieldHead = (field: { readonly key: string; readonly label: string; readonly description: string }): { readonly head: HTMLDivElement; readonly label: HTMLSpanElement; readonly help: HTMLParagraphElement } => {
    const label = el('span', 'geld-label', [field.label]);
    label.id = `${field.key}-label`;
    const help = el('p', 'geld-help', richText(field.description));
    help.id = `${field.key}-help`;
    return { head: el('div', 'options__field-head', [label, help]), label, help };
  };
  const toggleBlock = (field: ToggleField, extra: ReadonlyArray<Node> = []): HTMLDivElement => {
    const { head, label, help } = fieldHead(field);
    const button = switchButton(field.key, settings[field.key], label.id, help.id);
    const bound = bindSwitch(button, settings[field.key], async (value) => {
      settings = await settingsItem.patch({ [field.key]: value });
      generalStatus('Saved', 'success');
    });
    reviewSwitches.push({ field, set: bound.set });
    return block([el('div', 'geld-row options__field-row', [head, button]), ...extra]);
  };
  let reviewBotsArea: HTMLTextAreaElement | null = null;
  const aiFieldKeys = new Set<string>(['aiEnabled', 'aiBaseUrl', 'aiModel', 'aiJev']);
  let aiRendered = false;
  for (const field of reviewSection?.fields ?? []) {
    if ('key' in field && aiFieldKeys.has(field.key)) {
      if (!aiRendered) {
        aiRendered = true;
        await renderAiFields();
      }
      continue;
    }
    if (field.kind === 'toggle') {
      toggleBlock(field);
    } else if (field.kind === 'choice') {
      const { head, label } = fieldHead(field);
      const note = el('p', 'options__choice-note');
      const group = el('div', 'options__segments');
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-labelledby', label.id);
      const buttons = new Map<string, HTMLButtonElement>();
      const show = (value: GeldSettings): void => {
        const current = value[field.key];
        for (const [option, button] of buttons) {
          button.setAttribute('aria-checked', String(option === current));
          button.setAttribute('aria-pressed', String(option === current));
        }
        note.textContent = field.options.find((option) => option.value === current)?.description ?? '';
      };
      for (const option of field.options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'geld-button geld-button--small';
        button.setAttribute('role', 'radio');
        button.textContent = option.label;
        button.title = option.description;
        button.addEventListener('click', async () => {
          settings = await settingsItem.patch({ [field.key]: option.value });
          show(settings);
        });
        buttons.set(option.value, button);
        group.append(button);
      }
      show(settings);
      choiceSetters.push(show);
      block([el('div', 'geld-row options__field-row', [head, group]), note]);
    } else if (field.kind === 'list' && field.key === 'reviewBots') {
      const { head } = fieldHead(field);
      const area = el('textarea', 'geld-textarea geld-code options__textarea');
      area.id = 'review-bots';
      area.rows = field.rows;
      area.spellcheck = false;
      area.placeholder = field.placeholder;
      area.setAttribute('aria-label', field.label);
      area.value = settings.reviewBots.join('\n');
      const statusEl = el('span', 'geld-status');
      statusEl.setAttribute('aria-live', 'polite');
      const status = statusReporter(statusEl);
      const save = el('button', 'geld-button geld-button--primary', [field.saveLabel]);
      save.type = 'button';
      area.addEventListener('input', () => {
        status(area.value.trim() !== settings.reviewBots.join('\n') ? 'Unsaved changes' : '', 'neutral');
      });
      save.addEventListener('click', async () => {
        const reviewBots = parsePatternList(area.value);
        const problem = reviewBots.map(authorRuleProblem).find((entry): entry is string => entry !== null) ?? null;
        if (problem !== null) {
          status(problem, 'error');
          return;
        }
        settings = await settingsItem.patch({ reviewBots });
        area.value = reviewBots.join('\n');
        status(`Saved ${pluralize(reviewBots.length, 'bot', 'bots')}`, 'success');
      });
      reviewBotsArea = area;
      block([head, area, el('div', 'geld-row options__actions', [statusEl, save])]);
    }
  }

  /**
   * The AI fields, in the order they are needed: the switch, the gateway (URL
   * with one-click presets, then its key), the writing model (listed from the
   * gateway as soon as URL and key are there, never an evaluation model), and
   * Jev with its own key only when the gateway does not offer it.
   */
  async function renderAiFields(): Promise<void> {
    const fields = reviewSection?.fields ?? [];
    const enabledField = fields.find((field): field is ToggleField => field.kind === 'toggle' && field.key === 'aiEnabled');
    const urlField = fields.find((field): field is TextField => field.kind === 'text' && field.key === 'aiBaseUrl');
    const modelField = fields.find((field): field is TextField => field.kind === 'text' && field.key === 'aiModel');
    const jevField = fields.find((field): field is ToggleField => field.kind === 'toggle' && field.key === 'aiJev');
    if (enabledField === undefined || urlField === undefined || modelField === undefined || jevField === undefined) return;

    toggleBlock(enabledField);

    /* Gateway URL: saved on Save or on choosing a preset; the model list follows after a pause. */
    const urlHead = fieldHead(urlField);
    const urlInput = el('input', 'geld-input geld-code options__input options__input--grow');
    urlInput.id = 'aiBaseUrl';
    urlInput.type = 'url';
    urlInput.spellcheck = false;
    urlInput.placeholder = urlField.placeholder;
    urlInput.value = settings.aiBaseUrl;
    urlInput.setAttribute('autocomplete', urlField.autocomplete ?? 'off');
    const urlStatusEl = el('span', 'geld-status');
    const urlStatus = statusReporter(urlStatusEl);
    const urlSave = el('button', 'geld-button geld-button--primary geld-button--small', ['Save']);
    urlSave.type = 'button';
    const presets = el('div', 'options__presets');
    presets.setAttribute('aria-label', 'Gateway presets');
    const saveUrl = async (raw: string): Promise<boolean> => {
      const value = normalizeAiBaseUrl(raw);
      if (value !== '') {
        const denied = await requestGatewayPermission(value);
        if (denied !== null) {
          urlStatus(denied, 'error');
          return false;
        }
      }
      settings = await settingsItem.patch({ aiBaseUrl: value });
      urlInput.value = settings.aiBaseUrl;
      urlStatus(value === '' ? 'Cleared' : 'Saved', 'success');
      markPreset();
      void refreshModels();
      return true;
    };
    const markPreset = (): void => {
      for (const button of presets.querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(button.dataset.value === settings.aiBaseUrl));
    };
    for (const preset of urlField.presets ?? []) {
      const button = el('button', 'options__preset', [preset.label]);
      button.type = 'button';
      button.dataset.value = preset.value;
      button.title = preset.value;
      button.addEventListener('click', () => void saveUrl(preset.value));
      presets.append(button);
    }
    markPreset();
    urlSave.addEventListener('click', () => void saveUrl(urlInput.value));
    let urlTimer: ReturnType<typeof setTimeout> | null = null;
    urlInput.addEventListener('input', () => {
      // A pasted URL is saved by itself once it is a URL and typing has paused; no need to reach for Save.
      if (urlTimer !== null) clearTimeout(urlTimer);
      const value = normalizeAiBaseUrl(urlInput.value);
      if (value === settings.aiBaseUrl || (value !== '' && !/^https:\/\/[^\s/]+/i.test(value))) return;
      urlTimer = setTimeout(() => void saveUrl(urlInput.value), 900);
    });
    block([urlHead.head, urlInput, presets, el('div', 'geld-row options__actions', [urlStatusEl, urlSave])]);

    /* Gateway key: local only; saving it loads the models. */
    const keyLabel = el('label', 'geld-label', ['AI gateway key']);
    keyLabel.htmlFor = 'ai-key';
    const keyHelp = el('p', 'geld-help', ['Stored only on this device; never sent to geld.sh or written to the gist. Used for the gateway above, and only when AI features are on.']);
    const keyInput = el('input', 'geld-input geld-code options__input options__input--grow');
    keyInput.id = 'ai-key';
    keyInput.type = 'password';
    keyInput.spellcheck = false;
    keyInput.placeholder = 'sk-…';
    keyInput.setAttribute('autocomplete', 'off');
    keyInput.setAttribute('aria-label', 'AI gateway key');
    keyInput.value = await aiKeyItem.getValue();
    const keyStatusEl = el('span', 'geld-status');
    keyStatusEl.setAttribute('aria-live', 'polite');
    const keyStatus = statusReporter(keyStatusEl);
    const keySave = el('button', 'geld-button geld-button--primary geld-button--small', ['Save key']);
    keySave.type = 'button';
    keySave.addEventListener('click', async () => {
      await aiKeyItem.setValue(keyInput.value.trim());
      keyStatus(keyInput.value.trim() === '' ? 'Cleared. No AI calls will be made.' : 'Saved on this device.', 'success');
      void refreshModels();
    });
    block([el('div', 'options__field-head', [keyLabel, keyHelp]), keyInput, el('div', 'geld-row options__actions', [keyStatusEl, keySave])]);

    /* Writing model: a list from the gateway, disabled with a reason until URL and key are both there. */
    const modelHead = fieldHead(modelField);
    const modelSelect = el('select', 'geld-input geld-code options__input options__input--grow');
    modelSelect.id = 'aiModel';
    modelSelect.setAttribute('aria-labelledby', modelHead.label.id);
    const modelStatusEl = el('span', 'geld-status');
    modelStatusEl.setAttribute('aria-live', 'polite');
    const modelStatus = statusReporter(modelStatusEl);
    const modelSave = el('button', 'geld-button geld-button--primary geld-button--small', ['Save']);
    modelSave.type = 'button';
    const modelGate = el('p', 'options__gate', ['Save a gateway URL and key first; the models it offers are listed here.']);
    modelGate.setAttribute('role', 'status');
    const modelControls = el('div', 'options__gated', [modelSelect, el('div', 'geld-row options__actions', [modelStatusEl, modelSave])]);
    const setModelsEnabled = (enabled: boolean, reason: string): void => {
      modelSelect.disabled = !enabled;
      modelSave.disabled = !enabled;
      modelControls.toggleAttribute('data-disabled', !enabled);
      modelGate.textContent = reason;
      modelGate.hidden = enabled;
    };
    const fillModels = (ids: readonly string[]): void => {
      modelSelect.replaceChildren();
      const writers = ids.filter((id) => !isEvaluationModel(id));
      const placeholder = el('option', '', [writers.length === 0 ? 'No models listed' : 'Choose a model…']);
      placeholder.value = '';
      modelSelect.append(placeholder);
      if (settings.aiModel !== '' && !writers.includes(settings.aiModel) && !isEvaluationModel(settings.aiModel)) writers.unshift(settings.aiModel);
      for (const id of writers) modelSelect.append(el('option', '', [id]));
      modelSelect.value = writers.includes(settings.aiModel) ? settings.aiModel : '';
    };
    modelSave.addEventListener('click', async () => {
      const value = modelSelect.value;
      if (value === '') {
        modelStatus('Choose a model.', 'error');
        return;
      }
      settings = await settingsItem.patch({ aiModel: value });
      modelStatus('Saved', 'success');
    });
    block([modelHead.head, modelGate, modelControls]);

    /* Jev: through the gateway when it offers it, else with a TypeSafe key of the user's own. */
    const jevNote = el('p', 'options__jev-note');
    jevNote.setAttribute('role', 'status');
    const jevKeyLabel = el('label', 'geld-label', ['TypeSafe API key']);
    jevKeyLabel.htmlFor = 'jev-key';
    const jevKeyInput = el('input', 'geld-input geld-code options__input options__input--grow');
    jevKeyInput.id = 'jev-key';
    jevKeyInput.type = 'password';
    jevKeyInput.spellcheck = false;
    jevKeyInput.placeholder = 'ts-…';
    jevKeyInput.setAttribute('autocomplete', 'off');
    jevKeyInput.value = await jevKeyItem.getValue();
    const jevStatusEl = el('span', 'geld-status');
    jevStatusEl.setAttribute('aria-live', 'polite');
    const jevStatus = statusReporter(jevStatusEl);
    const jevSave = el('button', 'geld-button geld-button--primary geld-button--small', ['Save key']);
    jevSave.type = 'button';
    jevSave.addEventListener('click', async () => {
      const value = jevKeyInput.value.trim();
      if (value !== '') {
        const denied = await requestGatewayPermission(TYPESAFE_API);
        if (denied !== null) {
          jevStatus('Allow Geld to contact api.typesafe.ai to use your own key.', 'error');
          return;
        }
      }
      await jevKeyItem.setValue(value);
      jevStatus(value === '' ? 'Cleared' : 'Saved on this device.', 'success');
    });
    const jevKeyBlock = el('div', 'options__gated options__jev-key', [el('div', 'options__field-head', [jevKeyLabel]), jevKeyInput, el('div', 'geld-row options__actions', [jevStatusEl, jevSave])]);
    let ownKeyAnyway = jevKeyInput.value !== '';
    const useOwnKey = el('button', 'options__link', ['Use one anyway']);
    useOwnKey.type = 'button';
    useOwnKey.addEventListener('click', () => {
      ownKeyAnyway = true;
      renderJevState();
    });
    /** What the gateway offers is only known once its models loaded; until then the note only explains. */
    let gatewayJev: string | null | undefined;
    const renderJevState = (): void => {
      const on = settings.aiJev;
      jevNote.replaceChildren();
      delete jevNote.dataset.tone;
      // The key field: open when the gateway lacks Jev and Jev is on (it is the only route), or on request;
      // shown but closed as a hint when the gateway lacks Jev and Jev is off; hidden otherwise.
      let show = ownKeyAnyway;
      let open = ownKeyAnyway;
      if (gatewayJev === undefined) {
        jevNote.append('Whether your gateway offers Jev is checked when its models load.');
      } else if (gatewayJev !== null) {
        jevNote.append(`Jev is offered by your AI gateway (${gatewayJev}); no TypeSafe key is needed. `, useOwnKey);
      } else {
        jevNote.append(on ? 'Your AI gateway does not offer Jev. Add a TypeSafe API key to use it directly.' : 'Your AI gateway does not offer Jev; with Jev on, a TypeSafe API key is needed.');
        if (on) jevNote.dataset.tone = 'error';
        show = true;
        open = open || on;
      }
      jevKeyBlock.hidden = !show;
      jevKeyBlock.toggleAttribute('data-disabled', !open);
      jevKeyInput.disabled = !open;
      jevSave.disabled = !open;
    };
    toggleBlock(jevField, [jevNote, jevKeyBlock]);
    reviewSwitches.push({ field: jevField, set: () => renderJevState() });

    /** Fetch the gateway's models when URL and key are both there; gate the model field otherwise. */
    let modelsRun = 0;
    const refreshModels = async (): Promise<void> => {
      const run = (modelsRun += 1);
      const baseUrl = settings.aiBaseUrl;
      const apiKey = (await aiKeyItem.getValue()).trim();
      if (baseUrl === '' || apiKey === '') {
        setModelsEnabled(false, baseUrl === '' ? 'Save a gateway URL and key first; the models it offers are listed here.' : 'Save the gateway key; the models it offers are listed here.');
        gatewayJev = undefined;
        renderJevState();
        return;
      }
      // Contacting the gateway needs the browser's permission for its origin, which only a click here can ask for.
      if ((await hasGatewayPermission(baseUrl)) !== null) {
        // A cached list stays usable; the note only says the next refresh needs a click.
        if (modelSelect.options.length <= 1) setModelsEnabled(false, '');
        const allow = el('button', 'options__link', ['Allow Geld to contact the gateway']);
        allow.type = 'button';
        allow.addEventListener('click', async () => {
          const denied = await requestGatewayPermission(baseUrl);
          if (denied !== null) {
            setModelsEnabled(false, denied);
            return;
          }
          void refreshModels();
        });
        modelGate.replaceChildren(`Chrome has not yet allowed Geld to reach ${new URL(baseUrl).host}. `, allow);
        modelGate.hidden = false;
        renderJevState();
        return;
      }
      setModelsEnabled(false, 'Loading models from the gateway…');
      const message: AiModelsRequest = { type: 'geld:ai-models', baseUrl, apiKey };
      const response: unknown = await browser.runtime.sendMessage(message);
      if (run !== modelsRun) return;
      if (!isAiModelsResponse(response) || !response.ok) {
        setModelsEnabled(false, !isAiModelsResponse(response) || response.ok ? 'The gateway did not list its models.' : `The gateway did not list its models: ${response.reason}`);
        gatewayJev = undefined;
        renderJevState();
        return;
      }
      const ids = response.models.map((model) => model.id);
      gatewayJev = jevModelIn(response.models);
      await aiGatewayItem.setValue({ baseUrl, models: ids, jevModel: gatewayJev, checkedAt: new Date().toISOString() });
      fillModels(ids);
      setModelsEnabled(true, '');
      modelStatus(`${ids.filter((id) => !isEvaluationModel(id)).length} models`, 'success');
      renderJevState();
    };
    const cached = await aiGatewayItem.getValue();
    if (cached !== null && cached.baseUrl === settings.aiBaseUrl && settings.aiBaseUrl !== '') {
      gatewayJev = cached.jevModel;
      fillModels(cached.models);
      setModelsEnabled(true, '');
    } else {
      fillModels([]);
      setModelsEnabled(false, 'Save a gateway URL and key first; the models it offers are listed here.');
    }
    renderJevState();
    void refreshModels();
  }

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
    const verdict = createMatcher(settings, repo, catalog).explain(path);
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
  // The card's copy describes the current state, not a hypothetical sign-in.
  const signedOutCopy = requireElement('account-signed-out', HTMLParagraphElement);
  const signedInCopy = requireElement('account-signed-in', HTMLParagraphElement);
  const accountLogin = requireElement('account-login', HTMLElement);
  const accountSynced = requireElement('account-synced', HTMLSpanElement);
  const accountGist = requireElement('account-gist', HTMLAnchorElement);
  let account: GitHubAccount | null = null;
  let sync: SyncState = EMPTY_SYNC_STATE;
  const renderAccountCard = (): void => {
    signedOutCopy.hidden = account !== null;
    signedInCopy.hidden = account === null;
    if (account === null) return;
    accountLogin.textContent = account.login;
    accountSynced.textContent =
      sync.remoteInvalid !== null
        ? ' (sync is paused until the gist is fixed)'
        : sync.lastSyncedAt !== null
          ? ` (last synced ${new Date(sync.lastSyncedAt).toLocaleString()})`
          : '';
    accountGist.href = sync.gistId !== null ? `https://gist.github.com/${sync.gistId}` : 'https://gist.github.com';
  };
  accountItem.watch((value) => {
    account = value;
    renderAccountCard();
  });
  syncStateItem.watch((value) => {
    sync = { ...EMPTY_SYNC_STATE, ...value };
    renderAccountCard();
  });
  [account, sync] = await Promise.all([accountItem.getValue(), syncStateItem.getValue().then((value) => ({ ...EMPTY_SYNC_STATE, ...value }))]);
  renderAccountCard();

  const clientIdStatus = statusReporter(requireElement('app-client-status', HTMLSpanElement));
  const clientIdInput = requireElement('app-client-id', HTMLInputElement);
  clientIdInput.value = await appClientIdItem.getValue();
  clientIdInput.placeholder = BUILT_IN_CLIENT_ID !== '' ? `${BUILT_IN_CLIENT_ID} (built in)` : 'Iv23li…';
  requireElement('save-app-client', HTMLButtonElement).addEventListener('click', async () => {
    const value = clientIdInput.value.trim();
    if (value !== '' && !/^[A-Za-z0-9._-]{8,}$/.test(value)) {
      clientIdStatus('That does not look like a GitHub App client id.', 'error');
      return;
    }
    await appClientIdItem.setValue(value);
    clientIdStatus(value === '' ? 'Using the built-in client id.' : 'Saved. Sign out and back in to use it.', 'success');
  });

  /* Backup & maintenance: buttons come from the schema; behaviour is per action id. */
  applySchemaCopy('maintenance');
  const maintenanceStatus = statusReporter(requireElement('maintenance-status', HTMLSpanElement));
  const importInput = requireElement('import-file', HTMLInputElement);
  const maintenanceHost = requireElement('maintenance-buttons', HTMLDivElement);
  const actionsField = sections.find((section) => section.id === 'maintenance')?.fields.find((field): field is ActionsField => field.kind === 'actions');
  const runMaintenance: Record<MaintenanceActionId, () => Promise<void> | void> = {
    export: () => {
      // Same document the gist holds, so an export can be dropped straight into a gist and vice versa.
      const blob = new Blob([serializeSettingsPayload(settings)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'geld-settings.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      maintenanceStatus('Exported geld-settings.json', 'success');
    },
    import: () => importInput.click(),
    'clear-cache': async () => {
      await browser.storage.local.remove(['diffCache', 'repoConfigCache']);
      maintenanceStatus('Cached diffs and repository configs cleared', 'success');
    },
    reset: async () => {
      await settingsItem.setValue(DEFAULT_SETTINGS);
      maintenanceStatus('Restored default settings', 'success');
    },
  };
  for (const action of actionsField === undefined ? [] : actionsFor(actionsField, 'extension')) {
    const button = el('button', `geld-button${action.danger === true ? ' geld-button--danger' : ''}`, [action.label]);
    button.type = 'button';
    button.id = `maintenance-${action.id}`;
    button.title = action.description;
    button.addEventListener('click', () => {
      if (action.confirm !== undefined && !window.confirm(action.confirm)) return;
      void runMaintenance[action.id]();
    });
    maintenanceHost.insertBefore(button, importInput);
  }
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (file === undefined) return;
    const result = validateSettingsDocument(await file.text(), catalog);
    if (!result.ok) {
      const shown = result.issues.slice(0, 3).map((issue) => `${issue.path}: ${issue.message}`);
      const more = result.issues.length - shown.length;
      maintenanceStatus(`Could not import. ${shown.join(' ')}${more > 0 ? ` (+${more} more)` : ''}`, 'error');
      return;
    }
    await settingsItem.setValue(result.settings);
    maintenanceStatus('Settings imported', 'success');
  });

  /* A newer catalog was fetched (or the cache dropped): the category cards show its groups and copy. */
  function applyCatalog(next: CachedCatalog | null): void {
    if (JSON.stringify(next) === JSON.stringify(cachedCatalog)) return;
    cachedCatalog = next;
    catalog = catalogFromCache(next);
    renderCatalogStatus();
    if (!(document.activeElement instanceof HTMLTextAreaElement && document.activeElement.closest('.options__categories') !== null)) renderAll();
    runTester();
  }
  catalogItem.watch(applyCatalog);
  // The background may have stored a catalog between the read at the top and
  // this watch (typically right after install); read once more so it is not missed.
  applyCatalog(await catalogItem.getValue());

  /* Keep the page in sync with changes made elsewhere (popup, other windows, gist sync). */
  let lastSignature = categorySignature(settings);
  settingsItem.watch((next) => {
    settings = next;
    for (const { field, set } of toggleSwitches) set(next[field.key]);
    for (const { field, set } of reviewSwitches) set(next[field.key]);
    for (const show of choiceSetters) show(next);
    const signature = categorySignature(next);
    // Rebuilding while someone types in a pattern box would eat their input.
    if (signature !== lastSignature && !(document.activeElement instanceof HTMLTextAreaElement && document.activeElement.closest('.options__categories') !== null)) {
      lastSignature = signature;
      renderAll();
    }
    if (document.activeElement !== rulesArea) rulesArea.value = next.repoRules.join('\n');
    if (document.activeElement !== authorsArea) authorsArea.value = next.hiddenAuthors.join('\n');
    if (reviewBotsArea !== null && document.activeElement !== reviewBotsArea) reviewBotsArea.value = next.reviewBots.join('\n');
    if (document.activeElement !== hostsArea) hostsArea.value = next.enterpriseHosts.join('\n');
    runTester();
  });
}

polyfillCornerShape();
void main();
