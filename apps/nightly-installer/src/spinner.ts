/**
 * A one-character spinner beside each step: a square with one corner cut, the cut going round, as the logomark
 * cuts its corners. Quadrant blocks, which every terminal fits to the cell. It runs only in a terminal that can
 * draw it; piped output, CI and `TERM=dumb` get the step's line once, as before.
 */

/** The cut corner turning clockwise: upper left, upper right, lower right, lower left. */
export const FRAMES: readonly string[] = ['▟', '▙', '▛', '▜'];
/** The old Windows console's fonts may lack the quadrant blocks. */
export const PLAIN_FRAMES: readonly string[] = ['|', '/', '-', '\\'];
const FRAME_MS = 120;

export interface Terminal {
  readonly isTTY: boolean;
  readonly columns: number;
  readonly color: boolean;
  readonly frames: readonly string[];
  write(text: string): void;
}

export function terminalOf(stream: NodeJS.WriteStream, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Terminal {
  const isTTY = stream.isTTY === true && env['CI'] === undefined && env['TERM'] !== 'dumb';
  const modernWindows = env['WT_SESSION'] !== undefined || env['TERM_PROGRAM'] !== undefined;
  return {
    isTTY,
    // Read on every frame, so a terminal resized mid-step still gets lines that fit.
    get columns() {
      return stream.columns ?? 80;
    },
    color: isTTY && env['NO_COLOR'] === undefined && (stream.hasColors?.() ?? false),
    frames: platform === 'win32' && !modernWindows ? PLAIN_FRAMES : FRAMES,
    write: (text) => void stream.write(text),
  };
}

const paint = (on: boolean, code: number, text: string): string => (on ? `\u001b[${code}m${text}\u001b[39m` : text);

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const ZERO_WIDTH = /^[\p{M}\p{Cf}]+$/u;
const EMOJI = /\p{Emoji_Presentation}|\u{FE0F}/u;

/** East Asian Wide and Fullwidth blocks, which terminals draw two cells wide. */
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

function graphemeCells(grapheme: string): number {
  if (ZERO_WIDTH.test(grapheme)) return 0;
  return EMOJI.test(grapheme) || isWide(grapheme.codePointAt(0) ?? 0) ? 2 : 1;
}

/** How many terminal cells `text` takes: a CJK character or an emoji takes two, a combining mark none. */
export function cells(text: string): number {
  let total = 0;
  for (const { segment } of graphemes.segment(text)) total += graphemeCells(segment);
  return total;
}

/**
 * The animated line cut to one row: each frame clears only the row it is on, so a line that wrapped would leave
 * a fragment behind every frame. The frame, its space and the trailing ellipsis take three cells.
 */
export function fitted(label: string, columns: number): string {
  const room = Math.max(1, columns - 3);
  if (cells(label) <= room) return label;
  let kept = '';
  let used = 0;
  for (const { segment } of graphemes.segment(label)) {
    const width = graphemeCells(segment);
    if (used + width > room - 1) break;
    kept += segment;
    used += width;
  }
  return `${kept}…`;
}

/** Runs `run` with `label` beside a spinner, then leaves "✓ label" or "✗ label" in its place, written once and whole. */
export async function step<T>(terminal: Terminal, label: string, run: () => Promise<T>): Promise<T> {
  if (!terminal.isTTY) {
    terminal.write(`${label}…\n`);
    return run();
  }
  let frame = 0;
  const draw = (): void =>
    terminal.write(`\r\u001b[2K${paint(terminal.color, 36, terminal.frames[frame % terminal.frames.length] ?? '')} ${fitted(label, terminal.columns)}…`);
  terminal.write('\u001b[?25l');
  const restore = (): void => terminal.write('\u001b[?25h');
  // Ctrl+C ends the process without an exit event, which would leave the cursor hidden.
  const interrupted = (): void => {
    restore();
    terminal.write('\n');
    process.exit(130);
  };
  process.once('exit', restore);
  process.once('SIGINT', interrupted);
  draw();
  const timer = setInterval(() => {
    frame++;
    draw();
  }, FRAME_MS);
  try {
    const result = await run();
    terminal.write(`\r\u001b[2K${paint(terminal.color, 32, '✓')} ${label}\n`);
    return result;
  } catch (error) {
    terminal.write(`\r\u001b[2K${paint(terminal.color, 31, '✗')} ${label}\n`);
    throw error;
  } finally {
    clearInterval(timer);
    restore();
    process.off('exit', restore);
    process.off('SIGINT', interrupted);
  }
}
