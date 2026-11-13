'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ConsentManagerProvider, useConsentManager } from '@c15t/react';
import { Dialog } from '@base-ui/react/dialog';

import { SiteAnalytics } from '@/components/site-analytics';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { siteAnalyticsConfig } from '@/lib/site-analytics';

/** Firefox, Brave and some extensions send Global Privacy Control: it is a refusal, whatever is clicked. */
function globalPrivacyRefused(): boolean {
  return typeof navigator !== 'undefined' && 'globalPrivacyControl' in navigator && navigator.globalPrivacyControl === true;
}

/**
 * geld.sh's consent, as the dashboard asks it (c15t, offline: the choice stays in this browser): necessary storage,
 * and optional measurement, which starts off. Nothing optional loads before the visitor opts in. Without a PostHog key
 * there is nothing optional to ask about, so neither the banner nor the footer's Privacy settings show.
 */
export function PrivacyControls({ children }: { readonly children: ReactNode }) {
  if (siteAnalyticsConfig() === null) return children;
  return (
    <ConsentManagerProvider
      options={{
        mode: 'offline',
        acknowledgeNoRecords: true,
        consentCategories: ['necessary', 'measurement'],
        ignoreGeoLocation: true,
        experimental_globalPrivacyControl: true,
        react: { noStyle: true },
      }}
    >
      <ConsentAnalytics />
      {children}
      <ConsentInterface />
    </ConsentManagerProvider>
  );
}

function ConsentAnalytics() {
  const { consentInfo, hasConsentFor } = useConsentManager();
  return <SiteAnalytics enabled={consentInfo !== null && hasConsentFor('measurement') && !globalPrivacyRefused()} />;
}

/** The footer's way back to the choice, shown only where there is one to make. */
export function PrivacySettingsButton({ className }: { readonly className: string }) {
  if (siteAnalyticsConfig() === null) return null;
  return <PrivacySettingsTrigger className={className} />;
}

function PrivacySettingsTrigger({ className }: { readonly className: string }) {
  const { setIsPrivacyDialogOpen } = useConsentManager();
  return (
    <button type="button" className={className} onClick={() => setIsPrivacyDialogOpen(true)}>
      Privacy settings
    </button>
  );
}

function ConsentInterface() {
  const { showPopup, setShowPopup, saveConsents, consentInfo, setSelectedConsent, hasConsentFor, isPrivacyDialogOpen, setIsPrivacyDialogOpen } = useConsentManager();
  const measurement = consentInfo !== null && hasConsentFor('measurement');
  const [draft, setDraft] = useState(false);
  const manage = (): void => {
    const allowed = measurement && !globalPrivacyRefused();
    setDraft(allowed);
    setSelectedConsent('measurement', allowed);
    setIsPrivacyDialogOpen(true);
  };
  const choose = (type: 'all' | 'necessary' | 'custom'): void => {
    if (globalPrivacyRefused()) {
      setSelectedConsent('measurement', false);
      saveConsents('necessary');
    } else saveConsents(type);
    setShowPopup(false);
    setIsPrivacyDialogOpen(false);
  };
  return (
    <>
      {showPopup && !isPrivacyDialogOpen && (
        <section aria-label="Privacy choices" className="fixed inset-x-4 bottom-4 z-50 flex max-w-md flex-col gap-3 border bg-background p-4 shadow-lg sm:right-auto sm:left-4">
          <div className="flex flex-col gap-1">
            <strong className="text-sm font-medium">Your work. Your choices.</strong>
            <p className="text-sm text-muted-foreground">
              Optional measurement shows us which pages and buttons help, where visitors come from and roughly where they are. The site works the same without it, and nothing optional loads before you choose. See the{' '}
              <Link href="/privacy#consent" className="underline underline-offset-4">
                privacy policy
              </Link>
              .
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => choose('all')}>
              Opt in to all
            </Button>
            <Button size="sm" variant="outline" onClick={() => choose('necessary')}>
              Necessary only
            </Button>
            <Button size="sm" variant="outline" onClick={manage}>
              Manage
            </Button>
          </div>
        </section>
      )}
      <Dialog.Root open={isPrivacyDialogOpen} onOpenChange={(open) => (open ? manage() : setIsPrivacyDialogOpen(false))}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 border bg-background p-6 shadow-lg">
            <Dialog.Title className="text-lg font-medium">Privacy settings</Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">Necessary storage keeps your choices and the site working. Optional measurement starts off.</Dialog.Description>
            <label className="flex items-start justify-between gap-4">
              <span className="flex flex-col gap-1">
                <span className="text-sm font-medium">Measurement</span>
                <span className="text-sm text-muted-foreground">Page visits, the links and buttons you click, how far you scroll, the page you came from and your approximate region, counted with an identifier kept in this browser.</span>
              </span>
              <Switch
                checked={draft}
                disabled={globalPrivacyRefused()}
                onCheckedChange={(checked) => {
                  setDraft(checked);
                  setSelectedConsent('measurement', checked);
                }}
              />
            </label>
            {globalPrivacyRefused() && <p className="text-sm text-muted-foreground">Global Privacy Control is on. Optional measurement is refused.</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => choose('necessary')}>
                Necessary only
              </Button>
              <Button size="sm" onClick={() => choose('custom')}>
                Save choices
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
