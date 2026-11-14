#!/usr/bin/env node
// Read-only comparison of production Expo exports. Not an IPA/AAB size estimate.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const [before, after, output] = process.argv.slice(2).map(p => path.resolve(p));
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const marks = new Set(walk(path.join(before, 'assets/merchants')).filter(f => f.endsWith('.png')).map(hash));
const measurements = {};
fs.mkdirSync(output, { recursive: true });
for (const [label, project] of [['before', before], ['after', after]]) {
  measurements[label] = {};
  for (const platform of ['ios', 'android']) {
    const dir = path.join(output, `${label}-${platform}`);
    const run = spawnSync(process.execPath, [path.join(project, 'node_modules/expo/bin/cli'), 'export', '--platform', platform,
      '--output-dir', dir, '--dump-assetmap', '--max-workers', '1'], {
      cwd: project, encoding: 'utf8', env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' }, maxBuffer: 20 * 1024 * 1024,
    });
    fs.writeFileSync(path.join(output, `${label}-${platform}.log`), run.stdout + run.stderr);
    if (run.status !== 0) throw new Error(`${label}/${platform} export failed: ${run.status}\n${run.stderr}`);
    const files = walk(dir);
    const bundles = files.filter(f => /\.(?:hbc|js)$/.test(f) && f.includes('_expo'));
    if (!bundles.length || !bundles.some(f => f.endsWith('.hbc'))) throw new Error('Hermes bytecode missing: ' + dir);
    const assets = files.filter(f => f.startsWith(path.join(dir, 'assets') + path.sep));
    const sum = list => list.reduce((n, f) => n + fs.statSync(f).size, 0);
    const shippedMarks = assets.filter(f => marks.has(hash(f)));
    measurements[label][platform] = { hermesBytes: sum(bundles), assetBytes: sum(assets), assets: assets.length,
      totalExportBytes: sum(files), thirdPartyMarkFiles: shippedMarks.length };
    if (label === 'after' && shippedMarks.length) throw new Error('Third-party artwork survived export');
  }
}
measurements.delta = {};
for (const platform of ['ios', 'android']) measurements.delta[platform] = Object.fromEntries(
  Object.entries(measurements.after[platform]).map(([key, value]) => [key, value - measurements.before[platform][key]]));
fs.writeFileSync(path.join(output, 'measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
console.log(JSON.stringify(measurements, null, 2));
