'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const videoContent = require('../../../src/lib/ios-setup-video-content.json');
const assetStubs = {};
for (const kind of Object.keys(videoContent.guides)) for (const lang of ['en', 'ar']) for (const extension of ['mp4', 'jpg']) {
  assetStubs[`../../assets/videos/ios-setup/${kind}-${lang}.${extension}`] = 1;
}
const videoPolicy = load(path.join(root, 'src/lib/ios-setup-video.ts'), {
  './ios-setup-video-content.json': videoContent, ...assetStubs,
  './ios-setup-recordings': { iosSetupRecordings: {} },
  './ios-setup-availability': load(path.join(root, 'src/lib/ios-setup-availability.ts')),
});
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const walk = (node, out = []) => {
  if (Array.isArray(node)) node.forEach(child => walk(child, out));
  else if (node && typeof node === 'object') { out.push(node); walk(node.props?.children, out); walk(node.props?.footer, out); }
  return out;
};
const byId = (tree, id) => walk(tree).find(node => node.props.testID === id);
const strings = node => Array.isArray(node) ? node.map(strings).join(' ')
  : node && typeof node === 'object' ? strings(node.props?.children) : typeof node === 'string' ? node : '';
function hooks() {
  let cursor = 0; const slots = []; const effects = [];
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const memo = (factory, deps) => { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { value: factory(), deps }; return slots[i].value; };
  const api = {
    Component: class { constructor(props) { this.props = props; } },
    useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps), useRef: value => memo(() => ({ current: value }), []),
    useState: initial => { const cell = memo(() => ({ value: typeof initial === 'function' ? initial() : initial }), []); return [cell.value, value => { cell.value = typeof value === 'function' ? value(cell.value) : value; }]; },
    useEffect: (work, deps) => { const i = cursor++; if (slots[i] && equal(slots[i].deps, deps)) return; const old = slots[i]; const next = slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); next.cleanup = work(); }); },
  };
  return { api, render(fn) { cursor = 0; const tree = fn(); while (effects.length) effects.shift()(); return tree; }, unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}
const copy = { watch: 'Watch guide', close: 'Close', replay: 'Replay', fullscreen: 'Watch full screen', fullscreenFailed: 'Keep watching below', loading: 'Loading video', failed: 'Video could not play', readSteps: 'Read the steps', videoUnavailable: 'Update Wafra to play this guide. You can read the steps below.' };
const video = { title: 'New messages', description: 'Connect Wafra Capture v3', durationSeconds: 54, source: 123, poster: 456, recordingNote: 'Recorded in the iOS simulator.', recording: { source: 123, poster: 456, width: 1206, height: 2622 }, transcript: [{ title: 'Add the shortcut', body: 'Choose Shortcuts, then Add Shortcut.', startSeconds: 0 }, { title: 'Test it', body: 'The test does not confirm incoming SMS delivery.', startSeconds: 6 }] };
function harness({ os = 'ios', version = '26.1', available = true, recorded = true, durationSeconds = 54 } = {}) {
  const hook = hooks(); const appListeners = new Set(); let focused = true; let imports = 0;
  const theme = { text: '#111', textSecondary: '#555', background: '#fff', backgroundSelected: '#eee', cardBorder: '#ddd', primary: '#175', controlBorder: '#777' };
  const deps = {
    react: hook.api, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Platform: { OS: os, Version: version }, Modal: 'Modal', View: 'View', ScrollView: 'ScrollView', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: v => v, absoluteFillObject: {} }, useWindowDimensions: () => ({ width: 390, height: 844 }), AppState: { currentState: 'active', addEventListener: (_event, cb) => { appListeners.add(cb); return { remove: () => appListeners.delete(cb) }; } } },
    'expo-image': { Image: 'Image' }, 'expo-modules-core': { requireOptionalNativeModule: name => { assert.equal(name, 'ExpoVideo'); return available ? {} : null; } },
    '@react-navigation/native': { useIsFocused: () => focused },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }) },
    '@/hooks/use-theme': { useTheme: () => theme }, '@/hooks/use-language': { useLanguage: () => 'en' },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/components/ui/icon': { Icon: 'Icon' }, '@/components/ui/controls': { Button: 'Button' },
    '@/components/ui/bottom-sheet': { BottomSheet: 'BottomSheet' },
    '@/constants/theme': { Spacing: { one: 4, two: 8, three: 12, four: 16 }, Radius: { card: 16, control: 8 }, ScreenPadding: 20 },
    '@/lib/ios-setup-video': { getIosSetupVideo: (_kind, lang) => ({ ...video, durationSeconds, recording: recorded ? video.recording : null, title: lang === 'ar' ? 'الرسائل الجديدة' : video.title }), iosSetupVideoCopy: () => ({ ...copy, readGuide: 'Read setup steps' }), isIosSetupVideoSupported: videoPolicy.isIosSetupVideoSupported },
    '@/lib/store': { useStore: () => { throw new Error('watching must never read or write setup/ledger state'); } },
  };
  Object.defineProperty(deps, '@/components/ios-setup-video-player', { get() { imports++; return { IosSetupVideoPlayer: 'VideoPlayer' }; } });
  const Card = load(path.join(root, 'src/components/ios-setup-video-card.tsx'), deps).IosSetupVideoCard;
  const originalHookApi = { ...hook.api };
  return { deps, hook, get imports() { return imports; }, set focused(value) { focused = value; }, background() { for (const cb of appListeners) cb('background'); }, render(props = {}) { Object.assign(deps.react, originalHookApi); return hook.render(() => Card({ kind: 'capture', ...props })); },
    anotherCard() { const other = hooks(); return { render(props = {}) { Object.assign(deps.react, other.api); return other.render(() => Card({ kind: 'history', ...props })); }, unmount: other.unmount }; },
    unmount: hook.unmount };
}

