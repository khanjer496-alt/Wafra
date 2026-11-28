const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./repair/load-typescript.cjs');

// Wafra 1.0.2: every merchant and bank logo comes from the online lookup
// (Brandfetch), on by default on iOS and Android, cached on the phone after the
// first load. No third-party artwork ships in the app or its widgets; a miss,
// an error or no network shows the letter. Lifecycle, local-only mode and the
// store gate are exercised in repair/logo-avatar-privacy.test.cjs.
const root = path.resolve(__dirname, '../..');
const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);

// No bundled third-party marks, no Metro require map, no widget copies.
assert.deepEqual(files(path.join(root, 'assets/merchants')).filter(f => /\.(png|svg|webp|jpe?g)$/i.test(f)), [], 'no bundled merchant artwork');
assert.equal(fs.existsSync(path.join(root, 'src/components/ui/merchant-logo-assets.ts')), false, 'no bundled require map');
for (const dir of ['targets/widget/Assets.xcassets', 'modules/wafra-widgets/android/src/main/res']) {
  assert.deepEqual(files(path.join(root, dir)).filter(f => /wafra_logo_/.test(f)), [], `${dir}: widgets draw letters`);
}

const jsx = (type, props, key) => ({ type, props, key });
const remote = Object.freeze({ id: 'brandfetch:lulugroupinternational.com', domain: 'lulugroupinternational.com',
  logoUrl: 'https://cdn.brandfetch.io/domain/lulugroupinternational.com?c=fixture' });
function loadMerchantAvatar(os) {
  return load(path.join(root, 'src/components/ui/merchant-avatar.tsx'), {
    // A resolved logo on the first render: the remote state's initial value is null.
    react: { useState: initial => [initial === null ? { title: 'Lulu Hypermarket', logo: remote } : initial, () => {}], useEffect: () => {}, memo: f => f },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Platform: { OS: os }, StyleSheet: { create: v => v, absoluteFill: { position: 'absolute' } }, View: 'View' },
    'expo-image': { Image: 'Image' },
    '@/components/ui/monogram-avatar': { MonogramAvatar: 'Monogram' },
    '@/constants/theme': { Radius: { tile: 8, control: 12 } },
    '@/hooks/use-band': { useBand: () => ({ glyphGround: '#2E2A23' }) },
    '@/hooks/use-theme': { useTheme: () => ({ cardBorder: '#3A352D' }) },
    '@/hooks/use-color-scheme': { useColorScheme: () => 'dark' },
    '@/lib/store': { useOnlineLogosAllowed: () => true },
    '@/lib/merchant-logo-resolver': { resolveRemoteMerchantLogo: async () => remote },
    '@/lib/verified-logo-identities': { brandfetchImageSource: uri => ({ uri, headers: { Referer: 'https://wafra-app-azg.pages.dev/' } }) },
  }, { requestIdleCallback: () => 1, cancelIdleCallback: () => {} }).MerchantAvatar;
}
const flat = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
for (const os of ['ios', 'android']) {
  const MerchantAvatar = loadMerchantAvatar(os);
  const node = MerchantAvatar({ title: 'Lulu Hypermarket', category: 'groceries', size: 44 });
  assert.equal(node.key, remote.id, `${os}: identity changes remount failed-image state`);
  const tile = node.type(node.props);
  assert.equal(tile.props.testID, 'merchant-logo-brandfetch:lulugroupinternational-com');
  assert.equal(tile.props.accessibilityElementsHidden, true, 'the row supplies the accessible name');
  assert.equal(tile.props.pointerEvents, 'none');
  const [placeholder, image] = tile.props.children;
  assert.equal(placeholder.props.children.type.name, 'MerchantMonogram', 'the letter holds the tile while the image loads');
  assert.equal(image.type, 'Image');
  assert.equal(image.props.source.uri, remote.logoUrl, 'a CDN URL rebuilt from a validated domain');
  assert.equal(image.props.source.headers.Referer, 'https://wafra-app-azg.pages.dev/', 'hotlinked with the Referer Brandfetch requires');
  assert.equal(image.props.contentFit, 'contain', 'preserve artwork proportions');
  assert.equal(image.props.recyclingKey, remote.id);
  assert.equal(image.props.transition, 0, 'no row animations or logo cross-fades while scrolling');
  assert.equal(image.props.accessible, false);
  // Android keeps the on-device disk cache without growing the decoded-image memory cache.
  assert.equal(image.props.cachePolicy, os === 'android' ? 'disk' : 'memory-disk', `${os}: cache policy`);
  assert.equal(flat(image.props.style).width, 44);
  assert.equal(flat(image.props.style).opacity, 0, 'hidden until decoded');
  assert.equal(flat(tile.props.style).backgroundColor, undefined, 'no white backing off the dark bands');
  // On a dark band the artwork sits on a light plate at 78% size.
  const plated = MerchantAvatar({ title: 'Lulu Hypermarket', category: 'groceries', size: 50, plate: true });
  const platedTile = plated.type(plated.props);
  assert.equal(flat(platedTile.props.style).backgroundColor, '#F7F4EE');
  // A result for another title (a recycled row) is never drawn under the new name.
  assert.equal(MerchantAvatar({ title: 'Carrefour', category: 'groceries', size: 44 }).type.name, 'MerchantMonogram');
  assert.equal(flat(platedTile.props.children[1].props.style).width, 39);
}

