import type { ComponentProps } from 'react';
import { Button as SharedButton } from '@geld/ui';
export { buttonVariants } from '@geld/ui';
export function Button({
  children,
  type = 'button',
  variant = 'default',
  ...props
}: ComponentProps<typeof SharedButton>) {
  return (
    <SharedButton type={type} variant={variant} data-material={variant} {...props}>
      {children}
      <span className="touch-target" aria-hidden="true" />
    </SharedButton>
  );
}
