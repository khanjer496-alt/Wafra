/**
 * Properties the parser must hold for EVERY message, rather than assertions
 * about particular ones.
 *
 * `parser.test.js` pins ~200 individual formats: each says "this input gives
 * that output". Useful, and blind to a whole class of defect — the rule that
 * is right on the message it was written for and wrong on the next one, the
 * `/g` regex whose `lastIndex` survives a call, the amount that comes out as
 * NaN on an input nobody thought to add. Those show up only when you run the
 * whole corpus through and ask what must be true of all of it.
 *
 * The corpus here is every bank-alert-shaped message already in the repo:
 * repository-supplied redacted accuracy fixtures and every string literal
 * handed to `parseSms` in parser.test.js. Public examples and synthetic
 * grammar probes are labelled at their definitions; no unredacted customer
 * message belongs in this suite.
 */
const fs = require('fs');
const path = require('path');
const parser = require('./build/sms-parser');
const { CATEGORIES } = require('./build/categories');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

/* ── The corpus ──────────────────────────────────────────────────────── */

/**
 * Both accuracy exports. The second one's headers carry the merchant and
 * category the shipped app produced ("#12 (seen 4x, read as "Bloomfield
 * Treat" / Other):"), so its header line is a little longer — the same split
 * handles both, and the leading `#` comment block of the second file is
 * dropped because it has no `(seen ` header.
 */
function fixtureMessages() {
  const out = [];
  for (const name of ['uae-accuracy-report.txt', 'uae-accuracy-report-2.txt']) {
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
 * Every string literal passed to parseSms in the test file. Read as source
 * rather than executed, so this picks up the inputs of tests that assert a
 * null result too — those are exactly the messages most likely to trip a
 * helper that assumes it has something to work with.
 */
function testFileMessages() {
  const src = fs.readFileSync(path.join(__dirname, 'parser.test.js'), 'utf8');
  const out = [];
  // Single-quoted literals, allowing escaped quotes and \n inside.
  //
  // The character class must exclude a RAW newline. A JavaScript string
  // cannot contain one, so allowing it let the match run from one quote,
  // across the code between, and on to a quote several lines later —
  // scraping the test file's own source into the corpus. 151 of the 593
  // "messages" were JavaScript, and nine of them PARSED, so the suite was
  // reporting merchants like "{ Category })" and counting its own source as
  // unreadable bank formats. Every coverage figure this printed was fiction.
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.){40,})'/g)) {
    const body = m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    if (/\d/.test(body) && /[A-Za-z]{3}/.test(body)) out.push(body);
  }
  return out;
}

const corpus = [...new Set([...fixtureMessages(), ...testFileMessages()])];
console.log(`corpus: ${corpus.length} distinct messages\n`);
ok('corpus is large enough to be worth running', corpus.length >= 150, `only ${corpus.length}`);

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
const parsed = corpus.map((raw) => ({ raw, p: parser.parseSms(raw) }));
const hits = parsed.filter((x) => x.p);

/* ── Shape ───────────────────────────────────────────────────────────── */

{
  const bad = hits.filter(
    (x) => !Number.isInteger(x.p.amountFils) || x.p.amountFils <= 0,
  );
  ok('every parsed amount is a positive whole number of fils', bad.length === 0,
    bad.slice(0, 2).map((x) => `${x.p.amountFils} from "${x.raw.slice(0, 60)}"`).join(' | '));
}

{
  // AED 1,000,000 in a personal SMS is a misread, not a purchase. Flagged
  // rather than asserted away: if a real one turns up, this is where to argue.
  const huge = hits.filter((x) => x.p.kind === 'transaction' && x.p.amountFils > 100_000_000);
  ok('no single transaction reads as more than AED 1,000,000', huge.length === 0,
    huge.slice(0, 2).map((x) => `${x.p.amountFils} from "${x.raw.slice(0, 60)}"`).join(' | '));
}

