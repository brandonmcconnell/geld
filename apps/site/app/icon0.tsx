import { ImageResponse } from 'next/og';

import { loadGridLogomark } from '@/lib/brand';

/** 32px favicon drawn from the grid logomark at 2px per unit, black on white. */
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default async function Icon() {
  const mark = await loadGridLogomark();
  const height = mark.height * 2;
  const width = mark.width * 2;
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
