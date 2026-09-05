import { loadLogomark } from '@/lib/brand';

/**
 * SVG favicon with the colour-scheme preference baked in: the logomark is
 * black on light and white on dark. Browsers that understand SVG icons
 * (Chrome, Firefox) pick this, the last icon declared; Safari falls back to
 * the PNG from `icon0.tsx`. The shared brand SVGs are read, not modified.
 */
export const contentType = 'image/svg+xml';

export default async function Icon() {
  const mark = await loadLogomark();
  const paths = mark.paths.map((d) => `<path d="${d}"/>`).join('');
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${mark.viewBox}" fill="#000000" role="img" aria-label="Geld">`,
    '<style>@media (prefers-color-scheme: dark) { svg { fill: #ffffff; } }</style>',
    paths,
    '</svg>',
  ].join('');
  return new Response(svg, { headers: { 'Content-Type': contentType } });
}