{
  const bad = hits.filter((x) => !CATEGORY_IDS.has(x.p.categoryGuess));
  ok('every category is one the app knows', bad.length === 0,
    bad.slice(0, 2).map((x) => x.p.categoryGuess).join(' | '));
}

{
  const bad = hits.filter(
    (x) => typeof x.p.merchant !== 'string' || x.p.merchant.trim().length === 0,
  );
  ok('no parsed row has an empty merchant', bad.length === 0,
    bad.slice(0, 2).map((x) => `"${x.raw.slice(0, 60)}"`).join(' | '));
}

{
  // A merchant that is only digits, punctuation or mask characters is an
  // account reference that leaked through as a name.
  //
  // ARABIC COUNTS AS LETTERS. The parser no longer rewrites an Arabic body into
  // English before reading it — it normalises orthography and matches in place,
  // and slices the payee out of the bank's OWN spelling — so "كارفور" is now a
  // perfectly good merchant name. A Latin-only test rejected every Arabic
  // merchant the parser got RIGHT, which would have pushed the fix back towards
  // transliteration.
  const bad = hits.filter((x) => !/[A-Za-zء-ي]/.test(x.p.merchant));
  ok('every merchant contains a letter', bad.length === 0,
    bad.slice(0, 3).map((x) => `"${x.p.merchant}" from "${x.raw.slice(0, 50)}"`).join(' | '));
}

{
  // The vocabulary a bank uses about itself is never a merchant — that is the
  // exact defect that filed a fish shop as a utility.
  //
  // Except where the app means it. Some movements have no merchant at all: a
  // cheque, an ATM withdrawal, a refund. Those carry a deliberate structural
  // label, and `STRUCTURAL_TITLES` is the list of them. The rule is therefore
  // "not a bank's own noun UNLESS the app chose it on purpose", which is also
  // the stricter rule: anything new that leaks through has to be added to that
  // list by hand, in the open.
  const NOUN = /^(a\/?c|acc(t|ount)?|card|cheque|ref(erence)?|txn|transaction|trn|iban|mobile|phone|consumer|customer|invoice|receipt|order|serial|batch|voucher|available|balance|amount|payment|debit|credit|no|number)$/i;
  const bad = hits.filter(
    (x) => NOUN.test(x.p.merchant.trim()) && !parser.STRUCTURAL_TITLES.has(x.p.merchant.trim()),
  );
  ok('no merchant is a bank word the app did not choose deliberately', bad.length === 0,
    bad.slice(0, 3).map((x) => `"${x.p.merchant}" from "${x.raw.slice(0, 50)}"`).join(' | '));
}

{
  const bad = hits.filter((x) => /[\u0000-\u001f]/.test(x.p.merchant));
  ok('no merchant carries a control character', bad.length === 0);
}

{
  const bad = hits.filter((x) => x.p.date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(x.p.date));
  ok('every date is a well-formed ISO day', bad.length === 0,
    bad.slice(0, 2).map((x) => String(x.p.date)).join(' | '));
}

{
  // A date the calendar does not have. `new Date('2026-02-30')` rolls into
  // March rather than failing, so the check is a round trip.
  const bad = hits.filter((x) => {
    if (!x.p.date) return false;
    const [y, m, d] = x.p.date.split('-').map(Number);
    const back = new Date(Date.UTC(y, m - 1, d));
    return back.getUTCFullYear() !== y || back.getUTCMonth() + 1 !== m || back.getUTCDate() !== d;
  });
  ok('no date is one the calendar does not have', bad.length === 0,
    bad.slice(0, 2).map((x) => x.p.date).join(' | '));
}

{
  const bad = hits.filter(
    (x) => x.p.dueDay !== null && !(Number.isInteger(x.p.dueDay) && x.p.dueDay >= 1 && x.p.dueDay <= 31),
  );
  ok('every due day falls inside a month', bad.length === 0,
    bad.slice(0, 2).map((x) => String(x.p.dueDay)).join(' | '));
}

