import type { ComponentProps } from 'react';

/** Off-site link: opens in a new tab and tells screen readers so. */
export function ExternalLink({ children, ...props }: Omit<ComponentProps<'a'>, 'target' | 'rel'>) {
  return (
    <a target="_blank" rel="noopener noreferrer" {...props}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
