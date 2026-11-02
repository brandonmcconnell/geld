import 'server-only';
import { z } from 'zod';
import { effectiveGuidePolicy } from '@geld/domain';
import { database } from './db';
export const guidePolicySchema=z.object({trigger:z.enum(['click','created','push']),drafts:z.boolean(),override:z.boolean(),locked:z.boolean()});
export async function guidePolicy(repoId:string,pullNumber?:number){const db=database();if(!db)throw new Error('Policy storage is unavailable');const row=z.object({guide_policy:guidePolicySchema,settings:z.object({guidePolicy:guidePolicySchema.optional()})}).parse((await db.query('SELECT t.guide_policy,r.settings FROM team_repos r JOIN teams t ON t.id=r.team_id WHERE r.id=$1',[repoId])).rows[0]);const pr=pullNumber?z.object({policy:guidePolicySchema}).safeParse((await db.query('SELECT policy FROM guide_overrides WHERE repo_id=$1 AND pull_number=$2',[repoId,pullNumber])).rows[0]):null;return effectiveGuidePolicy([row.guide_policy,...(row.settings.guidePolicy?[row.settings.guidePolicy]:[]),...(pr?.success?[pr.data.policy]:[])]);}
