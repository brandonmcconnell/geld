import { connection } from 'next/server';
import { configured } from '@/lib/env';
import { json } from '@/lib/http';
/** Public project configuration is read at runtime, after the browser records consent. */
export async function GET(): Promise<Response> {
  await connection();
  const environment = process.env;
  const key = configured(environment.NEXT_PUBLIC_POSTHOG_KEY);
  const host = configured(environment.NEXT_PUBLIC_POSTHOG_HOST) ?? 'https://us.i.posthog.com';
  try {
    const url = new URL(host);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      return json({ config: null });
    return json({ config: key ? { key, host: url.href.replace(/\/$/, '') } : null });
  } catch {
    return json({ config: null });
  }
}
