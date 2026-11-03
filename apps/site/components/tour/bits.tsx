import { cn } from 'cn';

/** GitHub's pull request state colours; one set for both schemes, as GitHub's labels are. */
export const STATE_COLOR = {
  open: 'bg-[#1f883d] text-white',
  draft: 'bg-[#6e7781] text-white',
  merged: 'bg-[#8250df] text-white',
  closed: 'bg-[#cf222e] text-white',
} as const;

export type PrState = keyof typeof STATE_COLOR;

const PEOPLE = {
  octocat: 'bg-[oklch(0.72_0.12_250)]',
  mona: 'bg-[oklch(0.75_0.13_330)]',
  hubot: 'bg-[oklch(0.78_0.12_80)]',
  you: 'bg-[oklch(0.7_0.11_160)]',
} as const;

export type Person = keyof typeof PEOPLE;

/** A person's round picture: a tinted disc with their initial, so no faces are borrowed. */
export function Avatar({ who, size = 20, className }: { readonly who: Person; readonly size?: number; readonly className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold text-white uppercase ring-2 ring-card', PEOPLE[who], className)}
      style={{ width: size, height: size, fontSize: size * 0.48 }}
    >
      {who[0]}
    </span>
  );
}

const BOTS = {
  bugbot: { name: 'Bugbot', className: 'bg-[#14120b] text-white dark:bg-white dark:text-[#14120b]', glyph: 'B' },
  coderabbit: { name: 'CodeRabbit', className: 'bg-[#ff570a] text-white', glyph: 'C' },
  greptile: { name: 'Greptile', className: 'bg-[#22c55e] text-white', glyph: 'G' },
  devin: { name: 'Devin', className: 'bg-[#0294de] text-white', glyph: 'D' },
  copilot: { name: 'Copilot', className: 'bg-[#8250df] text-white', glyph: 'C' },
} as const;

export type BotId = keyof typeof BOTS;

export function botName(bot: BotId): string {
  return BOTS[bot].name;
}

/** A bot's square mark, the shape GitHub gives App avatars. */
export function BotMark({ bot, size = 18, className }: { readonly bot: BotId; readonly size?: number; readonly className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-grid shrink-0 place-items-center rounded-[4px] font-bold', BOTS[bot].className, className)}
      style={{ width: size, height: size, fontSize: size * 0.55 }}
    >
      {BOTS[bot].glyph}
    </span>
  );
}

/** A thin resolution meter, as the digest draws its rounds. */
export function Meter({ done, total, className }: { readonly done: number; readonly total: number; readonly className?: string }) {
  return (
    <span aria-hidden="true" className={cn('inline-block h-1.5 w-14 overflow-hidden rounded-full bg-neutral-block', className)}>
      <span className="block h-full rounded-full bg-addition transition-[width] duration-500" style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }} />
    </span>
  );
}

/** A pill in the digest's status rows: outlined, mark first, then words, then a light. */
export function Chip({ children, className, dashed = false }: { readonly children: React.ReactNode; readonly className?: string; readonly dashed?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border bg-card pr-2 pl-1 text-xs whitespace-nowrap',
        dashed && 'border-dashed',
        className,
      )}
    >
      {children}
    </span>
  );
}
