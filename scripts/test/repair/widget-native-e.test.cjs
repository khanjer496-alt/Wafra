'use strict';
// Native Home Screen widgets in design language E (targets/widget, iOS, and
// modules/wafra-widgets/android). Neither platform builds here, so this checks
// what can be checked without Xcode projects or Gradle: band colours against
// src/constants/theme.ts, the Lock Screen / StandBy redaction and deep links
// that must survive a restyle, English/Arabic copy parity, and that every
// Android resource the layouts and Kotlin name exists. On macOS it also
// compiles and runs the widget's Foundation logic (due words, tiles, money).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const theme = load(path.join(root, 'src/constants/theme.ts'), { '@/global.css': {}, 'react-native': { Platform: { select: (x) => x.android } } });
const { BandPalettes } = theme;

const swiftViews = read('targets/widget/WafraWidgetViews.swift');
const swiftSnapshot = read('targets/widget/WafraSnapshot.swift');
const androidRes = 'modules/wafra-widgets/android/src/main/res';
const kotlinDir = 'modules/wafra-widgets/android/src/main/java/expo/modules/wafrawidgets';

/** Body of `static func <name>(` up to the next `static func` or struct end. */
function swiftBandHexes(name) {
  const start = swiftViews.indexOf(`static func ${name}(_ scheme: ColorScheme) -> WafraBand`);
  assert.ok(start >= 0, `WafraBand.${name} exists`);
  const body = swiftViews.slice(start, swiftViews.indexOf('\n  }\n', start));
  const [dark, light] = body.split('return WafraBand(').slice(1);
  const pick = (chunk) => Object.fromEntries(
    [...chunk.matchAll(/(\w+): Color\(hex: 0x([0-9A-F]{6})\)/g)].map((m) => [m[1], `#${m[2]}`]),
  );
  return { light: pick(light), dark: pick(dark) };
}

