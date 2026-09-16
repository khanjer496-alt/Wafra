import fs from "node:fs";
import path from "node:path";

const outputDir = path.resolve(process.argv[2] ?? "dist");
const rawSiteUrl = process.env.EXPO_PUBLIC_WAFRA_SITE_URL;
let siteUrl = "";

try {
  const parsed = new URL(rawSiteUrl ?? "");
  const isOriginOnly =
    parsed.pathname === "/" && !parsed.search && !parsed.hash;
  const hostname = parsed.hostname.toLowerCase();
  const isPlaceholder =
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    hostname === "example.com" ||
    hostname === "example.org" ||
    hostname === "example.net" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".example") ||
    hostname.endsWith(".example.com") ||
    hostname.endsWith(".example.org") ||
    hostname.endsWith(".example.net") ||
    hostname.endsWith(".invalid") ||
    hostname.endsWith(".test");
  if (
    parsed.protocol === "https:" &&
    !parsed.username &&
    !parsed.password &&
    isOriginOnly &&
    !isPlaceholder
  ) {
    siteUrl = parsed.origin;
  }
} catch {
  // The single validation error below is more useful than URL's variants.
}

if (!siteUrl) {
  console.error(
    "EXPO_PUBLIC_WAFRA_SITE_URL must be Wafra's deployed HTTPS origin, not a placeholder.",
  );
  process.exit(1);
}

const indexPath = path.join(outputDir, "index.html");
const robotsPath = path.join(outputDir, "robots.txt");
if (!fs.existsSync(indexPath) || !fs.existsSync(robotsPath)) {
  console.error(`No static Expo export found at ${outputDir}.`);
  process.exit(1);
}

fs.rmSync(path.join(outputDir, "(tabs)"), { recursive: true, force: true });

const indexHtml = fs.readFileSync(indexPath, "utf8");
const staticIndexHtml = indexHtml
  .replace(
    /<script\b[^>]*\bsrc="\/_expo\/static\/js\/web\/[^"]+\.js"[^>]*><\/script>/g,
    "",
  )
  .replace(
    '<script type="module">globalThis.__EXPO_ROUTER_HYDRATE__=true;</script>',
    "",
  );
fs.writeFileSync(indexPath, staticIndexHtml);

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const inlineMarkdown = (value) =>
  escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)]+|mailto:[^)]+|\.\/privacy-policy\.md)\)/g,
      (_all, label, href) => {
        const resolved = href === "./privacy-policy.md" ? "/privacy/" : href;
        return `<a href="${resolved}">${label}</a>`;
      },
    );

