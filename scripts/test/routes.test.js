/**
 * Every route the app navigates to must have a file behind it.
 *
 * expo-router resolves a name with no file to "Unmatched Route". There is no
 * compile error and no warning — the string is just a string — so a screen
 * that was renamed or moved leaves working-looking buttons that can only
 * fail, and nobody finds out until a user taps one.
 *
 * This has now happened twice. First a root `bills` screen kept its <Stack>
 * entry after bills.tsx moved into (tabs). Then a budget warning's own "See
 * the breakdown" button pointed at `/budgets`, which has never existed at
 * all — the one button on the one card the app puts in front of you when
 * you overspend.
 */
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const APP = path.join(__dirname, '../../src/app');
const SRC = path.join(__dirname, '../../src');

/** Every route expo-router will resolve, from the files on disk. */
function routes(dir = APP, prefix = '') {
  const out = new Set();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // A (group) directory does not appear in the URL.
      const next = /^\(.*\)$/.test(entry.name) ? prefix : `${prefix}/${entry.name}`;
      for (const r of routes(full, next)) out.add(r);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    const base = entry.name.replace(/\.tsx?$/, '');
    if (base === '_layout') continue;
    out.add(base === 'index' ? prefix || '/' : `${prefix}/${base}`);
  }
  return out;
}

const available = routes();
ok('the route table was read off disk', available.size >= 8, [...available].join(' '));
ok('the tab routes are there', ['/', '/flow', '/bills', '/wallet'].every((r) => available.has(r)),
  [...available].join(' '));

/** Every file under src/, so nothing is missed by only checking screens. */
function sources(dir = SRC) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

{
  // Literal router.push('/x') / router.replace('/x') targets. Template
  // literals are skipped deliberately: their path is not knowable here, and
  // a test that guessed at them would be worse than one that says so.
  const bad = [];
  for (const file of sources()) {
    const text = fs.readFileSync(file, 'utf8');
    const re = /router\.(?:push|replace)\(\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(text))) {
      const route = m[1].split('?')[0];
      if (!available.has(route)) bad.push(`${path.relative(SRC, file)} → ${route}`);
    }
  }
  ok('every route the app pushes to exists', bad.length === 0, bad.join(' | '));
}

{
  // The insight destinations are declared as a list precisely so this can
  // check them — they are reached through a variable, so the scan above
  // cannot see them.
  const text = fs.readFileSync(path.join(SRC, 'lib/insights.ts'), 'utf8');
  const decl = text.match(/INSIGHT_DESTINATIONS = \[([^\]]*)\]/);
  ok('the insight destinations are declared in one place', !!decl);
  const declared = decl ? [...decl[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
  const bad = declared.filter((r) => !available.has(r));
  ok('every insight destination exists', declared.length > 0 && bad.length === 0, bad.join(' | '));

  // And the assignment must only ever use one of them, or the list is
  // decoration. Anything quoted next to `i.href =` has to be in it.
  // Only the path-shaped strings: the same expression tests insight ids
  // ('budget-', 'largest'), and those are not destinations.
  const assigned = [...text.matchAll(/i\.href =([\s\S]*?);/g)]
    .flatMap((m) => [...m[1].matchAll(/'(\/[^']*)'/g)].map((x) => x[1]));
  const stray = assigned.filter((r) => !declared.includes(r));
  ok('no insight is given a destination outside the list', stray.length === 0, stray.join(' | '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
