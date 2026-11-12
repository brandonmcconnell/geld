# GitHub media viewer

The extension uses `@ramka/react` for the modal, focus management, gallery, thumbnail strip, view transitions, zoom, pan and pull-to-dismiss.
The native GitHub content remains in its original DOM tree.
A small React trigger bridge registers those existing nodes with Ramka for morphs and decoded image placeholders.
The React root is mounted only when someone opens media and is removed after closing.

Media discovery follows rendered content rather than URL routes or a CDN allowlist.
It covers repository READMEs, Markdown files, wikis, discussions, releases, issue and PR descriptions and comments, image file and diff previews, and attachment previews in dialogs.
GitHub images on loan to Geld's review panel remain eligible.
Avatars, emoji, hidden content, explicit downloads and the viewer's own media are excluded.
Each rendered body forms its own ordered gallery, so unrelated comments do not mix.
A separate debounced observer handles GitHub replacing content after navigation or hydration.

Regular image clicks open the viewer, including images without links and responsive pictures.
Modified clicks preserve the underlying link's behavior.
The original link retains a GitHub blob or upload URL when available, otherwise the image's canonical URL or displayed source.
Signed image URLs are retained intact, and GitHub's image proxy is used for displaying external images.
Native inline video controls remain available, with a separate expand button opening the viewer.

The composition follows Ramka's [state](https://ramka.dev/docs/lightbox/state-lifecycle), [composition](https://ramka.dev/docs/lightbox/composition), [transitions](https://ramka.dev/docs/lightbox/view-transitions), [gestures](https://ramka.dev/docs/lightbox/gestures), [zoom](https://ramka.dev/docs/lightbox/zoom), [RTL](https://ramka.dev/docs/lightbox/rtl), [CSP](https://ramka.dev/docs/lightbox/csp) and [API](https://ramka.dev/docs/lightbox/api) guides.
The default preset supplies the gallery pattern, thumbnail strip and active zoom bridge.
The film-trailer example supplies the playback lifecycle: play active video after opening settles, pause inactive media, and pause before the closing snapshot.
The existing Video.js player retains seeking, speed, volume, captions, fullscreen and picture-in-picture where supported.
Closing transfers playback position to the original inline video.
Next.js image and route examples, commerce sidebars, stories, and WebGL examples are composition patterns for other applications rather than additional GitHub features.

The viewer has mouse, wheel, touch and keyboard controls, plus pointer buttons for panning without dragging.
Ramka owns gesture arbitration, momentum, elastic bounds and reduced-motion fallbacks.
The extension supplies accessible names, direction, captions, a compact fitted size, floating Geld controls and a neutral transparent backdrop.
Media dimensions are reserved before opening to avoid a collapsed loading frame.
Failed media offers retry and the original URL.
The existing Attachment lightbox setting remains on by default and disables the entire enhancement when switched off.
