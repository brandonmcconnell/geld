import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { reserveCredits, finishCredits } from './credits';
describe('credit reservation transactions', () => {
  it('prevents duplicate billing and refunds a failed request only once', async () => {
    const db = new PGlite();
    for (const name of ['0001_auth.sql','0002_dashboard.sql','0003_review.sql','0004_workspaces.sql','0005_access.sql','0006_apps.sql','0007_automation.sql','0008_trackers.sql','0009_tracker_oauth.sql','0010_enterprise.sql','0011_companion.sql','0012_privacy.sql']) await db.exec(await readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8'));
    await db.exec("INSERT INTO users(id,name,email) VALUES ('u','Reviewer','reviewer@example.test'); INSERT INTO teams(id,name) VALUES ('t','Team'); INSERT INTO team_members(team_id,user_id,role) VALUES ('t','u','admin'); INSERT INTO subscriptions(team_id,tier,seats,used_credits,cap_cents,card_on_file) VALUES ('t','starter',1,39,25,true)");
    const sql = { query: async (text: string, values?: unknown[]) => db.query(text, values) };
    const input = { teamId: 't', actorId: 'u', credits: 2, key: crypto.randomUUID() };
    const result = await reserveCredits(sql, input);
    expect(result.ok).toBe(true);
    expect(await reserveCredits(sql, input)).toEqual({ ok: false, reason: 'duplicate' });
    expect(await reserveCredits(sql, { ...input, key: crypto.randomUUID() })).toEqual({ ok: false, reason: 'cap' });
    expect(await reserveCredits(sql, { ...input, actorId: 'outsider' })).toEqual({ ok: false, reason: 'forbidden' });
    if (result.ok) { await finishCredits(sql, result.id, false); await finishCredits(sql, result.id, false); }
    const subscription = await db.query('SELECT used_credits,spent_cents FROM subscriptions');
    expect(subscription.rows).toEqual([{ used_credits: 39, spent_cents: 0 }]);
    await db.close();
  });
});
