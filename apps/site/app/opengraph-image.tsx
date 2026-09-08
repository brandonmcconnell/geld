import { ImageResponse } from 'next/og';

import { loadGeistFont, loadScreenshot, loadWordmark } from '@/lib/brand';
import { SITE_NAME, TAGLINE } from '@/lib/site';

export const alt = `${SITE_NAME} — ${TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Wordmark and tagline on the left; on the right, a real capture of the
 * extension on a 124-file pull request (39 test files hidden, +3,485 → +2,766)
 * with the hover breakdown open. The card bleeds off the right edge so the
 * numbers stay large enough to read in a timeline preview.
 */
export default async function OpenGraphImage() {
  const [wordmark, screenshot, sans, mono] = await Promise.all([
    loadWordmark(),
    loadScreenshot('pr-header-breakdown.png'),
    loadGeistFont('Geist-SemiBold.ttf'),
    loadGeistFont('GeistMono-Medium.ttf'),
  ]);
  const wordmarkHeight = 64;
  const wordmarkWidth = (wordmark.width / wordmark.height) * wordmarkHeight;
  const shotWidth = 640;
  const shotHeight = Math.round((screenshot.height / screenshot.width) * shotWidth);

  return new ImageResponse(
    (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          overflow: 'hidden',
          background: '#ffffff',
          color: '#1f2328',
          fontFamily: 'Geist',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: 572,
            padding: '64px 0 56px 72px',
          }}
        >
          <svg width={wordmarkWidth} height={wordmarkHeight} viewBox={wordmark.viewBox} fill="#000000">
            {wordmark.paths.map((d) => (
              <path key={d} d={d} />
            ))}
          </svg>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div style={{ fontSize: 60, fontWeight: 600, letterSpacing: -2.2, lineHeight: 1.05 }}>{`${TAGLINE}.`}</div>
            <div style={{ fontSize: 26, lineHeight: 1.35, color: '#59636e' }}>
              A browser extension that hides test files and other review noise from GitHub diffs.
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 24, color: '#59636e' }}>
            <span style={{ fontFamily: 'Geist Mono', color: '#1f2328' }}>geld.sh</span>
            <span>Chrome · Edge · Firefox · Safari</span>
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            right: -56,
            top: (size.height - shotHeight) / 2,
            display: 'flex',
            width: shotWidth,
            height: shotHeight,
            overflow: 'hidden',
            border: '2px solid #d0d7de',
            borderRadius: 16,
            boxShadow: '0 28px 70px rgba(31, 35, 40, 0.16)',
            background: '#ffffff',
          }}
        >
          <img src={screenshot.src} width={shotWidth} height={shotHeight} alt="" />
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Geist', data: sans, weight: 600, style: 'normal' },
        { name: 'Geist Mono', data: mono, weight: 500, style: 'normal' },
      ],
    },
  );
}
