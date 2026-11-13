// Send a build of the Mac app to TestFlight's external groups.
//
//   node asc-testflight-distribute.mjs <bundle-id> <marketing-version> <build-number> <groups> [what-to-test-file]
//
// Whoever uploaded the build (testflight.yml, or publish.yml's App Store job), this makes sure it carries its What to
// Test notes, is in each named external group (comma-separated) and has been submitted to TestFlight App Review,
// doing only what is not done yet, so a later run repeats nothing. It waits up to 40 minutes for Apple to finish
// processing a build it has just been given.
//
// Prints "sent", "already" (every step was done before), "refused <reason>" when Apple would not take the review
// submission (one already running, the six-a-day limit) or "missing" when App Store Connect has no such build, and
// exits 0; any other failure exits 1.
//
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY (base64 .p8).
import { readFileSync } from 'node:fs';
import { api, appIdFor } from './asc-api.mjs';

const [bundleId, marketingVersion, buildNumber, groupList, notesFile] = process.argv.slice(2);
if (!bundleId || !marketingVersion || !buildNumber || !groupList) {
  throw new Error('usage: asc-testflight-distribute.mjs <bundle-id> <marketing-version> <build-number> <groups> [what-to-test-file]');
}
const groupNames = groupList.split(',').map((name) => name.trim()).filter((name) => name !== '');
const whatToTest = notesFile === undefined ? '' : readFileSync(notesFile, 'utf8').trim().slice(0, 3800);

const app = await appIdFor(bundleId);
const findBuild = async () =>
  (
    await api(
      `/builds?filter[app]=${app}&filter[version]=${encodeURIComponent(buildNumber)}&filter[preReleaseVersion.version]=${encodeURIComponent(marketingVersion)}&filter[preReleaseVersion.platform]=MAC_OS&fields[builds]=processingState,usesNonExemptEncryption&limit=1`,
    )
  ).data?.[0];

let build = await findBuild();
if (build === undefined) {
  console.log('missing');
  process.exit(0);
}
for (let waited = 0; build.attributes.processingState === 'PROCESSING' && waited < 40 * 60; waited += 30) {
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  build = (await findBuild()) ?? build;
}
if (build.attributes.processingState !== 'VALID') throw new Error(`build ${marketingVersion} (${buildNumber}) is ${build.attributes.processingState}`);

let changed = false;

if (build.attributes.usesNonExemptEncryption === null || build.attributes.usesNonExemptEncryption === undefined) {
  await api(`/builds/${build.id}`, { method: 'PATCH', body: { data: { type: 'builds', id: build.id, attributes: { usesNonExemptEncryption: false } } } });
  changed = true;
}

if (whatToTest !== '') {
  const localizations = (await api(`/builds/${build.id}/betaBuildLocalizations?fields[betaBuildLocalizations]=locale,whatsNew`)).data ?? [];
  const english = localizations.find((localization) => localization.attributes.locale === 'en-US');
  if (english === undefined) {
    await api('/betaBuildLocalizations', {
      method: 'POST',
      body: { data: { type: 'betaBuildLocalizations', attributes: { locale: 'en-US', whatsNew: whatToTest }, relationships: { build: { data: { type: 'builds', id: build.id } } } } },
    });
    changed = true;
  } else if (english.attributes.whatsNew !== whatToTest) {
    await api(`/betaBuildLocalizations/${english.id}`, { method: 'PATCH', body: { data: { type: 'betaBuildLocalizations', id: english.id, attributes: { whatsNew: whatToTest } } } });
    changed = true;
  }
}

for (const name of groupNames) {
  const group = (await api(`/betaGroups?filter[app]=${app}&filter[name]=${encodeURIComponent(name)}&fields[betaGroups]=name&limit=1`)).data?.[0];
  if (group === undefined) throw new Error(`no TestFlight group is named ${name}`);
  const inGroup = (await api(`/betaGroups/${group.id}/relationships/builds?limit=200`)).data ?? [];
  if (!inGroup.some((member) => member.id === build.id)) {
    await api(`/betaGroups/${group.id}/relationships/builds`, { method: 'POST', body: { data: [{ type: 'builds', id: build.id }] } });
    changed = true;
  }
}

// A build never submitted answers with no data, or a 404.
const submission = await api(`/builds/${build.id}/betaAppReviewSubmission`).then(
  (answer) => answer.data,
  (error) => {
    if (error instanceof Error && / 404 /.test(error.message)) return null;
    throw error;
  },
);
if (submission === null || submission === undefined) {
  try {
    await api('/betaAppReviewSubmissions', { method: 'POST', body: { data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: build.id } } } } } });
    changed = true;
  } catch (error) {
    console.log(`refused ${error instanceof Error ? error.message.replace(/\s+/g, ' ').slice(0, 300) : String(error)}`);
    process.exit(0);
  }
}

console.log(changed ? 'sent' : 'already');
