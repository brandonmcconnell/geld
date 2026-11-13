// Renders store/safari-review-notes.txt into the App Review notes for one submission.
//
//   SAFARI_REVIEW_VERSION=0.1.4308 SAFARI_REVIEW_BUILD=4308 node safari-review-notes.mjs <template>
//
// Apple asked for a physical-Mac recording once, for the new app (Guideline 2.1,
// Sep 2026), and for the answers to stay in the notes for later submissions. The
// recording is therefore a reference, never a gate: with SAFARI_REVIEW_VIDEO_URL,
// SAFARI_REVIEW_VIDEO_VERSION and SAFARI_REVIEW_TEST_DEVICE set (all three, once)
// the notes cite that recording and the workflow attaches the file; with none set
// they point at the recording the first review was given, which App Review keeps
// in this app's messages. A new version never needs a new recording.
import { readFile } from 'node:fs/promises';

const [templatePath] = process.argv.slice(2);

if (templatePath === undefined) {
  throw new Error('Usage: node safari-review-notes.mjs <template>');
}

const env = (name) => {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
};

const version = env('SAFARI_REVIEW_VERSION');
const build = env('SAFARI_REVIEW_BUILD');
if (version === undefined || build === undefined) {
  throw new Error('SAFARI_REVIEW_VERSION and SAFARI_REVIEW_BUILD are required');
}

const evidence = {
  url: env('SAFARI_REVIEW_VIDEO_URL'),
  shows: env('SAFARI_REVIEW_VIDEO_VERSION'),
  device: env('SAFARI_REVIEW_TEST_DEVICE'),
};
const given = Object.values(evidence).filter((value) => value !== undefined).length;
if (given !== 0 && given !== 3) {
  throw new Error('Set SAFARI_REVIEW_VIDEO_URL, SAFARI_REVIEW_VIDEO_VERSION and SAFARI_REVIEW_TEST_DEVICE together, or none of them');
}

// What the first review was given (App Store Connect, geld-safari, Oct 31, 2026 reply; approved Nov 9, 2026).
const FIRST_REVIEW_RECORDING =
  'The physical-Mac recording for this app, geld-safari-0.1.2-build163-narrated-tight.mov (2 min 31 s, captured on a 14-inch MacBook Pro (Mac17,2), Apple M3, macOS 27.0.1 (26A434), Safari 27.0.1 (22625.1.29.11.28), showing Geld 0.1.2), is attached to the Oct 31, 2026 reply in this app\'s App Review messages, on which version 0.1.2 was approved on Nov 9, 2026.';

const recording =
  evidence.url === undefined
    ? FIRST_REVIEW_RECORDING
    : `Recording: ${evidence.url} (the same file is attached under App Review Information).\n\nCaptured on ${evidence.device}, showing Geld ${evidence.shows}.`;

const replacements = { RECORDING: recording, VERSION: version, BUILD: build };

let notes = await readFile(templatePath, 'utf8');

for (const [name, value] of Object.entries(replacements)) {
  notes = notes.replaceAll(`{{${name}}}`, value);
}

const unresolved = notes.match(/\{\{[A-Z_]+\}\}/g);
if (unresolved !== null) {
  throw new Error(`Unresolved review-note placeholders: ${unresolved.join(', ')}`);
}

// App Store Connect refuses App Review notes over 4,000 characters, and the submission with them.
const APPLE_NOTES_LIMIT = 4000;
if ([...notes].length > APPLE_NOTES_LIMIT) {
  throw new Error(`Review notes are ${[...notes].length} characters; App Store Connect takes at most ${APPLE_NOTES_LIMIT}`);
}

process.stdout.write(notes);
