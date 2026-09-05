import { ImageResponse } from 'next/og';

import { loadGeistFont, loadWordmark } from '@/lib/brand';
import { SITE_NAME, TAGLINE } from '@/lib/site';

export const alt = `${SITE_NAME} — ${TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpenGraphImage() {
  const [wordmark, sans, mono] = await Promise.all([loadWordmark(), loadGeistFont('Geist-SemiBold.ttf'), loadGeistFont('GeistMono-Medium.ttf')]);
  const wordmarkHeight = 72;
  const wordmarkWidth = (wordmark.width / wordmark.height) * wordmarkHeight;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          background: '#ffffff',
          color: '#1f2328',
          fontFamily: 'Geist',
        }}
      >
        <svg width={wordmarkWidth} height={wordmarkHeight} viewBox={wordmark.viewBox} fill="#000000">
          {wordmark.paths.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div style={{ fontSize: 68, fontWeight: 600, letterSpacing: -2.5, lineHeight: 1.05 }}>{`${TAGLINE}.`}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontFamily: 'Geist Mono', fontSize: 28 }}>
            <Chip>
              <span style={{ color: '#1a7f37' }}>+93</span>
              <span style={{ color: '#cf222e' }}>−53</span>
            </Chip>
            <span style={{ color: '#6e7781' }}>→</span>
            <Chip>
              <span style={{ color: '#6e7781' }}>6 tests</span>
              <span style={{ color: '#1a7f37' }}>+42</span>
              <span style={{ color: '#cf222e' }}>−26</span>
            </Chip>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 26, color: '#6e7781' }}>
          <span>Hide test files from GitHub diffs. Chrome, Edge, Firefox, Safari.</span>
          <span style={{ fontFamily: 'Geist Mono' }}>geld.sh</span>
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

function Chip({ children }: { readonly children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 18px',
        border: '2px solid #d0d7de',
        borderRadius: 14,
        background: '#f6f8fa',
      }}
    >
      {children}
    </div>
  );
}
