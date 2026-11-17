// Is a Mac App Store review of this app waiting or under way?
//
//   node asc-review-busy.mjs <bundle-id>
//
// Prints "busy <STATE>" when a review submission is waiting for review, in
// review, or being cancelled or completed, else "free", and exits 0; any other
// failure exits 1. The workflow skips Safari while it is busy rather than
// withdrawing the waiting submission: withdrawing it for each newer build, twice
// a day, meant Apple never finished a review.
// A submission Apple sent back with issues (UNRESOLVED_ISSUES) is not busy: a
// new build may answer it.
//
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY (base64 .p8).
import { api, appIdFor } from './asc-api.mjs';

const BUSY = ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'CANCELING', 'COMPLETING'];

const [bundleId] = process.argv.slice(2);
if (!bundleId) throw new Error('usage: asc-review-busy.mjs <bundle-id>');

const app = await appIdFor(bundleId);
const submissions = await api(`/reviewSubmissions?filter[app]=${app}&filter[platform]=MAC_OS&filter[state]=${BUSY.join(',')}&fields[reviewSubmissions]=state&limit=1`);
const state = submissions.data?.[0]?.attributes?.state;
console.log(state === undefined ? 'free' : `busy ${state}`);
