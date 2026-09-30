import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { assertOutputSafety, hashFile, outputNames, parseArgs, validateTimeline, verifySource } from './validation.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const original = JSON.parse(fs.readFileSync(path.join(here, 'capture-automation.json')));
const fresh = () => structuredClone(original);
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(here, '.validation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('the verified recording timeline retains all eight chapters and exact final hold', () => {
  const plan = validateTimeline(fresh());
  assert.equal(plan.chapters.length, 8);
  assert.equal(plan.durationInFrames, 1135);
  assert.equal(plan.finalHoldSeconds, 2);
  assert.equal(plan.chapters.at(-1).durationFrames, 79 + 48);
  assert.equal(plan.chapters.at(-1).endSeconds, 1135 / 24);
  assert.equal(outputNames(plan).at(-1), 'recording-metadata.json', 'publish the receipt only after its assets');
});

test('source ranges reject negative, nonfinite, reversed, overlapping and beyond-end input', () => {
  for (const change of [
    plan => { plan.chapters[0].sourceInSeconds = -1; },
    plan => { plan.chapters[0].sourceInSeconds = NaN; },
    plan => { plan.chapters[0].sourceOutSeconds = Infinity; },
    plan => { plan.chapters[0].sourceOutSeconds = plan.chapters[0].sourceInSeconds; },
    plan => { plan.chapters[1].sourceInSeconds = 10; },
    plan => { plan.chapters.at(-1).sourceOutSeconds = 177.3; },
  ]) {
    const plan = fresh(); change(plan);
    assert.throws(() => validateTimeline(plan), /source range/);
  }
});

test('chapter gaps, retiming, stale second offsets and false duration receipts fail closed', () => {
  for (const change of [
    plan => { plan.chapters[1].startFrame += 1; },
    plan => { plan.chapters[0].durationFrames += 24; },
    plan => { plan.chapters[2].startSeconds = 14; },
    plan => { plan.chapters[3].endSeconds = 30; },
    plan => { plan.durationInFrames = 1200; },
    plan => { plan.posterFrame = plan.durationInFrames; },
  ]) {
    const plan = fresh(); change(plan);
    assert.throws(() => validateTimeline(plan), /timing|duration|poster/);
  }
});

test('missing language captions, duplicate chapters and unsafe output prefixes are rejected', () => {
  for (const change of [
    plan => { plan.chapters[2].ar.body = ''; },
    plan => { plan.chapters[1].id = plan.chapters[0].id; },
    plan => { plan.outputPrefix = '../../source'; },
    plan => { plan.finalHoldSeconds = 30; },
  ]) {
    const plan = fresh(); change(plan);
    assert.throws(() => validateTimeline(plan));
  }
});

test('a wrong raw-file hash is refused before probing media', async t => {
  const directory = temporary(t);
  const source = path.join(directory, 'raw.mov'); fs.writeFileSync(source, 'different recording');
  let probes = 0;
  await assert.rejects(verifySource(source, fresh(), () => { probes++; return {}; }), /SHA-256 mismatch/);
  assert.equal(probes, 0);
});

test('matching bytes still require matching media dimensions and duration', async t => {
  const directory = temporary(t);
  const source = path.join(directory, 'raw.mov'); fs.writeFileSync(source, 'source fixture');
  const plan = fresh(); plan.sourceSha256 = await hashFile(source);
  const media = { streams: [{ codec_type: 'video', width: 1206, height: 2622 }], format: { duration: '177.286667' } };
  const verified = await verifySource(source, plan, () => media);
  assert.equal(verified.sha256, plan.sourceSha256);
  await assert.rejects(verifySource(source, plan, () => ({ ...media, format: { duration: '176' } })), /duration, dimensions or ranges/);
  await assert.rejects(verifySource(source, plan, () => ({ ...media, streams: [{ codec_type: 'video', width: 720, height: 1566 }] })), /duration, dimensions or ranges/);
});

test('an existing generated file needs an explicit overwrite flag and remains untouched by preflight', t => {
  const directory = temporary(t);
  const source = path.join(directory, 'raw.mov'); fs.writeFileSync(source, 'source');
  const out = path.join(directory, 'out'); fs.mkdirSync(out);
  const target = path.join(out, 'capture-automation-en.mp4'); fs.writeFileSync(target, 'keep this video');
  assert.throws(() => assertOutputSafety(out, source, outputNames(original), false), /already exists/);
  assert.doesNotThrow(() => assertOutputSafety(out, source, outputNames(original), true));
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep this video');
});

test('overwrite cannot target the source, a hardlink to it, or a symlink', t => {
  const directory = temporary(t);
  const source = path.join(directory, 'raw.mov'); fs.writeFileSync(source, 'source');
  assert.throws(() => assertOutputSafety(directory, source, ['raw.mov'], true), /replace the source/);
  fs.linkSync(source, path.join(directory, 'hardlink.mov'));
  assert.throws(() => assertOutputSafety(directory, source, ['hardlink.mov'], true), /replace the source/);
  fs.symlinkSync(source, path.join(directory, 'link.mov'));
  assert.throws(() => assertOutputSafety(directory, source, ['link.mov'], true), /symlink/);
});

test('preflight does not create output directories or affect unrelated files', t => {
  const directory = temporary(t);
  const source = path.join(directory, 'raw.mov'); fs.writeFileSync(source, 'source');
  const out = path.join(directory, 'out');
  assertOutputSafety(out, source, outputNames(original), false);
  assert.equal(fs.existsSync(out), false);
  fs.mkdirSync(out); fs.writeFileSync(path.join(out, 'notes.txt'), 'keep notes');
  assertOutputSafety(out, source, outputNames(original), false);
  assert.equal(fs.readFileSync(path.join(out, 'notes.txt'), 'utf8'), 'keep notes');
});

test('CLI requires explicit source/output and does not silently accept ambiguous flags', () => {
  assert.deepEqual(parseArgs(['--source', 'raw.mov', '--out', 'out', '--overwrite', '--validate-only']),
    { source: 'raw.mov', out: 'out', overwrite: true, validateOnly: true, help: false });
  assert.throws(() => parseArgs(['--source', 'raw.mov']), /Both --source and --out/);
  assert.throws(() => parseArgs(['--source', '--out', 'out']), /Missing value/);
  assert.throws(() => parseArgs(['--source', 'a', '--source', 'b', '--out', 'out']), /Repeated/);
  assert.throws(() => parseArgs(['--force']), /Unknown/);
  assert.equal(parseArgs(['--help']).help, true);
});
