import { allHosts, DEFAULT_SETTINGS } from '@geld/core';
import type { Metadata } from 'next';

import { ExternalLink } from '@/components/external-link';
import { PageIntro, Prose } from '@/components/section';
import { ISSUES_URL, REPO_URL, SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'Geld collects no data, makes no requests except to GitHub, and stores your settings in your browser’s sync storage — or, if you opt in, a secret gist on your own account.',
  alternates: { canonical: '/privacy' },
};

/**
 * Written to be linked from the browser store listings as the extension's
 * privacy policy, so it states each point plainly and completely.
 */
export default function PrivacyPage() {
  const defaultHosts = allHosts(DEFAULT_SETTINGS);
  return (
    <>
      <PageIntro
        eyebrow="Privacy policy"
        title="Geld collects nothing."
        description="This page is the privacy policy for the Geld browser extension and for this website. It is written to be complete enough to serve as the store listing's privacy policy."
      />
      <div className="container-site pb-24">
        <Prose>
          <h2 id="summary">Summary</h2>
          <ul>
            <li>Geld does not collect, store or transmit any personal data, usage data or telemetry. There is no analytics and no error reporting.</li>
            <li>
              Geld has no server. The only network requests it makes go to GitHub: to the GitHub hosts you use, to fetch diffs that GitHub would serve
              you anyway, and, only if you choose to sign in, to GitHub&apos;s Gist API to sync your settings to a secret gist on your own account.
            </li>
            <li>Your settings are stored in your browser&apos;s extension sync storage. Nothing about your browsing is stored anywhere else.</li>
            <li>
              Signing in with GitHub is optional and asks for the <code>gist</code> scope only. In the extension the token stays on your device; on
              geld.sh it is kept only in an encrypted cookie in your own browser. There is no database.
            </li>
          </ul>

          <h2 id="data-collection">Data collection</h2>
          <p>
            None. The extension has no account system, no identifiers, no crash reporter and no analytics of any kind. The developer receives no
            information from installs of Geld.
          </p>

          <h2 id="network">Network requests</h2>
          <p>
            Geld runs only on {defaultHosts.join(', ')} and on GitHub Enterprise Server hostnames you explicitly add in the options (your browser asks
            for permission for each one). On those hosts it reads the page you are viewing. When a page does not include per-file diffs (a pull
            request&apos;s conversation tab, pull request lists, large pull requests that GitHub loads progressively), Geld requests the pull
            request&apos;s <code>.diff</code> file from the same host, exactly as if you had appended <code>.diff</code> to the URL yourself. The request
            carries your existing GitHub session cookies, which is what lets it read private repositories you already have access to. No request is
            ever made to any other host, and nothing about your browsing is sent anywhere.
          </p>

          <h2 id="sign-in">Optional GitHub sign-in and settings sync</h2>
          <p>
            You can sign in with GitHub from the popup or the options page to sync your settings between browsers. This is off until you choose it.
            Sign-in uses GitHub&apos;s OAuth <em>device flow</em>: Geld asks GitHub for a short code, you confirm it on github.com, and GitHub issues a
            token with the <code>gist</code> scope only. There is no Geld server in this exchange and no client secret. Geld then reads your public
            profile (login and avatar, shown in the popup) and keeps your settings in a <strong>secret gist on your own GitHub account</strong> named{' '}
            <code>geld-settings.json</code>. Only you and Geld running in your signed-in browsers can read or change it. The token is stored in{' '}
            <code>browser.storage.local</code> on the device that signed in and is never synced or sent anywhere except to <code>api.github.com</code>.
            Signing out deletes the token; deleting the gist from GitHub removes the synced copy.
          </p>
          <p>
            You can also sign in on <strong>geld.sh/settings</strong> to edit the same gist from any browser. That uses the same OAuth App through
            GitHub&apos;s web flow: GitHub sends a one-time code to <code>www.geld.sh/auth</code>, the site exchanges it for a <code>gist</code>-scoped token
            and stores the token, your login and avatar URL in an <strong>encrypted, HttpOnly cookie in your browser</strong> (30 days, or until you
            sign out, which also asks GitHub to revoke the token). geld.sh has no database and keeps nothing between requests: it reads or writes your
            gist only while serving a request you make, and never logs its contents. A second, readable cookie holds just your login and avatar so the
            page header can show them.
          </p>

          <h2 id="storage">Storage</h2>
          <p>
            Settings (which categories to hide, your patterns and categories, repository rules, Enterprise hosts and a few preferences) are stored in{' '}
            <code>browser.storage.sync</code>, so they follow your browser profile if your browser syncs extension data. Parsed diffs are cached in{' '}
            <code>browser.storage.local</code> on your device, keyed by commit, to avoid refetching; this cache contains only line counts per file
            path and expires on its own. Uninstalling the extension removes all of it. The options page lets you export and import your settings as a
            JSON file you control.
          </p>

          <h2 id="permissions">Permissions</h2>
          <ul>
            <li>
              <strong>Access to GitHub hosts</strong> — to read diff pages and fetch <code>.diff</code> files on {defaultHosts.join(', ')} (and{' '}
              <code>patch-diff.githubusercontent.com</code>, where GitHub redirects them) and the Enterprise hosts you add; <code>api.github.com</code>{' '}
              is used only for the optional sign-in and gist sync.
            </li>
            <li>
              <strong>Storage</strong> — to save your settings and the diff cache.
            </li>
            <li>
              <strong>Scripting / content scripts</strong> — to register the content script on Enterprise hosts you add.
            </li>
            <li>
              <strong>Offscreen document</strong> (Chrome and Edge) — to detect your light or dark colour scheme so the toolbar icon matches it.
            </li>
          </ul>

          <h2 id="website">This website</h2>
          <p>
            {SITE_URL} is a static site with no analytics, advertising or third-party scripts. It sets no cookies unless you sign in (see above); a
            theme choice made in the header is kept in your browser&apos;s local storage. The install buttons link to GitHub Releases or to browser
            extension stores, which have their own privacy policies.
          </p>

          <h2 id="changes">Changes and contact</h2>
          <p>
            If this policy ever changes, the change will be visible in the{' '}
            <ExternalLink href={`${REPO_URL}/commits/main/apps/site/app/privacy/page.tsx`}>public history of this page</ExternalLink>
            . Questions or concerns: please{' '}
            <ExternalLink href={ISSUES_URL}>open an issue on GitHub</ExternalLink>
            .
          </p>
        </Prose>
      </div>
    </>
  );
}
