'use client';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ConsentManagerProvider, useConsentManager } from '@c15t/react';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from '@geld/ui';
import { z } from 'zod';

function globalPrivacyRefused(): boolean {
  return typeof navigator !== 'undefined' && 'globalPrivacyControl' in navigator && navigator.globalPrivacyControl === true;
}
export function PrivacyControls({ children }: { readonly children: ReactNode }) {
  return <ConsentManagerProvider options={{ mode: 'offline', acknowledgeNoRecords: true, consentCategories: ['necessary', 'measurement'], ignoreGeoLocation: true, experimental_globalPrivacyControl: true, react: { noStyle: true } }}>{children}<ConsentInterface/></ConsentManagerProvider>;
}
function ConsentInterface() {
  const { showPopup, setShowPopup, saveConsents, selectedConsents, setSelectedConsent, hasConsentFor, isPrivacyDialogOpen, setIsPrivacyDialogOpen } = useConsentManager();
  const pathname = usePathname();
  const measurement = hasConsentFor('measurement');
  useEffect(() => {
    if (!measurement || globalPrivacyRefused()) return;
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    import('posthog-js').then(({ default: posthog }) => {
      if (cancelled) return;
      posthog.init(key, { api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com', autocapture: false, capture_pageview: false, capture_pageleave: false, disable_session_recording: true, disable_surveys: true, person_profiles: 'never', advanced_disable_feature_flags: true, mask_all_text: true, mask_all_element_attributes: true, persistence: 'memory', before_send: (event) => {
        if (!event || !['$pageview', 'provider_setup', 'guide_requested', 'review_submitted', 'billing_opened'].includes(event.event)) return null;
        const properties = z.object({ route: z.string().optional(), feature: z.string().optional(), provider: z.enum(['github','gitlab','bitbucket']).optional() }).safeParse(event.properties);
        return { ...event, properties: properties.success ? properties.data : {} };
      } });
      posthog.capture('$pageview', { route: pathname.startsWith('/github/') || pathname.startsWith('/gitlab/') || pathname.startsWith('/bitbucket/') || pathname.startsWith('/ghe/') ? '/:provider/:owner/:repo/:view' : pathname });
      stop = () => { posthog.opt_out_capturing(); posthog.reset(); };
    });
    return () => { cancelled = true; stop?.(); };
  }, [measurement, pathname]);
  function choose(type: 'all' | 'necessary' | 'custom') {
    if (globalPrivacyRefused()) { setSelectedConsent('measurement', false); saveConsents('necessary'); }
    else saveConsents(type);
    setShowPopup(false); setIsPrivacyDialogOpen(false);
  }
  return <><footer className="privacy-footer"><Link href="/privacy">Privacy</Link><button onClick={() => setIsPrivacyDialogOpen(true)}>Privacy settings</button><span>Need self-hosted or enterprise options? <a href="mailto:hello@geld.sh">Contact us</a></span></footer>
    {showPopup && <section className="consent-banner" aria-label="Privacy choices"><div><strong>Your work. Your choices.</strong><p>Optional measurement helps us understand which features work. Without it, your reviews and feature access work the same. Nothing optional loads before your choice.</p></div><div className="consent-actions"><Button variant="outline" size="sm" onClick={() => choose('all')}>Opt in to all</Button><Button variant="outline" size="sm" onClick={() => choose('necessary')}>Cancel</Button><Button variant="outline" size="sm" onClick={() => setIsPrivacyDialogOpen(true)}>Manage</Button></div></section>}
    <Dialog.Root open={isPrivacyDialogOpen} onOpenChange={setIsPrivacyDialogOpen}><Dialog.Portal><Dialog.Backdrop className="dialog-backdrop"/><Dialog.Popup className="privacy-dialog"><Dialog.Title className="text-lg font-medium">Privacy settings</Dialog.Title><Dialog.Description className="muted mt-3">Necessary storage keeps your account and choices working. Optional measurement starts off.</Dialog.Description><label className="settings-row"><div><h3>Measurement</h3><p>Help us improve navigation and review flows. Turning this off stops optional usage measurement.</p></div><input type="checkbox" checked={selectedConsents.measurement === true} disabled={globalPrivacyRefused()} onChange={(event) => setSelectedConsent('measurement', event.target.checked)}/></label>{globalPrivacyRefused() && <p className="muted">Global Privacy Control is enabled. Optional measurement is refused.</p>}<div className="consent-actions"><Button variant="outline" onClick={() => choose('all')}>Opt in to all</Button><Button variant="outline" onClick={() => choose('necessary')}>Cancel</Button><Button variant="outline" onClick={() => choose('custom')}>Save choices</Button></div></Dialog.Popup></Dialog.Portal></Dialog.Root>
  </>;
}
