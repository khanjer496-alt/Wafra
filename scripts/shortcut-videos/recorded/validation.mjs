import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function hashFile(file) {
  const digest = createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
}

const positive = value => Number.isFinite(value) && value > 0;
const text = value => typeof value === 'string' && value.trim().length > 0;
const close = (a, b) => Number.isFinite(a) && Math.abs(a - b) < 0.00001;

/** No implicit retiming, missing chapters or claims inherited from another recording. */
export function validateTimeline(plan) {
  if (!plan || plan.schema !== 1 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(plan.outputPrefix ?? '') ||
      !/^[a-f0-9]{64}$/.test(plan.sourceSha256 ?? '')) throw new Error('Invalid timeline identity or source SHA-256');
  if (plan.fps !== 24 || plan.width !== 720 || plan.height !== 1740 ||
      !positive(plan.sourceDurationSeconds) || !Number.isInteger(plan.sourceWidth) || plan.sourceWidth <= 0 ||
      !Number.isInteger(plan.sourceHeight) || plan.sourceHeight <= 0 ||
      !text(plan.sourcePlatform) || !text(plan.sourceOS) || !['en', 'ar'].includes(plan.uiLanguage) ||
      !text(plan.coverage) || !Array.isArray(plan.doesNotShow) || !plan.doesNotShow.every(text)) {
    throw new Error('Invalid source, recording scope or 720x1740 / 24 fps output contract');
  }
  if (!Number.isFinite(plan.finalHoldSeconds) || plan.finalHoldSeconds < 0 || plan.finalHoldSeconds > 5 ||
      !Number.isInteger(plan.finalHoldSeconds * plan.fps) ||
      !Array.isArray(plan.chapters) || plan.chapters.length === 0) throw new Error('Invalid final hold or chapter list');
  for (const language of ['en', 'ar']) {
    if (!text(plan.headings?.[language]?.title) || !text(plan.headings?.[language]?.recordingLabel)) {
      throw new Error(`Missing ${language} recording heading`);
    }
  }
  let frame = 0;
  let previousOut = 0;
  const ids = new Set();
  for (const [index, chapter] of plan.chapters.entries()) {
    if (!text(chapter.id) || ids.has(chapter.id)) throw new Error('Duplicate or missing chapter identity');
    ids.add(chapter.id);
    if (!Number.isFinite(chapter.sourceInSeconds) || chapter.sourceInSeconds < previousOut ||
        !Number.isFinite(chapter.sourceOutSeconds) || chapter.sourceOutSeconds <= chapter.sourceInSeconds ||
        chapter.sourceOutSeconds > plan.sourceDurationSeconds + 0.00001) {
      throw new Error(`Invalid, overlapping or out-of-bounds source range: ${chapter.id}`);
    }
    const sourceFrames = Math.round((chapter.sourceOutSeconds - chapter.sourceInSeconds) * plan.fps);
    const frames = sourceFrames + (index === plan.chapters.length - 1 ? plan.finalHoldSeconds * plan.fps : 0);
    if (sourceFrames < 1 || chapter.startFrame !== frame || chapter.durationFrames !== frames ||
        !close(chapter.startSeconds, frame / plan.fps) || !close(chapter.endSeconds, (frame + frames) / plan.fps)) {
      throw new Error(`Chapter timing does not match its source range: ${chapter.id}`);
    }
    for (const language of ['en', 'ar']) {
      if (!text(chapter[language]?.title) || !text(chapter[language]?.body)) throw new Error(`Missing ${language} captions: ${chapter.id}`);
    }
    frame += frames;
    previousOut = chapter.sourceOutSeconds;
  }
  if (plan.durationInFrames !== frame || !Number.isInteger(plan.posterFrame) || plan.posterFrame < 0 || plan.posterFrame >= frame) {
    throw new Error('Invalid complete timeline duration or poster frame');
  }
  return plan;
}

export function probeMedia(source) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', source], { encoding: 'utf8' }));
}

export async function verifySource(source, plan, probe = probeMedia) {
  validateTimeline(plan);
  if (!fs.statSync(source).isFile()) throw new Error('Source must be a regular recording file');
  const digest = await hashFile(source);
  if (digest !== plan.sourceSha256) throw new Error('Source SHA-256 mismatch; this timeline belongs to a different recording');
  const media = probe(source);
  const videos = media.streams.filter(stream => stream.codec_type === 'video');
  const duration = Number(media.format.duration);
  if (videos.length !== 1 || videos[0].width !== plan.sourceWidth || videos[0].height !== plan.sourceHeight ||
      !Number.isFinite(duration) || Math.abs(duration - plan.sourceDurationSeconds) > 0.001 ||
      plan.chapters.some(chapter => chapter.sourceOutSeconds > duration + 0.00001)) {
    throw new Error('Source media duration, dimensions or ranges differ from the verified timeline');
  }
  return { sha256: digest, durationSeconds: duration, width: videos[0].width, height: videos[0].height };
}

export function outputNames(plan) {
  // Publish the receipt last, after every asset it attests has been written.
  return ['timeline.json', ...['en', 'ar'].flatMap(language => {
    const base = `${plan.outputPrefix}-${language}`;
    return [`${base}.mp4`, `${base}.jpg`, `${base}-contact.jpg`,
      ...plan.chapters.map((_, index) => `${base}-step-${String(index + 1).padStart(2, '0')}.jpg`)];
  }), 'recording-metadata.json'];
}

/** Check every named output before any rendering, without creating directories. */
export function assertOutputSafety(out, source, names, overwrite) {
  if (fs.existsSync(out) && (!fs.statSync(out).isDirectory() || fs.lstatSync(out).isSymbolicLink())) {
    throw new Error('Output must be a normal directory, not a file or symlink');
  }
  const sourceReal = fs.realpathSync(source);
  for (const name of names) {
    if (path.basename(name) !== name || name === '.' || name === '..') throw new Error('Unsafe output filename');
    const target = path.join(out, name);
    if (path.resolve(target) === path.resolve(source)) throw new Error('Output would replace the source recording');
    let stat;
    try { stat = fs.lstatSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Refusing output symlink or non-file: ${target}`);
    if (fs.realpathSync(target) === sourceReal || (stat.dev === fs.statSync(source).dev && stat.ino === fs.statSync(source).ino)) {
      throw new Error('Output would replace the source recording');
    }
    if (!overwrite) throw new Error(`Output already exists: ${target}; use --overwrite explicitly to replace generated files`);
  }
}

export function parseArgs(args) {
  const options = { overwrite: false, validateOnly: false, help: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (seen.has(arg)) throw new Error(`Repeated argument: ${arg}`);
    seen.add(arg);
    if (arg === '--overwrite') options.overwrite = true;
    else if (arg === '--validate-only') options.validateOnly = true;
    else if (arg === '--help') options.help = true;
    else if (['--source', '--out', '--timeline'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.help && (!options.source || !options.out)) throw new Error('Both --source and --out are required');
  return options;
}
