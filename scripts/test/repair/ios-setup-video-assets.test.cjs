'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const content = require('../../../src/lib/ios-setup-video-content.json');
const manifest = require('../../../assets/videos/ios-setup/recordings-manifest.json');
const assets = path.join(root, 'assets/videos/ios-setup');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const resources = {};
for (const recording of manifest.recordings) {
  for (const file of [recording.file, recording.posterFile]) resources[`../../assets/videos/ios-setup/${file}`] = file;
}
const recordings = load(path.join(root, 'src/lib/ios-setup-recordings.ts'), {
  ...resources, '../../assets/videos/ios-setup/recordings-manifest.json': manifest,
}).iosSetupRecordings;
const api = load(path.join(root, 'src/lib/ios-setup-video.ts'), {
  './ios-setup-video-content.json': content,
  './ios-setup-recordings': { iosSetupRecordings: recordings },
  './ios-setup-availability': load(path.join(root, 'src/lib/ios-setup-availability.ts')),
});

test('only actual recordings are registered and their bytes match verified provenance', () => {
  let total = 0;
  const seen = new Set();
  for (const recording of manifest.recordings) {
    const key = `${recording.kind}:${recording.language}`;
    assert.ok(!seen.has(key)); seen.add(key);
    assert.equal(recording.provenance, 'ios-simulator');
    assert.match(recording.recordedOsVersion, /^\d+\.\d+/);
    assert.match(recording.rawSourceSha256, /^[a-f0-9]{64}$/);
    assert.ok(recording.width > 0 && recording.height > 0 && recording.durationSeconds > 0);
    const bytes = readFileSync(path.join(assets, recording.file));
    assert.equal(hash(bytes), recording.sha256);
    assert.equal(bytes.length, recording.bytes);
    assert.equal(hash(readFileSync(path.join(assets, recording.posterFile))), recording.posterSha256);
    const registered = recordings[recording.kind]?.[recording.language];
    assert.ok(registered);
    for (const field of ['durationSeconds', 'width', 'height', 'title', 'note']) assert.equal(registered[field], recording[field]);
    assert.equal(registered.source, recording.file); assert.equal(registered.poster, recording.posterFile);
    let previous = -1;
    for (const chapter of registered.chapters) {
      assert.ok(chapter.startSeconds >= previous && chapter.startSeconds < registered.durationSeconds);
      assert.ok(content.guides[recording.kind][recording.language].steps[chapter.stepIndex]);
      previous = chapter.startSeconds;
    }
    const boxes = [];
    for (let offset = 0; offset < bytes.length;) {
      assert.ok(offset + 8 <= bytes.length);
      let size = bytes.readUInt32BE(offset);
      if (size === 1) size = Number(bytes.readBigUInt64BE(offset + 8));
      if (size === 0) size = bytes.length - offset;
      assert.ok(size >= 8 && offset + size <= bytes.length);
      boxes.push(bytes.toString('ascii', offset + 4, offset + 8)); offset += size;
    }
    assert.equal(boxes[0], 'ftyp');
    assert.ok(boxes.includes('moov') && boxes.includes('mdat'));
    assert.ok(boxes.indexOf('moov') < boxes.indexOf('mdat'), 'fast-start playback');
    total += bytes.length;
  }
  assert.ok(total < 20 * 1024 * 1024, 'recordings remain bounded offline assets');
  assert.deepEqual(Object.entries(recordings).flatMap(([kind, locales]) => Object.keys(locales).map(lang => `${kind}:${lang}`)).sort(), [...seen].sort());
  for (const file of ['ios-setup-video.ts', 'ios-setup-recordings.ts']) {
    assert.doesNotMatch(readFileSync(path.join(root, 'src/lib', file), 'utf8'), /(?:capture|history|apple-pay)-(?:en|ar)\.(?:mp4|jpg)/, 'illustrations are not runtime media');
  }
});

test('unfilmed steps remain written instructions with no invented video timestamps', () => {
  for (const kind of ['capture', 'history', 'apple-pay']) for (const language of ['en', 'ar', 'fr']) {
    const lang = language === 'ar' ? 'ar' : 'en';
    const guide = api.getIosSetupVideo(kind, language);
    const recording = recordings[kind]?.[lang] ?? null;
    assert.equal(guide.recording, recording);
    assert.equal(guide.transcript.length, content.guides[kind][lang].steps.length);
    for (const [index, step] of guide.transcript.entries()) assert.equal(step.startSeconds, recording?.chapters.find(c => c.stepIndex === index)?.startSeconds ?? null);
    if (!recording) { assert.equal(guide.durationSeconds, 0); assert.equal(guide.recordingNote, ''); }
  }
});

test('real recording policy preserves version-specific setup exposure', () => {
  for (const version of [26, '26.0', '26.6.2']) assert.equal(api.isIosSetupVideoSupported(version), true);
  for (const version of [null, undefined, '26oops', '', 18, 27, '27.0']) assert.equal(api.isIosSetupVideoSupported(version), false);
  for (const version of [17, 26, '26.6.2', null, '27beta', '27.x']) assert.equal(api.isIosSetupVideoSupported(version, 'apple-pay'), false);
  for (const version of [27, '27.0', '27.1.2', 28]) assert.equal(api.isIosSetupVideoSupported(version, 'apple-pay'), true);
});
