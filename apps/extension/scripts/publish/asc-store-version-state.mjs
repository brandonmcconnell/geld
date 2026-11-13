// What state is this App Store version of the Mac app in?
//
//   node asc-store-version-state.mjs <bundle-id> <version-string>
//
// Prints "none" when App Store Connect has no such version, "open" when it has one still to be submitted (being
// prepared, or sent back by App Review or the developer), else "submitted <STATE>" (waiting, in review, approved,
// on sale), and exits 0; any other failure exits 1. TestFlight uploads every release's build, so the App Store job
// finds the build there and submits it as it is, unless this version is already with App Review or on the store.
//
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY (base64 .p8).
import { api, appIdFor } from './asc-api.mjs';

const OPEN = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'];

const [bundleId, versionString] = process.argv.slice(2);
if (!bundleId || !versionString) throw new Error('usage: asc-store-version-state.mjs <bundle-id> <version-string>');

const app = await appIdFor(bundleId);
const versions = await api(
  `/apps/${app}/appStoreVersions?filter[versionString]=${encodeURIComponent(versionString)}&filter[platform]=MAC_OS&fields[appStoreVersions]=appStoreState,appVersionState&limit=1`,
);
const attributes = versions.data?.[0]?.attributes;
const state = attributes?.appVersionState ?? attributes?.appStoreState;
console.log(attributes === undefined ? 'none' : OPEN.includes(state) ? 'open' : `submitted ${state}`);
