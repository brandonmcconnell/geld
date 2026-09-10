/**
 * @geld/github — everything Geld needs to talk to GitHub on a user's behalf
 * through the Geld GitHub App, shared by the extension and the website:
 * authorization flows, token refresh, and (to come) the search / pull request
 * clients behind the dashboard. Pure TypeScript; each home supplies storage
 * and, in tests, `fetch`.
 */
export * from './auth';
