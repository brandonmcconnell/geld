/**
 * @geld/core — everything Geld knows that does not depend on a browser:
 * which paths are tests (or generated, vendored, ...), how repository rules and
 * settings work, and how to read a unified diff. Consumed by the extension and
 * the website so documentation is rendered from the same source of truth.
 */
export * from './categories';
export * from './diff-parse';
export * from './format';
export * from './glob';
export * from './matcher';
export * from './repo-rules';
export * from './settings';
export * from './test-patterns';