function androidColors(dir) {
  const xml = read(`${androidRes}/${dir}/colors.xml`);
  return Object.fromEntries([...xml.matchAll(/<color name="(\w+)">(#[0-9A-F]{6})<\/color>/g)].map((m) => [m[1], m[2]]));
}

test('iOS widgets wear the Home and Bills bands from theme.ts, light and dark', () => {
  for (const [widget, band] of [['home', 'home'], ['bills', 'bills']]) {
    const swift = swiftBandHexes(widget);
    for (const scheme of ['light', 'dark']) {
      const p = BandPalettes[scheme][band];
      assert.equal(swift[scheme].band, p.band, `${widget} ${scheme} band`);
      assert.equal(swift[scheme].onBand, p.onBand, `${widget} ${scheme} text`);
      assert.equal(swift[scheme].onBandSecondary, p.onBandSecondary, `${widget} ${scheme} secondary`);
      assert.equal(swift[scheme].tile, p.tile, `${widget} ${scheme} tile`);
      assert.equal(swift[scheme].mark, p.bandMark, `${widget} ${scheme} week-bar mark`);
    }
  }
  assert.equal(swiftBandHexes('home').light.accent, BandPalettes.light.home.accent, 'today bar is mint');
});

test('Android widgets wear the same bands, and night deepens them', () => {
  const light = androidColors('values');
  const dark = androidColors('values-night');
  assert.deepEqual(Object.keys(dark).sort(), Object.keys(light).sort(), 'every colour has a night value');
  for (const [scheme, colors] of [['light', light], ['dark', dark]]) {
    const home = BandPalettes[scheme].home;
    const bills = BandPalettes[scheme].bills;
    assert.equal(colors.wafra_widget_today_band, home.band, `today band ${scheme}`);
    assert.equal(colors.wafra_widget_today_text, home.onBand, `today text ${scheme}`);
    assert.equal(colors.wafra_widget_today_secondary, home.onBandSecondary, `today secondary ${scheme}`);
    assert.equal(colors.wafra_widget_today_mark, home.bandMark, `today bars ${scheme}`);
    assert.equal(colors.wafra_widget_today_accent, home.accent, `today accent ${scheme}`);
    assert.equal(colors.wafra_widget_upcoming_band, bills.band, `upcoming band ${scheme}`);
    assert.equal(colors.wafra_widget_upcoming_text, bills.onBand, `upcoming text ${scheme}`);
    assert.equal(colors.wafra_widget_upcoming_secondary, bills.onBandSecondary, `upcoming secondary ${scheme}`);
    assert.equal(colors.wafra_widget_upcoming_tile, bills.tile, `upcoming tile ${scheme}`);
  }
  // The wallpaper (Material You) overrides would replace the band colours.
  for (const dir of ['values-v31', 'values-night-v31']) {
    assert.ok(!fs.existsSync(path.join(root, androidRes, dir, 'colors.xml')), `${dir} does not override the bands`);
  }
});

test('iOS keeps Lock Screen and StandBy redaction, deep links and tinted legibility', () => {
  assert.match(swiftViews, /privacySensitive\(snapshot\.amountsSensitive\)/, 'redaction modifier');
  const structBody = (name) => {
    const start = swiftViews.indexOf(`struct ${name}`);
    assert.ok(start >= 0, `${name} exists`);
    const next = swiftViews.indexOf('\nstruct ', start + 1);
    return swiftViews.slice(start, next < 0 ? undefined : next);
  };
  for (const name of ['WafraBandFigure', 'WafraTodayLine', 'WafraWeekBars', 'WafraComingUpView', 'WafraLeftLine', 'WafraLockScreenView']) {
    assert.match(structBody(name), /\.wafraAmount\(snapshot\)/, `${name} redacts its amounts`);
  }
  // The one-line inline family cannot redact part of itself: amounts only when not sensitive.
  assert.match(structBody('WafraLockScreenView'), /if !snapshot\.amountsSensitive, !snapshot\.hidden/);
  assert.equal((swiftViews.match(/\.widgetURL\(WafraShared\.appURL\)/g) || []).length, 3, 'every widget opens the app');
  // Tinted / clear Home Screen and StandBy: translucent tiles, system text.
  assert.match(swiftViews, /showsWidgetContainerBackground/);
  assert.match(swiftViews, /widgetRenderingMode/);
  assert.match(structBody('WafraBandFigure'), /\.widgetAccentable\(\)/, 'the band figure takes the tint');
  // Band figures never use a monospaced face.
  assert.doesNotMatch(swiftViews, /design: \.monospaced/);
});

test('widget copy has English and Arabic for every string', () => {
  const picks = [...swiftSnapshot.matchAll(/pick\("([^"]*)",\s*"([^"]*)"\)/g)];
  assert.ok(picks.length >= 15, 'iOS strings found');
  for (const [, en, ar] of picks) {
    assert.ok(en.trim() && ar.trim(), `iOS string "${en}" has both languages`);
    assert.match(ar, /[؀-ۿ]/, `iOS "${en}" Arabic is Arabic`);
  }
  const strings = (dir) => {
    const xml = read(`${androidRes}/${dir}/strings.xml`);
    const names = [...xml.matchAll(/<(string|plurals) name="(\w+)"( translatable="false")?/g)]
      .filter((m) => !m[3]).map((m) => m[2]);
    return new Set(names);
  };
  const en = strings('values');
  const ar = strings('values-ar');
  assert.deepEqual([...en].filter((n) => !ar.has(n)), [], 'every translatable Android string has Arabic');
  assert.deepEqual([...ar].filter((n) => !en.has(n)), [], 'no Arabic-only Android strings');
  assert.match(read(`${androidRes}/values/strings.xml`), /name="wafra_widget_left_in_budgets">%1\$s left in budgets</);
});

test('every Android resource the layouts and Kotlin name exists', () => {
  const resDir = path.join(root, androidRes);
  const defined = { color: new Set(), string: new Set(), plurals: new Set(), drawable: new Set(), layout: new Set(), xml: new Set(), id: new Set() };
  for (const dir of fs.readdirSync(resDir)) {
    for (const file of fs.readdirSync(path.join(resDir, dir))) {
      const text = fs.readFileSync(path.join(resDir, dir, file), 'utf8');
      const type = dir.split('-')[0];
      if (type === 'values') {
        for (const m of text.matchAll(/<(color|string|plurals) name="(\w+)"/g)) defined[m[1]].add(m[2]);
      } else if (defined[type]) {
        defined[type].add(file.replace(/\.xml$/, ''));
      }
      for (const m of text.matchAll(/@\+id\/(\w+)/g)) defined.id.add(m[1]);
      // Tag balance: a cheap well-formedness check (aapt2 does the full one).
      const opens = (text.match(/<[A-Za-z][^>]*[^/]>/g) || []).filter((t) => !t.startsWith('<?')).length;
      const closes = (text.match(/<\/[A-Za-z][^>]*>/g) || []).length;
      assert.equal(opens, closes, `${dir}/${file} tags balance`);
    }
  }
  const missing = [];
  for (const dir of fs.readdirSync(resDir)) {
    for (const file of fs.readdirSync(path.join(resDir, dir))) {
      const text = fs.readFileSync(path.join(resDir, dir, file), 'utf8');
      for (const m of text.matchAll(/@(color|string|drawable|layout|xml)\/(\w+)/g)) {
        if (!defined[m[1]].has(m[2])) missing.push(`${dir}/${file}: @${m[1]}/${m[2]}`);
      }
    }
  }
  for (const file of fs.readdirSync(path.join(root, kotlinDir))) {
    const text = read(`${kotlinDir}/${file}`);
    for (const m of text.matchAll(/\bR\.(id|string|plurals|color|drawable|layout|xml)\.(\w+)/g)) {
      if (!defined[m[1]].has(m[2])) missing.push(`${file}: R.${m[1]}.${m[2]}`);
    }
  }
  const manifest = read('modules/wafra-widgets/android/src/main/AndroidManifest.xml');
  for (const m of manifest.matchAll(/@(string|xml)\/(\w+)/g)) {
    if (!defined[m[1]].has(m[2])) missing.push(`AndroidManifest.xml: @${m[1]}/${m[2]}`);
  }
  assert.deepEqual(missing, []);
  // RemoteViews inflates only framework widgets it allows; a bare <View> fails at runtime.
  for (const file of fs.readdirSync(path.join(resDir, 'layout'))) {
    const tags = [...fs.readFileSync(path.join(resDir, 'layout', file), 'utf8').matchAll(/<([A-Za-z.]+)[\s>]/g)].map((m) => m[1]);
    for (const tag of tags) {
      assert.ok(['LinearLayout', 'FrameLayout', 'TextView', 'ImageView'].includes(tag), `${file}: <${tag}> is RemoteViews-safe`);
    }
  }
});

test('Android keeps amount hiding, spoken hidden amounts and the tap-to-open link', () => {
  const kotlin = read(`${kotlinDir}/WafraWidgets.kt`);
  assert.match(kotlin, /setOnClickPendingIntent\(R\.id\.wafra_widget_root/);
  assert.match(kotlin, /wafra_widget_amount_hidden/);
  assert.match(read(`${kotlinDir}/WidgetSnapshot.kt`), /if \(hidden \|\| minor == null\) return DASH/);
  assert.match(kotlin, /left != null && !snapshot\.hidden/, 'no budget line when amounts are hidden');
  // Due words match iOS: today, tomorrow, weekday within the coming week, then a date.
  assert.match(kotlin, /in 2L\.\.6L ->/);
});

test('the widget Foundation logic compiles and passes on macOS', { skip: os.platform() !== 'darwin' && 'needs xcrun swiftc' }, (t) => {
  const which = spawnSync('xcrun', ['--find', 'swiftc'], { encoding: 'utf8' });
  if (which.status !== 0) { t.skip('swiftc not available'); return; }
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-widget-')), 'widget-logic');
  const build = spawnSync('xcrun', [
    'swiftc', '-o', out,
    path.join(root, 'targets/widget/WafraSnapshot.swift'),
    path.join(root, 'scripts/test/widget-native/main.swift'),
  ], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const run = spawnSync(out, [], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /all checks passed/);
});
