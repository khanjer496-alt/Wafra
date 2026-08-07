/**
 * Renders docs/privacy-policy.md and docs/terms-of-use.md into the static site
 * published at wafra-legal.pages.dev. Run with `npm run render:legal` from the
 * repo root; deploy the output with `npm run deploy:legal`.
 *
 * This script exists because the pages it replaces were hand-written. They were
 * accurate the day they went up and then quietly stopped being accurate: the
 * relay's queue retention moved from 72 hours to 30 days, `docs/` was updated,
 * and the live policy went on telling users 72 hours — understating how long
 * financial data is held by a factor of ten. Nothing regenerated, so nothing
 * noticed. A published privacy policy that drifts from the code is a promise
 * the product has stopped keeping.
 *
 * So `docs/` is the only source. There is no page copy in this file, and there
 * must never be — every sentence a reader sees comes from the markdown, and
 * fixing the site means editing the markdown and running this again.
 *
 * Both documents describe both platforms in their own headed sections, so the
 * same two documents are published at all four paths. Splitting them into four
 * files is what allowed the drift in the first place: four copies of a shared
 * claim means three of them can be wrong while the fourth is right, and no one
 * finds out.
 *
 * Output is self-contained by requirement: inline CSS, no fonts, no scripts, no
 * external requests of any kind. A privacy policy that phones out to a CDN to
 * render is making a liar of itself in the first paragraph.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'dist-legal');

/** Every published path, and which source document answers it. */
const PAGES = [
  { path: 'ios/privacy', src: 'docs/privacy-policy.md', nav: 'Privacy' },
  { path: 'ios/terms', src: 'docs/terms-of-use.md', nav: 'Terms' },
  { path: 'android/privacy', src: 'docs/privacy-policy.md', nav: 'Privacy' },
  { path: 'android/terms', src: 'docs/terms-of-use.md', nav: 'Terms' },
];

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Inline markdown. Escape first, then add markup, so a document containing a
 * literal `<script>` is printed rather than run — these files are edited by
 * hand and one day one of them will quote something angular.
 */
function inline(src) {
  let s = escapeHtml(src);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => `<a href="${href}">${text}</a>`);
  s = s.replace(/&lt;(https?:\/\/[^&\s]+)&gt;/g, '<a href="$1">$1</a>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Underscore emphasis only between word boundaries, so snake_case column
  // names in the retention section survive as themselves.
  s = s.replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:)]|$)/g, '$1<em>$2</em>');
  return s;
}

/** Block-level markdown. Deliberately small: it supports what docs/ uses. */
function render(md) {
  const out = [];
  let list = null; // 'ul' | 'ol' | null
  let para = [];
  let quote = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushQuote();
    closeList();
  };

  for (const raw of md.split('\n')) {
    const line = raw.replace(/\s+$/, '');

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (line.startsWith('> ')) {
      flushPara();
      closeList();
      quote.push(line.slice(2));
      continue;
    }

    const ul = /^[-*]\s+(.*)$/.exec(line);
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      flushQuote();
      const want = ul ? 'ul' : 'ol';
      if (list !== want) {
        closeList();
        out.push(`<${want}>`);
        list = want;
      }
      out.push(`<li>${inline((ul ?? ol)[1])}</li>`);
      continue;
    }

    // A continuation line of the current list item or paragraph. Markdown
    // wraps at 80 columns here, so most sentences arrive in pieces.
    if (list) {
      const i = out.length - 1;
      out[i] = out[i].replace(/<\/li>$/, ` ${inline(line.trim())}</li>`);
      continue;
    }
    if (quote.length) {
      quote.push(line.trim());
      continue;
    }
    para.push(line.trim());
  }
  flushAll();
  return out.join('\n');
}

