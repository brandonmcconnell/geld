import { looksLikeHtml } from './http';

describe('looksLikeHtml', () => {
  it('trusts the content type first', () => {
    expect(looksLikeHtml('text/html; charset=utf-8', 'categories:\n  tests: true\n')).toBe(true);
    expect(looksLikeHtml('text/plain; charset=utf-8', 'categories:\n  tests: true\n')).toBe(false);
  });

  it('sniffs a document when the type is missing or generic', () => {
    expect(looksLikeHtml(null, '\n<!DOCTYPE html>\n<html lang="en" data-color-mode="auto">')).toBe(true);
    expect(looksLikeHtml('application/octet-stream', '<html><head><meta charset="utf-8">')).toBe(true);
    expect(looksLikeHtml(null, '# Geld config\ncategories:\n  tests: true\n')).toBe(false);
  });

  it('does not mistake YAML that mentions HTML for a page', () => {
    expect(looksLikeHtml('text/plain', 'categoryPatterns:\n  generated:\n    - "<html>.snap"\n')).toBe(false);
  });
});
