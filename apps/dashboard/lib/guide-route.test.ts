import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlExecutor } from './transactions';
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('./request-audit', () => ({
  auditedRoute: <T extends unknown[]>(handler: (request: Request, ...rest: T) => Promise<Response>) => handler,
}));
vi.mock('./session', () => ({ currentActor: async () => ({ id: 'u' }) }));
let db: PGlite;
let afterGeneration: () => Promise<void> = async () => undefined;
let lostReply = false;
vi.mock('./db', () => ({
  database: () => ({
    query: (text: string, values?: unknown[]) => db.query(text, values),
    connect: async () => ({
      query: (text: string, values?: unknown[]) => db.query(text, values),
      release: () => undefined,
    }),
  }),
}));
vi.mock('./review-context', () => ({
  reviewContext: async () => ({
    ok: true,
    value: { aiAllowed: true, pull: { headSha: 'head', state: 'open' }, files: [] },
  }),
}));
vi.mock('./providers', () => ({
  providerClient: async () => ({ pull: async () => ({ ok: true, value: { headSha: 'head', state: 'open' } }) }),
}));
vi.mock('./ai-config', () => ({
  aiConfigurations: async () => [{ id: 'ai', fallback: true }],
  completeConfigured: async () => undefined,
}));
vi.mock('@geld/review/planner', () => ({
  planReview: async () => {
    await afterGeneration();
    return {
      ok: true,
      plan: {
        id: 'p',
        headSha: 'head',
        madeAt: '2026-11-01T00:00:00Z',
        producer: 'ai',
        model: 'Fixture',
        steps: [],
        unassigned: [],
        excerpted: false,
      },
    };
  },
}));
vi.mock('./content-store', async (original) => {
  const actual = await original<typeof import('./content-store')>();
  return {
    ...actual,
    contentStore: () => {
      const store = actual.createGeneratedContentStore({
        sql: { query: (text, values) => db.query(text, values) },
        run: (work) => db.transaction((tx) => work({ query: (text, values) => tx.query(text, values) })),
      });
      return {
        ...store,
        put: async (input: Parameters<typeof store.put>[0]) => {
          await store.put(input);
          if (lostReply) throw new Error('Commit response was lost');
        },
      };
    },
  };
});
import { POST, GET } from '../app/api/guides/route';
import { recoverGuideCredits } from './guide-publications';
import { contentStore } from './content-store';
beforeEach(async () => {
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'synthetic-guide-route-key-at-least-32-characters');
  vi.stubEnv('DASHBOARD_ORIGIN', 'https://app.geld.sh');
  vi.stubEnv('GELD_DEMO_MODE', 'false');
  db = new PGlite();
  const directory = new URL('../db/migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort())
    await db.exec(await readFile(new URL(name, directory), 'utf8'));
  await db.exec(
    "INSERT INTO users(id,name,email) VALUES('u','User','user@example.test'); INSERT INTO teams(id,name) VALUES('t','Team'); INSERT INTO team_members(team_id,user_id,role) VALUES('t','u','admin'); INSERT INTO subscriptions(team_id,tier,seats,card_on_file) VALUES('t','starter',1,true); INSERT INTO team_repos(id,team_id,provider,host,external_id,owner,name) VALUES('r','t','github','github.com','1','org','repo')",
  );
  afterGeneration = async () => undefined;
  lostReply = false;
});
afterEach(async () => {
  await db.close();
  vi.unstubAllEnvs();
});
function request() {
  return new Request('https://app.geld.sh/api/guides', {
    method: 'POST',
    headers: { origin: 'https://app.geld.sh', 'content-type': 'application/json' },
    body: JSON.stringify({
      ref: { provider: 'github', host: 'github.com', owner: 'org', repo: 'repo', number: 1 },
      headSha: 'head',
      teamId: 't',
      key: crypto.randomUUID(),
    }),
  });
}
describe('manual guide publication authority and recovery', () => {
  it.each([
    ['frozen team', "UPDATE teams SET deleting_at=now() WHERE id='t'"],
    ['erasing team', "UPDATE teams SET content_erasing_at=now() WHERE id='t'"],
    ['removed member', "DELETE FROM team_members WHERE user_id='u'"],
    ['removed repository', "UPDATE team_repos SET removed_at=now() WHERE id='r'"],
  ])('rejects a %s after generation and refunds without publishing', async (_name, sql) => {
    afterGeneration = async () => {
      await db.exec(sql);
    };
    expect((await POST(request())).status).toBe(503);
    expect((await db.query('SELECT id FROM generated_content')).rows).toEqual([]);
    expect((await db.query('SELECT state FROM credit_reservations')).rows).toEqual([{ state: 'refunded' }]);
    expect((await db.query('SELECT used_credits FROM subscriptions')).rows).toEqual([{ used_credits: 0 }]);
  });
  it('journals before publication and settles an acknowledged save', async () => {
    expect((await POST(request())).status).toBe(200);
    expect((await db.query('SELECT state,fallback,head_sha FROM credit_reservations')).rows).toEqual([
      { state: 'settled', fallback: true, head_sha: 'head' },
    ]);
    expect((await db.query('SELECT reservation_id FROM guide_publications')).rows).toHaveLength(1);
    expect((await db.query('SELECT reservation_id FROM generated_content_receipts')).rows).toHaveLength(1);
  });
  it('recovers a lost save response from its receipt exactly once', async () => {
    lostReply = true;
    expect((await POST(request())).status).toBe(503);
    const reservation = await db.query<{ id: string; state: string }>('SELECT id,state FROM credit_reservations');
    expect(reservation.rows[0]?.state).toBe('settled');
    const id = reservation.rows[0]?.id;
    if (!id) throw new Error('Missing reservation');
    const sql: SqlExecutor = { query: (text, values) => db.query(text, values) };
    await recoverGuideCredits({
      sql,
      run: (work) => db.transaction((tx) => work({ query: (text, values) => tx.query(text, values) })),
      store: contentStore,
      reservationId: id,
    });
    expect((await db.query('SELECT used_credits FROM subscriptions')).rows).toEqual([{ used_credits: 1 }]);
    expect((await db.query('SELECT id FROM generated_content')).rows).toHaveLength(1);
  });
  it('hides an existing guide after deletion is frozen', async () => {
    expect((await POST(request())).status).toBe(200);
    await db.exec("UPDATE teams SET deleting_at=now() WHERE id='t'");
    const response = await GET(
      new Request(
        'https://app.geld.sh/api/guides?provider=github&host=github.com&owner=org&repo=repo&number=1&teamId=t',
      ),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ plan: null });
  });
});
