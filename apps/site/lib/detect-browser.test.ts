import { describe, expect, it } from 'vitest';

import { detectBrowser } from './detect-browser';

describe('detectBrowser', () => {
  it('recognises the four supported browsers', () => {
    expect(detectBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0')).toBe('edge');
    expect(detectBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('firefox');
    expect(detectBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36')).toBe('chrome');
    expect(detectBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15')).toBe('safari');
  });

  it('maps iOS variants and unknown agents sensibly', () => {
    expect(detectBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1')).toBe('chrome');
    expect(detectBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/130.0 Mobile/15E148 Safari/605.1.15')).toBe('firefox');
    expect(detectBrowser('curl/8.6.0')).toBe('chrome');
  });
});