{
  const bad = hits.filter(
    (x) => x.p.minDueFils !== null && !(x.p.minDueFils > 0 && x.p.minDueFils <= x.p.amountFils),
  );
  ok('a stated minimum is never larger than the total it belongs to', bad.length === 0,
    bad.slice(0, 2).map((x) => `${x.p.minDueFils} of ${x.p.amountFils}`).join(' | '));
}

{
  const bad = hits.filter((x) => x.p.card && !/^\d{3,4}$/.test(x.p.card.last4));
  ok('a card is identified by three or four digits, nothing else', bad.length === 0,
    bad.slice(0, 2).map((x) => String(x.p.card.last4)).join(' | '));
}

{
  // Payments name a credit card. A PAN-less statement may deliberately keep
  // card=null for sender-bank resolution on-device, but can never claim a
  // debit/account identity.
  const bad = hits.filter(
    (x) =>
      (x.p.kind === 'cardPayment' && x.p.card?.kind !== 'credit') ||
      (x.p.kind === 'cardStatement' && x.p.card !== null && x.p.card.kind !== 'credit'),
  );
  ok('statements never claim a non-credit card identity', bad.length === 0);
}

/* ── Behaviour ───────────────────────────────────────────────────────── */

{
  // A `/g` regex used with .test() or .exec() keeps `lastIndex` between calls,
  // so the SECOND parse of a message can differ from the first. This file has
  // two module-level /g patterns; this is the check that they stay contained.
  const drift = [];
  for (const { raw, p } of parsed) {
    const again = parser.parseSms(raw);
    if (JSON.stringify(p) !== JSON.stringify(again)) drift.push(raw);
  }
  ok('parsing a message twice gives the same answer', drift.length === 0,
    drift.slice(0, 2).map((r) => `"${r.slice(0, 60)}"`).join(' | '));
}

{
  // No message may change how the next one reads. Parse the corpus forwards,
  // then backwards, and compare each result to the isolated one.
  const forward = corpus.map((r) => JSON.stringify(parser.parseSms(r)));
  const reversed = [...corpus].reverse().map((r) => JSON.stringify(parser.parseSms(r)));
  reversed.reverse();
  const contaminated = corpus.filter((_, i) => forward[i] !== reversed[i]);
  ok('order of arrival never changes how a message reads', contaminated.length === 0,
    contaminated.slice(0, 2).map((r) => `"${r.slice(0, 60)}"`).join(' | '));
}

{
  // Catastrophic backtracking turns one bad message into a frozen import.
  // Every message in the corpus, and a long adversarial one.
  const slow = [];
  for (const raw of corpus) {
    const t0 = process.hrtime.bigint();
    parser.parseSms(raw);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms > 25) slow.push(`${ms.toFixed(0)}ms "${raw.slice(0, 50)}"`);
  }
  ok('no message takes more than 25ms to read', slow.length === 0, slow.slice(0, 2).join(' | '));

  const adversarial = [
    'AED ' + '1,'.repeat(400) + '00 at ' + 'A'.repeat(600),
    'Purchase of AED 10.00 with Credit Card ending 1234 at ' + 'X '.repeat(500),
    ' '.repeat(2000) + 'AED 5.00',
    'AED 1.00 ' + '·'.repeat(1500),
  ];
  const t0 = process.hrtime.bigint();
  for (const raw of adversarial) parser.parseSms(raw);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(`pathological input does not hang the parser (${ms.toFixed(0)}ms)`, ms < 500);
}