test('cards are limited to iOS26 and explicit web previews', () => {
  for (const options of [{ os: 'android', version: 36 }, { version: '25.1' }, { version: '27.0' }, { os: 'web' }]) {
    const h = harness(options); assert.equal(h.render(), null); assert.equal(h.imports, 0); h.unmount();
  }
  const web = harness({ os: 'web' }); assert.ok(web.render({ preview: true })); web.unmount();
});
test('pending recordings offer written steps without an illustrated poster or decoder', () => {
  const h = harness({ recorded: false }); let tree = h.render();
  assert.equal(byId(tree, 'ios-setup-video-watch-capture'), undefined);
  assert.equal(walk(tree).some(node => node.type === 'Image'), false);
  assert.doesNotMatch(strings(tree), /0:54|Illustrated/);
  const read = byId(tree, 'ios-setup-video-read-capture'); assert.ok(read);
  read.props.onPress(); tree = h.render();
  assert.equal(h.imports, 0);
  assert.match(strings(tree), /Choose Shortcuts/);
  assert.equal(byId(tree, 'ios-setup-video-unavailable'), undefined);
  h.unmount();
});
test('recorded duration rounds across a minute boundary without showing 0:60', () => {
  const h = harness({ durationSeconds: 59.96 });
  assert.match(byId(h.render(), 'ios-setup-video-watch-capture').props.accessibilityLabel, /1:00/);
  h.unmount();
});
test('older iPhones expose regular guides but never the Apple Pay guide', () => {
  const older = harness({ version: '26.6.2' });
  assert.ok(byId(older.render({ kind: 'capture' }), 'ios-setup-video-watch-capture'));
  assert.ok(byId(older.render({ kind: 'history' }), 'ios-setup-video-watch-history'));
  assert.equal(older.render({ kind: 'apple-pay' }), null);
  assert.equal(older.imports, 0); older.unmount();
  for (const version of ['27.0', '27.1.2', '28.0']) {
    const newer = harness({ version });
    assert.ok(byId(newer.render({ kind: 'apple-pay' }), 'ios-setup-video-watch-apple-pay'));
    assert.equal(newer.imports, 0); newer.unmount();
  }
});
test('card mount loads no decoder; Watch opens explicitly and Close removes the player', () => {
  const h = harness(); let tree = h.render({ compact: true });
  assert.equal(h.imports, 0); assert.equal(byId(tree, 'ios-setup-video-modal'), undefined);
  const watch = byId(tree, 'ios-setup-video-watch-capture');
  assert.match(watch.props.accessibilityLabel, /0:54/); assert.match(watch.props.accessibilityLabel, /Recorded in the iOS simulator/);
  watch.props.onPress(); tree = h.render();
  assert.equal(h.imports, 1); assert.ok(byId(tree, 'ios-setup-video-modal'));
  assert.ok(walk(tree).some(node => node.type === 'VideoPlayer'));
  byId(tree, 'ios-setup-video-close').props.children.props.onPress(); tree = h.render();
  assert.equal(walk(tree).some(node => node.type === 'VideoPlayer'), false); h.unmount();
});
test('the shared sheet owns dismiss gestures and dismissing unmounts the player', () => {
  const h = harness(); byId(h.render(), 'ios-setup-video-watch-capture').props.onPress();
  const sheet = byId(h.render(), 'ios-setup-video-modal');
  assert.equal(sheet.type, 'BottomSheet'); assert.equal(sheet.props.title, video.title);
  assert.equal(sheet.props.subtitle, video.recordingNote); assert.equal(sheet.props.visible, true);
  sheet.props.onClose(); assert.equal(byId(h.render(), 'ios-setup-video-modal'), undefined); h.unmount();
});
test('opening the second guide removes the first player slot', () => {
  const h = harness(); const second = h.anotherCard();
  byId(h.render(), 'ios-setup-video-watch-capture').props.onPress();
  assert.ok(byId(h.render(), 'ios-setup-video-modal'));
  byId(second.render(), 'ios-setup-video-watch-history').props.onPress();
  assert.equal(byId(h.render(), 'ios-setup-video-modal'), undefined);
  assert.ok(byId(second.render(), 'ios-setup-video-modal'));
  h.unmount(); second.unmount();
});
test('old binaries never evaluate expo-video and still offer the complete transcript', () => {
  const h = harness({ available: false }); byId(h.render(), 'ios-setup-video-watch-capture').props.onPress(); const tree = h.render();
  assert.equal(h.imports, 0); assert.match(strings(tree), /Update Wafra/);
  assert.match(strings(tree), /Choose Shortcuts/); assert.match(strings(tree), /does not confirm incoming SMS/); h.unmount();
});
test('disabled cards do not open and Arabic metadata is used', () => {
  const h = harness(); const tree = h.render({ language: 'ar', disabled: true });
  assert.match(strings(tree), /الرسائل الجديدة/); const watch = byId(tree, 'ios-setup-video-watch-capture');
  assert.equal(watch.props.disabled, true); watch.props.onPress?.(); assert.equal(h.imports, 0); h.unmount();
});
test('background and route blur close the guide without resuming automatically', () => {
  for (const event of ['background', 'blur']) {
    const h = harness(); byId(h.render(), 'ios-setup-video-watch-capture').props.onPress(); h.render();
    if (event === 'background') h.background(); else h.focused = false;
    h.render(); assert.equal(byId(h.render(), 'ios-setup-video-modal'), undefined);
    h.focused = true; assert.equal(byId(h.render(), 'ios-setup-video-modal'), undefined); h.unmount();
  }
});

