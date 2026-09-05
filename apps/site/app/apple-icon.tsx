import { ImageResponse } from 'next/og';

import { loadLogomark } from '@/lib/brand';

/** 180px touch icon rendered from the logomark. */
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default async function AppleIcon() {
  const mark = await loadLogomark();
  const height = 120;
  const width = (mark.width / mark.height) * height;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ffffff' }}>
        <svg width={width} height={height} viewBox={mark.viewBox} fill="#000000">
          {mark.paths.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      </div>
    ),
    size,
  );
}
