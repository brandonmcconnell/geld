import type { Metadata } from 'next';
import { Suspense } from 'react';
import type { ReactNode } from 'react';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { PrivacyControls } from '@/components/privacy-controls';
import { CornerShapePolyfill } from '@/components/corner-shape-polyfill';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'Geld · Review queue', template: '%s · Geld' },
  description: 'Follow the change. Your repositories, teams and pull requests in one review workspace.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <CornerShapePolyfill />
        <Suspense
          fallback={
            <div className="page" role="status">
              Loading your workspace...
            </div>
          }
        >
          <PrivacyControls>{children}</PrivacyControls>
        </Suspense>
      </body>
    </html>
  );
}
