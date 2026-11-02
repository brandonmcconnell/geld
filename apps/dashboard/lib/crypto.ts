import 'server-only';
import { configured } from './env';
const encoder = new TextEncoder();
async function encryptionKey(): Promise<CryptoKey> {
  const secret = configured(process.env.TOKEN_ENCRYPTION_KEY);
  if (!secret || secret.length < 32) throw new Error('Credential encryption is not configured');
  return crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest('SHA-256', encoder.encode(secret)),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function encryptCredential(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), encoder.encode(value));
  return `v1.${Buffer.from(iv).toString('base64url')}.${Buffer.from(ciphertext).toString('base64url')}`;
}
export async function decryptCredential(value: string): Promise<string | null> {
  const [version, ivText, ciphertextText, ...rest] = value.split('.');
  if (version !== 'v1' || !ivText || !ciphertextText || rest.length) return null;
  try {
    const iv = Uint8Array.from(Buffer.from(ivText, 'base64url'));
    const ciphertext = Uint8Array.from(Buffer.from(ciphertextText, 'base64url'));
    if (iv.length !== 12) return null;
    return new TextDecoder().decode(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await encryptionKey(), ciphertext),
    );
  } catch {
    return null;
  }
}
