/**
 * The gist format and API calls are shared with geld.sh and live in
 * `@geld/core/gist-sync`; this module only exists so existing imports keep
 * working inside the extension.
 */
export {
  GIST_DESCRIPTION,
  GIST_FILE,
  SignedOutError,
  findSettingsGist,
  readRemote,
  settingsEqual,
  writeRemote,
} from '@geld/core';
export type { RemoteSettings } from '@geld/core';
