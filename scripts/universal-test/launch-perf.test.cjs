'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-ts.cjs').createLoader();
const { inspectMarketAlert, withAlertSemanticsMemo } = load('@/lib/alert-semantics');
const { rememberDuringInspection, withAlertInspectionMemo } = load('@/lib/alert-draft');
const { inspectUniversalBankEvent } = load('@/lib/universal-parser');

// Parser performance round (lane perf). Pinned here:
//  1. Every regex rewritten for speed matches EXACTLY what its old spelling
//     matched (same matches, indexes and groups, by matchAll and by test) on
//     randomised text built from the pattern's own vocabulary, and runs in
//     bounded time on an 8 KB blank run. The old spellings live only here.
//     The rewrites stop a second match start inside a blank run that an
//     earlier separator already covers; on iPhone (JavaScriptCore without a
//     JIT) the old spellings took seconds on a 4 KB run of newlines.
//  2. The per-inspection memo that shares pack-independent answers across the
//     20 language packs changes no reading and keeps nothing afterwards.
//  3. The vocabulary shortcut's case-folding assumption holds in this engine.
// The time limit is generous on purpose (CI machines are slow and shared).
// All bodies are synthetic, with fictional shops, numbers and amounts.
const timed = (run) => {
  const started = process.hrtime.bigint();
  const value = run();
  return { value, ms: Number(process.hrtime.bigint() - started) / 1e6 };
};
const LIMIT_MS = 500;

// ── 1. Rewritten patterns match exactly what the old spellings matched ───────
const root = path.resolve(__dirname, '../..');
/** The regex literal assigned to `const NAME =` in a source file. */
function literal(file, name) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const at = source.indexOf(`const ${name} =`);
  assert.ok(at >= 0, `${name} in ${file}`);
  let i = source.indexOf('/', at + name.length + 8);
  let inClass = false;
  let body = '';
  for (i += 1; i < source.length; i += 1) {
    const c = source[i];
    if (c === '\\') { body += c + source[i + 1]; i += 1; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) break;
    body += c;
  }
  const flags = /^[a-z]*/.exec(source.slice(i + 1))[0];
  return new RegExp(body, flags);
}
function random(seed) {
  let state = seed;
  return () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x7fffffff; };
}
const signature = (re, text, replaceWithBlanks) => {
  if (replaceWithBlanks) return text.replace(new RegExp(re.source, re.flags), (m) => ' '.repeat(m.length));
  const first = text.match(new RegExp(re.source, re.flags.replace('g', '')));
  const all = [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))]
    .map((m) => [m.index, ...m]);
  return JSON.stringify([first && [first.index, ...first], all]);
};
function sameMatches(oldRe, newRe, tokens, { rounds = 40000, seed = 7, replaceWithBlanks = false } = {}) {
  const next = random(seed);
  for (let round = 0; round < rounds; round += 1) {
    let text = '';
    const length = 1 + Math.floor(next() * 12);
    for (let k = 0; k < length; k += 1) text += tokens[Math.floor(next() * tokens.length)];
    assert.equal(signature(newRe, text, replaceWithBlanks), signature(oldRe, text, replaceWithBlanks), `differs on ${JSON.stringify(text)}`);
  }
}

