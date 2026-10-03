// Playback of the real components/assets in the existing demo-only preview.
// Browser evidence, not iPhone/Shortcuts execution evidence.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const { createWebSeed, STATE_KEY } = require('./universal-review-fixtures.cjs');
const content = require('../../src/lib/ios-setup-video-content.json');
const { recordings } = require('../../assets/videos/ios-setup/recordings-manifest.json');
const base = process.env.BASE ?? 'http://localhost:8142';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const out = process.env.OUT ?? 'artifacts/ios-setup-videos-20260930/ui';
await mkdir(out, { recursive: true });
const browser = await chromium.launch(process.env.VIDEO_BROWSER_CHANNEL
  ? { channel: process.env.VIDEO_BROWSER_CHANNEL } : {});
const results = [];
try {
  for (const language of ['en', 'ar']) for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme,
      reducedMotion: 'reduce', locale: language === 'ar' ? 'ar-AE' : 'en-US' });
    const errors = []; const mediaRequests = [];
    await context.route('**/*', route => {
      const url = route.request().url();
      if (/\.mp4(?:\?|$)/.test(url)) mediaRequests.push(url);
      return url.startsWith(base + '/') || /^(data|blob):/.test(url) ? route.continue() : route.abort();
    });
    await context.addInitScript(entries => entries.forEach(([key, value]) => localStorage.setItem(key, value)),
      createWebSeed().map(([key, value]) => key !== STATE_KEY ? [key, value] :
        [key, JSON.stringify({ ...JSON.parse(value), language, languagePreference: language, themePreference: 'system', captureOptOut: true })]));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/setup-preview?screen=videos`, { waitUntil: 'networkidle' });
    await page.getByTestId('ios-setup-video-watch-capture').waitFor();
    assert.equal(await page.locator('video').count(), 0, 'no decoder before Watch');
    assert.equal(mediaRequests.length, 0, 'video bytes are not requested before Watch');
    const setupState = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage)
      .filter(key => /ios.*(?:setup|history|capture)|onboarding/.test(key))
      .map(key => [key, localStorage.getItem(key)])));
    const before = await setupState();
    await page.screenshot({ path: path.join(out, `${language}-${colorScheme}-cards.png`) });
    for (const kind of ['capture', 'history', 'apple-pay']) {
      const recording = recordings.find(item => item.kind === kind && item.language === language);
      if (!recording) {
        assert.equal(await page.getByTestId(`ios-setup-video-watch-${kind}`).count(), 0);
        const requestsBefore = mediaRequests.length;
        await page.getByTestId(`ios-setup-video-read-${kind}`).click();
        assert.equal(await page.locator('video').count(), 0);
        const steps = await page.getByTestId('ios-setup-video-transcript').innerText();
        for (const step of content.guides[kind][language].steps) assert.ok(steps.includes(step.body));
        assert.equal(mediaRequests.length, requestsBefore, 'pending footage does not request media');
        await page.screenshot({ path: path.join(out, `${language}-${colorScheme}-${kind}-written.png`) });
        await page.getByTestId('ios-setup-video-close').getByRole('button').click();
        continue;
      }
      await page.getByTestId(`ios-setup-video-watch-${kind}`).click();
      await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
      const duration = recording.durationSeconds;
      assert.equal(await page.locator('video').evaluate(video => video.controls), true);
      assert.ok(Math.abs(await page.locator('video').evaluate(video => video.duration) - duration) < 0.1);
      await page.waitForFunction(() => {
        const video = document.querySelector('video'); return video && !video.paused && video.currentTime > 0.8;
      });
      await page.locator('video').evaluate(video => video.pause());
      assert.equal(await page.locator('video').evaluate(video => video.paused), true);
      await page.getByRole('button', { name: language === 'ar' ? 'شاهد بملء الشاشة' : 'Watch full screen', exact: true }).click();
      await page.waitForFunction(() => document.fullscreenElement !== null);
      await page.evaluate(() => document.exitFullscreen());
      // The actual Arabic/English video contains burned captions; the full
      // transcript remains independent of video decoding and font scaling.
      const transcript = await page.getByTestId('ios-setup-video-transcript').innerText();
      for (const step of content.guides[kind][language].steps) assert.ok(transcript.includes(step.body));
      await page.screenshot({ path: path.join(out, `${language}-${colorScheme}-${kind}.png`) });
      await page.locator('video').evaluate(video => { video.currentTime = video.duration - 0.15; void video.play(); });
      const replay = page.getByRole('button', { name: language === 'ar' ? 'إعادة المشاهدة' : 'Replay', exact: true });
      try { await replay.waitFor({ state: 'visible' }); } catch (error) {
        console.log('Replay wait state:', await page.locator('video').evaluate(video => ({
          time: video.currentTime, duration: video.duration, ended: video.ended, paused: video.paused,
          ready: video.readyState, error: video.error?.message,
          seekable: Array.from({ length: video.seekable.length }, (_, i) => [video.seekable.start(i), video.seekable.end(i)]),
        })));
        await page.screenshot({ path: path.join(out, `${language}-${colorScheme}-${kind}-failure.png`) });
        throw error;
      }
      await replay.click();
      await page.waitForFunction(() => {
        const video = document.querySelector('video'); return video && video.currentTime < 2 && !video.paused;
      });
      await page.getByTestId('ios-setup-video-close').getByRole('button').click();
      await page.waitForFunction(() => document.querySelectorAll('video').length === 0);
    }
    assert.deepEqual(await setupState(), before, 'watching must not confirm any setup/import step');
    assert.deepEqual(errors, []);
    results.push({ language, colorScheme, playback: 'passed', setupUnchanged: true, errors });
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
}
console.log(`${results.length} language/theme scenarios passed with real recordings, full screen, written-only pending guides, replay and unchanged setup state.`);
