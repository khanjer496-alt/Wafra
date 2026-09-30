# Wafra iOS setup recordings

The app uses **actual simulator recordings only**, registered in
`src/lib/ios-setup-recordings.ts` and verified by
`assets/videos/ios-setup/recordings-manifest.json`.

Four clips are integrated, with English or Arabic captions over English iOS 26.1
native UI:

- **Create Message automation** — `capture-automation-{en,ar}.mp4`, 47.291667
  seconds. Shows the Message trigger, one-space condition, Run Immediately and
  saved Wafra Capture v3 automation. Installation, permission checks and incoming
  bank-message capture are not shown.
- **Install and start history import** — `history-install-start-{en,ar}.mp4`,
  67 seconds. Shows actual Wafra navigation, sharing/installing Wafra History v8,
  starting it and the empty-simulator result. No Messages permission prompt,
  populated import, Review screen or entry filing was recorded. Remaining phone
  steps are explicitly marked as written instructions, not filmed actions.

Apple Pay has written steps only while actual iOS 27 footage remains unavailable.
Unfilmed steps have no invented timestamps. A guide without verified footage
loads no video player or illustrated poster. Setup footage is not physical-device
message-delivery proof or populated-history qualification.

Final MP4/JPEG files live in `assets/videos/ios-setup`. Raw takes, reviewed edits,
contact sheets and native/build evidence are in
`artifacts/real-ios-setup-20260930/`. The manifest retains source and final hashes,
actual OS/interface language, coverage, chapter ranges and measured geometry.

## Reproduce actual recordings

The normal real-footage renderer is in [`recorded/`](recorded/README.md). Install
its existing isolated dependencies from the repository root:

```sh
npm ci --prefix scripts/shortcut-videos
```

FFmpeg/ffprobe and a working Chrome/headless Chromium are required. Set
`REMOTION_BROWSER_EXECUTABLE` to the installed browser executable when needed.
Run the following commands from the repository root, choosing a new output
folder. Add `--validate-only` for a no-write source/range/output-safety check.
Existing generated outputs require the explicit `--overwrite` flag.

Capture, from its verified raw take and default reviewed timeline:

```sh
node scripts/shortcut-videos/recorded/render.mjs \
  --source artifacts/real-ios-setup-20260930/raw/capture-automation-take2.mov \
  --out artifacts/real-ios-setup-20260930/capture-reproduced
```

History, from its reviewed two-recording composite and explicit timeline:

```sh
node scripts/shortcut-videos/recorded/render.mjs \
  --source artifacts/real-ios-setup-20260930/history-edit/history-footage-composite.mp4 \
  --out artifacts/real-ios-setup-20260930/history-reproduced \
  --timeline scripts/shortcut-videos/recorded/history-install-start.json
```

The History command starts from the prepared **actual-footage composite**. Its
original MOV hashes, exact cut ranges, CFR normalization and real-frame hold are
in `history-edit/source-lineage.json` and `history-edit/README.md`; its preparation
procedure is retained alongside them. It does not invent unavailable footage.
A missing or changed source must be resolved against that evidence, not by
replacing the timeline hash to bypass validation.

The renderer preserves the full native frame, places captions outside it, checks
source hashes/durations/ranges and rejects unsafe overwrites. It writes bilingual
MP4s, JPEG posters, chapter stills, contact sheets, a timeline snapshot and
`recording-metadata.json`. Review the media and metadata before registering or
copying outputs into app assets; rendering alone does not update registration or
qualify an import/capture flow.

```sh
node --test scripts/shortcut-videos/recorded/validation.test.mjs
```

## Scope of this release

Only the recorded-footage renderer is included. Historical illustration sources
remain in the author's preserved local work and are not app runtime assets.
`npm run render --prefix scripts/shortcut-videos -- --source <raw> --out <folder>`
invokes the recorded renderer; source verification is still mandatory.

Remotion dependencies and the lockfile remain isolated in this directory. The
Expo app bundles finished registered assets, not the renderer. JavaScript/JSX
renderer files do not add a Remotion dependency to the app's TypeScript checks.
