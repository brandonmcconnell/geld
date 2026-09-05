/** Build-time environment (from `.env` files; WXT exposes `WXT_*` keys). */
interface ImportMetaEnv {
  /** Public client id of the GitHub OAuth App used for sign-in (device flow). */
  readonly WXT_GITHUB_CLIENT_ID?: string;
}
