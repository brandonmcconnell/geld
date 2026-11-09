import { loadDarkLogomark, loadLogomark } from '@/lib/brand';

/**
 * SVG favicon with the colour-scheme preference baked in: the logomark black
 * on light, and its lighter dark-mode cut white on dark. Browsers that
 * understand SVG icons (Chrome, Firefox) pick this, the last icon declared;
 * Safari falls back to the PNG from `icon0.tsx`. The shared brand SVGs are
 * read, not modified.
 */
export const contentType = 'image/svg+xml';

export default async function Icon() {
  const [light, dark] = await Promise.all([loadLogomark(), loadDarkLogomark()]);
  const group = (className: string, paths: readonly string[]) => `<g class="${className}">${paths.map((d) => `<path d="${d}"/>`).join('')}</g>`;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${light.viewBox}" fill="#000000" role="img" aria-label="Geld">`,
    '<style>.dark { display: none; } @media (prefers-color-scheme: dark) { svg { fill: #ffffff; } .light { display: none; } .dark { display: inline; } }</style>',
    group('light', light.paths),
    group('dark', dark.paths),
    '</svg>',
  ].join('');
  return new Response(svg, { headers: { 'Content-Type': contentType } });
}
