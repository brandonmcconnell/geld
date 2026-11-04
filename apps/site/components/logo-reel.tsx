'use client';

import { faPause, faPlay } from '@awesome.me/kit-2e791c163e/icons/sharp/solid';
import { cn } from 'cn';
import type { FocusEvent, PointerEvent, RefObject } from 'react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { ExternalLink } from '@/components/external-link';
import { FaIcon } from '@/components/fa-icon';
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
 * The button shows while the section is hovered or it has keyboard focus, and
 * always on a touch screen, which has no hover to reveal it.
 */
export function LogoReel({ className }: { readonly className?: string }) {
  const view = useRef<HTMLDivElement | null>(null);
  const track = useRef<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  useReelSpeed(track, paused || focused, hovered);
  usePauseOffscreen(view);

  const onFocus = (event: FocusEvent<HTMLDivElement>): void => {
    if (!event.target.matches(':focus-visible')) return;
    setFocused(true);
    if (track.current) bringIntoView(track.current, event.currentTarget, event.target);
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setFocused(false);
  };
  const onPointer = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse') setHovered(event.type === 'pointerenter');
  };

  return (
    <section aria-labelledby="customers-heading" className={cn('group/reel container-wide', className)}>
      <div className="relative mx-auto w-fit">
        <h2 id="customers-heading" className="text-center text-sm text-muted-foreground">
          Used by founders and engineers at
        </h2>
        <button
          type="button"
          onClick={() => setPaused((was) => !was)}
          aria-label={paused ? 'Play logos' : 'Pause logos'}
          title={paused ? 'Play' : 'Pause'}
          className="absolute top-1/2 left-full ml-1 grid size-6 -translate-y-1/2 place-items-center text-muted-foreground opacity-0 outline-none transition-opacity duration-150 ease-out group-hover/reel:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 [@media(hover:none)]:opacity-100 motion-reduce:hidden"
        >
          <FaIcon icon={paused ? faPlay : faPause} className="size-3" />
        </button>
      </div>
      <div ref={view} className="logo-reel mt-6" onFocus={onFocus} onBlur={onBlur} onPointerEnter={onPointer} onPointerLeave={onPointer}>
        <div ref={track} className="flex w-max animate-logo-reel motion-reduce:w-full motion-reduce:animate-none">
          <LogoList />
          <LogoList copy />
        </div>
      </div>
    </section>
  );
}

/** Out of view the window is marked `data-offscreen` and the reel stops there (`logo-reel` in globals.css), taking up again where it left off. */
function usePauseOffscreen(view: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const node = view.current;
    if (node === null) return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (entry !== undefined) node.toggleAttribute('data-offscreen', !entry.isIntersecting);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [view]);
}

/**
 * Only the first copy of the list takes keyboard focus, and it may have slid
 * out of the window, so a focused logo the window does not show whole moves
 * the track (the animation's time) until it stands in the middle, or as near
 * as the track's travel allows.
 */
function bringIntoView(track: HTMLElement, view: HTMLElement, target: Element): void {
  const animation = track.getAnimations()[0];
  const duration = animation?.effect?.getComputedTiming().duration;
  if (animation === undefined || typeof duration !== 'number') return;
  const frame = view.getBoundingClientRect();
  const box = target.getBoundingClientRect();
  if (box.left >= frame.left && box.right <= frame.right) return;
  const half = track.offsetWidth / 2;
  const offset = track.getBoundingClientRect().left - frame.left + (frame.left + frame.width / 2 - (box.left + box.width / 2));
  animation.currentTime = (Math.min(half, Math.max(0, -offset)) / half) * duration;
}

/**
 * Drives the track's CSS animation through its playback rate, so the reel
 * stops where it is rather than jumping. `stopped` takes effect at once;
 * `slowed` eases to a stop and back over `EASE_MS`, a partial change taking
 * its share of that.
 */
function useReelSpeed(track: RefObject<HTMLDivElement | null>, stopped: boolean, slowed: boolean): void {
  const rate = useRef(1);
  // Reduced motion removes the animation, and turning it off makes a new one at full speed, which must be told the state again.
  const reducedMotion = useSyncExternalStore(subscribeToMotion, prefersReducedMotion, () => false);
  useEffect(() => {
    if (reducedMotion) return;
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
  }, [track, stopped, slowed, reducedMotion]);
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION).matches;
}

function subscribeToMotion(change: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
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
    <ExternalLink href={customer.url} tabIndex={focusable ? undefined : -1} className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground">
      <span
        aria-hidden="true"
        className="logo-mask"
        style={{ height: logo.height, width: logo.height * logo.aspect, maskImage: `url(${logo.src})`, WebkitMaskImage: `url(${logo.src})` }}
      />
      <span className={customer.markOnly ? 'text-[1.375rem] leading-none font-semibold tracking-tight' : 'sr-only'}>{customer.name}</span>
    </ExternalLink>
  );
}