function playerHarness() {
  const h = harness(); const events = new Map(); let created = 0; let released = 0; let played = 0; let paused = 0;
  const player = { status: 'loading', currentTime: 0, play() { played++; }, pause() { paused++; }, replay() { played++; this.currentTime = 0; }, addListener(name, fn) { events.set(name, fn); return { remove: () => events.delete(name) }; } };
  h.deps.expo = { useEvent: () => ({ status: player.status }) };
  h.deps['expo-video'] = { VideoView: 'VideoView', useVideoPlayer: (_source, setup) => {
    h.deps.react.useMemo(() => { created++; setup?.(player); return player; }, []);
    h.deps.react.useEffect(() => () => { released++; }, []); return player;
  } };
  const Player = load(path.join(root, 'src/components/ios-setup-video-player.tsx'), h.deps).IosSetupVideoPlayer;
  return { ...h, player, events, get counts() { return { created, released, played, paused }; }, render: () => h.hook.render(() => Player({ video, copy })) };
}
test('player exposes loading/error states, native seek/fullscreen controls and releases on unmount', () => {
  const h = playerHarness(); let tree = h.render(); assert.match(strings(tree), /Loading video/);
  assert.equal(h.player.muted, true, 'silent guides must not interrupt other audio');
  const view = walk(tree).find(node => node.type === 'VideoView'); assert.equal(view.props.nativeControls, true);
  const size = view.props.style.at(-1);
  assert.ok(Math.abs(size.width / size.height - 1206 / 2622) < 0.00001, 'preserve the real recording aspect ratio');
  assert.equal(view.props.fullscreenOptions.enable, true); assert.equal(view.props.allowsPictureInPicture, false);
  h.player.status = 'error'; tree = h.render(); assert.match(strings(tree), /Video could not play/);
  h.unmount(); assert.equal(h.counts.created, 1); assert.equal(h.counts.released, 1); assert.ok(h.counts.paused > 0);
});
test('Watch starts once after the mounted video becomes ready and never overrides a user pause', () => {
  const h = playerHarness(); h.render();
  assert.equal(h.counts.played, 0, 'a loading player must not lose an early play request before VideoView mounts');
  h.player.status = 'readyToPlay'; h.render();
  assert.equal(h.counts.played, 1, 'the mounted ready player must start after explicit Watch');
  h.player.pause(); h.player.status = 'loading'; h.render();
  h.player.status = 'readyToPlay'; h.render();
  assert.equal(h.counts.played, 1, 'buffering after a user pause must not restart playback');
  h.render(); assert.equal(h.counts.played, 1); h.unmount();
});
test('the portrait guide offers an explicit full-screen action and a usable failure fallback', async () => {
  const h = playerHarness(); h.player.status = 'readyToPlay'; let tree = h.render();
  const view = byId(tree, 'ios-setup-video-view'); let entered = 0;
  view.props.ref.current = { enterFullscreen: async () => { entered++; throw new Error('unsupported'); } };
  walk(tree).find(node => node.props.label === copy.fullscreen).props.onPress();
  await Promise.resolve(); tree = h.render();
  assert.equal(entered, 1); assert.match(strings(tree), /Keep watching below/);
  assert.ok(byId(tree, 'ios-setup-video-view')); h.unmount();
});
test('active native playback pauses immediately on background', () => {
  const h = playerHarness(); h.render(); h.player.status = 'readyToPlay'; h.render(); const before = h.counts.paused; h.background();
  assert.equal(h.counts.paused, before + 1); h.unmount();
});
test('playback ending never advances setup; Replay is an explicit local player action', () => {
  const h = playerHarness(); h.render(); h.player.status = 'readyToPlay'; h.render(); const before = h.counts.played;
  h.events.get('playToEnd')(); const tree = h.render(); assert.equal(h.counts.played, before);
  const replay = walk(tree).find(node => node.props.label === copy.replay); assert.ok(replay); replay.props.onPress();
  assert.equal(h.counts.played, before + 1); h.unmount();
});