{
  // A full-history import is a hot loop on the JS thread. This does not claim
  // to benchmark a phone from Node; it is a generous regression tripwire for
  // accidental quadratic regex or corpus-size work in parseSms. Five thousand
  // rows is deliberately above the product's performance acceptance target.
  const batch = Array.from({ length: 5_000 }, (_, i) => corpus[i % corpus.length]);
  let recognized = 0;
  const t0 = process.hrtime.bigint();
  for (const raw of batch) {
    if (parser.parseSms(raw)) recognized++;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(
    `5,000-message import stays bounded (${ms.toFixed(0)}ms)`,
    ms < 1_500 && recognized > 0,
    `${recognized} recognized`,
  );
}

{
  // Junk must be refused, not guessed at.
  const junk = ['', '   ', 'hello', '12345', 'AED', '...', '\n\n\n', 'OTP is 123456'];
  const claimed = junk.filter((r) => parser.parseSms(r) !== null);
  ok('junk and OTPs are refused rather than guessed at', claimed.length === 0,
    claimed.map((r) => `"${r}"`).join(' | '));
}

{
  // The parser refuses a figure whose leading digits the bank redacted, on
  // purpose: "AED ····9235.93" is not 9,235.93. Recovering one would silently
  // invent money.
  const masked = [
    'Your available balance is AED ····9235.93',
    'Purchase of AED ····50.00 with Credit Card ending 1234 at SHOP',
    'AED ••••123.45 has been debited from your account',
  ];
  const wrong = masked
    .map((raw) => ({ raw, p: parser.parseSms(raw) }))
    .filter((x) => x.p && x.p.amountFils > 0 && /[·•]/.test(x.raw.slice(0, x.raw.indexOf(String(Math.floor(x.p.amountFils / 100))))));
  ok('a redacted figure is never read as an amount', wrong.length === 0,
    wrong.slice(0, 2).map((x) => `${x.p.amountFils} from "${x.raw}"`).join(' | '));
}

{
  // cleanDescriptor runs over names it has already cleaned during healing, so
  // a second pass must not keep eating characters.
  const names = hits.map((x) => x.p.merchant);
  const unstable = names.filter((n) => {
    const once = parser.normalizeServiceName(n) ?? n;
    const twice = parser.normalizeServiceName(once) ?? once;
    return once !== twice;
  });
  ok('cleaning a merchant name twice gives the same name', unstable.length === 0,
    unstable.slice(0, 3).join(' | '));
}

{
  // guessCategory must be a pure function of its inputs.
  const merchants = [...new Set(hits.map((x) => x.p.merchant))];
  const unstable = merchants.filter(
    (m) => parser.guessCategory(m, 'expense', {}, m) !== parser.guessCategory(m, 'expense', {}, m),
  );
  ok('the same merchant always gets the same category', unstable.length === 0,
    unstable.slice(0, 3).join(' | '));
}

{
  // A user override is the last word — it must beat every built-in rule.
  const merchants = [...new Set(hits.map((x) => x.p.merchant))].slice(0, 60);
  const ignored = merchants.filter(
    (m) => parser.guessCategory(m, 'expense', { [m.toLowerCase()]: 'charity' }, m) !== 'charity',
  );
  ok('a category the user set always wins', ignored.length === 0,
    ignored.slice(0, 3).join(' | '));
}

/* ── Coverage, reported rather than asserted ─────────────────────────── */

{
  // "other" means two opposite things, so count them apart. A brokerage, a
  // card settlement or an own-account transfer is other ON PURPOSE and the
  // parser says so; only the fall-through shrug is a gap worth chasing. The
  // single number this used to print made every eToro purchase look like a
  // miss, which is exactly the mistake the in-app report was making.
  const unread = parsed.filter((x) => !x.p).length;
  const others = hits.filter((x) => x.p.categoryGuess === 'other');
  const deliberate = others.filter((x) => x.p.categoryDeliberate).length;
  const unresolved = others.length - deliberate;
  console.log(
    `\n  coverage: ${hits.length}/${corpus.length} read` +
      `, ${unread} refused` +
      `, ${deliberate} deliberately other` +
      `, ${unresolved} unresolved (${Math.round((unresolved / (hits.length || 1)) * 100)}%)`,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
