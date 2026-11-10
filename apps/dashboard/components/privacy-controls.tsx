'use client';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ConsentManagerProvider, CookieBanner, ConsentManagerDialog, useConsentManager } from '@c15t/react';
import { Button } from '@/components/button';
import { X } from './icons';
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
  useEffect(() => {
    window.addEventListener('geld:privacy', manage);
    return () => window.removeEventListener('geld:privacy', manage);
  });
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
      <CookieBanner.Root noStyle disableAnimation trapFocus={false}>
        <CookieBanner.Card data-geld-consent-banner role="region" aria-label="Privacy choices">
          <CookieBanner.Header>
            <CookieBanner.Title>
              <strong>Privacy choices</strong>
            </CookieBanner.Title>
            <CookieBanner.Description>
              <p>
                Allow optional usage measurement? Your reviews work the same either way.{' '}
                <Link href="https://www.geld.sh/privacy" className="underline">
                  Privacy policy
                </Link>
              </p>
            </CookieBanner.Description>
          </CookieBanner.Header>
          <CookieBanner.Footer>
            <div className="consent-actions">
              <Button variant="ghost" size="sm" onClick={manage}>
                Manage
              </Button>
              <Button variant="outline" size="sm" onClick={() => choose('necessary')}>
                Decline optional
              </Button>
              <Button size="sm" onClick={() => choose('all')}>
                Allow measurement
              </Button>
            </div>
          </CookieBanner.Footer>
        </CookieBanner.Card>
      </CookieBanner.Root>
      <ConsentManagerDialog.Root
        noStyle
        disableAnimation
        open={isPrivacyDialogOpen}
        data-geld-consent-dialog
        aria-modal="true"
        onKeyDown={(event) => {
          if (event.key === 'Escape') setIsPrivacyDialogOpen(false);
        }}
        overlay={<div className="dialog-backdrop" onClick={() => setIsPrivacyDialogOpen(false)} />}
      >
        <ConsentManagerDialog.Card data-geld-consent-card>
          <ConsentManagerDialog.Header>
            <div className="dialog-heading">
              <ConsentManagerDialog.HeaderTitle id="privacy-settings-title">
                <h2>Privacy settings</h2>
              </ConsentManagerDialog.HeaderTitle>
              <button
                type="button"
                className="icon-button"
                aria-label="Close privacy settings"
                onClick={() => setIsPrivacyDialogOpen(false)}
              >
                <X size={17} />
                <span className="touch-target" aria-hidden="true" />
              </button>
            </div>
            <ConsentManagerDialog.HeaderDescription>
              <p className="privacy-description">Necessary storage keeps your account and privacy choices working.</p>
            </ConsentManagerDialog.HeaderDescription>
          </ConsentManagerDialog.Header>
          <ConsentManagerDialog.Content>
            <label className="privacy-choice">
              <input
                name="measurement"
                type="checkbox"
                checked={draftMeasurement}
                disabled={globalPrivacyRefused()}
                onChange={(event) => {
                  setDraftMeasurement(event.target.checked);
                  setSelectedConsent('measurement', event.target.checked);
                }}
              />
              <span>
                <strong>Usage measurement</strong>
                <p>Help improve navigation and review flows. Optional and off by default.</p>
              </span>
            </label>
            {globalPrivacyRefused() && (
              <p className="inline-note">Global Privacy Control is enabled. Optional measurement is refused.</p>
            )}
          </ConsentManagerDialog.Content>
          <div className="dialog-actions">
            <Button variant="outline" size="sm" onClick={() => setIsPrivacyDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => choose('custom')}>Save choices</Button>
          </div>
        </ConsentManagerDialog.Card>
      </ConsentManagerDialog.Root>
    </>
  );
}
