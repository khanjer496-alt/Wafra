'use strict';
// The lock screen's pattern keeps the person's shapes and colours but never
// their initial or the icons of the categories they watch: the lock is shown
// to whoever holds the phone. Home and the recap keep the full pattern.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const theme = load(path.join(root, 'src/constants/theme.ts'), { '@/global.css': {}, 'react-native': { Platform: { select: (x) => x.ios } } });
const pattern = load(path.join(root, 'src/lib/pattern.ts'), { '@/constants/theme': theme });
const { redactPatternTiles } = load(path.join(root, 'src/lib/pattern-redact.ts'));

const full = pattern.buildPattern({
  name: 'Sara',
  goals: ['bills', 'salary', 'subscriptions', 'cash-cards', 'spend-less'],
  watched: ['dining', 'groceries'],
  reminders: { bills: true, cards: true, dailySummary: true },
});

test('the full pattern does carry the initial and the watched categories', () => {
  assert.ok(full.some((tile) => tile.kind === 'letter' && tile.letter === 'S'));
  assert.equal(full.filter((tile) => tile.kind === 'glyph' && tile.category).length, 2);
});

test('the lock pattern has no letter, no glyph and no category anywhere', () => {
  const locked = redactPatternTiles(full);
  for (const tile of locked) {
    assert.notEqual(tile.kind, 'letter');
    assert.notEqual(tile.kind, 'glyph');
    assert.equal(tile.letter, undefined, tile.key);
    assert.equal(tile.category, undefined, tile.key);
  }
  assert.doesNotMatch(JSON.stringify(locked), /Sara|"S"|dining|groceries/);
});

test('every cell stays where it was, in its own colour', () => {
  const locked = redactPatternTiles(full);
  assert.equal(locked.length, full.length);
  full.forEach((tile, index) => {
    const out = locked[index];
    assert.deepEqual([out.col, out.row, out.order], [tile.col, tile.row, tile.order]);
    if (tile.kind === 'letter') assert.deepEqual([out.kind, out.color], ['square', tile.color]);
    else if (tile.kind === 'glyph') assert.deepEqual([out.kind, out.color], ['circle', tile.mark ?? tile.color]);
    else assert.equal(out, tile, 'plain shapes pass through untouched');
  });
  assert.equal(new Set(locked.map((tile) => tile.key)).size, locked.length, 'keys stay unique');
});

test('the lock gate draws only the redacted pattern; Home keeps the full one', () => {
  const gate = read('src/components/lock-gate.tsx');
  assert.match(gate, /<LockPattern /);
  assert.doesNotMatch(gate, /YourPattern|buildPattern|usePatternTiles|PatternMosaic/);
  const lockPattern = read('src/components/settings-band/lock-pattern.tsx');
  assert.match(lockPattern, /redactPatternTiles\(tiles\)/);
  assert.match(lockPattern, /<PatternMosaic tiles=\{redacted\}/);
  assert.match(read('src/screens/journal-home-screen.tsx'), /<YourPattern /);
});
