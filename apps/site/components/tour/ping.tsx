import { cn } from 'cn';

/**
 * Draws the eye to a scene's main control. It fades out once the reader first
 * presses a control in the scene (`data-used` on the window, `ping-fade` in
 * globals.css), so nothing here holds state. `inset` pings inward, for a row
 * that spans its frame. The ring's shape is the wrapper's: give `className`
 * its display and radius.
 */
export function Ping({
  on = true,
  inset = false,
  tone = 'text-foreground',
  className = 'inline-flex',
  children,
}: {
  readonly on?: boolean;
  readonly inset?: boolean;
  readonly tone?: string;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <span className={cn('relative', className)}>
      {children}
      {on ? (
        <span aria-hidden="true" className="ping-fade pointer-events-none absolute inset-0 rounded-[inherit]">
          <span className={cn('ping-ring absolute inset-0 rounded-[inherit]', inset ? 'motion-safe:animate-ping-ring-inset' : 'motion-safe:animate-ping-ring', tone)} />
        </span>
      ) : null}
    </span>
  );
}
