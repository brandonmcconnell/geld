/**
 * Authenticated encryption for the session cookie: AES-256-GCM via WebCrypto,
 * key derived from `AUTH_SECRET` with SHA-256. Output is `v1.<iv>.<ciphertext>`
 * in base64url. Rotating the secret makes every existing cookie unreadable,
 * which simply signs everyone out.
 */

const VERSION = 'v1';
const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function deriveKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const buffer = Buffer.from(text, 'base64url');
  // Copy into a fresh ArrayBuffer: Buffer may sit in a shared pool, which WebCrypto refuses.
  const bytes = new Uint8Array(new ArrayBuffer(buffer.byteLength));
  bytes.set(buffer);
  return bytes;
}

export async function seal(plaintext: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext));
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

/** Decrypts a value produced by {@link seal}; `null` for anything tampered with, expired-key or malformed. */
export async function open(sealed: string, secret: string): Promise<string | null> {
  const [version, ivText, ciphertextText, ...rest] = sealed.split('.');
  if (version !== VERSION || ivText === undefined || ciphertextText === undefined || rest.length > 0) return null;
  const iv = fromBase64Url(ivText);
  const ciphertext = fromBase64Url(ciphertextText);
  if (iv === null || ciphertext === null || iv.byteLength !== IV_BYTES) return null;
  try {
    const key = await deriveKey(secret);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return decoder.decode(plaintext);
  } catch {
    return null;
  }
}

/** Random URL-safe token, for OAuth `state`. */
export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}
