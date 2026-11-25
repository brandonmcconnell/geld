import app from 'vinext/server/app-router-entry';
import { withWorkerDatabases } from '../lib/db';

type AppBindings = NonNullable<Parameters<typeof app.fetch>[1]>;
type AppContext = NonNullable<Parameters<typeof app.fetch>[2]>;
interface DashboardBindings extends AppBindings {
  GELD_DATABASE?: { connectionString: string };
  GELD_CUSTOMER_CONTENT_DATABASE?: { connectionString: string };
}

const worker = {
  fetch(request: Request, env: DashboardBindings, ctx: AppContext): Promise<Response> {
    const primary = env.GELD_DATABASE?.connectionString;
    const customer = env.GELD_CUSTOMER_CONTENT_DATABASE?.connectionString;
    return withWorkerDatabases(primary, customer, async (close) => {
      let response: Response;
      try {
        response = await app.fetch(request, env, ctx);
      } catch (error) {
        ctx.waitUntil(close());
        throw error;
      }

      if (!primary && !customer) return response;
      if (!response.body) {
        ctx.waitUntil(close());
        return response;
      }

      // RSC can query after the response headers have been sent.
      const { readable, writable } = new TransformStream<Uint8Array>();
      ctx.waitUntil(response.body.pipeTo(writable).catch(() => undefined).finally(close));
      return new Response(readable, response);
    });
  },
};

export default worker;
