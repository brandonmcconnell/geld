import { compileGlobs } from '../../src/lib/glob';
import { DEFAULT_SETTINGS, parsePatternList } from '../../src/lib/settings';
import { settingsItem } from '../../src/lib/storage';
import { TEST_PATTERN_GROUPS } from '../../src/lib/test-patterns';
import { bindSwitch, requireElement } from '../../src/ui/switch';

function renderGroups(container: HTMLElement): void {
  for (const group of TEST_PATTERN_GROUPS) {
    const details = document.createElement('details');
    details.className = 'options__group';

    const summary = document.createElement('summary');
    const title = document.createElement('span');
    title.textContent = group.label;
    const description = document.createElement('span');
    description.className = 'options__group-description';
    description.textContent = group.description;
    title.append(description);
    const count = document.createElement('span');
    count.className = 'options__group-count';
    count.textContent = `${group.patterns.length} patterns`;
    summary.append(title, count);

    const list = document.createElement('ul');
    list.className = 'options__patterns';
    for (const pattern of group.patterns) {
      const item = document.createElement('li');
      const code = document.createElement('code');
      code.textContent = pattern;
      item.append(code);
      list.append(item);
    }

    details.append(summary, list);
    container.append(details);
  }
}

/** Compile each pattern on its own so we can point at the broken line. */
function validatePatterns(patterns: readonly string[]): string | null {
  for (const pattern of patterns) {
    try {
      compileGlobs([pattern]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return `Invalid pattern "${pattern}": ${reason}`;
    }
  }
  return null;
}

async function main(): Promise<void> {
  let settings = await settingsItem.getValue();

  const status = requireElement('status', HTMLSpanElement);
  const textarea = requireElement('custom-patterns', HTMLTextAreaElement);
  const save = requireElement('save', HTMLButtonElement);
  const reset = requireElement('reset', HTMLButtonElement);

  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  const report = (message: string, tone: 'success' | 'error' | 'neutral'): void => {
    status.textContent = message;
    if (tone === 'neutral') delete status.dataset.tone;
    else status.dataset.tone = tone;
    if (statusTimer !== null) clearTimeout(statusTimer);
    if (tone !== 'error') {
      statusTimer = setTimeout(() => {
        status.textContent = '';
        delete status.dataset.tone;
      }, 2000);
    }
  };

  const enabledSwitch = bindSwitch(requireElement('enabled', HTMLButtonElement), settings.enabled, async (enabled) => {
    settings = await settingsItem.patch({ enabled });
    report('Saved', 'success');
  });
  const hideTestsSwitch = bindSwitch(
    requireElement('hide-tests', HTMLButtonElement),
    settings.hideTests,
    async (hideTests) => {
      settings = await settingsItem.patch({ hideTests });
      report('Saved', 'success');
    },
  );
  const expandedSwitch = bindSwitch(
    requireElement('expanded', HTMLButtonElement),
    settings.expandedByDefault,
    async (expandedByDefault) => {
      settings = await settingsItem.patch({ expandedByDefault });
      report('Saved', 'success');
    },
  );

  const listStatsSwitch = bindSwitch(
    requireElement('list-stats', HTMLButtonElement),
    settings.showListStats,
    async (showListStats) => {
      settings = await settingsItem.patch({ showListStats });
      report('Saved', 'success');
    },
  );

  textarea.value = settings.customPatterns.join('\n');
  textarea.addEventListener('input', () => {
    const dirty = textarea.value.trim() !== settings.customPatterns.join('\n');
    report(dirty ? 'Unsaved changes' : '', 'neutral');
  });

  save.addEventListener('click', async () => {
    const customPatterns = parsePatternList(textarea.value);
    const problem = validatePatterns(customPatterns);
    if (problem !== null) {
      report(problem, 'error');
      return;
    }
    settings = await settingsItem.patch({ customPatterns });
    textarea.value = customPatterns.join('\n');
    report(`Saved ${customPatterns.length} custom pattern${customPatterns.length === 1 ? '' : 's'}`, 'success');
  });

  reset.addEventListener('click', async () => {
    await settingsItem.setValue(DEFAULT_SETTINGS);
    report('Restored default settings', 'success');
  });

  settingsItem.watch((next) => {
    settings = next;
    enabledSwitch.set(next.enabled);
    hideTestsSwitch.set(next.hideTests);
    expandedSwitch.set(next.expandedByDefault);
    listStatsSwitch.set(next.showListStats);
    if (document.activeElement !== textarea) textarea.value = next.customPatterns.join('\n');
  });

  renderGroups(requireElement('groups', HTMLDivElement));
}

void main();
