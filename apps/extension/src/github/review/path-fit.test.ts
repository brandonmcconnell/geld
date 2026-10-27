import { describe, expect, it } from 'vitest';
import { fitPath } from './path-fit';

// One unit per character: widths are lengths.
const measure = (text: string): number => text.length;
const PATH = 'apps/dashboard/components/content-editor/TiptapEditor/Extensions/CustomComponent/MentionFormat.ts';

describe('fitPath', () => {
  it('leaves a path alone when it fits', () => {
    expect(fitPath(PATH, PATH.length, measure)).toBe(PATH);
    expect(fitPath('a/b.ts', 100, measure)).toBe('a/b.ts');
  });

  it('keeps the file name and the start, marks the gap once', () => {
    const fitted = fitPath(PATH, 60, measure);
    expect(fitted.endsWith('/MentionFormat.ts')).toBe(true);
    expect(fitted.startsWith('apps/dashboard/')).toBe(true);
    expect(fitted.split('…').length).toBe(2);
    expect(fitted.length).toBeLessThanOrEqual(60);
  });

  it('prefers more segments, keeps the file\'s directory, then fills from the start', () => {
    expect(fitPath('aa/bb/cc/dd/file.ts', 'aa/…/dd/file.ts'.length, measure)).toBe('aa/…/dd/file.ts');
    expect(fitPath('aa/bb/cc/dd/file.ts', 'aa/bb/…/dd/file.ts'.length, measure)).toBe('aa/bb/…/dd/file.ts');
    expect(fitPath('aa/bb/cc/dd/ee/file.ts', 'aa/bb/cc/…/ee/file.ts'.length, measure)).toBe('aa/bb/cc/…/ee/file.ts');
  });

  it('falls back to the file name alone', () => {
    expect(fitPath(PATH, 20, measure)).toBe('…/MentionFormat.ts');
    expect(fitPath(PATH, 5, measure)).toBe('…/MentionFormat.ts');
  });
});
