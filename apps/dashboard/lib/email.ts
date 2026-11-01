import 'server-only';
import { configured } from './env';
export async function sendEmail(to: string, subject: string, text: string, idempotencyKey?:string): Promise<void> {
  const key = configured(process.env.EMAIL_API_KEY);
  const from = configured(process.env.EMAIL_FROM);
  if (!key || !from) throw new Error('Email delivery is not configured');
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{}) }, body: JSON.stringify({ from, to: [to], subject, text }), redirect: 'error' });
  if (!response.ok) throw new Error('Email delivery is temporarily unavailable');
}
