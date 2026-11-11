import emblem from '../../../../assets/brand/geld-logomark-grid.svg?raw';

const paths = {
  flow: '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
  filter: '<path d="M3 6h18M7 12h10M10 18h4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  settings: '<path d="m9 3 1-2h4l1 2 2 1 2-.2 2 3.4-1.2 1.8V12l1.2 1.8-2 3.4-2-.2-2 1-1 2h-4l-1-2-2-1-2 .2-2-3.4L4.2 12V9L3 7.2l2-3.4L7 4Z" transform="translate(0 1)"/><circle cx="12" cy="12" r="3"/>',
  reviews: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M19 15a5 5 0 0 1 2 4v2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  changes: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>',
  dot: '<circle cx="12" cy="12" r="4" fill="currentColor"/>',
  severe: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3.5v.5"/>',
  skipped: '<path d="M12 3 2 20h20Z"/><path d="M12 10v4m0 3v.5"/>',
  comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-5 4V5a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2Z"/>',
  activity: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  report: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h7M7 16h4"/>',
  preview: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 8h18"/>',
  commit: '<circle cx="12" cy="12" r="3"/><path d="M3 12h6m6 0h6"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  push: '<path d="M12 3v12m-5-7 5-5 5 5M5 21h14"/>',
  pin: '<path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4Z"/>',
  link: '<path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 12a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1"/>',
} as const;

export type DigestIcon = keyof typeof paths;

export function digestIcon(name: DigestIcon | 'geld', doc: Document = document): SVGSVGElement {
  const template = doc.createElement('template');
  template.innerHTML = name === 'geld' ? emblem.replace(/fill="#000000"/g, 'fill="currentColor"')
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
  const svg = template.content.querySelector('svg');
  if (svg === null) throw new Error('Missing digest icon');
  svg.setAttribute('class', 'geld-provider-digest-icon');
  if (name !== 'geld') svg.setAttribute('data-geld-outline', '');
  svg.setAttribute('width', '16');svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');svg.setAttribute('focusable', 'false');
  return svg;
}
