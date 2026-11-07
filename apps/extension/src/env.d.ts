/** Build-time environment (from `.env` files; WXT exposes `WXT_*` keys). */
interface ImportMetaEnv {
  /** Public client id of the Geld GitHub App, used for sign-in (device flow). */
  readonly WXT_GELD_APP_CLIENT_ID?: string;
  /** Public client id of the Geld Slack app (PKCE on), used for Connect Slack. */
  readonly WXT_GELD_SLACK_CLIENT_ID?: string;
}
