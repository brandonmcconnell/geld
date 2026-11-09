// Does App Store Connect already have this build of the Mac app?
//
//   node asc-build-exists.mjs <bundle-id> <marketing-version> <build-number>
//
// Asks the App Store Connect API (read-only) before the workflow spends five
// minutes of macOS runner archiving, exporting and uploading a package Apple
// would then refuse as a redundant binary. Prints "exists" or "missing" and
// exits 0; any other failure exits 1 so the caller falls back to archiving.
//
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY (base64 .p8).
import { api, appIdFor } from './asc-api.mjs';

const [bundleId, marketingVersion, build] = process.argv.slice(2);
if (!bundleId || !marketingVersion || !build) throw new Error('usage: asc-build-exists.mjs <bundle-id> <marketing-version> <build-number>');

const app = await appIdFor(bundleId);
const builds = await api(
  `/builds?filter[app]=${app}&filter[version]=${encodeURIComponent(build)}&filter[preReleaseVersion.version]=${encodeURIComponent(marketingVersion)}&filter[preReleaseVersion.platform]=MAC_OS&fields[builds]=version,processingState&limit=1`,
);
console.log(builds.data?.length > 0 ? 'exists' : 'missing');
