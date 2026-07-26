/**
 * Regenerates the app icon, adaptive icon layers, splash and favicon from the
 * Wafra mark. Run with `node render-icons.mjs` from the repo root.
 *
 * The mark is the same two sub-paths as src/components/wafra-logo.tsx, so the
 * icon and the in-app logo can never drift apart.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = 'assets/images';
const INK = '#16130F';
const CHARCOAL = '#14120F';
const MINT = '#57B894';
const TERTIARY = '#8C857A';

const MARK = (color, strokeScale = 1) => `
<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
  <g fill="none" stroke="${color}" stroke-width="${4.2 * strokeScale}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 15 L15.5 33 L23 19 L30.5 33 L40 11.5" />
    <path d="M34 11.5 H40 V17.5" />
  </g>
</svg>`;

const kufi = readFileSync('assets/fonts/NotoKufiArabic-Regular.ttf').toString('base64');

function page({ width, height, background, body }) {
  return `<!doctype html><meta charset="utf-8">
<style>
  @font-face { font-family: 'Kufi'; src: url(data:font/ttf;base64,${kufi}) format('truetype'); }
  html,body { margin:0; padding:0; }
  body { width:${width}px; height:${height}px; background:${background}; display:flex;
         flex-direction:column; align-items:center; justify-content:center; }
</style>
${body}`;
}

/** The mark alone, inset so the strokes never touch the edge. */
const markBox = (size, color) =>
  `<div style="width:${size}px;height:${size}px">${MARK(color)}</div>`;

const TARGETS = [
  {
    file: 'icon.png',
    width: 1024,
    height: 1024,
    // Square and full-bleed: iOS applies its own mask, and a pre-rounded
    // icon shows corner artefacts under it.
    html: page({ width: 1024, height: 1024, background: INK, body: markBox(600, MINT) }),
    // iOS rejects an app icon that carries an alpha channel.
    opaque: true,
  },
  {
    file: 'android-icon-foreground.png',
    width: 1024,
    height: 1024,
    // Adaptive icons crop hard: the mark stays inside the 66% safe circle.
    html: page({ width: 1024, height: 1024, background: 'transparent', body: markBox(470, MINT) }),
  },
  {
    file: 'android-icon-background.png',
    width: 1024,
    height: 1024,
    html: page({ width: 1024, height: 1024, background: CHARCOAL, body: '' }),
    opaque: true,
  },
  {
    file: 'android-icon-monochrome.png',
    width: 1024,
    height: 1024,
    // Themed icons are tinted from the alpha channel, so the colour here is
    // only a stand-in — the shape is what ships.
    html: page({ width: 1024, height: 1024, background: 'transparent', body: markBox(470, '#FFFFFF') }),
  },
  {
    file: 'splash-icon.png',
    width: 512,
    height: 620,
    // Expo scales the splash by width, so a 512-wide image rendered at
    // imageWidth 120 puts the mark at exactly 120px.
    html: page({
      width: 512,
      height: 620,
      background: 'transparent',
      body: `${markBox(512, MINT)}
        <div style="font-family:Kufi;font-size:84px;line-height:1;color:${TERTIARY};margin-top:8px">وفرة</div>`,
    }),
  },
  {
    file: 'favicon.png',
    width: 96,
    height: 96,
    html: page({ width: 96, height: 96, background: INK, body: markBox(60, MINT) }),
    opaque: true,
  },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const t of TARGETS) {
  const p = await browser.newPage({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: 1 });
  await p.setContent(t.html);
  await p.waitForTimeout(120);
  const buf = await p.screenshot({ omitBackground: !t.opaque, type: 'png' });
  writeFileSync(`${OUT}/${t.file}`, buf);
  console.log(`${t.file}  ${t.width}x${t.height}  ${buf.length} bytes`);
  await p.close();
}
await browser.close();
