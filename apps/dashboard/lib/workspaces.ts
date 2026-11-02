import 'server-only';
import { z } from 'zod';
import { database } from './db';
import { appendAudit } from './audit';
import { transaction } from './transactions';
export const teamRowSchema = z.object({ id: z.string(), name: z.string(), role: z.enum(['admin','member']), managed_access: z.boolean(), sync_enabled: z.boolean(), add_approval: z.boolean(), visibility: z.enum(['names','request','count','none']), tier: z.enum(['free','starter','team','business','enterprise']), seats: z.number(), used_credits: z.number(), cap_cents: z.number(), spent_cents: z.number(), card_on_file: z.boolean() });
export async function ensurePersonalWorkspace(user: { readonly id: string; readonly name: string }): Promise<void> {
  const db = database();
  if (!db) return;
  await transaction(db, async (sql) => {
    const row = await sql.query('INSERT INTO teams(id,name,created_by,personal_owner_id) VALUES ($1,$2,$3,$3) ON CONFLICT(personal_owner_id) DO NOTHING RETURNING id', [crypto.randomUUID(), `${user.name || 'Your'} workspace`, user.id]);
    const team = z.object({ id: z.string() }).parse(row.rows[0] ?? (await sql.query('SELECT id FROM teams WHERE personal_owner_id = $1', [user.id])).rows[0]);
    if (row.rows.length) await appendAudit(sql, { teamId: team.id, actorId: user.id, action: 'team.create_personal', resourceType: 'team', resourceId: team.id, outcome: 'success' });
    await sql.query('INSERT INTO team_members(team_id,user_id,role) VALUES ($1,$2,\'admin\') ON CONFLICT DO NOTHING', [team.id, user.id]);
    await sql.query('INSERT INTO subscriptions(team_id) VALUES ($1) ON CONFLICT DO NOTHING', [team.id]);
    await sql.query('INSERT INTO ai_providers(id,user_id,provider,label,enabled,settings) VALUES ($1,$2,\'geld\',\'Geld\',true,\'{"billed":true,"models":[],"automaticLadder":true}\') ON CONFLICT(user_id) WHERE provider = \'geld\' DO NOTHING', [crypto.randomUUID(), user.id]);
  });
}
export async function listTeams(userId: string) {
  const db = database();
  if (!db) return [];
  const result = await db.query('SELECT t.id,t.name,m.role,t.managed_access,t.sync_enabled,t.add_approval,t.visibility,s.tier,s.seats,s.used_credits,s.cap_cents,s.spent_cents,s.card_on_file FROM teams t JOIN team_members m ON m.team_id = t.id JOIN subscriptions s ON s.team_id = t.id WHERE m.user_id = $1 ORDER BY t.created_at', [userId]);
  return z.array(teamRowSchema).parse(result.rows);
}
export async function teamMembership(userId: string, teamId: string, admin = false): Promise<boolean> {
  const db = database();
  if (!db) return false;
  const result = await db.query('SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
  const member = z.object({ role: z.enum(['admin','member']) }).safeParse(result.rows[0]);
  return member.success && (!admin || member.data.role === 'admin');
}
