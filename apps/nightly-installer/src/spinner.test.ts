import { FRAMES, step } from './spinner';
import type { Terminal } from './spinner';

function fake(isTTY: boolean): Terminal & { readonly output: () => string } {
  let text = '';
  return { isTTY, columns: 80, color: false, frames: FRAMES, write: (chunk) => void (text += chunk), output: () => text };
}

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

  it('leaves a cross and passes the error on when the step fails', async () => {
    const terminal = fake(true);
    await expect(step(terminal, 'Checking', () => Promise.reject(new Error('bad sum')))).rejects.toThrow('bad sum');
    expect(terminal.output()).toContain('✗ Checking\n');
  });
});
