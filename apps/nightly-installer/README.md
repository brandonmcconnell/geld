# geld-nightly

Installs **Geld Nightly**, the self-updating nightly build of [Geld](https://github.com/brandonmcconnell/geld), for the browser profiles you pick. Geld is a browser extension that hides test files and other review noise from GitHub diffs and adds a pull request digest.

```sh
npx geld-nightly
```

Without npm, the same installer runs from Geld's site:

```sh
curl -fsSL https://www.geld.sh/nightly.sh | sh
```

```powershell
irm https://www.geld.sh/nightly.ps1 | iex
```

Node.js 20 or newer. Works with Chrome, Chrome Beta, Edge and Brave on macOS, Windows and Linux.

## What it does

1. Lists your browser profiles by name and lets you pick one or more.
2. Downloads the latest nightly build from [GitHub Releases](https://github.com/brandonmcconnell/geld/releases/latest) and checks it before anything is written: the release must come from Geld's own CI, the zip must match its published SHA-256, and the manifest must be Geld Nightly at the release's version.
3. Unzips it into `~/Geld Nightly/<profile>` (on Windows, `Geld Nightly` in your user folder), one folder per profile, and deletes the zip.
4. For each profile, copies the folder's path to the clipboard, opens the browser in that profile and prints the steps: go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and paste the path.

Then click the Geld Nightly toolbar icon and **Connect folder**, and pick the same folder. When Chrome asks, choose **Allow on every visit**. A folder installed with `--downloads` needs neither step. From then on Geld Nightly installs new builds into its folder by itself, on every push to Geld's `main` branch, and can roll back to the build before.

Do not move or rename the folder once it is loaded: the browser ties the extension to its path. Run `npx geld-nightly` again at any time to repair a folder.

## Options

```text
--profile <name>       A profile to install for, by name or folder (repeatable). Default: ask.
--all                  Every profile found.
--browser <id>         Only chrome, chrome-beta, edge or brave (repeatable).
--dir <folder>         Where the build folders go. Default: ~/Geld Nightly.
--downloads            Put them in the profile's Downloads folder instead, where updates
                       need no folder picker but cleanup tools may empty the folder.
--yes                  Answer yes to warnings about the folder.
--no-open              Do not open the browser or wait between profiles.
--verify-attestation   Also check GitHub's build attestation (needs the gh CLI, signed in).
--help, --version
```

In a terminal it opens with Geld's logo. Its cut corners are drawn with the triangles your terminal draws itself, and with plain blocks where it draws none. Set `GELD_LOGO=powerline`, `geometric` or `blocks` to choose, for example `powerline` in iTerm2 with its built-in Powerline glyphs turned on.

## Where it installs, and where it will not

The installer never writes over a folder that is not Geld Nightly, and never into another profile's folder. It refuses temporary folders and folders the browser's folder picker will not open (`~/Library`, `Application Support`, `AppData`, `Program Files`, `~/.config`, system folders), and asks first before a synced folder (iCloud, OneDrive, Dropbox, Google Drive) or Downloads. It keeps its own state in `~/.geld`, never in the build folder.

## Good to know

- Geld Nightly pauses while Geld from a store is on in the same profile, and starts once that copy is off or removed.
- It has its own extension id, so its settings are separate from a store install's unless you sign in to sync them.
- Updates read public GitHub releases, so no token is needed. This package only installs: you do not need to update it to get new nightly builds.

More in [Geld's README](https://github.com/brandonmcconnell/geld#nightly-builds).

## License

[AGPL-3.0-only](https://github.com/brandonmcconnell/geld/blob/main/LICENSE)
