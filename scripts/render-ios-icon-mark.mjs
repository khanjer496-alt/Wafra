/**
 * Write the Icon Composer layer for the iOS app icon (assets/wafra.icon).
 *
 * Icon Composer and actool fill SVG paths and ignore strokes, so the in-app
 * mark (two open, round-capped stroked polylines in src/components/wafra-logo.tsx)
 * renders as a filled wedge closed by a stray line. This converts each stroke
 * into its exact filled outline: offset edges, round joins and round caps as
 * circular arcs. The geometry, stroke width and scale match assets/images/icon.png.
 *
 *   node scripts/render-ios-icon-mark.mjs          # write the layer
 *   node scripts/render-ios-icon-mark.mjs --check  # fail if it is stale
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const STROKE_WIDTH = 4.2; // same as render-icons.mjs
export const SCALE = 15; // icon.png: a 720 px box over the 48-unit viewBox
export const CANVAS = 1024;

/** Parse the mark's M/L/H/V polylines. */
export function parsePolyline(d) {
  const points = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, args] of d.matchAll(/([MLHV])\s*([-\d.\s]+)/g)) {
    const n = args.trim().split(/\s+/).map(Number);
    if (cmd === 'M' || cmd === 'L') [x, y] = n;
    else if (cmd === 'H') [x] = n;
    else [y] = n;
    points.push([x, y]);
  }
  return points;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const unit = (v) => mul(v, 1 / Math.hypot(v[0], v[1]));
const normal = (d) => [-d[1], d[0]];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

/** Closed outline of a round-capped, round-joined stroke of half-width r. */
export function strokeOutline(points, r) {
  const dirs = points.slice(1).map((p, i) => unit(sub(p, points[i])));
  const lens = points.slice(1).map((p, i) => Math.hypot(...sub(p, points[i])));
  const ops = [];
  // One side of the tube; sign +1 walks the +normal side forward,
  // sign -1 walks the -normal side backward.
  const side = (sign) => {
    const idx = sign > 0 ? points.map((_, i) => i) : points.map((_, i) => points.length - 1 - i);
    const segDir = (k) => (sign > 0 ? dirs[k] : mul(dirs[k], -1));
    const segs = sign > 0 ? dirs.map((_, k) => k) : dirs.map((_, k) => dirs.length - 1 - k);
    for (let j = 1; j < idx.length - 1; j++) {
      const p = points[idx[j]];
      const d1 = segDir(segs[j - 1]);
      const d2 = segDir(segs[j]);
      const m1 = normal(d1);
      const m2 = normal(d2);
      if (cross(d1, d2) > 0) {
        // Inner corner: the two offset edges meet.
        const q = add(p, mul(add(m1, m2), r / (1 + dot(m1, m2))));
        const back = dot(sub(p, q), d1);
        const lenIn = lens[segs[j - 1]];
        const lenOut = lens[segs[j]];
        if (back > lenIn || back > lenOut) throw new Error('segment too short for its inner join');
        ops.push(['L', q]);
      } else {
        ops.push(['L', add(p, mul(m1, r))]);
        ops.push(['A', add(p, mul(m2, r))]);
      }
    }
    const last = points[idx[idx.length - 1]];
    const dl = segDir(segs[segs.length - 1]);
    ops.push(['L', add(last, mul(normal(dl), r))]);
    // Round cap as two quarter arcs (a single half-circle arc is ambiguous).
    ops.push(['A', add(last, mul(dl, r))]);
    ops.push(['A', add(last, mul(normal(dl), -r))]);
  };
  const d0 = dirs[0];
  const start = add(points[0], mul(normal(d0), r));
  side(+1);
  side(-1);
  // Walking a tube this way keeps the outline on one winding; the arcs
  // turn with decreasing angle, which is SVG sweep-flag 0.
  return { start, ops };
}

const fmt = (n) => Number(n.toFixed(3)).toString();

export function outlinePath(points, r, transform) {
  const { start, ops } = strokeOutline(points, r);
  const t = (p) => transform(p).map(fmt).join(' ');
  const R = fmt(transform([r, 0])[0] - transform([0, 0])[0]);
  let d = `M${t(start)}`;
  for (const [op, p] of ops) d += op === 'L' ? ` L${t(p)}` : ` A${R} ${R} 0 0 0 ${t(p)}`;
  return `${d} Z`;
}

export function markPaths(logoSource) {
  const paths = [...logoSource.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]);
  if (paths.length !== 2) throw new Error('Expected original two-path W-arrow mark');
  return paths.map(parsePolyline);
}

/** The filled layer, centred on the mark's own bounds (as #80's layer was). */
export function renderLayer(logoSource) {
  const polylines = markPaths(logoSource);
  const r = STROKE_WIDTH / 2;
  const xs = polylines.flat().map((p) => p[0]);
  const ys = polylines.flat().map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const transform = ([x, y]) => [CANVAS / 2 + (x - cx) * SCALE, CANVAS / 2 + (y - cy) * SCALE];
  const body = polylines
    .map((pts) => `<path fill="#FFFFFF" fill-rule="nonzero" d="${outlinePath(pts, r, transform)}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}">${body}</svg>\n`;
}

export const LAYER = 'assets/wafra.icon/Assets/wafra-mark.svg';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const svg = renderLayer(readFileSync('src/components/wafra-logo.tsx', 'utf8'));
  if (process.argv.includes('--check')) {
    if (readFileSync(LAYER, 'utf8') !== svg) {
      console.error(`${LAYER} is stale: run node scripts/render-ios-icon-mark.mjs`);
      process.exit(1);
    }
  } else {
    writeFileSync(LAYER, svg);
    console.log(`${LAYER}: filled outline, ${CANVAS}×${CANVAS}`);
  }
}
