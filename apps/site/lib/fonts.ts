import localFont from 'next/font/local';

/**
 * Geist, self-hosted from the `geist` package. Declared here rather than via
 * `geist/font/*` so the mono face is not preloaded: it only styles code chips
 * and diffstats, and letting the sans face load first keeps LCP down.
 */
export const geistSans = localFont({
  src: '../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2',
  variable: '--font-geist-sans',
  weight: '100 900',
  display: 'swap',
  preload: true,
});

export const geistMono = localFont({
  src: '../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2',
  variable: '--font-geist-mono',
  weight: '100 900',
  display: 'swap',
  preload: false,
});
