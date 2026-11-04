import { cn } from 'cn';
import { ChevronDownIcon, CopyIcon, Rows3Icon } from 'lucide-react';

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

/** A person's round picture: a tinted disc with their initial, so no faces are borrowed. The initial is set as a bot's mark sets its letter. */
export function Avatar({ who, size = 20, className }: { readonly who: Person; readonly size?: number; readonly className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-bold text-white uppercase ring-2 ring-card', PEOPLE[who], className)}
      style={{ width: size, height: size, fontSize: size * 0.55 }}
    >
      {who[0]}
    </span>
  );
}

const BOTS = {
  buggy: { name: 'Buggy', className: 'bg-[#14120b] text-white dark:bg-white dark:text-[#14120b]', glyph: 'B' },
  codehopper: { name: 'CodeHopper', className: 'bg-[#ff570a] text-white', glyph: 'C' },
  gecko: { name: 'Gecko', className: 'bg-[#22c55e] text-white', glyph: 'G' },
  devlin: { name: 'Devlin', className: 'bg-[#0294de] text-white', glyph: 'D' },
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

/** The end of the digest's Geld row: a scene's own control (Flow's button), then the grouping picker and Copy digest, which no scene uses, greyed and disabled. All 20px tall, so every scene's Geld row is the same height. */
export function GeldRowTools({ children }: { readonly children?: React.ReactNode }) {
  return (
    <span className="ml-auto flex items-center gap-1 text-muted-foreground">
      {children}
      <button type="button" disabled aria-label="Group the digest by type" className="inline-flex h-5 cursor-not-allowed items-center gap-1 rounded-md px-1 opacity-50">
        <Rows3Icon aria-hidden="true" className="size-3.5" />
        type
        <ChevronDownIcon aria-hidden="true" className="size-3" />
      </button>
      <button type="button" disabled aria-label="Copy digest" className="grid size-5 cursor-not-allowed place-items-center rounded-md opacity-50">
        <CopyIcon aria-hidden="true" className="size-3.5" />
      </button>
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

/** A pill in the digest's status rows: outlined, mark first, then words, then a light. A bot's mark (4px corners) sits 3px inside the 1px border, so `square` takes 8px corners, concentric with it. */
export function Chip({ children, className, dashed = false, square = false }: { readonly children: React.ReactNode; readonly className?: string; readonly dashed?: boolean; readonly square?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 border bg-card pr-2 pl-[3px] text-xs whitespace-nowrap',
        square ? 'rounded-[8px]' : 'rounded-full',
        dashed && 'border-dashed',
        className,
      )}
    >
      {children}
    </span>
  );
}
