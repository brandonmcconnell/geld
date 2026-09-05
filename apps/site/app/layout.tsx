import type { Metadata, Viewport } from 'next';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { SmoothHashLinks } from '@/components/smooth-hash-links';
import { TooltipProvider } from '@/components/ui/tooltip';
import { geistMono, geistSans } from '@/lib/fonts';
import { DESCRIPTION, SITE_NAME, SITE_URL, TAGLINE } from '@/lib/site';
import { ACCOUNT_INIT_SCRIPT, THEME_INIT_SCRIPT } from '@/lib/theme';

import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — ${TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ['GitHub', 'pull request', 'code review', 'hide test files', 'browser extension', 'diff', 'Chrome', 'Firefox', 'Edge', 'Safari'],
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${TAGLINE}`,
    description: DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — ${TAGLINE}`,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
  alternates: { canonical: '/' },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#131417' },
  ],
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the theme script below may add `data-theme` before React hydrates.
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies a stored light/dark preference and the signed-in marker before first paint; plain inline so it runs during parsing. */}
        <script dangerouslySetInnerHTML={{ __html: `${THEME_INIT_SCRIPT}${ACCOUNT_INIT_SCRIPT}` }} />
      </head>
      <body className="flex min-h-svh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-sm focus:text-background"
        >
          Skip to content
        </a>
        <SmoothHashLinks />
        <TooltipProvider>
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
        </TooltipProvider>
      </body>
    </html>
  );
}
