import { fitted, FRAMES, step } from './spinner';
import type { Terminal } from './spinner';

function fake(isTTY: boolean): Terminal & { readonly output: () => string } {
  let text = '';
  return { isTTY, columns: 80, color: false, frames: FRAMES, write: (chunk) => void (text += chunk), output: () => text };
}

describe('fitted', () => {
  it('keeps a label that fits and cuts one that does not to the row, frame and ellipsis included', () => {
    expect(fitted('Downloading', 40)).toBe('Downloading');
    const long = 'Installing build 3312 into /Users/someone/Geld Nightly/Work Profile';
    const cut = fitted(long, 40);
    expect([...cut].length + 3).toBe(40);
    expect(cut.endsWith('…')).toBe(true);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
  });
});

describe('step', () => {
  afterEach(() => vi.useRealTimers());

  it('prints the step once when output is not a terminal', async () => {
    const terminal = fake(false);
    expect(await step(terminal, 'Downloading', () => Promise.resolve(7))).toBe(7);
    expect(terminal.output()).toBe('Downloading…\n');
  });

  it('turns the cut corner while the step runs, then leaves a check', async () => {
    vi.useFakeTimers();
    const terminal = fake(true);
    let finish: (value: string) => void = () => undefined;
    const running = step(terminal, 'Downloading', () => new Promise<string>((resolve) => (finish = resolve)));
    await vi.advanceTimersByTimeAsync(360);
    finish('done');
    expect(await running).toBe('done');
    const output = terminal.output();
    for (const frame of FRAMES) expect(output).toContain(`${frame} Downloading…`);
    expect(output.endsWith('✓ Downloading\n\u001b[?25h')).toBe(true);
  });

  it('never animates a line wider than the terminal, and leaves the whole label when done', async () => {
    vi.useFakeTimers();
    const terminal = { ...fake(true), columns: 30 };
    let output = '';
    const narrow = { ...terminal, write: (chunk: string) => void (output += chunk) };
    const label = 'Installing build 3312 into /home/someone/Geld Nightly/Work';
    let finish: () => void = () => undefined;
    const running = step(narrow, label, () => new Promise<void>((resolve) => (finish = resolve)));
    await vi.advanceTimersByTimeAsync(360);
    finish();
    await running;
    const frames = output.split('\r\u001b[2K').slice(1, -1);
    expect(frames.length).toBeGreaterThan(1);
    for (const frame of frames) expect([...frame].length).toBeLessThanOrEqual(30);
    expect(output).toContain(`✓ ${label}\n`);
  });

  it('leaves a cross and passes the error on when the step fails', async () => {
    const terminal = fake(true);
    await expect(step(terminal, 'Checking', () => Promise.reject(new Error('bad sum')))).rejects.toThrow('bad sum');
    expect(terminal.output()).toContain('✗ Checking\n');
  });
});
