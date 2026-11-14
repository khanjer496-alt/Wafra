'use strict';
// The iOS app icon is an Icon Composer document (assets/wafra.icon). Build 193
// shipped a filled wedge with a stray line because its layer was an open
// stroked path: Icon Composer/actool fill paths and drop strokes. These checks
// keep the layer a filled outline of the exact in-app mark and keep the glass
// effects that blurred it switched off. scripts/test/ios-app-icon.sh compiles
// and renders it with Xcode on the native-ios CI job.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '../../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const generator = () => import(pathToFileURL(path.join(root, 'scripts/render-ios-icon-mark.mjs')).href);
const brand = 'extended-srgb:0.12157,0.41961,0.32157,1.00000'; // #1F6B52
const darkBrand = 'extended-srgb:0.34118,0.72157,0.58039,1.00000'; // #57B894

test('iOS uses the Icon Composer document and the flat PNG stays the generic icon', () => {
  const expo = JSON.parse(read('app.json')).expo;
  assert.equal(expo.ios.icon, './assets/wafra.icon');
  assert.equal(expo.icon, './assets/images/icon.png');
});

test('the layer is the committed filled outline of the exact in-app mark', async () => {
  const {renderLayer, LAYER} = await generator();
  assert.equal(LAYER, 'assets/wafra.icon/Assets/wafra-mark.svg');
  assert.equal(read(LAYER), renderLayer(read('src/components/wafra-logo.tsx')),
    'stale layer: run node scripts/render-ios-icon-mark.mjs');
});

test('the layer has no strokes, only closed white fills', () => {
  const svg = read('assets/wafra.icon/Assets/wafra-mark.svg');
  assert.doesNotMatch(svg, /stroke/);
  assert.doesNotMatch(svg, /fill="none"/);
  assert.doesNotMatch(svg, /transform=/);
  const paths = [...svg.matchAll(/<path ([^>]*)\/>/g)].map(m => m[1]);
  assert.equal(paths.length, 2, 'W and arrow');
  for (const attrs of paths) {
    assert.match(attrs, /fill="#FFFFFF"/);
    assert.match(attrs, /d="M[^"]+ Z"/, 'every outline is closed');
  }
});

test('the outline matches the stroked geometry it replaces', async () => {
  const {parsePolyline, strokeOutline, STROKE_WIDTH} = await generator();
  const r = STROKE_WIDTH / 2;
  // Every outline vertex lies exactly r from the polyline it outlines.
  const distance = (p, a, b) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  for (const d of ['M8 15 L15.5 33 L23 19 L30.5 33 L40 11.5', 'M34 11.5 H40 V17.5']) {
    const points = parsePolyline(d);
    const {start, ops} = strokeOutline(points, r);
    for (const p of [start, ...ops.map(([, q]) => q)]) {
      const nearest = Math.min(...points.slice(1).map((b, i) => distance(p, points[i], b)));
      assert.ok(Math.abs(nearest - r) < 1e-9, `${d}: vertex ${p} is ${nearest} from the stroke`);
    }
  }
  assert.deepEqual(parsePolyline('M34 11.5 H40 V17.5'), [[34, 11.5], [40, 11.5], [40, 17.5]]);
});

test('icon.json is a flat brand-green tile without glass blur, shadow or gradient', () => {
  const icon = JSON.parse(read('assets/wafra.icon/icon.json'));
  assert.deepEqual(icon.fill, {solid: brand});
  assert.equal(icon.groups.length, 1);
  const [group] = icon.groups;
  assert.equal(group.translucency.enabled, false);
  assert.equal(group.specular, false);
  assert.equal(group.shadow.kind, 'none');
  assert.equal(group.layers.length, 1);
  const [layer] = group.layers;
  assert.equal(layer['image-name'], 'wafra-mark.svg');
  assert.deepEqual(layer['fill-specializations'], [{appearance: 'dark', value: {solid: darkBrand}}]);
  assert.ok(read('src/constants/theme.ts').includes("primary: '#57B894'"), 'dark mark is the dark-theme primary');
  assert.deepEqual(fs.readdirSync(path.join(root, 'assets/wafra.icon/Assets')), ['wafra-mark.svg']);
});
