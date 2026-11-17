import type { Metadata } from 'next';

import { ExternalLink } from '@/components/external-link';
import { NightlyBrowserTabs } from '@/components/nightly-browser-tabs';
import type { BrowserTab } from '@/components/nightly-browser-tabs';
import { PageIntro, Prose } from '@/components/section';
import { SubBar } from '@/components/sub-bar';
import { STORE_URLS, TESTFLIGHT_URL } from '@/lib/downloads';
import { LATEST_RELEASE_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Geld Nightly',
  description: 'How to install Geld Nightly in each browser, keep it updating on its own, and fix it when it stops.',
  alternates: { canonical: '/nightly' },
  robots: { index: false, follow: false },
};

const SECTIONS = [
  { id: 'start', label: 'Quick start' },
  { id: 'browser', label: 'Your browser' },
  { id: 'updates', label: 'How updates work' },
  { id: 'store', label: 'Beside the store version' },
  { id: 'trouble', label: 'Troubleshooting' },
] as const;

const INSTALL = `npx geld-nightly@latest
# or, without npm
curl -fsSL https://www.geld.sh/nightly.sh | sh
# on Windows, in PowerShell
irm https://www.geld.sh/nightly.ps1 | iex`;

const BROWSER_TABS: readonly BrowserTab[] = [
  {
    id: 'chrome',
    label: 'Chrome & Edge',
    content: (
      <Prose>
        <p>Every channel works: stable, Beta, Dev and Canary. Edge gets its own build and the installer picks it.</p>
        <p>
          After you connect the folder, the first update asks to let Geld edit it. Choose <strong>Allow</strong>. That permission ends when the last Geld page
          closes, so the next update asks again, and this time the browser offers <strong>Allow on every visit</strong>. Choose it. From then on every update
          installs by itself, even after the browser restarts. Until you do, each update waits for one click on <strong>Install</strong> in the toolbar popup.
        </p>
      </Prose>
    ),
  },
  {
    id: 'brave',
    label: 'Brave',
    content: (
      <Prose>
        <p>
          Brave turns off folder access, which updates need, so <strong>Connect folder</strong> cannot work until you turn it on. Pick one of these.
        </p>
        <ul>
          <li>
            <strong>Turn on folder access.</strong> Open <code>brave://flags/#file-system-access-api</code>, set it to <strong>Enabled</strong> and relaunch
            Brave. Then connect the folder and choose <strong>Allow on every visit</strong> as in Chrome.
          </li>
          <li>
            <strong>Install in Downloads instead.</strong> Run <code>npx geld-nightly@latest --browser brave --downloads</code>. Geld then updates through
            Brave&apos;s downloads and needs no folder access. Cleanup tools and Storage Sense can empty Downloads, which is why this is not the default.
          </li>
        </ul>
        <p>
          If you already loaded Geld from another folder, remove that copy on <code>brave://extensions</code> after loading the Downloads one. Two loaded copies
          pause one of them. Export your settings from Geld&apos;s options first to keep them.
        </p>
      </Prose>
    ),
  },
  {
    id: 'chromium',
    label: 'Helium, Arc & others',
    content: (
      <Prose>
        <p>
          The installer also finds profiles in Chromium, Helium, Arc, Dia, Comet, Vivaldi, Opera, Opera GX, Thorium and Yandex, and in the Beta and Nightly
          channels of Brave. Setup is the same as Chrome: load the folder, connect it, then choose <strong>Allow on every visit</strong>.
        </p>
        <ul>
          <li>
            Use the browser&apos;s own extensions page if it has one: <code>opera://extensions</code>, <code>vivaldi://extensions</code>. The installer prints
            the right address.
          </li>
          <li>Opera has one profile, listed as Default.</li>
          <li>Arc and Dia are macOS only.</li>
        </ul>
      </Prose>
    ),
  },
  {
    id: 'firefox',
    label: 'Firefox & Zen',
    content: (
      <Prose>
        <p>
          Geld Nightly does not update itself in Firefox or in browsers built on it, like Zen. Firefox only installs extensions Mozilla has signed, and nightly
          builds are not signed yet. For everyday use, install{' '}
          {STORE_URLS.firefox !== undefined ? <ExternalLink href={STORE_URLS.firefox}>Geld from Firefox Add-ons</ExternalLink> : 'Geld from Firefox Add-ons'},
          which updates on its own.
        </p>
        <p>To try a nightly build anyway, download the Firefox nightly zip from the latest release, then:</p>
        <ul>
          <li>
            <strong>Firefox:</strong> open <code>about:debugging</code>, choose <strong>This Firefox</strong>, click <strong>Load Temporary Add-on</strong> and
            pick the zip. It stays until Firefox quits.
          </li>
          <li>
            <strong>Zen, Firefox Developer Edition, Nightly or ESR:</strong> in <code>about:config</code>, set <code>xpinstall.signatures.required</code> to{' '}
            <code>false</code>. Then in <code>about:addons</code>, open the gear menu, choose <strong>Install Add-on From File</strong> and pick the zip.
            Regular Firefox ignores this setting.
          </li>
        </ul>
        <p>Either way, a newer build means installing the newer zip the same way.</p>
      </Prose>
    ),
  },
  {
    id: 'safari',
    label: 'Safari',
    content: (
      <Prose>
        {TESTFLIGHT_URL !== null ? (
          <>
            <p>Safari extensions ship inside an app, so Safari&apos;s nightly is a TestFlight beta of Geld for Safari, updated with every push to main.</p>
            <ol>
              <li>
                On macOS 12 or later, install <ExternalLink href="https://apps.apple.com/app/testflight/id899247664">TestFlight</ExternalLink> from the App
                Store.
              </li>
              <li>
                Open <ExternalLink href={TESTFLIGHT_URL}>Geld&apos;s TestFlight link</ExternalLink> on your Mac, then <strong>Accept</strong> and{' '}
                <strong>Install</strong>.
              </li>
              <li>
                When TestFlight asks, turn on <strong>Automatic Updates</strong>. Each new build then installs itself.
              </li>
              <li>
                Open Geld once, then turn it on in Safari&apos;s <strong>Settings</strong>, under <strong>Extensions</strong>.
              </li>
            </ol>
            <p>
              The beta replaces Geld from the App Store on that Mac, keeping your settings, and installing the App Store version puts it back. Each build waits
              for Apple&apos;s beta review, usually a few hours, before it reaches you.
            </p>
          </>
        ) : (
          <p>
            Safari extensions ship inside an app, so there is no self-updating nightly for Safari yet.{' '}
            {STORE_URLS.safari !== undefined ? <ExternalLink href={STORE_URLS.safari}>Get Geld for Safari</ExternalLink> : 'Get Geld for Safari'} from the App
            Store. Building the Safari nightly yourself takes Xcode and is meant for development.
          </p>
        )}
      </Prose>
    ),
  },
];

