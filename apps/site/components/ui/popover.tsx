'use client';

import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { cn } from 'cn';
import type { FocusEvent, PointerEvent } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

interface HoverHandlers {
  readonly onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => void;
  readonly onPointerLeave: (event: PointerEvent<HTMLButtonElement>) => void;
  readonly onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  readonly onFocus: (event: FocusEvent<HTMLButtonElement>) => void;
  readonly onBlur: (event: FocusEvent<HTMLButtonElement>) => void;
  /** Whether the click that just happened came from a mouse (hover already handles those). */
  readonly lastPointerWasMouse: () => boolean;
}

const HoverContext = createContext<HoverHandlers | null>(null);

const OPEN_DELAY = 150;

/**
 * A popover that behaves like the extension's breakdown tooltip: it stays open
 * only while the pointer is over the trigger (or the trigger has keyboard
 * focus), so moving onto the popup itself lets it close. Taps toggle it, and
 * tapping anywhere else closes it, because tooltips never open from touch.
 */
function Popover({ children, ...props }: Omit<PopoverPrimitive.Root.Props, 'open' | 'onOpenChange' | 'defaultOpen'>) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerType = useRef('');
  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const schedule = useCallback(
    (next: boolean, delay: number) => {
      clear();
      timer.current = setTimeout(() => {
        timer.current = null;
        setOpen(next);
      }, delay);
    },
    [clear],
  );
  useEffect(() => clear, [clear]);

  const handlers: HoverHandlers = {
    onPointerEnter: (event) => {
      if (event.pointerType === 'mouse') schedule(true, OPEN_DELAY);
    },
    onPointerLeave: (event) => {
      if (event.pointerType !== 'mouse') return;
      clear();
      setOpen(false);
    },
    onPointerDown: (event) => {
      pointerType.current = event.pointerType;
    },
    onFocus: (event) => {
      // Keyboard focus only; a mouse click also focuses, and hover already opened it.
      if (event.currentTarget.matches(':focus-visible')) {
        clear();
        setOpen(true);
      }
    },
    onBlur: (event) => {
      // Focus moving into the popup (a screen reader, or a tap on some browsers) is not leaving.
      if (event.relatedTarget instanceof Element && event.relatedTarget.closest('[data-slot="popover-content"]') !== null) return;
      clear();
      setOpen(false);
    },
    lastPointerWasMouse: () => pointerType.current === 'mouse',
  };

  return (
    <HoverContext.Provider value={handlers}>
      <PopoverPrimitive.Root data-slot="popover" open={open} onOpenChange={setOpen} {...props}>
        {children}
      </PopoverPrimitive.Root>
    </HoverContext.Provider>
  );
}

/** Trigger for {@link Popover}: hover and focus are handled there; clicks only toggle for touch and pen. */
function PopoverTrigger({ onClick, ...props }: Omit<PopoverPrimitive.Trigger.Props, 'openOnHover' | 'delay' | 'closeDelay'>) {
  const hover = useContext(HoverContext);
  if (hover === null) throw new Error('PopoverTrigger must be used inside Popover.');
  const { lastPointerWasMouse, ...handlers } = hover;
  return (
    <PopoverPrimitive.Trigger
      data-slot="popover-trigger"
      openOnHover={false}
      {...handlers}
      onClick={(event) => {
        onClick?.(event);
        if (lastPointerWasMouse()) event.preventBaseUIHandler();
      }}
      {...props}
    />
  );
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
          // The content is read-only detail: never move focus into it, and do not move it back on close
          // (a programmatic re-focus of the trigger would count as keyboard focus and reopen it).
          initialFocus={false}
          finalFocus={false}
          className={cn(
            'z-50 w-fit max-w-xs origin-(--transform-origin) rounded-none border bg-popover text-xs text-popover-foreground shadow-md outline-none',
            // Quick fade-out (no scale) so leaving the trigger feels immediate; the entrance keeps the small scale-in.
            'transition-[opacity,transform] duration-150 ease-out data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-75 motion-reduce:transition-none',
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
