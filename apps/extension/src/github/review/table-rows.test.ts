// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { textWithTableRows } from './crawler';

describe('textWithTableRows', () => {
  it('writes a time in a row as its exact datetime, as the markdown reader does', () => {
    const body = document.createElement('div');
    body.innerHTML = '<table><tr><td>geld-site</td><td><relative-time datetime="2026-11-04T00:26:50.469Z">Nov 4, 2026 12:26am UTC</relative-time></td></tr></table>';
    expect(textWithTableRows(body)).toContain('| geld-site | 2026-11-04T00:26:50.469Z |');
  });
});
