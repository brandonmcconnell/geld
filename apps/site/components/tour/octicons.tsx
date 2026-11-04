import { cn } from 'cn';

// Mirrors the review group's glyphs in apps/extension/src/github/ui/icons.ts (ICON_CHECK, ICON_X, ICON_COMMENT and their *_SEND forms).
const CHECK = 'M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z';
const X =
  'M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z';
const COMMENT =
  'M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z';
const SEND_ARROW =
  'M11.97 9.97a.75.75 0 0 1 1.06 0l2.25 2.25a.75.75 0 0 1 0 1.06l-2.25 2.25a.75.75 0 1 1-1.06-1.06l.97-.97H9.75a.75.75 0 0 1 0-1.5h3.19l-.97-.97a.75.75 0 0 1 0-1.06Z';

const GLYPHS = {
  check: { path: CHECK, arrow: [0.75, 0.75] },
  x: { path: X, arrow: [1.5, 2] },
  comment: { path: COMMENT, arrow: [0.75, 2.5] },
} as const;

export type Glyph = keyof typeof GLYPHS;

/** A 16px octicon, drawn as the extension draws it; `send` adds the arrow of a 1-click review, overhanging the box where it must. */
export function Octicon({ glyph, send = false, className }: { readonly glyph: Glyph; readonly send?: boolean; readonly className?: string }) {
  const { path, arrow } = GLYPHS[glyph];
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false" className={cn('block shrink-0 overflow-visible', className)}>
      <path d={path} />
      {send ? <path transform={`translate(${arrow[0]} ${arrow[1]})`} d={SEND_ARROW} /> : null}
    </svg>
  );
}
