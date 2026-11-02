import 'server-only';
import { z } from 'zod';
import { applyRepoConfigs, DEFAULT_SETTINGS, generatedConfigFrom, parseRepoConfig, validateSettingsDocument } from '@geld/core';
import type { IssueTrackerConfig, GeldSettings, RepoConfig } from '@geld/core';
import type { TokenSource } from '@geld/github';
import { createApiTransport } from '@geld/github';
import { REVIEW_BOTS } from '@geld/review/bots';
import type { RepositoryRef } from '@geld/domain';
import { currentActor, providerTokenSource } from './session';
import { database } from './db';
import { demoEnabled } from './env';
export async function reviewSettings(ref: RepositoryRef, background?: {readonly source:TokenSource;readonly userId:string;readonly organisationSource?:TokenSource;readonly organisationComplete?:boolean}): Promise<{ readonly settings: GeldSettings; readonly warning: string | null; readonly aiAllowed: boolean;readonly issueTracker:IssueTrackerConfig|null }> {
  if (demoEnabled()) return { settings: DEFAULT_SETTINGS, warning: null, aiAllowed: true,issueTracker:null };
  let settings = DEFAULT_SETTINGS;
  let warning: string | null = null;
  const actor = background ? {id:background.userId} : await currentActor();
  const db = database();
  if (actor && db) {
    const row = await db.query('SELECT settings FROM users WHERE id = $1', [actor.id]);
    const parsed = z.object({ settings: z.unknown() }).safeParse(row.rows[0]);
    if (parsed.success && parsed.data.settings && typeof parsed.data.settings === 'object' && Object.keys(parsed.data.settings).length) {
      const validated = validateSettingsDocument(JSON.stringify(parsed.data.settings));
      if (validated.ok) settings = validated.settings;
      else warning = 'Your saved review settings contain invalid values. Default rules are in use.';
    }
  }
  let issueTracker=settings.issueTracker;
  let aiAllowed = true;
  const source = background?.source ?? await providerTokenSource(ref.provider,ref.owner);
  const api = createApiTransport({ baseUrl: ref.provider === 'github' ? 'https://api.github.com/' : ref.provider === 'gitlab' ? 'https://gitlab.com/api/v4/' : 'https://api.bitbucket.org/2.0/', source, anonymousReads: true });
  const organisationApi = createApiTransport({ baseUrl: ref.provider === 'github' ? 'https://api.github.com/' : ref.provider === 'gitlab' ? 'https://gitlab.com/api/v4/' : 'https://api.bitbucket.org/2.0/', source: background?.organisationSource ?? source });
  const pausePolicy = () => { warning = 'Some repository rules could not be loaded. AI processing is paused until their policy can be read.'; aiAllowed = false; };
  const readFile = async (owner: string, repo: string, path: string, organisation = false): Promise<string | null> => {
    const endpoint = ref.provider === 'github' ? `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}` : ref.provider === 'gitlab' ? `projects/${encodeURIComponent(`${owner}/${repo}`)}/repository/files/${encodeURIComponent(path)}/raw?ref=HEAD` : `repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/src/HEAD/${path}`;
    if (organisation) {
      const repositoryEndpoint = ref.provider === 'github' ? `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` : ref.provider === 'gitlab' ? `projects/${encodeURIComponent(`${owner}/${repo}`)}` : `repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
      const accessible = await organisationApi.request(repositoryEndpoint);
      if (!accessible.ok) {
        if (accessible.reason !== 'not_found' || !background?.organisationComplete) pausePolicy();
        return null;
      }
    }
    const result = await (organisation ? organisationApi : api).request(endpoint, { text: true, ...(ref.provider === 'github' ? { accept: 'application/vnd.github.raw+json' } : {}) });
    if (!result.ok) { if (result.reason !== 'not_found') { warning = 'Some repository rules could not be loaded. AI processing is paused until their policy can be read.'; aiAllowed = false; } return null; }
    if (typeof result.value !== 'string' || Buffer.byteLength(result.value, 'utf8') >= 100000) { warning = 'Some repository rules could not be loaded. AI processing is paused until their policy can be read.'; aiAllowed = false; return null; }
    return result.value;
  };
  const [org, repo, attributes] = await Promise.all([readFile(ref.owner, '.github', 'geld.yml', true), readFile(ref.owner, ref.repo, '.github/geld.yml'), readFile(ref.owner, ref.repo, '.gitattributes')]);
  const configs: RepoConfig[] = [];
  for (const text of [org, repo]) if (text) {
    const parsed = parseRepoConfig(text, undefined, REVIEW_BOTS.map((bot) => bot.id));
    if (parsed.ok) { configs.push(parsed.config); if(settings.repoConfigs!=='never'&&parsed.config.issueTracker)issueTracker=parsed.config.issueTracker; if (parsed.config.review?.ai === false) aiAllowed = false; }
    else { warning = 'A repository configuration is invalid. AI processing is paused until it is fixed.'; aiAllowed = false; }
  }
  if (attributes) configs.push(generatedConfigFrom(attributes));
  return { settings: settings.repoConfigs === 'never' ? settings : applyRepoConfigs(settings, configs), warning, aiAllowed,issueTracker };
}
