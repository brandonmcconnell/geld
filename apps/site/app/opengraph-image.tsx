import { ImageResponse } from 'next/og';

import { loadGeistFont, loadScreenshot, loadWordmark } from '@/lib/brand';
import { HEADLINE, SUBHEADLINE, TAGLINE } from '@/lib/site';

export const alt = TAGLINE;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Wordmark, headline and the home page's short line on the left; on the right,
 * the digest Geld makes of a pull request, captured from the home page's hero
 * (`assets/screenshots/hero-digest.png`, 2×), so the picture is the idea rather
 * than a GitHub screenshot. Re-capture it when the digest card changes.
 */
export default async function OpenGraphImage() {
  const [wordmark, screenshot, sans, mono] = await Promise.all([
    loadWordmark(),
    loadScreenshot('hero-digest.png'),
    loadGeistFont('Geist-SemiBold.ttf'),
    loadGeistFont('GeistMono-Medium.ttf'),
  ]);
  const wordmarkHeight = 64;
  const wordmarkWidth = (wordmark.width / wordmark.height) * wordmarkHeight;
  const shotWidth = 540;
  const shotHeight = Math.round((screenshot.height / screenshot.width) * shotWidth);
  // The card's own corner (rounded-xl at its natural 380px), scaled with it.
  const shotRadius = Math.round((12 * shotWidth) / 380);

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
            <div style={{ display: 'flex', flexDirection: 'column', fontSize: 46, fontWeight: 600, letterSpacing: -1.5, lineHeight: 1.08 }}>
              {HEADLINE.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </div>
            <div style={{ fontSize: 30, lineHeight: 1.35, color: '#59636e' }}>{SUBHEADLINE}</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 24, color: '#59636e' }}>
            <span style={{ fontFamily: 'Geist Mono', color: '#1f2328' }}>geld.sh</span>
            <span>Chrome · Edge · Firefox · Safari</span>
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            right: 48,
            top: (size.height - shotHeight) / 2,
            display: 'flex',
            width: shotWidth,
            height: shotHeight,
            overflow: 'hidden',
            borderRadius: shotRadius,
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
