# Guides from real screen recordings

This renderer uses actual footage only. It trims reviewed source ranges and
places English or Arabic captions outside the complete native screen. It does
not generate device UI or invent missing installation, permission or history
footage.

The default `capture-automation.json` is pinned to the SHA-256 of the verified
177.286667-second iOS 26.1 Simulator recording. Its eight chronological ranges
produce 1135 frames at 24 fps (47.291667 seconds), including a two-second hold
on the genuine saved-automation ending. Its scope is **Create Message
automation**, after Wafra Capture v3 has already been installed. The Arabic
edition explicitly labels the native interface as English.

## Validate without rendering

From the repository root:

```sh
node scripts/shortcut-videos/recorded/render.mjs \
  --source artifacts/real-ios-setup-20260930/raw/capture-automation-take2.mov \
  --out artifacts/real-ios-setup-20260930/reproduced \
  --validate-only
```

This reads the source, hashes it, checks its actual FFprobe dimensions and
duration, validates the timeline, and checks output conflicts. It writes
nothing and does not load Remotion or open a browser.

## Render

Install the existing isolated renderer dependencies with
`npm ci --prefix scripts/shortcut-videos`, then run the same command without
`--validate-only`. Set `REMOTION_BROWSER_EXECUTABLE` to a working Chrome or
headless Chromium executable when needed. FFmpeg and ffprobe must be on PATH.
No app dependency or package change is required.

Both `--source` and `--out` are mandatory. Existing generated files are refused
unless `--overwrite` is explicitly supplied. That flag replaces only the
known generated filenames; unrelated output files remain untouched. Source
files, source hardlinks, symlinks and non-file targets are always protected.
All work is staged in a fresh temporary subdirectory of the selected output
directory, then published after source stability and output validation checks.

Outputs include both captioned MP4s, JPEG posters, per-chapter stills, contact
sheets, `timeline.json`, and `recording-metadata.json` with source/output hashes
and exact chapter timings. Videos are silent 720 × 1740 H.264/yuv420p, with
fast-start playback and a 4 MiB limit per clip. Rendering uses concurrency 2.

## A future recording

Use `--timeline path/to/reviewed-timeline.json` with a new reviewed timeline
and its matching raw file. A new source must have its own exact SHA-256,
duration, dimensions, truthful scope/headings, captions and chronological
source ranges. Do not replace the default hash merely to bypass a mismatch.

The current renderer accepts portrait recordings in the existing 720 × 1740
caption layout and preserves each source's complete frame with `contain`.
For every chapter, `durationFrames` equals the rounded source duration at
24 fps; only the final chapter adds `finalHoldSeconds * 24`. `startFrame`,
`startSeconds` and `endSeconds` must be contiguous. Holds are bounded to five
seconds. Review the exported stills and final playback after any new source or
caption change. No History or Apple Pay recording is supplied by this folder.

## Focused tests

```sh
node --test scripts/shortcut-videos/recorded/validation.test.mjs
```

The tests exercise actual file hashing, mismatched recording metadata,
out-of-bounds/overlapping ranges, frame timing, mandatory captions, overwrite
refusal, source/hardlink/symlink protection and explicit CLI arguments. They
do not rerender the finished guides or require Remotion dependencies.
