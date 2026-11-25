import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolConfig } from 'pg';
import { configured } from './env';

const primaryOptions = { max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 };
const lockOptions = { ...primaryOptions, max: 1 };
const customerOptions = { max: 3, connectionTimeoutMillis: 10000 };
type DatabaseKind = 'primary' | 'lock' | 'customer';
interface WorkerDatabases {
  readonly primary: string | undefined;
  readonly customer: string | undefined;
  readonly pools: Partial<Record<DatabaseKind, Pool>>;
}

const workerDatabases = new AsyncLocalStorage<WorkerDatabases>();
const nodePools: Partial<Record<DatabaseKind, Pool>> = {};

export function withWorkerDatabases(
  primary: string | undefined,
  customer: string | undefined,
  work: (close: () => Promise<void>) => Promise<Response>,
): Promise<Response> {
  const pools: WorkerDatabases['pools'] = {};
  return workerDatabases.run({ primary, customer, pools }, () =>
    work(async () => {
      await Promise.all(Object.values(pools).map((pool) => pool.end()));
    }),
  );
}

function getPool(kind: DatabaseKind, options: PoolConfig, nodeUrl: string | undefined, nodeOptions: PoolConfig = {}) {
  const worker = workerDatabases.getStore();
  if (worker) {
    const connectionString = kind === 'customer' ? worker.customer : worker.primary;
    if (!connectionString) return null;
    return (worker.pools[kind] ??= new Pool({ ...options, connectionString, idleTimeoutMillis: 0 }));
  }
  const connectionString = configured(nodeUrl);
  if (!connectionString) return null;
  return (nodePools[kind] ??= new Pool({ ...options, ...nodeOptions, connectionString }));
}

export function database(): Pool | null {
  return getPool('primary', primaryOptions, process.env.DATABASE_URL, { statement_timeout: 15000 });
}

export function lockDatabase(): Pool | null {
  // Grant locks must not occupy the query connections needed by their own work.
  return getPool('lock', lockOptions, process.env.DATABASE_URL);
}

export function customerContentDatabase(): Pool | null {
  return getPool('customer', customerOptions, process.env.CUSTOMER_CONTENT_DATABASE_URL, {
    ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: true },
  });
}
