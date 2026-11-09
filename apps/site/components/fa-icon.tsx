import type { SVGProps } from 'react';
import type { faPlay } from '@awesome.me/kit-2e791c163e/icons/sharp/solid';

type IconDefinition = typeof faPlay;

/** A Font Awesome icon from the Geld kit, drawn inline in the text colour. */
export function FaIcon({ icon, ...props }: { readonly icon: IconDefinition } & Omit<SVGProps<SVGSVGElement>, 'children' | 'viewBox'>) {
  const [width, height, , , data] = icon.icon;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      {(typeof data === 'string' ? [data] : data).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
