'use client';

import { useEffect, useSyncExternalStore } from 'react';

import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { createTabMemory, isNightlyTab, nightlyTabFor } from '@/lib/nightly-tabs';
import type { NightlyTab } from '@/lib/nightly-tabs';

export interface BrowserTab {
  readonly id: NightlyTab;
  readonly label: string;
  readonly content: React.ReactNode;
}

/** Fired after a tab click rewrites the address, which `replaceState` does without a `hashchange`. */
const TAB_CHANGED = 'geld:nightly-tab';

function tabInHash(): NightlyTab | null {
  const hash = window.location.hash.slice(1);
  return isNightlyTab(hash) ? hash : null;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  window.addEventListener(TAB_CHANGED, onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener(TAB_CHANGED, onChange);
  };
}

const tabFor = createTabMemory();
const clientTab = (): NightlyTab => tabFor(window.location.hash, () => nightlyTabFor(navigator.userAgent, 'brave' in navigator));
const serverTab = (): NightlyTab => 'chrome';

/**
 * One tab per browser, opening on the reader's own. The tab lives in the address (`/nightly#brave`), so a link
 * can open someone straight on their browser, and a link to `#brave` elsewhere on the page switches to it.
 */
export function NightlyBrowserTabs({ tabs, sectionId }: { readonly tabs: readonly BrowserTab[]; readonly sectionId: string }) {
  const value = useSyncExternalStore(subscribe, clientTab, serverTab);

  useEffect(() => {
    const reveal = (behavior: ScrollBehavior): void => {
      if (tabInHash() !== null) document.getElementById(sectionId)?.scrollIntoView({ behavior });
    };
    reveal('auto');
    const onHashChange = (): void => reveal('smooth');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [sectionId]);

  const select = (next: unknown): void => {
    if (!isNightlyTab(next)) return;
    window.history.replaceState(null, '', `#${next}`);
    window.dispatchEvent(new Event(TAB_CHANGED));
  };

  return (
    <Tabs value={value} onValueChange={select}>
      <TabsList aria-label="Browser">
        {tabs.map((tab) => (
          <TabsTab key={tab.id} value={tab.id}>
            {tab.label}
          </TabsTab>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsPanel key={tab.id} value={tab.id} keepMounted>
          {tab.content}
        </TabsPanel>
      ))}
    </Tabs>
  );
}
