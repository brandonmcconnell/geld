/**
 * Global Privacy Control, which Firefox, Brave and some extensions send: a refusal of anything optional, whatever the
 * settings say. Read wherever Geld decides to send (the error and usage uplinks) as well as where it asks (the privacy
 * prompt and the options switches), so no path sends what the browser refused. Workers expose it too.
 */
export function globalPrivacyRefused(): boolean {
  return typeof navigator !== 'undefined' && 'globalPrivacyControl' in navigator && navigator.globalPrivacyControl === true;
}
