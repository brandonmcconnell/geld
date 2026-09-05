'use client';

import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cn } from 'cn';

/**
 * Square switch. Track 36×20 with a 1px border, thumb 12×12: that leaves an
 * even 3px of track above, below and beside the thumb in either position
 * (whole pixels, so it sits visibly centred).
 */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer group/switch relative inline-flex h-5 w-9 shrink-0 items-center rounded-none border border-transparent transition-colors outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:bg-primary data-unchecked:bg-input data-disabled:cursor-not-allowed data-disabled:opacity-50 dark:data-unchecked:bg-input/80',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-3 rounded-none bg-background transition-transform data-checked:translate-x-[19px] data-unchecked:translate-x-[3px] motion-reduce:transition-none dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
