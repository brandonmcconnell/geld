import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { verifyWebhook, pullEventSchema } from './webhooks';
describe('webhook boundaries', () => {
  it('requires an exact SHA-256 signature and rejects tampering', () => {
    const secret = crypto.randomUUID();
    const body = JSON.stringify({ repository: { id: 42 } });
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    expect(verifyWebhook(body, signature, secret)).toBe(true);
    expect(verifyWebhook(`${body} `, signature, secret)).toBe(false);
    expect(verifyWebhook(body, 'sha1=bad', secret)).toBe(false);
    expect(verifyWebhook(body, null, secret)).toBe(false);
  });
  it('strips raw repository content from the durable event contract', () => {
    const event = pullEventSchema.parse({
      provider: 'github',
      host: 'github.com',
      repositoryId: '42',
      number: 7,
      headSha: 'sha',
      state: 'open',
      draft: false,
      event: 'push',
      body: 'private description',
      diff: 'private diff',
      comments: ['private comment'],
    });
    expect(Object.keys(event)).not.toContain('body');
    expect(JSON.stringify(event)).not.toContain('private');
  });
});