// Each pair: the spelling before this round, the source file and the line
// marker of its current spelling. The old ones are kept only here.
const rewrites = [
  ['src/lib/universal-fields.ts', 'से\\s+(?=[A-Z]{3}', String.raw`((?:^|[।\n\]])\s*)([\p{L}\p{M}][\p{L}\p{M}\p{N} &'’.*_-]{1,95}?)\s+से\s+(?=[A-Z]{3}\s*\d[\d.,]*\s+(?:की\s+रिफंड\s+राशि|का\s+रिफंड))`, 'gu'],
  ['src/lib/universal-fields.ts', 'işyerindeki\\s+(?=', String.raw`((?:^|[.!?。।;\n\]])\s*)([\p{L}\p{M}][\p{L}\p{M}\p{N} &'’.*_-]{1,95}?)\s+işyerindeki\s+(?=[A-Z]{3}\s*\d)`, 'giu'],
  ['src/lib/universal-fields.ts', 'alışverişiniz\\s+tamamlandı/', String.raw`((?:^|[.!?。।;\n\]])\s*)([\p{L}\p{M}][\p{L}\p{M}\p{N} &'’.*_-]{1,95}?)\s+alışverişiniz\s+tamamlandı`, 'giu'],
  ['src/lib/universal-fields.ts', 'での購入が完了しました/', String.raw`((?:^|[.!?。।;\n\]])\s*)([\p{L}\p{M}\p{N} &'’.*_-]{2,96}?)での購入が完了しました`, 'gu'],
  ['src/lib/universal-fields.ts', 'の電気料金の請求です/', String.raw`((?:^|[.!?。।;\n\]])\s*)([\p{L}\p{M}\p{N} &'’.*_-]{2,96}?)の電気料金の請求です`, 'gu'],
  ['src/lib/universal-fields.ts', '的消费已完成/', String.raw`((?:^|[.!?。।;\n\]])\s*您在)([\p{L}\p{M}\p{N} &'’.*_-]{2,96}?)的消费已完成`, 'gu'],
  ['src/lib/universal-fields.ts', '的退款(?=', String.raw`((?:^|[.!?。।;\n\]])\s*)([\p{L}\p{M}\p{N} &'’.*_-]{2,96}?)的退款(?=\s*(?:[A-Z]{3}\s*\d|[$€£¥]\s*\d)[\d.,]*\s*已到账)`, 'gu'],
  ['src/lib/universal-fields.ts', '(?:لدى|من|جهة|الجهة)\\s*[:：]', String.raw`(?:^|\n)\s*(?:لدى|من|جهة|الجهة)\s*[:：]\s*`, 'gu'],
  ['src/lib/universal-fields.ts', 'مبلغ\\s*:/u', String.raw`(?:^|\n)\s*مبلغ\s*:`, 'u'],
  ['src/lib/universal-parser.ts', 'const WORLD_EXAMPLE_LEAD', String.raw`(?:^|[:/\n]\s*|[.!?]\s+)(?:exemple|beispiel|ejemplo|esempio|voorbeeld|exemplo|przyk[łl]ad|exempel|eksempel|p[řr][íi]klad|مثال)\s*[.:]`, 'iu'],
  ['src/lib/universal-parser.ts', 'const ENGLISH_EXAMPLE_LEAD', String.raw`(?:^|[:/\n]\s*|[.!?]\s+)(?:example|sample(?:\s+alert)?|tip|pro\s+tip|hint)\s*(?:[.:]|[-–—]\s|\n)`, 'iu'],
  ['src/lib/universal-parser.ts', 'const challengeHeader', String.raw`\b(?:otp|verification\s+code|security\s+code)\s*(?:is\s*)?[:=-]?\s*\p{N}`, 'iu'],
  ['src/lib/universal-parser.ts', 'مبلغ\\s*:/u.test(structured)', String.raw`(?:^|\n)\s*مبلغ\s*:`, 'u'],
];
/** The regex literal on the line holding `marker`. */
function literalOnLine(file, marker) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `${marker} in ${file}`);
  const line = source.slice(source.lastIndexOf('\n', at) + 1, source.indexOf('\n', at));
  const from = line.indexOf('/', line.indexOf('=') >= 0 && !line.trim().startsWith('/') ? line.indexOf('=') : 0);
  let i = from + 1, inClass = false, body = '';
  for (; i < line.length; i += 1) {
    const c = line[i];
    if (c === '\\') { body += c + line[i + 1]; i += 1; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) break;
    body += c;
  }
  return new RegExp(body, /^[a-z]*/.exec(line.slice(i + 1))[0]);
}
for (const [file, marker, oldSource, oldFlags] of rewrites) {
  test(`${path.basename(file)} ${marker.slice(0, 32)}: same matches as before, linear on blank runs`, () => {
    const old = new RegExp(oldSource, oldFlags);
    const current = literalOnLine(file, marker);
    assert.equal(current.flags, old.flags);
    assert.notEqual(current.source, old.source, 'the pattern was rewritten');
    const words = [...new Set(oldSource.match(/\p{L}{2,}/gu) ?? [])].slice(0, 12);
    const tokens = [' ', '  ', '\n', '\r', '\t', ' \n', '.', '!', '?', '。', '।', ';', ']', ',', ':', '/', '-', '=', 'x', 'A',
      'AED 5', 'ABC 12', '12', '5', 'SHOP', 'is', ...words, ...words.map((w) => `${w} `), ...words.map((w) => ` ${w}`)];
    sameMatches(old, current, tokens, { rounds: 20000, seed: oldSource.length });
    for (const body of ['\n'.repeat(8192) + '#', ' \n'.repeat(4096) + '#', `.${'\n'.repeat(8192)}#`, `${words[0] ?? 'x'}${'\n'.repeat(8192)}#`]) {
      const { ms } = timed(() => body.replace(new RegExp(current.source, current.flags.includes('g') ? current.flags : `${current.flags}g`), ''));
      assert.ok(ms < LIMIT_MS, `${ms.toFixed(0)} ms on an 8 KB blank run`);
    }
  });
}

