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
  '.mp4': 'video/mp4',
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
    const size = fs.statSync(file).size;
    const headers = {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      'accept-ranges': 'bytes',
    };
    let start = 0; let end = size - 1;
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        if (match[1]) {
          start = Number(match[1]);
          end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        } else {
          start = Math.max(0, size - Number(match[2]));
        }
      }
      if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) || start >= size || end < start) {
        res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` });
        res.end();
        return;
      }
      headers['content-range'] = `bytes ${start}-${end}/${size}`;
    }
    res.writeHead(range ? 206 : 200, { ...headers, 'content-length': range ? end - start + 1 : size });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file, range ? { start, end } : undefined).pipe(res);
  })
  .listen(PORT, function () { console.log(`serving ${ROOT} on http://localhost:${this.address().port}`); });
