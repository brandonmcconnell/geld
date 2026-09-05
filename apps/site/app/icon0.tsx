import { ImageResponse } from 'next/og';

import { loadLogomark } from '@/lib/brand';

/** 32px favicon rendered from the logomark, black on white. */
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default async function Icon() {
  const mark = await loadLogomark();
  const height = 24;
  const width = (mark.width / mark.height) * height;
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
