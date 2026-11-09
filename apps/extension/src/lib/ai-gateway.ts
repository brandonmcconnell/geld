/**
 * Optional host permission for the user's OpenAI-compatible gateway.
 * github.com is already granted; api.openai.com (or a custom origin) is not.
 */

import { browser } from 'wxt/browser';

/** Plain http is accepted only for a model served on this computer (Ollama, LM Studio). Mirrored in wxt.config.ts's optional host permissions. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

const NOT_HTTPS = 'AI gateway URL must be https, or http on localhost.';

export function gatewayOriginPattern(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`);
    if (url.protocol === 'https:') return `${url.protocol}//${url.host}/*`;
    // A match pattern without a port covers every port, which is how the manifest declares loopback.
    if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return `http://${url.hostname}/*`;
    return null;
  } catch {
    return null;
  }
}

export async function requestGatewayPermission(baseUrl: string): Promise<string | null> {
  const origin = gatewayOriginPattern(baseUrl);
  if (origin === null) return NOT_HTTPS;
  try {
    if (await browser.permissions.contains({ origins: [origin] })) return null;
    const granted = await browser.permissions.request({ origins: [origin] });
    return granted ? null : 'Allow Geld to contact the AI gateway to load models or rewrite titles.';
  } catch {
    return 'Could not request permission for the AI gateway.';
  }
}

export async function hasGatewayPermission(baseUrl: string): Promise<string | null> {
  const origin = gatewayOriginPattern(baseUrl);
  if (origin === null) return NOT_HTTPS;
  try {
    if (await browser.permissions.contains({ origins: [origin] })) return null;
  } catch {
    return 'Could not check permission for the AI gateway.';
  }
  return 'Allow Geld to contact the AI gateway from the options page.';
}
