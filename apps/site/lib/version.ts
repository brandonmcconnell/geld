import extensionPackage from '../../extension/package.json';

/**
 * The extension version, read from `apps/extension/package.json` so the site
 * can never announce a version that does not exist.
 */
export const EXTENSION_VERSION: string = extensionPackage.version;
