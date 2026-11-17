// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { rowDestinationUnder, settleToggledRow } from './row-scroll';

function rowAt(top: number): HTMLElement {
  const row = document.createElement('button');
  row.getBoundingClientRect = () => ({ top, bottom: top + 20, left: 0, right: 0, width: 0, height: 20, x: 0, y: top, toJSON: () => ({}) });
  document.body.append(row);
  return row;
}

describe('settleToggledRow', () => {
  it('leaves a row that is still on screen where it is', () => {
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    expect(settleToggledRow(rowAt(300), () => 60)).toBe(false);
    expect(scroll).not.toHaveBeenCalled();
    scroll.mockRestore();
  });

  it('brings a row carried under the bars back just below them', () => {
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    expect(settleToggledRow(rowAt(-400), () => 60)).toBe(true);
    expect(scroll).toHaveBeenCalledWith({ top: window.scrollY - 400 - 60 - 8, behavior: 'instant' });
    scroll.mockRestore();
  });

  it('puts the row at the top edge where no header stands', () => {
    expect(rowDestinationUnder(1000, () => 0)).toBe(992);
  });
});
