// The Mac App Store version for a build of Geld.
//
//   node safari-version.mjs <package.json version> <build number>   → 0.1.4308
//
// Every store needs a version that only goes up, and the other stores take the
// four-part manifest version (package.json's version plus CI's run number).
// Apple caps CFBundleShortVersionString at three integers (ITMS-90060) and
// releases each App Store version once, so a build of the same three-part
// version cannot follow a released one. The App Store version is therefore
// major.minor from package.json and the build number as the third part: it
// rises with every build, and the build number (CFBundleVersion, the same
// number) leads back to the release tag, v<version>-build.<build>.
//
// Used by safari-sync.sh (MARKETING_VERSION) and publish.yml (the version the
// App Store Connect checks and the submission name), so the two never differ.
const [packageVersion, build] = process.argv.slice(2);

const versionShape = /^(\d+)\.(\d+)(?:\.\d+)*$/;
const match = packageVersion === undefined ? null : versionShape.exec(packageVersion);
if (match === null || build === undefined || !/^\d+$/.test(build)) {
  throw new Error('usage: safari-version.mjs <package.json version> <build number>');
}

process.stdout.write(`${match[1]}.${match[2]}.${Number(build)}\n`);
