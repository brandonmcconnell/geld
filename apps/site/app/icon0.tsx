import { ImageResponse } from 'next/og';

import { loadLogomark } from '@/lib/brand';

/** 32px favicon: the logomark at 1px per unit (24 × 25), so every straight edge lands on a pixel, black on white. */
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default async function Icon() {
  const mark = await loadLogomark();
  const height = mark.height;
  const width = mark.width;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ffffff', borderRadius: 6 }}>
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
