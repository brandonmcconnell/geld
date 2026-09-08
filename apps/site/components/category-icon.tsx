import type { CategoryIconName } from '@geld/core';
import { CATEGORY_ICON_PATHS } from '@geld/core';
import { cn } from 'cn';
import type { SVGProps } from 'react';

interface CategoryIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  readonly name: CategoryIconName;
}

/** The same Octicon the extension shows for a category, drawn from shared path data. */
export function CategoryIcon({ name, className, ...props }: CategoryIconProps) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" fill="currentColor" className={cn('size-4 shrink-0', className)} {...props}>
      {CATEGORY_ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
