/** Site-wide constants. Everything that is a URL lives here so it is easy to audit. */

/** Canonical origin. The apex `geld.sh` 308-redirects here (Vercel domain setting). */
export const SITE_URL = 'https://www.geld.sh';
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

/** Author links shown in the footer. Entries with `url: null` are not rendered. */
export const AUTHOR = {
  name: 'Brandon McConnell',
  profiles: [
    { label: 'GitHub', url: `https://github.com/${GITHUB_OWNER}` },
    { label: 'X / Twitter', url: 'https://x.com/branmcconnell' },
    { label: 'LinkedIn', url: 'https://www.linkedin.com/in/brandonmcconnell/' },
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
