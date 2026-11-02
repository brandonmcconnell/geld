'use client';
import { useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ConsentManagerProvider, useConsentManager } from '@c15t/react';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from '@geld/ui';
import { Measurement } from './measurement';

function globalPrivacyRefused(): boolean {
  return (
    typeof navigator !== 'undefined' && 'globalPrivacyControl' in navigator && navigator.globalPrivacyControl === true
  );
}
export function PrivacyControls({ children }: { readonly children: ReactNode }) {
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
      <ConsentMeasurement />
      {children}
      <ConsentInterface />
    </ConsentManagerProvider>
  );
}
function ConsentMeasurement() {
  const { consentInfo, hasConsentFor } = useConsentManager();
  return <Measurement enabled={consentInfo !== null && hasConsentFor('measurement') && !globalPrivacyRefused()} />;
}
function ConsentInterface() {
  const {
    showPopup,
    setShowPopup,
    saveConsents,
    consentInfo,
    setSelectedConsent,
    hasConsentFor,
    isPrivacyDialogOpen,
    setIsPrivacyDialogOpen,
  } = useConsentManager();
  const measurement = consentInfo !== null && hasConsentFor('measurement');
  const [draftMeasurement, setDraftMeasurement] = useState(false);
  function manage() {
    const allowed = measurement && !globalPrivacyRefused();
    setDraftMeasurement(allowed);
    setSelectedConsent('measurement', allowed);
    setIsPrivacyDialogOpen(true);
  }
  function choose(type: 'all' | 'necessary' | 'custom') {
    if (globalPrivacyRefused()) {
      setSelectedConsent('measurement', false);
      saveConsents('necessary');
    } else saveConsents(type);
    setShowPopup(false);
    setIsPrivacyDialogOpen(false);
  }
  return (
    <>
      <footer className="privacy-footer">
        <Link href="/privacy">Privacy</Link>
        <button data-measure="privacy-settings" onClick={manage}>
          Privacy settings
        </button>
        <span>
          Need self-hosted or enterprise options? <a href="mailto:hello@geld.sh">Contact us</a>
        </span>
      </footer>
      {showPopup && (
        <section className="consent-banner" aria-label="Privacy choices">
          <div>
            <strong>Your work. Your choices.</strong>
            <p>
              Optional measurement helps us understand which features work. Without it, your reviews and feature access
              work the same. Nothing optional loads before your choice.
            </p>
          </div>
          <div className="consent-actions">
            <Button variant="outline" size="sm" onClick={() => choose('all')}>
              Opt in to all
            </Button>
            <Button variant="outline" size="sm" onClick={() => choose('necessary')}>
              Cancel
            </Button>
            <Button variant="outline" size="sm" onClick={manage}>
              Manage
            </Button>
          </div>
        </section>
      )}
      <Dialog.Root
        open={isPrivacyDialogOpen}
        onOpenChange={(open) => (open ? manage() : setIsPrivacyDialogOpen(false))}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="dialog-backdrop" />
          <Dialog.Popup className="privacy-dialog">
            <Dialog.Title className="text-lg font-medium">Privacy settings</Dialog.Title>
            <Dialog.Description className="muted mt-3">
              Necessary storage keeps your account and choices working. Optional measurement starts off.
            </Dialog.Description>
            <label className="settings-row">
              <div>
                <h3>Measurement</h3>
                <p>Help us improve navigation and review flows. Turning this off stops optional usage measurement.</p>
              </div>
              <input
                type="checkbox"
                checked={draftMeasurement}
                disabled={globalPrivacyRefused()}
                onChange={(event) => {
                  setDraftMeasurement(event.target.checked);
                  setSelectedConsent('measurement', event.target.checked);
                }}
              />
            </label>
            {globalPrivacyRefused() && (
              <p className="muted">Global Privacy Control is enabled. Optional measurement is refused.</p>
            )}
            <div className="consent-actions">
              <Button variant="outline" onClick={() => choose('all')}>
                Opt in to all
              </Button>
              <Button variant="outline" onClick={() => choose('necessary')}>
                Cancel
              </Button>
              <Button variant="outline" onClick={() => choose('custom')}>
                Save choices
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
