import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import type { LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';
export function publicAddress(address: string): boolean {
  try {
    return ipaddr.parse(address).range() === 'unicast';
  } catch {
    return false;
  }
}
export async function publicReachableHost(host: string): Promise<boolean> {
  try {
    const addresses = await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every((a) => publicAddress(a.address));
  } catch {
    return false;
  }
}
/** The address is checked inside the actual socket lookup to prevent DNS rebinding. */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  void lookup(hostname, { all: true })
    .then((addresses) => {
      const first = addresses[0];
      if (!first || addresses.some((a) => !publicAddress(a.address))) {
        callback(new Error('Private addresses require the customer relay'), '', 0);
        return;
      }
      if (options.all) callback(null, addresses);
      else callback(null, first.address, first.family);
    })
    .catch(() => callback(new Error('Public host resolution failed'), '', 0));
};
export async function publicHttpsFetch(raw: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    throw new Error('Invalid public HTTPS destination');
  // A managed proxy may resolve differently. Use the relay instead of bypassing it or weakening the address check.
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY)
    throw new Error('A customer relay is required for this environment');
  const headers: Record<string, string> = {};
  for (const [key, value] of new Headers(init.headers)) headers[key] = value;
  return new Promise<Response>((resolve, reject) => {
    const req = request(
      url,
      {
        method: init.method ?? 'GET',
        headers,
        lookup: safeLookup,
        timeout: 8000,
        signal: init.signal ?? undefined,
      },
      (res) => {
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        res.on('data', (value: Uint8Array) => {
          bytes += value.length;
          if (bytes > 12000000) {
            res.destroy();
            reject(new Error('Provider response exceeded its limit'));
          } else chunks.push(value);
        });
        res.on('error', () => reject(new Error('Public provider response failed')));
        res.on('end', () => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers))
            if (typeof value === 'string') responseHeaders.set(key, value);
          const status = res.statusCode ?? 503;
          resolve(
            new Response([204, 304].includes(status) ? null : Buffer.concat(chunks), {
              status,
              headers: responseHeaders,
            }),
          );
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Public provider timed out')));
    req.on('error', () => reject(new Error('Public provider is unreachable')));
    if (typeof init.body === 'string') req.write(init.body);
    req.end();
  });
}
