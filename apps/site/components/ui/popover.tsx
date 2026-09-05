'use client';

import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { cn } from 'cn';

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

/**
 * Opens on hover (desktop) and on click/tap (everywhere), unlike a tooltip,
 * which never opens from touch. Use for hover details that phones must reach.
 */
function PopoverTrigger({ openOnHover = true, delay = 150, ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" openOnHover={openOnHover} delay={delay} {...props} />;
}

function PopoverContent({
  className,
  side = 'top',
  sideOffset = 6,
  align = 'center',
  alignOffset = 0,
  children,
  ...props
}: PopoverPrimitive.Popup.Props & Pick<PopoverPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner align={align} alignOffset={alignOffset} side={side} sideOffset={sideOffset} className="isolate z-50">
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            'z-50 w-fit max-w-xs origin-(--transform-origin) rounded-none border bg-popover text-xs text-popover-foreground shadow-md outline-none',
            'transition-[opacity,transform] duration-150 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none',
            className,
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
