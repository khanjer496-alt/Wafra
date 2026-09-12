const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../repair/load-typescript.cjs');
const source = path.resolve(__dirname, '../../../src/lib/ios-local-capture-protocol.ts');
const publishedUrl = 'https://www.icloud.com/shortcuts/9a85d5f8b44d416181a76e68fcdf569d';

test('the published capture share is invoked by its actual installed name for test and catch-up', () => {
  const api = load(source, {}, { process: { env: { EXPO_PUBLIC_WAFRA_SHORTCUT_URL: publishedUrl } } });
  assert.equal(api.IOS_LOCAL_CAPTURE_SHORTCUT_URL, publishedUrl);
  assert.equal(api.IOS_LOCAL_CAPTURE_SHORTCUT_NAME, 'WafraLocalCapture');
  for (const raw of [api.iosLocalCaptureTestUrl(), api.iosLocalCaptureTestUrl(true), api.iosLocalCaptureCatchupUrl()]) {
    const url = new URL(raw);
    assert.equal(url.searchParams.get('name'), 'WafraLocalCapture');
    assert.equal(url.searchParams.has('input'), false);
  }
  assert.match(new URL(api.iosLocalCaptureTestUrl(true)).searchParams.get('x-success'), /fromOnboarding=1/);
});

test('a separately generated development share retains the canonical generator name', () => {
  const api = load(source, {}, { process: { env: {
    EXPO_PUBLIC_WAFRA_SHORTCUT_URL: 'https://www.icloud.com/shortcuts/abcdefabcdefabcdefabcdefabcdefab',
  } } });
  assert.equal(api.IOS_LOCAL_CAPTURE_SHORTCUT_NAME, 'Wafra Capture v2');
  assert.equal(new URL(api.iosLocalCaptureTestUrl()).searchParams.get('name'), 'Wafra Capture v2');
});

test('a newly configured setup-check graph passes only the fixed control marker; catch-up still has no input', async () => {
  const api = load(source, {}, { process: { env: {
    EXPO_PUBLIC_WAFRA_SHORTCUT_URL: 'https://www.icloud.com/shortcuts/abcdefabcdefabcdefabcdefabcdefab',
    EXPO_PUBLIC_WAFRA_SHORTCUT_SETUP_CHECK_VERSION: '1',
  } } });
  const { pathToFileURL } = require('node:url');
  const graph = await import(pathToFileURL(path.resolve(__dirname, '../../build-ios-local-capture-shortcut.mjs')));
  for (const fromOnboarding of [false, true]) {
    const url = new URL(api.iosLocalCaptureTestUrl(fromOnboarding));
    assert.equal(url.searchParams.get('input'), 'text');
    assert.equal(url.searchParams.get('text'), graph.IOS_LOCAL_CAPTURE_SETUP_CHECK_MARKER);
    assert.equal(url.searchParams.get('text'), 'WAFRA_SETUP_CHECK_V1');
    assert.equal(url.searchParams.get('name'), 'Wafra Capture v2');
    for (const result of ['success', 'cancel', 'error']) {
      assert.equal(url.searchParams.get(`x-${result}`),
        `wafra://ios-setup?shortcutResult=${result}${fromOnboarding ? '&fromOnboarding=1' : ''}`);
    }
  }
  const catchup = new URL(api.iosLocalCaptureCatchupUrl());
  assert.equal(catchup.searchParams.has('input'), false);
  assert.equal(catchup.searchParams.has('text'), false);
});

test('legacy shares and unversioned or invalid configuration never receive the control marker', () => {
  for (const env of [
    { EXPO_PUBLIC_WAFRA_SHORTCUT_URL: publishedUrl, EXPO_PUBLIC_WAFRA_SHORTCUT_SETUP_CHECK_VERSION: '1' },
    { EXPO_PUBLIC_WAFRA_SHORTCUT_URL: 'https://www.icloud.com/shortcuts/abcdefabcdefabcdefabcdefabcdefab' },
    { EXPO_PUBLIC_WAFRA_SHORTCUT_URL: 'https://www.icloud.com/shortcuts/abcdefabcdefabcdefabcdefabcdefab', EXPO_PUBLIC_WAFRA_SHORTCUT_SETUP_CHECK_VERSION: '2' },
    { EXPO_PUBLIC_WAFRA_SHORTCUT_SETUP_CHECK_VERSION: '1' },
  ]) {
    const api = load(source, {}, { process: { env } });
    const url = new URL(api.iosLocalCaptureTestUrl());
    assert.equal(url.searchParams.has('input'), false);
    assert.equal(url.searchParams.has('text'), false);
  }
});