const CSS = `
:root{--bg:#fbfaf8;--fg:#1a1a18;--muted:#6b675f;--rule:#e6e2da;--accent:#3f6248;--chip:#f3f0ea}
@media(prefers-color-scheme:dark){
  :root{--bg:#14140f;--fg:#ebe7dd;--muted:#8f8a80;--rule:#2e2c26;--accent:#9dbfa4;--chip:#1e1c17}
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
  font:16px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  -webkit-text-size-adjust:100%}
.wrap{max-width:44rem;margin:0 auto;padding:2.5rem 1.25rem 5rem}
h1{font-size:1.85rem;line-height:1.2;margin:0 0 .75rem}
h2{font-size:1.15rem;margin:2.5rem 0 .6rem;padding-top:1.25rem;border-top:1px solid var(--rule)}
h3{font-size:1rem;margin:1.75rem 0 .4rem;color:var(--accent)}
p{margin:0 0 1rem}
a{color:var(--accent);overflow-wrap:anywhere}
strong{font-weight:600}
code{background:var(--chip);padding:.1em .35em;border-radius:3px;font-size:.9em;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
ul,ol{margin:0 0 1rem;padding-left:1.35rem}
li{margin:0 0 .45rem}
blockquote{margin:0 0 1rem;padding:.1rem 0 .1rem 1rem;border-left:3px solid var(--rule);color:var(--muted)}
nav{margin:0 0 2rem;display:flex;flex-wrap:wrap;gap:.5rem;font-size:.88rem}
nav a{padding:.3rem .75rem;border:1px solid var(--rule);border-radius:100px;
  text-decoration:none;color:var(--fg)}
nav a[aria-current]{background:var(--accent);border-color:var(--accent);color:var(--bg)}
footer{margin-top:4rem;padding-top:1.25rem;border-top:1px solid var(--rule);
  font-size:.85rem;color:var(--muted)}
`.trim();

function page({ title, body, current }) {
  const nav = PAGES.map(
    (p) =>
      `<a href="/${p.path}"${p.path === current ? ' aria-current="page"' : ''}>` +
      `${p.path.startsWith('ios') ? 'iPhone' : 'Android'} · ${p.nav}</a>`,
  ).join('');
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Wafra</title>
<style>${CSS}</style>
<div class="wrap">
<nav>${nav}</nav>
${body}
<footer>Generated from <code>${escapeHtml(
    PAGES.find((p) => p.path === current)?.src ?? 'docs/',
  )}</code> by <code>scripts/render-legal.mjs</code>. Edit the markdown, not this page.</footer>
</div>
</html>
`;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const p of PAGES) {
  const md = readFileSync(resolve(ROOT, p.src), 'utf8');
  const title = (/^#\s+(.*)$/m.exec(md)?.[1] ?? 'Wafra').trim();
  const html = page({ title, body: render(md), current: p.path });
  const file = resolve(OUT, `${p.path}.html`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
  console.log(`  /${p.path.padEnd(16)} <- ${p.src}`);
}

// An index so the bare domain is not a 404, built from the same nav.
writeFileSync(
  resolve(OUT, 'index.html'),
  page({
    title: 'Wafra legal',
    body:
      '<h1>Wafra</h1><p>The privacy policy and terms of use for Wafra, ' +
      'covering both the Android and iPhone builds.</p><ul>' +
      PAGES.map(
        (p) =>
          `<li><a href="/${p.path}">${p.path.startsWith('ios') ? 'iPhone' : 'Android'} — ${p.nav}</a></li>`,
      ).join('') +
      '</ul>',
    current: '',
  }),
);

/**
 * The check that would have caught the 72-hour error. The queue sweep interval
 * is the one number in the policy that is also a constant in the Worker, so it
 * is the one number worth asserting rather than trusting.
 */
const worker = readFileSync(resolve(ROOT, 'server/src/index.ts'), 'utf8');
const seconds = Number(/DELETE FROM queue WHERE created_at < unixepoch\(\) - (\d+)/.exec(worker)?.[1]);
const privacy = readFileSync(resolve(ROOT, 'docs/privacy-policy.md'), 'utf8');

if (!Number.isFinite(seconds)) {
  console.error('\nCould not find the queue sweep in server/src/index.ts — check the query shape.');
  process.exit(1);
}
const days = seconds / 86400;
if (!privacy.includes(`${days} days`)) {
  console.error(
    `\nserver/src/index.ts sweeps the queue at ${seconds}s (${days} days), but ` +
      `docs/privacy-policy.md never says "${days} days".\n` +
      'Fix the markdown before publishing — the published policy is a promise.',
  );
  process.exit(1);
}

console.log(`\n  retention cross-check: Worker ${seconds}s = ${days} days, and the policy says so.`);
console.log(`\nWrote ${PAGES.length + 1} pages to dist-legal/. Publish with: npm run deploy:legal`);
