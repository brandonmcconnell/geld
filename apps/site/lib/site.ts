/** Site-wide constants. Everything that is a URL lives here so it is easy to audit. */

export const SITE_URL = 'https://geld.sh';
export const SITE_NAME = 'Geld';
export const TAGLINE = 'Review the code, not the tests';
export const DESCRIPTION =
  'Geld is a browser extension that hides test files and other review noise from GitHub diffs, so you can review the code that matters first. Chrome, Edge, Firefox and Safari.';

export const GITHUB_OWNER = 'brandonmcconnell';
export const GITHUB_REPO = 'geld';
export const REPO_SLUG = `${GITHUB_OWNER}/${GITHUB_REPO}`;
export const REPO_URL = `https://github.com/${REPO_SLUG}`;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const LATEST_RELEASE_URL = `${RELEASES_URL}/latest`;
export const ISSUES_URL = `${REPO_URL}/issues`;
export const INSTALL_GUIDE_URL = `${REPO_URL}#install-for-testing`;
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

export interface ProfileLink {
  readonly label: string;
  /** `null` until the owner fills in the URL; the footer skips those entries. */
  readonly url: string | null;
}

/**
 * Author links shown in the footer.
 *
 * TODO(owner): fill in the remaining profile URLs. Entries with `url: null`
 * are not rendered, so nothing breaks while they are missing.
 */
export const AUTHOR = {
  name: 'Brandon McConnell',
  profiles: [
    { label: 'GitHub', url: `https://github.com/${GITHUB_OWNER}` },
    { label: 'X', url: null }, // TODO(owner): e.g. https://x.com/<handle>
    { label: 'Bluesky', url: null }, // TODO(owner): e.g. https://bsky.app/profile/<handle>
    { label: 'Website', url: null }, // TODO(owner): personal site
  ],
} satisfies { readonly name: string; readonly profiles: readonly ProfileLink[] };

export interface NavLink {
  readonly href: string;
  readonly label: string;
  /** Whether the header shows the link on narrow screens (the footer always does). */
  readonly compact: boolean;
}

export const NAV_LINKS: readonly NavLink[] = [
  { href: '/how-it-works', label: 'How it works', compact: true },
  { href: '/patterns', label: 'Patterns', compact: true },
  { href: '/faq', label: 'FAQ', compact: true },
  { href: '/privacy', label: 'Privacy', compact: false },
];

export const KEYBOARD_SHORTCUT = ['Alt', 'Shift', 'T'] as const;
