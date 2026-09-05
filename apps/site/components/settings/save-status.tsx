import { cn } from 'cn';

export type Tone = 'neutral' | 'success' | 'error' | 'pending';

export interface Status {
  readonly message: string;
  readonly tone: Tone;
}

export const NO_STATUS: Status = { message: '', tone: 'neutral' };

/** Subtle inline status ("Saved", "Saving…", validation problems). */
export function SaveStatus({ status, className }: { readonly status: Status; readonly className?: string | undefined }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        'text-xs transition-opacity',
        status.message === '' && 'opacity-0',
        status.tone === 'error' ? 'text-destructive' : status.tone === 'success' ? 'text-addition' : 'text-muted-foreground',
        className,
      )}
    >
      {status.message === '' ? '\u00a0' : status.message}
    </span>
  );
}
