import { createInterface } from 'node:readline/promises';

/** Questions on the terminal. Without one (a pipe, CI) every question takes its default and nothing waits. */

export const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;

export async function ask(question: string, fallback: string): Promise<string> {
  if (!interactive) return fallback;
  const lines = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await lines.question(question)).trim();
    return answer === '' ? fallback : answer;
  } finally {
    lines.close();
  }
}

export async function confirm(question: string, fallback: boolean): Promise<boolean> {
  const answer = await ask(`${question} ${fallback ? '[Y/n]' : '[y/N]'} `, fallback ? 'y' : 'n');
  return /^y(es)?$/i.test(answer);
}

/** Picks from a numbered list: "1,3", "2-4", "all", or Enter for the default. */
export function parseChoice(answer: string, count: number): number[] | null {
  const text = answer.trim().toLowerCase();
  if (text === 'all') return Array.from({ length: count }, (_, index) => index);
  const picked = new Set<number>();
  for (const part of text.split(/[\s,]+/).filter((piece) => piece !== '')) {
    const range = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (range === null) return null;
    const from = Number(range[1]);
    const to = Number(range[2] ?? range[1]);
    if (from < 1 || to > count || from > to) return null;
    for (let n = from; n <= to; n++) picked.add(n - 1);
  }
  return picked.size === 0 ? null : [...picked].sort((a, b) => a - b);
}
