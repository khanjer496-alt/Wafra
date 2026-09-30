import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { assertOutputSafety, hashFile, outputNames, parseArgs, probeMedia, sha256, validateTimeline, verifySource } from './validation.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const renderer = path.dirname(here);
const root = path.resolve(renderer, '../..');
const require = createRequire(path.join(renderer, 'package.json'));
const usage = `Render captioned guides from verified real footage.

node scripts/shortcut-videos/recorded/render.mjs --source raw.mov --out output-directory
  [--timeline reviewed-timeline.json] [--overwrite] [--validate-only]

The default timeline is pinned to the verified iOS 26.1 Message automation take.
A different recording requires its own reviewed timeline and exact source SHA-256.
Set REMOTION_BROWSER_EXECUTABLE to a working Chrome/headless Chromium executable.
Requires the isolated scripts/shortcut-videos dependencies and FFmpeg/ffprobe.
--validate-only checks source and output safety without rendering or writing files.
--overwrite replaces only the explicitly named generated outputs, never the source.`;

const run = (binary, args) => execFileSync(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
function verifyEncoded(file, plan, frames = plan.durationInFrames) {
  const media = probeMedia(file);
  const video = media.streams[0];
  if (media.streams.length !== 1 || video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' ||
      video.width !== plan.width || video.height !== plan.height || video.r_frame_rate !== `${plan.fps}/1` ||
      Number(video.nb_frames) !== frames || Math.abs(Number(media.format.duration) - frames / plan.fps) > 0.001) {
    throw new Error(`Encoded media contract failed: ${file}`);
  }
  return media;
}

/** Each page is cut before padding; a final hold cannot include later footage. */
function prepareFootage(source, plan, work, publicDir) {
  const segments = [];
  for (const [index, chapter] of plan.chapters.entries()) {
    const filename = `segment-${String(index).padStart(3, '0')}.mp4`;
    const target = path.join(work, filename);
    const duration = chapter.sourceOutSeconds - chapter.sourceInSeconds;
    const hold = index === plan.chapters.length - 1 ? plan.finalHoldSeconds : 0;
    run('ffmpeg', ['-n', '-hide_banner', '-loglevel', 'error', '-ss', String(chapter.sourceInSeconds),
      '-t', String(duration), '-i', source, '-vf',
      `scale=720:-2,fps=${plan.fps}:start_time=0,tpad=stop_mode=clone:stop_duration=${hold + 1 / plan.fps}`,
      '-frames:v', String(chapter.durationFrames), '-an', '-c:v', 'libx264', '-preset', 'fast',
      '-crf', '20', '-pix_fmt', 'yuv420p', '-threads', '2', target]);
    const stream = probeMedia(target).streams[0];
    if (Number(stream.nb_frames) !== chapter.durationFrames) throw new Error(`Source range yielded too few frames: ${chapter.id}`);
    segments.push(filename);
  }
  const list = path.join(work, 'concat.txt');
  fs.writeFileSync(list, segments.map(file => `file '${file}'`).join('\n') + '\n', { flag: 'wx' });
  const clean = path.join(publicDir, 'recording-clean.mp4');
  run('ffmpeg', ['-n', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-map', '0:v:0', '-c', 'copy', '-movflags', '+faststart', clean]);
  if (Number(probeMedia(clean).streams[0].nb_frames) !== plan.durationInFrames) throw new Error('Clean recording timeline mismatch');
  for (const font of ['Geist-Regular.ttf', 'Geist-SemiBold.ttf', 'IBMPlexSansArabic-Regular.ttf', 'IBMPlexSansArabic-SemiBold.ttf']) {
    fs.copyFileSync(path.join(root, 'assets/fonts', font), path.join(publicDir, font), fs.constants.COPYFILE_EXCL);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage); return; }
  const source = path.resolve(options.source);
  const out = path.resolve(options.out);
  const timelinePath = path.resolve(options.timeline ?? path.join(here, 'capture-automation.json'));
  const timelineBytes = fs.readFileSync(timelinePath);
  const plan = validateTimeline(JSON.parse(timelineBytes));
  const names = outputNames(plan);
  assertOutputSafety(out, source, names, options.overwrite);
  const sourceFacts = await verifySource(source, plan);
  console.log(`Verified source ${sourceFacts.sha256}: ${plan.chapters.length} chapters, ${plan.durationInFrames / plan.fps}s output`);
  if (options.validateOnly) { console.log('Validation passed; no outputs written.'); return; }

  // Load Remotion only after all dependency-free safety checks have passed.
  const { bundle } = require('@remotion/bundler');
  const { openBrowser, renderMedia, renderStill, selectComposition } = require('@remotion/renderer');
  fs.mkdirSync(out, { recursive: true });
  const work = fs.mkdtempSync(path.join(out, '.recorded-work-'));
  const publicDir = path.join(work, 'public');
  const staged = path.join(work, 'outputs');
  fs.mkdirSync(publicDir); fs.mkdirSync(staged);
  let browser;
  try {
    prepareFootage(source, plan, work, publicDir);
    const serveUrl = await bundle({ entryPoint: path.join(here, 'composition.jsx'), publicDir });
    browser = await openBrowser('chrome', { browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE });
    const videos = [];
    for (const language of ['en', 'ar']) {
      const base = `${plan.outputPrefix}-${language}`;
      const inputProps = { language, data: plan };
      const composition = await selectComposition({ serveUrl, id: 'recorded-guide', puppeteerInstance: browser, inputProps });
      for (const [index, chapter] of plan.chapters.entries()) {
        await renderStill({ composition, serveUrl, inputProps, puppeteerInstance: browser, overwrite: false,
          frame: chapter.startFrame + Math.min(plan.fps, chapter.durationFrames - 1), imageFormat: 'jpeg', jpegQuality: 90,
          output: path.join(staged, `${base}-step-${String(index + 1).padStart(2, '0')}.jpg`) });
      }
      await renderStill({ composition, serveUrl, inputProps, puppeteerInstance: browser, overwrite: false,
        frame: plan.posterFrame, imageFormat: 'jpeg', jpegQuality: 90, output: path.join(staged, `${base}.jpg`) });
      run('ffmpeg', ['-n', '-hide_banner', '-loglevel', 'error', '-pattern_type', 'glob', '-i', path.join(staged, `${base}-step-*.jpg`),
        '-vf', `scale=240:-2,tile=4x${Math.ceil(plan.chapters.length / 4)}`, '-frames:v', '1', '-q:v', '2', path.join(staged, `${base}-contact.jpg`)]);
      let logged = -1;
      const temporary = path.join(work, `${base}-render.mp4`);
      await renderMedia({ composition, serveUrl, inputProps, puppeteerInstance: browser, overwrite: false,
        outputLocation: temporary, codec: 'h264', pixelFormat: 'yuv420p', crf: 26, x264Preset: 'medium', concurrency: 2,
        offthreadVideoThreads: 2, offthreadVideoCacheSizeInBytes: 64 * 1024 * 1024, imageFormat: 'jpeg', jpegQuality: 88,
        muted: true, onProgress: ({ progress }) => {
          const percent = Math.floor(progress * 10) * 10;
          if (percent !== logged) { logged = percent; console.log(`${base}: ${percent}%`); }
        } });
      const target = path.join(staged, `${base}.mp4`);
      run('ffmpeg', ['-n', '-hide_banner', '-loglevel', 'error', '-i', temporary, '-map', '0:v:0',
        '-vf', 'scale=in_range=full:out_range=tv', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
        '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-movflags', '+faststart', target]);
      const media = verifyEncoded(target, plan);
      const bytes = fs.statSync(target).size;
      if (bytes > 4 * 1024 * 1024) throw new Error(`Clip exceeds 4 MiB: ${base}`);
      videos.push({ id: base, file: `${base}.mp4`, poster: `${base}.jpg`, language,
        title: plan.headings[language].title, coverage: plan.coverage, sourcePlatform: plan.sourcePlatform,
        sourceOS: plan.sourceOS, uiLanguage: plan.uiLanguage, source: path.basename(source), sourceSha256: sourceFacts.sha256,
        width: plan.width, height: plan.height, fps: plan.fps, frames: plan.durationInFrames,
        durationSeconds: Number(media.format.duration), bytes, sha256: await hashFile(target),
        posterSha256: await hashFile(path.join(staged, `${base}.jpg`)), timelineSha256: sha256(timelineBytes),
        finalHoldSeconds: plan.finalHoldSeconds, doesNotShow: plan.doesNotShow,
        chapters: plan.chapters.map(chapter => ({ id: chapter.id, sourceInSeconds: chapter.sourceInSeconds,
          sourceOutSeconds: chapter.sourceOutSeconds, startSeconds: chapter.startSeconds,
          endSeconds: chapter.endSeconds, ...chapter[language] })) });
    }
    if (await hashFile(source) !== sourceFacts.sha256 || !fs.readFileSync(timelinePath).equals(timelineBytes)) {
      throw new Error('Source or timeline changed during rendering; outputs were not published');
    }
    fs.writeFileSync(path.join(staged, 'timeline.json'), timelineBytes, { flag: 'wx' });
    fs.writeFileSync(path.join(staged, 'recording-metadata.json'), JSON.stringify({ schema: 1, kind: 'real-simulator-footage', videos }, null, 2) + '\n', { flag: 'wx' });
    assertOutputSafety(out, source, names, options.overwrite);
    for (const name of names) {
      const target = path.join(out, name);
      if (options.overwrite) fs.renameSync(path.join(staged, name), target);
      else fs.copyFileSync(path.join(staged, name), target, fs.constants.COPYFILE_EXCL);
    }
    console.log(`Wrote ${videos.length} real-footage guides to ${out}`);
  } finally {
    try {
      if (browser) await browser.close({ silent: true });
    } finally {
      // This directory was created by mkdtemp for this invocation only.
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