// Brandfetch's terms require a Referer naming the requesting site. Native apps
// send Wafra's public site (the origin of app.json's privacy link); browsers
// send their own, and expo-image would fetch the image itself if given headers.
const extra = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo.extra;
for (const os of ['ios', 'android', 'web']) {
  const publicLinks = load(path.join(root, 'src/lib/public-links.ts'), {
    'expo-constants': { __esModule: true, default: { expoConfig: { extra } } },
  }, { URL });
  const identities = load(path.join(root, 'src/lib/verified-logo-identities.ts'), {
    'react-native': { Platform: { OS: os } },
    '@/lib/public-links': publicLinks,
  }, { URL });
  const logo = identities.verifiedLogoUrl('lulugroupinternational.com');
  const source = identities.brandfetchImageSource(logo);
  assert.equal(source.uri, logo);
  if (os === 'web') {
    assert.equal(source.headers, undefined, 'web keeps a plain <img> hotlink');
    assert.deepEqual({ ...identities.brandfetchRequestHeaders() }, {});
  } else {
    assert.equal(source.headers.Referer, 'https://wafra-app-azg.pages.dev/', `${os}: image request names Wafra's site`);
    assert.equal(identities.brandfetchRequestHeaders().Referer, 'https://wafra-app-azg.pages.dev/', `${os}: search request names Wafra's site`);
    assert.equal(identities.brandfetchImageSource(logo).headers, source.headers, 'stable headers keep image sources stable');
  }
}

const detail = fs.readFileSync(path.join(root, 'src/components/entry-detail-sheet.tsx'), 'utf8');
assert.match(detail, /MerchantAvatar title=\{transaction.title\} category=\{transaction.category\} size=\{44\}/,
  'transaction details keep the merchant logo tile, 44pt beside the name (compact sheet, design language E)');

// The letter avatar every miss falls back to: EN/AR initials, sizing, decorative accessibility.
const monoDeps = {
  react: { memo: f => f }, 'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { View: 'View' }, '@/components/themed-text': { ThemedText: 'Text' },
  '@/hooks/use-theme': { useTheme: () => ({ text: '#111', primary: '#222', primarySoft: '#EEE' }) },
  '@/constants/theme': { Radius: { tile: 8, control: 12 } },
};
const { MonogramAvatar } = load(path.join(root, 'src/components/ui/monogram-avatar.tsx'), monoDeps);
const initials = [['Careem', 'C'], ['كريم', 'ك'], ['  Noon One ', 'N'], ['', '—'], ['éclair', 'É'], ['\u200F\u200BExample', 'E'], ['e\u0301clair', 'E\u0301'], ['👩🏽‍💻 Cafe', 'C'], ['👩🏽‍💻', '—']];
for (const [name, initial] of initials) {
  const letter = MonogramAvatar({ name, size: 44 });
  assert.equal(letter.props.children.props.children, initial);
  assert.equal(letter.props.accessibilityElementsHidden, true);
  assert.equal(letter.props.style.width, 44);
}

console.log(`✓ online merchant logo tile on iOS and Android (cache policy, plate, letter placeholder); no bundled or widget artwork; ${initials.length} EN/AR letter fallbacks`);
