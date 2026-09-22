/**
 * The in-repo bank-alert corpus, assembled once.
 *
 * `invariants.test.js` built this inline and is the reason it exists: the
 * properties it asserts are only as good as the set of messages they run over.
 * `scripts/parser-benchmark/run.mjs` scores candidate parsing engines on the
 * same set, and a benchmark that quietly reads a different corpus to the gate
 * would report accuracy for messages the gate never sees. One definition,
 * both callers.
 *
 * Sources, both repository-supplied and redacted:
 *   - the two UAE accuracy exports under fixtures/
 *   - every string literal handed to parseSms in parser.test.js, read as
 *     source rather than executed, so the inputs of tests asserting a null
 *     result are included too
 *
 * No unredacted customer message belongs here.
 */
const fs = require('fs');
const path = require('path');

const ACCURACY_EXPORTS = ['uae-accuracy-report.txt', 'uae-accuracy-report-2.txt'];

/**
 * Both accuracy exports. The second one's headers carry the merchant and
 * category the shipped app produced ("#12 (seen 4x, read as "Bloomfield
 * Treat" / Other):"), so its header line is a little longer — the same split
 * handles both, and the leading `#` comment block of the second file is
 * dropped because it has no `(seen ` header.
 */
function fixtureMessages() {
  const out = [];
  for (const name of ACCURACY_EXPORTS) {
    const file = path.join(__dirname, 'fixtures', name);
    if (!fs.existsSync(file)) continue;
    for (const block of fs.readFileSync(file, 'utf8').split(/\n(?=#\d+ \(seen )/)) {
      const body = block.replace(/^#\d+ \(seen [^)]*\):\n/, '').trim();
      // The commentary header of report 2 is not a message.
      if (!body || /^#/.test(body)) continue;
      out.push(body);
    }
  }
  return out;
}

/**
 * Every string literal passed to parseSms in the test file.
 *
 * The character class must exclude a RAW newline. A JavaScript string cannot
 * contain one, so allowing it let the match run from one quote, across the
 * code between, and on to a quote several lines later — scraping the test
 * file's own source into the corpus. 151 of the 593 "messages" were
 * JavaScript, and nine of them PARSED, so the suite was reporting merchants
 * like "{ Category })" and counting its own source as unreadable bank
 * formats. Every coverage figure this printed was fiction.
 */
function testFileMessages() {
  const src = fs.readFileSync(path.join(__dirname, 'parser.test.js'), 'utf8');
  const out = [];
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.){40,})'/g)) {
    const body = m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    if (/\d/.test(body) && /[A-Za-z]{3}/.test(body)) out.push(body);
  }
  return out;
}

/** Distinct messages, in a stable order. */
function corpusMessages() {
  return [...new Set([...fixtureMessages(), ...testFileMessages()])];
}

module.exports = { corpusMessages, fixtureMessages, testFileMessages };
