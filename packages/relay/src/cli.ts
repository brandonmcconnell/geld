import { z } from 'zod';
import { databaseChannelResolver } from './database';
import { createRelayBroker } from './broker';
import { pollConnector } from './client';
async function main() {
  const mode = process.argv[2];
  if (mode === 'broker') {
    const channels = z
      .array(
        z.object({
          id: z.string(),
          secret: z.string().min(32),
          host: z.string(),
          kind: z.enum(['github', 'claude']).default('github'),
        }),
      )
      .parse(JSON.parse(process.env.RELAY_CHANNELS ?? '[]'));
    const resolver = databaseChannelResolver();
    if (!resolver && !channels.length) throw new Error('Configure the relay database or static channels');
    const broker = createRelayBroker(channels, resolver ?? undefined);
    broker.server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
    process.once('SIGTERM', () => broker.close());
    process.once('SIGINT', () => broker.close());
  } else if (mode === 'connector') {
    const config = z
      .object({
        url: z.url(),
        channel: z.string(),
        secret: z.string().min(32),
        host: z.string(),
      })
      .parse({
        url: process.env.RELAY_BROKER_URL,
        channel: process.env.RELAY_CHANNEL_ID,
        secret: process.env.RELAY_SECRET,
        host: process.env.ENTERPRISE_HOST,
      });
    const abort = new AbortController();
    process.once('SIGTERM', () => abort.abort());
    process.once('SIGINT', () => abort.abort());
    await pollConnector(
      { ...config, allowHttp: process.env.RELAY_ALLOW_HTTP === 'true' },
      config.host,
      (request) =>
        fetch(request.url, {
          method: request.method,
          headers: request.headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(30000),
          ...(request.body !== undefined ? { body: request.body } : {}),
        }),
      abort.signal,
    );
  } else {
    process.stderr.write('Usage: geld-relay broker|connector\n');
    process.exitCode = 1;
  }
}
void main().catch(() => {
  process.stderr.write('The relay could not start. Check its configuration.\n');
  process.exitCode = 1;
});
