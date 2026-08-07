/**
 * Static server for the exported web build, with extensionless rewrites.
 *
 * `expo export --platform web` writes one `settings.html` per route, but the
 * client router only matches the extensionless path — loading `/settings.html`
 * directly renders expo-router's "Unmatched Route" page. A plain
 * `python3 -m http.server` cannot bridge that, so the capture harness could
 * only ever screenshot the four tabs. This maps `/settings` to `settings.html`
 * so every pushed screen can be reached by URL.
 *
 *   node scripts/e2e/serve.mjs [dir] [port]
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] ?? '/tmp/wafra-web');
const PORT = Number(process.argv[3] ?? 8126);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

/** Resolve a request path to a file on disk, trying the .html rewrite. */
function resolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const candidates =
    clean === '/' || clean === ''
      ? ['index.html']
      : [clean.replace(/^\//, ''), `${clean.replace(/^\//, '')}.html`];
  for (const rel of candidates) {
    const file = path.join(ROOT, rel);
    // Never serve outside the export directory.
    if (!file.startsWith(ROOT)) continue;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

http
  .createServer((req, res) => {
    const file = resolve(req.url ?? '/');
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
