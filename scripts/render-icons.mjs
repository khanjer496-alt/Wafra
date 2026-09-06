/** Render launcher assets from the same vector geometry as the in-app mark. */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = 'assets/images';
const source = readFileSync('src/components/wafra-logo.tsx', 'utf8');
const paths = [...source.matchAll(/\bd="([^"]+)"/g)].map((match) => match[1]);
if (paths.length !== 1) throw new Error('Expected one Wafra mark path');
const theme = readFileSync('src/constants/theme.ts', 'utf8');
const primary = theme.match(/light:\s*\{[\s\S]*?primary:\s*'([^']+)'/)?.[1];
const darkPrimary = theme.match(/dark:\s*\{[\s\S]*?primary:\s*'([^']+)'/)?.[1];
if (!primary || !darkPrimary) throw new Error('Missing brand colours');
const mark = (color) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="100%" height="100%"><path d="${paths[0]}" fill="none" stroke="${color}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
writeFileSync(`${OUT}/wafra-mark.svg`, mark(primary));
const targets = [
  { file: 'icon.png', size: 1024, markSize: 720, color: '#FFFFFF', background: primary },
  { file: 'android-icon-foreground.png', size: 1024, markSize: 580, color: '#FFFFFF' },
  { file: 'android-icon-background.png', size: 1024, background: primary },
  { file: 'android-icon-monochrome.png', size: 1024, markSize: 580, color: '#FFFFFF' },
  { file: 'splash-icon.png', size: 512, markSize: 460, color: primary },
  { file: 'splash-icon-dark.png', size: 512, markSize: 460, color: darkPrimary },
  { file: 'favicon.png', size: 96, markSize: 68, color: '#FFFFFF', background: primary },
];
const browser = await chromium.launch();
try {
  for (const target of targets) {
    const page = await browser.newPage({ viewport: { width: target.size, height: target.size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;}body{display:grid;place-items:center;background:${target.background ?? 'transparent'}}</style>${target.markSize ? `<div style="width:${target.markSize}px;height:${target.markSize}px">${mark(target.color)}</div>` : ''}`);
    const data = await page.screenshot({ type: 'png', omitBackground: !target.background });
    // PNG colour type 2 is opaque RGB; store icons must not carry alpha.
    if (target.file === 'icon.png' && data[25] !== 2) throw new Error('iOS icon must be RGB without alpha');
    writeFileSync(`${OUT}/${target.file}`, data);
    console.log(`${target.file}: ${target.size}×${target.size}`);
    await page.close();
  }
} finally {
  await browser.close();
}
