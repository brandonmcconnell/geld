/** Export only bounded state from a prior options-only permission diagnostic. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readEvidenceFile, EVIDENCE_LIMITS } from './provider-evidence.mjs';

const providers = new Set(['gitlab', 'bitbucket']);
const origins = new Set(['https://gitlab.com/*', 'https://bitbucket.org/*', 'https://api.bitbucket.org/*']);
const scripts = new Set(['geld-gitlab', 'geld-bitbucket', 'geld-bitbucket-main']);
const phases = new Set(['permission_request', 'worker_registration', 'state_unavailable', 'unexpected_permission_scope']);
const statuses = new Set(['running', 'passed', 'failed', 'unavailable']);
const count = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 10_000) : null;
function state(value) {
  if (!value || typeof value !== 'object') return null;
  return { granted: value.granted === true, origins: Array.isArray(value.origins) ? value.origins.filter(origin => origins.has(origin)).slice(0, 3) : [],
    scripts: Array.isArray(value.scripts) ? value.scripts.filter(script => scripts.has(script?.id)).slice(0, 3).map(script => ({ id: script.id, count: count(script.count), documentStart: script.documentStart === true, expectedWorld: script.expectedWorld === true, expectedFile: script.expectedFile === true, expectedHosts: script.expectedHosts === true })) : [] };
}
export function accessEvidenceSummary(report, raw) {
  if (report?.schema !== 1 || report.focus !== 'provider-access' || !Array.isArray(report.infrastructureErrors)) throw Error('ACCESS_EVIDENCE_REPORT');
  const value = report.providerAccessVerification;
  if (!value || typeof value !== 'object') throw Error('ACCESS_EVIDENCE_REPORT');
  return { schema: 1, sourceFocus: 'provider-access', reportBytes: raw.length, reportSha256: createHash('sha256').update(raw).digest('hex'),
    providerAccessVerification: { status: statuses.has(value.status) ? value.status : 'unknown',
      clicks: Array.isArray(value.clicks) ? value.clicks.filter(click => providers.has(click?.provider)).slice(0, 2).map(click => ({ provider: click.provider, pointerClick: click.pointerClick === true, trusted: click.trusted === true, acknowledged: click.acknowledged === true, pendingPhase: phases.has(click.pendingPhase) ? click.pendingPhase : null, grantScopeValid: typeof click.grantScopeValid === 'boolean' ? click.grantScopeValid : null, before: state(click.before), after: state(click.after),
        confirmation: click.confirmation ? { status: ['confirmed', 'already_granted', 'unavailable'].includes(click.confirmation.status) ? click.confirmation.status : 'unknown', method: click.confirmation.method === 'owned_native_atspi_allow' ? click.confirmation.method : null } : null })) : [] },
    infrastructureErrors: report.infrastructureErrors.slice(0, 16).map(error => typeof error === 'string' ? error.slice(0, 2000) : 'NON_STRING_INFRASTRUCTURE_ERROR'),
    truncated: report.infrastructureErrors.length > 16 || report.infrastructureErrors.some(error => typeof error === 'string' && error.length > 2000) || (value.clicks?.length ?? 0) > 2,
    providerRequests: 0, browserStarted: false };
}
export async function exportProviderAccessEvidence(directory = resolve('.browser-previous-evidence'), write = line => process.stdout.write(line + '\n')) {
  const raw = await readEvidenceFile(directory, 'report.json', EVIDENCE_LIMITS.report);
  if (raw === null) throw Error('ACCESS_EVIDENCE_REPORT');
  let report;
  try { report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { throw Error('ACCESS_EVIDENCE_REPORT'); }
  write(`GELD_PROVIDER_ACCESS_EVIDENCE ${JSON.stringify(accessEvidenceSummary(report, raw))}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { if (process.argv.length !== 2) throw Error('ACCESS_EVIDENCE_ARGUMENTS');await exportProviderAccessEvidence(); }
  catch (error) { process.stderr.write(`GELD_PROVIDER_ACCESS_EVIDENCE_FAILED ${error?.message === 'ACCESS_EVIDENCE_ARGUMENTS' ? 'ARGUMENTS' : 'REPORT'}\n`);process.exitCode = 1; }
}