export default function NightlyPage() {
  return (
    <>
      <PageIntro
        eyebrow="Geld Nightly"
        title="Every push, as it lands."
        description="Geld Nightly is the same build as the store's, published with every push to main. In Chromium browsers it updates itself within minutes. This page covers setup for each browser and what to do when an update stalls."
      />

      <SubBar aria-label="Sections" className="py-3">
        <ul className="container-site flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SECTIONS.map((section) => (
            <li key={section.id} className="shrink-0">
              <a
                href={`#${section.id}`}
                className="geld-corners geld-cut-[7px] inline-block border bg-background/60 px-3 py-1 text-sm whitespace-nowrap text-foreground/80 hover:border-foreground hover:bg-background hover:text-foreground"
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </SubBar>

      <div className="container-site pb-24">
        <Prose>
          <h2 id="start">Quick start</h2>
          <p>For Chrome, Edge and other Chromium browsers, run the installer in a terminal. It needs Node.js 20 or newer.</p>
          <pre>
            <code>{INSTALL}</code>
          </pre>
          <p>
            It lists your browser profiles by name, downloads the latest build, checks it against its published checksum and puts it in{' '}
            <code>~/Geld Nightly/&lt;profile&gt;</code>, one folder per profile. Then it opens each browser and prints three steps:
          </p>
          <ol>
            <li>
              Open the browser&apos;s extensions page (<code>chrome://extensions</code>, <code>edge://extensions</code> and so on) and turn on{' '}
              <strong>Developer mode</strong>.
            </li>
            <li>
              Click <strong>Load unpacked</strong> and pick the folder. Its path is on your clipboard.
            </li>
            <li>
              Click the Geld Nightly toolbar icon, then <strong>Connect folder</strong>, and pick the same folder. This lets Geld write new builds into it.
            </li>
          </ol>
          <p>
            Run the installer again any time to repair a folder or add another profile. Pass <code>--help</code> to see every option and every browser it knows.
          </p>
        </Prose>
        <section id="browser" aria-labelledby="browser-heading" className="mt-12 max-w-2xl scroll-mt-36">
          <h2 id="browser-heading" className="mb-4 text-xl font-semibold tracking-tight">
            Your browser
          </h2>
          <NightlyBrowserTabs sectionId="browser" tabs={BROWSER_TABS} />
        </section>
        <Prose>
          <h2 id="updates">How updates work</h2>
          <p>
            CI publishes a build a few minutes after each push to main. Geld looks for it on every GitHub page load, when the browser starts, and every 30
            minutes when GitHub is not open. So while you use GitHub, a new build arrives within seconds of being published.
          </p>
          <ul>
            <li>
              <strong>Automatic</strong> (the default) installs the build and reloads Geld, which puts itself back into open GitHub tabs.
            </li>
            <li>
              <strong>Manual</strong> shows a badge on the toolbar icon and an <strong>Install</strong> button in its popup.
            </li>
            <li>
              To look right away, click the refresh icon beside the status in the toolbar popup (<strong>Check for updates</strong>). It shows once a folder is
              connected.
            </li>
            <li>
              Every build is checked against its published checksum before anything is written, and Geld keeps a copy of the build it replaces. A failed update
              puts that copy back. For a day after an update, <strong>Roll back</strong> returns to the previous build.
            </li>
          </ul>
          <p>Do not move or rename the folder once it is loaded. The browser ties the extension to its path.</p>

          <h2 id="store">Beside the store version</h2>
          <p>
            Geld Nightly does not run while Geld from a store is on in the same profile. It pauses, marks Geld&apos;s bar on GitHub with a button to turn the
            store version off, and starts on its own once it is off or removed. Nightly has its own extension id, so its settings are separate unless you sign
            in to sync them.
          </p>

          <h2 id="trouble">Troubleshooting</h2>
          <h3>The installer finds no profiles</h3>
          <p>
            Open the browser once so it creates its profile, then run the installer again. Check <code>--help</code> for the list of browsers it knows.
          </p>
          <h3>&ldquo;This browser cannot give Geld access to a folder&rdquo;</h3>
          <p>
            The browser has folder access turned off. In Brave, follow the <a href="#brave">Brave steps</a>. Anywhere else, reinstall with{' '}
            <code>--downloads</code>.
          </p>
          <h3>Every update asks first</h3>
          <p>
            The browser has only a one-time permission. On the next prompt, choose <strong>Allow on every visit</strong>.
          </p>
          <h3>The folder moved, or an update keeps failing</h3>
          <p>
            Run <code>npx geld-nightly@latest</code> again. It repairs the folder in place. If you pick a new folder instead, load it, then remove the old copy.
          </p>
          <h3>Something else</h3>
          <p>
            Every build is on the <ExternalLink href={LATEST_RELEASE_URL}>latest release</ExternalLink>. Geld&apos;s options page has{' '}
            <strong>Report with diagnostics</strong>, which opens an issue with what Geld saw.
          </p>
        </Prose>
      </div>
    </>
  );
}