// ── 2. The per-inspection memo changes nothing and keeps nothing ─────────────
const bodies = [
  'You made a $20.91 purchase at SAMPLE SHOP with your Visa Debit ••9760 on Sep 26, 2026 at 11:16 AM.',
  'SAMPLE PERSON a reçu votre paiement de 131,45 €.',
  'Card purchase of KWD 566.000 at SAMPLE MART. Available balance KWD 1,200.500',
  'Your card ending 4321 was used for AED 45.00 at SAMPLE CAFE. If you did not make this transaction, call 600 000000.',
  'Did you attempt a USD 1,299.00 purchase at SAMPLE OUTLET? Reply YES or NO.',
  'Vi har belastet et gebyr på 348,02 kr 09.10.2026.',
  'تم خصم مبلغ 50.00 ر.س من بطاقتك المنتهية بـ 4321 لدى SAMPLE STORE',
];
const markets = ['US', 'GB', 'FR', 'DE', 'ES', 'IT', 'NL', 'IN', 'QA', 'KW', 'BH', 'OM', 'EG', 'JO', 'PT', 'PL', 'SE', 'DK', 'NO', 'CZ'];
test('a pack reading inside the shared memo equals the same reading alone', () => {
  for (const body of bodies) {
    const alone = markets.map((market) => inspectMarketAlert(body, market, {}));
    const shared = withAlertSemanticsMemo(() => markets.map((market) => inspectMarketAlert(body, market, {})));
    assert.deepEqual(shared, alone, body);
  }
});
test('the universal reader gives the same event on a repeat call', () => {
  for (const body of bodies) assert.deepEqual(inspectUniversalBankEvent(body, {}), inspectUniversalBankEvent(body, {}), body);
});
test('the inspection memo is dropped when its outermost call returns or throws', () => {
  let computed = 0;
  const owner = {};
  const ask = () => rememberDuringInspection(owner, 'text', () => { computed += 1; return computed; });
  withAlertInspectionMemo(() => {
    assert.equal(ask(), 1);
    assert.equal(withAlertInspectionMemo(() => ask()), 1, 'a nested call shares the outer memo');
    assert.equal(ask(), 1);
  });
  assert.equal(ask(), 2, 'outside a memo every call computes afresh');
  assert.equal(ask(), 3);
  assert.throws(() => withAlertInspectionMemo(() => { ask(); throw new Error('stop'); }), /stop/);
  assert.equal(withAlertInspectionMemo(() => ask()), 5, 'a throw does not leave the memo behind');
});

// ── 3. The vocabulary shortcut relies on lower case agreeing with /iu folding ──
// findTerm skips a list whose terms do not occur in the lower-cased text. That
// is exact only where `c.toLowerCase()` agrees with the engine's case folding;
// the exceptions are listed in FOLD_UNSAFE and bypass the shortcut. This checks
// the engine still agrees everywhere else (all cased BMP and astral blocks).
test('lower case agrees with /iu case folding outside FOLD_UNSAFE', () => {
  const source = fs.readFileSync(path.join(root, 'src/lib/alert-semantics.ts'), 'utf8');
  const unsafe = literal('src/lib/alert-draft.ts', 'FOLD_UNSAFE');
  assert.ok(source.includes('needles.some((needle) => FOLD_UNSAFE.test(needle))'), 'a list with an unsafe term has no shortcut');
  assert.ok(fs.readFileSync(path.join(root, 'src/lib/alert-draft.ts'), 'utf8').includes('tokens.some((token) => FOLD_UNSAFE.test(token))'), 'an unsafe alias has no shortcut');
  const ranges = [[0, 0xffff], [0x10400, 0x1044f], [0x104b0, 0x104fb], [0x10570, 0x105bc], [0x10c80, 0x10cff],
    [0x118a0, 0x118df], [0x16e40, 0x16e7f], [0x1e900, 0x1e95f]];
  const single = (s) => [...s].length === 1;
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  // Candidates for "the same letter under /iu": a character's own upper and
  // lower case, and every character sharing the compatibility decomposition of
  // its lower case (that is where U+0390/U+1FD3 and U+FB05/U+FB06 live).
  const groups = new Map();
  for (const [from, to] of ranges) {
    for (let cp = from; cp <= to; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const c = String.fromCodePoint(cp);
      const key = c.toLowerCase().normalize('NFKD');
      if (key === c && c.toUpperCase() === c) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
  }
  for (const [from, to] of ranges) {
    for (let cp = from; cp <= to; cp += 1) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const c = String.fromCodePoint(cp);
      if (unsafe.test(c)) continue;
      const lower = c.toLowerCase(), upper = c.toUpperCase();
      if (lower === c && upper === c && !groups.has(lower.normalize('NFKD'))) continue;
      const pattern = new RegExp(`^${escape(c)}$`, 'iu');
      const others = new Set([lower, upper, upper.toLowerCase(), lower.toUpperCase(), ...(groups.get(lower.normalize('NFKD')) ?? [])]);
      for (const other of others) {
        if (other === c || !single(other) || unsafe.test(other) || !pattern.test(other)) continue;
        assert.equal(other.toLowerCase(), lower, `U+${cp.toString(16)} folds like ${JSON.stringify(other)}`);
      }
    }
  }
});
