import fs from 'node:fs';
import path from 'node:path';

const escapeHtml = (value) => value
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

// The checked-in policy documents use this small Markdown subset. Escape all
// source text; render only these explicit constructs, never embedded HTML.
const inlineMarkdown = (source) => {
  const token = /`([^`]+)`|\*\*([^*]+)\*\*|_([^_]+)_|\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|\.\/privacy-policy\.md)\)/g;
  let result = '';
  let cursor = 0;
  for (const match of source.matchAll(token)) {
    result += escapeHtml(source.slice(cursor, match.index));
    if (match[1]) result += `<code>${escapeHtml(match[1])}</code>`;
    else if (match[2]) result += `<strong>${inlineMarkdown(match[2])}</strong>`;
    else if (match[3]) result += `<em>${inlineMarkdown(match[3])}</em>`;
    else {
      const href = match[5] === './privacy-policy.md' ? '/privacy/' : match[5];
      result += `<a href="${escapeHtml(href)}">${escapeHtml(match[4])}</a>`;
    }
    cursor = match.index + match[0].length;
  }
  return result + escapeHtml(source.slice(cursor));
};

export const markdownToHtml = (source) => {
  const html = [];
  let paragraph = [];
  let list = null;
  let quote = [];
  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) html.push(`<${list.type}>${list.items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) html.push(`<aside class="notice">${inlineMarkdown(quote.join(' '))}</aside>`);
    quote = [];
  };
  const flush = () => { flushParagraph(); flushList(); flushQuote(); };

  for (const line of source.replace(/\r/g, '').split('\n')) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const item = line.match(/^([-*]|\d+\.)\s+(.+)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      const id = heading[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      html.push(`<h${level} id="${id}">${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (line.startsWith('> ')) {
      flushParagraph(); flushList();
      quote.push(line.slice(2));
    } else if (item) {
      flushParagraph(); flushQuote();
      const type = /^\d/.test(item[1]) ? 'ol' : 'ul';
      if (list?.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push(item[2]);
    } else if (!line.trim()) {
      flush();
    } else if (list && /^\s+/.test(line)) {
      // Markdown source wraps list text across lines. Keep the continuation
      // inside its list item so numbered instructions do not restart at 1.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList(); flushQuote();
      paragraph.push(line.trim());
    }
  }
  flush();
  return html.join('\n');
};

const legalCss = `
@font-face{font-family:Geist;src:url('/fonts/Geist-Regular.ttf');font-display:swap}
@font-face{font-family:GeistSemi;src:url('/fonts/Geist-SemiBold.ttf');font-display:swap}
:root{color-scheme:light}*{box-sizing:border-box}html{background:#F4F1EA;color:#14120F;font-family:Geist,system-ui,sans-serif}body{margin:0}
a{color:#1F6B52;text-underline-offset:3px}a:focus-visible{outline:2px solid #1F6B52;outline-offset:4px}
.skip{position:absolute;left:20px;top:-100px;z-index:3;background:#F4F1EA;padding:12px}.skip:focus{top:12px}
.nav{align-items:center;background:#F4F1EA;border-bottom:1px solid #E3DED2;display:flex;justify-content:space-between;gap:16px;padding:8px max(20px,calc((100vw - 900px)/2));position:sticky;top:0;z-index:2}
.brand{font:20px GeistSemi,sans-serif;text-decoration:none;white-space:nowrap}.nav a{display:inline-block;padding:12px 0}.navlinks{display:flex;gap:18px;font-size:14px}
.legal{margin:auto;max-width:820px;padding:64px 24px 96px;overflow-wrap:anywhere}.legal h1,.legal h2,.legal h3{font-family:GeistSemi,sans-serif;font-weight:400;line-height:1.2;scroll-margin-top:100px}
.legal h1{font-size:clamp(38px,7vw,58px);letter-spacing:-.04em;margin:0 0 12px}.legal h2{border-top:1px solid #E3DED2;font-size:26px;margin:52px 0 18px;padding-top:38px}.legal h3{font-size:20px;margin-top:30px}
.legal p,.legal li{color:#49443D;line-height:1.75}.legal li+li{margin-top:10px}.legal code{font-size:.9em}.notice{background:#E8E3D8;border-left:4px solid #1F6B52;line-height:1.65;margin:28px 0;padding:18px 20px}
.eyebrow{color:#1F6B52;font-size:12px;letter-spacing:.08em;text-transform:uppercase}.supportGrid{display:grid;gap:18px;grid-template-columns:repeat(2,minmax(0,1fr));margin-top:32px}.supportCard{border:1px solid #D6CFC1;padding:24px}.supportCard h2{border:0;font-size:21px;margin:0 0 12px;padding:0}.supportCard p{margin:0}.supportCard p+p{margin-top:12px}.back{display:inline-block;margin-top:48px;padding:12px 0}
@media(max-width:600px){.nav{align-items:flex-start;flex-wrap:wrap;gap:0 16px;position:static}.navlinks{flex-wrap:wrap}.legal{padding-top:44px}.supportGrid{grid-template-columns:1fr}}
`;

export const writePublicPages = (outputDir, siteUrl) => {
  // Resolve documents from this checkout even when invoked outside its cwd.
  const privacyMarkdown = fs.readFileSync(new URL('../docs/privacy-policy.md', import.meta.url), 'utf8');
  const termsMarkdown = fs.readFileSync(new URL('../docs/terms-of-use.md', import.meta.url), 'utf8');
  const contact = privacyMarkdown.match(/\[([^\]]+)\]\(mailto:([^\s)]+)\)/);
  if (!contact) throw new Error('The privacy policy must supply the public support contact.');
  const contactLink = `<a href="mailto:${escapeHtml(contact[2])}">${escapeHtml(contact[1])}</a>`;

  const shell = ({ title, description, canonicalPath, body, robots = 'index, follow' }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="${robots}">
<link rel="canonical" href="${escapeHtml(siteUrl + canonicalPath)}"><link rel="icon" href="/wafra-icon.svg" type="image/svg+xml"><style>${legalCss}</style></head>
<body><a class="skip" href="#main">Skip to content</a><nav class="nav" aria-label="Site navigation"><a class="brand" href="/">Wafra · <span lang="ar" dir="rtl">وفرة</span></a><div class="navlinks"><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a><a href="/support/">Support</a></div></nav><main id="main" class="legal">${body}</main></body></html>`;
  const writePage = (route, options) => {
    fs.mkdirSync(path.join(outputDir, route), { recursive: true });
    fs.writeFileSync(path.join(outputDir, route, 'index.html'), shell({ ...options, canonicalPath: `/${route}/` }));
  };
  const back = '<a class="back" href="/">Back to Wafra</a>';
  writePage('privacy', {
    title: 'Privacy Policy | Wafra',
    description: 'How Wafra handles device data, optional imports, storage, security and deletion.',
    body: `${markdownToHtml(privacyMarkdown)}${back}`,
  });
  writePage('terms', {
    title: 'Terms of Use | Wafra',
    description: 'Terms for using the Wafra personal money manager on Android and iOS.',
    body: `${markdownToHtml(termsMarkdown)}${back}`,
  });
  writePage('support', {
    title: 'Support | Wafra',
    description: 'Get help with Wafra, review privacy information, and find data deletion guidance.',
    body: `<p class="eyebrow">Wafra support</p><h1>How can we help?</h1><p>For help with Wafra, email ${contactLink}. Do not include bank message text, account numbers, card numbers, passwords or verification codes.</p><div class="supportGrid"><section class="supportCard"><h2>Privacy and data</h2><p>Read what Wafra processes, where data is stored, and the choices available in the app.</p><p><a href="/privacy/">Read the Privacy Policy</a></p></section><section class="supportCard"><h2>Delete Wafra data</h2><p>Use <strong>Settings → Erase all data</strong> while online to erase local data and request deletion of relay registration and queued data. Exported files must be deleted where you saved them.</p><p><a href="/privacy/#your-choices-and-deletion">Read deletion details</a></p></section><section class="supportCard"><h2>Terms</h2><p>Review the terms and limits for the app before using it.</p><p><a href="/terms/">Read the Terms of Use</a></p></section><section class="supportCard"><h2>Billing</h2><p>Subscriptions are managed through the store where they were purchased. Wafra does not handle payment details.</p><p><a href="/terms/#wafra-pro-trial-and-billing">Read billing terms</a></p></section></div>${back}`,
  });
  // Cloudflare Pages serves this document for unknown URLs instead of its SPA
  // fallback. It must remain outside the sitemap and must not load the app.
  fs.writeFileSync(path.join(outputDir, '404.html'), shell({
    title: 'Page not found | Wafra', description: 'This Wafra page could not be found.',
    canonicalPath: '/404.html', robots: 'noindex, nofollow, noarchive',
    body: '<p class="eyebrow">404</p><h1>That page is not here.</h1><p>The address may be wrong, or the page may have moved.</p><a class="back" href="/">Go to Wafra home</a>',
  }));
};