const markdownToHtml = (source) => {
  const lines = source.replace(/\r/g, "").split("\n");
  const html = [];
  let paragraph = [];
  let list = null;
  let quote = [];
  const flushParagraph = () => {
    if (paragraph.length)
      html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list)
      html.push(
        `<${list.type}>${list.items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</${list.type}>`,
      );
    list = null;
  };
  const flushQuote = () => {
    if (quote.length)
      html.push(
        `<aside class="notice">${inlineMarkdown(quote.join(" "))}</aside>`,
      );
    quote = [];
  };
  const flush = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      const id = heading[2].toLowerCase().replace(/\[\[.*?\]\]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      html.push(`<h${level}${id ? ` id="${id}"` : ''}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (line.startsWith("> ")) {
      flushParagraph();
      flushList();
      quote.push(line.slice(2));
    } else if (bullet || ordered) {
      flushParagraph();
      flushQuote();
      const type = ordered ? "ol" : "ul";
      if (list?.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push((bullet || ordered)[1]);
    } else if (!line.trim()) {
      flush();
    } else {
      flushList();
      flushQuote();
      paragraph.push(line.trim());
    }
  }
  flush();
  return html.join("\n");
};

const legalCss = `
@font-face{font-family:Geist;src:url('/fonts/Geist-Regular.ttf')}@font-face{font-family:GeistSemi;src:url('/fonts/Geist-SemiBold.ttf')}
:root{color-scheme:light}*{box-sizing:border-box}html{background:#F4F1EA;color:#16130F;font-family:Geist,system-ui,sans-serif}body{margin:0}
a{color:#1F6B52;text-underline-offset:3px}.nav{align-items:center;background:#F4F1EA;border-bottom:1px solid #E3DED2;display:flex;justify-content:space-between;padding:18px max(20px,calc((100vw - 900px)/2));position:sticky;top:0;z-index:2}.brand{font:20px GeistSemi,sans-serif;text-decoration:none}.navlinks{display:flex;gap:18px;font-size:14px}.legal{margin:auto;max-width:820px;padding:64px 24px 96px}.legal h1,.legal h2,.legal h3{font-family:GeistSemi,sans-serif;font-weight:400;line-height:1.2}.legal h1{font-size:clamp(38px,7vw,58px);letter-spacing:-.04em;margin:0 0 12px}.legal h2{border-top:1px solid #E3DED2;font-size:26px;margin:52px 0 18px;padding-top:38px}.legal h3{font-size:20px;margin-top:30px}.legal p,.legal li{color:#49443D;line-height:1.75}.legal li+li{margin-top:10px}.notice{background:#E8E3D8;border-left:4px solid #1F6B52;line-height:1.65;margin:28px 0;padding:18px 20px}.eyebrow{color:#1F6B52;font-size:12px;letter-spacing:.08em;text-transform:uppercase}.supportGrid{display:grid;gap:18px;grid-template-columns:repeat(2,minmax(0,1fr));margin-top:32px}.supportCard{border:1px solid #D6CFC1;padding:24px}.supportCard h2{border:0;font-size:21px;margin:0 0 12px;padding:0}.supportCard p{margin:0}.back{display:inline-block;margin-top:48px}@media(max-width:600px){.nav{align-items:flex-start;gap:12px;position:static}.navlinks{flex-wrap:wrap;justify-content:flex-end}.legal{padding-top:44px}.supportGrid{grid-template-columns:1fr}}
`;

const shell = ({
  title,
  description,
  canonicalPath,
  body,
  robots = "index, follow",
}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta name="robots" content="${robots}">
<link rel="canonical" href="${siteUrl}${canonicalPath}"><link rel="icon" href="/wafra-icon.svg" type="image/svg+xml"><style>${legalCss}</style></head>
<body><nav class="nav" aria-label="Site navigation"><a class="brand" href="/">Wafra · وفرة</a><div class="navlinks"><a href="/privacy/">Privacy</a><a href="/terms/">Terms</a><a href="/support/">Support</a></div></nav>${body}</body></html>`;

const writePage = (route, html) => {
  const directory = path.join(outputDir, route);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "index.html"), html);
};

const privacyMarkdown = fs.readFileSync(
  path.resolve("docs/privacy-policy.md"),
  "utf8",
);
const termsMarkdown = fs.readFileSync(
  path.resolve("docs/terms-of-use.md"),
  "utf8",
);
writePage(
  "privacy",
  shell({
    title: "Privacy Policy | Wafra",
    description:
      "How Wafra handles device data, optional imports, storage, security and deletion.",
    canonicalPath: "/privacy/",
    body: `<main class="legal">${markdownToHtml(privacyMarkdown)}<a class="back" href="/">Back to Wafra</a></main>`,
  }),
);
writePage(
  "terms",
  shell({
    title: "Terms of Use | Wafra",
    description:
      "Terms for using the Wafra personal money manager on Android and iOS.",
    canonicalPath: "/terms/",
    body: `<main class="legal">${markdownToHtml(termsMarkdown)}<a class="back" href="/">Back to Wafra</a></main>`,
  }),
);
writePage(
  "support",
  shell({
    title: "Support | Wafra",
    description:
      "Get help with Wafra, review privacy information, and find data deletion guidance.",
    canonicalPath: "/support/",
    body: `<main class="legal"><p class="eyebrow">Wafra support</p><h1>How can we help?</h1><p>For help with Wafra, email <a href="mailto:support@nasidaapps.com">support@nasidaapps.com</a>. Do not include bank message text, account numbers, card numbers, passwords or verification codes.</p><div class="supportGrid"><section class="supportCard"><h2>Privacy and data</h2><p>Read what Wafra processes, where data is stored, and the choices available in the app.</p><p><a href="/privacy/">Read the Privacy Policy</a></p></section><section class="supportCard"><h2>Delete Wafra data</h2><p>Use <strong>Settings → Erase all data</strong> while online to erase local data and request deletion of relay registration and queued data. Exported files must be deleted where you saved them.</p><p><a href="/privacy/#your-choices-and-deletion">Read deletion details</a></p></section><section class="supportCard"><h2>Terms</h2><p>Review the terms and limits for the app before using it.</p><p><a href="/terms/">Read the Terms of Use</a></p></section><section class="supportCard"><h2>Billing</h2><p>Subscriptions are managed through the store where they were purchased. Wafra does not handle payment details.</p><p><a href="/terms/#wafra-pro-trial-and-billing">Read billing terms</a></p></section></div><a class="back" href="/">Back to Wafra</a></main>`,
  }),
);

const notFoundHtml = shell({
  title: "Page not found | Wafra",
  description: "This Wafra page could not be found.",
  canonicalPath: "/404.html",
  robots: "noindex, nofollow, noarchive",
  body: '<main class="legal"><p class="eyebrow">404</p><h1>That page is not here.</h1><p>The address may be wrong, or the page may have moved.</p><a class="back" href="/">Go to Wafra home</a></main>',
});
fs.writeFileSync(path.join(outputDir, "404.html"), notFoundHtml);

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${siteUrl}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>${siteUrl}/privacy/</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>
  <url><loc>${siteUrl}/terms/</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>
  <url><loc>${siteUrl}/support/</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>
</urlset>\n`;
fs.writeFileSync(path.join(outputDir, "sitemap.xml"), sitemap);
const robots = fs.readFileSync(robotsPath, "utf8").trimEnd();
fs.writeFileSync(robotsPath, `${robots}\nSitemap: ${siteUrl}/sitemap.xml\n`);
console.log(`Finalized web SEO and public pages for ${siteUrl}.`);
