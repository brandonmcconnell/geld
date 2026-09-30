import { describe, expect, it } from 'vitest';
import { describeBrowser } from './feedback-link';

describe('describeBrowser', () => {
  it('names the browser and the platform from the user agent', () => {
    expect(describeBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.96 Safari/537.36', 'MacIntel')).toBe('Chrome 148 on macOS');
    expect(describeBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0', 'Win32')).toBe('Edge 148 on Windows');
    expect(describeBrowser('Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0', 'Linux x86_64')).toBe('Firefox 133 on Linux');
    expect(describeBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', 'MacIntel')).toBe('Safari 18 on macOS');
    expect(describeBrowser('something else', '')).toBe('');
  });
});
