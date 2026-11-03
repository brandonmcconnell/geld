'use client';

import { cn } from 'cn';
import { PauseIcon, PlayIcon } from 'lucide-react';
import type { FocusEvent, PointerEvent, RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';

import { ExternalLink } from '@/components/external-link';
import type { Customer } from '@/lib/customers';
import { CUSTOMERS } from '@/lib/customers';

/** How long the reel takes to slow from full speed to a stop under the mouse, and to get going again. */
const EASE_MS = 3000;

/**
 * An endless reel of customer logos. The list is rendered twice and the track
 * slides by exactly one copy, so the loop has no seam. With reduced motion it
 * is one still, wrapping row instead. One copy must stay wider than
 * `container-wide` (1216px of content), or a logo would show twice at once.
 *
 * The button beside the heading pauses it (WCAG 2.2.2), and so does keyboard
 * focus on a logo, both at once; under the mouse it eases to a stop instead.
 */
export function LogoReel({ className }: { readonly className?: string }) {
  const track = useRef<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  useReelSpeed(track, paused || focused, hovered);

  const onFocus = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.target.matches(':focus-visible')) setFocused(true);
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setFocused(false);
  };
  const onPointer = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse') setHovered(event.type === 'pointerenter');
  };

  return (
    <section aria-labelledby="customers-heading" className={cn('container-wide', className)}>
      <div className="relative mx-auto w-fit">
        <h2 id="customers-heading" className="text-center text-sm text-muted-foreground">
          Used by founders and engineers at
        </h2>
        <button
          type="button"
          onClick={() => setPaused((was) => !was)}
          aria-label={paused ? 'Play logos' : 'Pause logos'}
          title={paused ? 'Play' : 'Pause'}
          className="absolute top-1/2 left-full ml-1 grid size-6 -translate-y-1/2 place-items-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:hidden"
        >
          {paused ? <PlayIcon aria-hidden="true" className="size-3.5" /> : <PauseIcon aria-hidden="true" className="size-3.5" />}
        </button>
      </div>
      <div className="logo-reel mt-6" onFocus={onFocus} onBlur={onBlur} onPointerEnter={onPointer} onPointerLeave={onPointer}>
        <div ref={track} className="flex w-max animate-logo-reel motion-reduce:w-full motion-reduce:animate-none">
          <LogoList />
          <LogoList copy />
        </div>
      </div>
    </section>
  );
}

/**
 * Drives the track's CSS animation through its playback rate, so the reel
 * stops where it is rather than jumping. `stopped` takes effect at once;
 * `slowed` eases to a stop and back over `EASE_MS`, a partial change taking
 * its share of that.
 */
function useReelSpeed(track: RefObject<HTMLDivElement | null>, stopped: boolean, slowed: boolean): void {
  const rate = useRef(1);
  useEffect(() => {
    const animation = track.current?.getAnimations()[0];
    if (animation === undefined) return;
    const target = stopped || slowed ? 0 : 1;
    if (stopped) {
      rate.current = 0;
      animation.playbackRate = 0;
      return;
    }
    const from = rate.current;
    const duration = Math.abs(target - from) * EASE_MS;
    const start = performance.now();
    let frame = 0;
    const step = (now: number): void => {
      const progress = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
      rate.current = from + (target - from) * progress * progress * (3 - 2 * progress);
      animation.playbackRate = rate.current;
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [track, stopped, slowed]);
}

function LogoList({ copy = false }: { readonly copy?: boolean }) {
  return (
    <ul
      className={cn('flex shrink-0 items-center', 'motion-reduce:w-full motion-reduce:shrink motion-reduce:flex-wrap motion-reduce:justify-center motion-reduce:gap-y-6', copy && 'motion-reduce:hidden')}
      // The copy is half of what passes under the pointer, so its links work too; readers and the keyboard meet the list once.
      aria-hidden={copy || undefined}
    >
      {CUSTOMERS.map((customer) => (
        <li key={customer.name} className="flex h-10 shrink-0 items-center pr-12 sm:pr-16">
          <CustomerLink customer={customer} focusable={!copy} />
        </li>
      ))}
    </ul>
  );
}

function CustomerLink({ customer, focusable }: { readonly customer: Customer; readonly focusable: boolean }) {
  const { logo } = customer;
  return (
    <ExternalLink href={customer.url} tabIndex={focusable ? undefined : -1} className="flex items-center gap-2 text-foreground/65 transition-colors hover:text-foreground">
      <span
        aria-hidden="true"
        className="logo-mask"
        style={{ height: logo.height, width: logo.height * logo.aspect, maskImage: `url(${logo.src})`, WebkitMaskImage: `url(${logo.src})` }}
      />
      <span className={customer.markOnly ? 'text-[1.375rem] leading-none font-semibold tracking-tight' : 'sr-only'}>{customer.name}</span>
    </ExternalLink>
  );
}
