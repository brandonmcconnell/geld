import { BRAVE_FOLDER_FLAG, folderAccessMissing } from './folder-access';

describe('folderAccessMissing', () => {
  it("points Brave to its flag and every browser to the Downloads install", () => {
    expect(folderAccessMissing(true)).toContain(BRAVE_FOLDER_FLAG);
    expect(folderAccessMissing(true)).toContain('--downloads');
    expect(folderAccessMissing(false)).not.toContain('brave://');
    expect(folderAccessMissing(false)).toContain('--downloads');
  });

  it('keeps to the UI copy rules: no em or en dashes and no semicolons', () => {
    for (const text of [folderAccessMissing(true), folderAccessMissing(false)]) expect(text).not.toMatch(/[—–;]/);
  });
});
