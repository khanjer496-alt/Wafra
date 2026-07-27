/**
 * The delivery-time banner, checked against real bank messages.
 *
 * InstantAlert.kt runs in an Android broadcast receiver with no JavaScript
 * engine, so it cannot call the real parser and reads the message with its own
 * blunt patterns instead. That is a second reader of the same text, which is
 * exactly the shape of thing that drifts — the store's duplicate copy of the
 * healing rules is the cautionary tale in this repo.
 *
 * So this suite does not restate those patterns. It EXTRACTS them from the
 * Kotlin source and runs them here, which means it can never test a stale
 * copy: change the Kotlin and this either still passes or tells you what you
 * broke. Only the ten lines of control flow around them are restated, and
 * they are marked below.
 *
 * Java and JavaScript regex agree on everything these patterns use — \b,
 * (?:...), character classes, alternation, case-insensitivity. Nothing here
 * relies on a construct where the two engines differ.
 *
 * What is being asserted is one-sided on purpose. A missing banner costs the
 * user nothing: the message is still imported on the next scan. A WRONG
 * banner — announcing a charge that never happened, or quoting a number the
 * message does not contain — is the thing worth failing a build over.
 */
const fs = require('fs');
const path = require('path');

const parser = require('./build/sms-parser');

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

/* ── Pull the real patterns out of the Kotlin ────────────────────────── */

const KT = path.join(
  __dirname,
  '../../modules/sms-reader/android/src/main/java/expo/modules/smsreader/InstantAlert.kt',
);
const source = fs.readFileSync(KT, 'utf8');

/** Every "..." literal in a declaration, concatenated the way Kotlin does. */
function literals(text) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out.join('');
}

/**
 * A `private const val` string, with any $NAME references already expanded.
 *
 * Stops at the next declaration rather than the next newline: these values are
 * long enough to wrap, and a newline-anchored scan read only the first
 * fragment — which, once the Arabic currency words were added, was empty.
 */
function constant(name, vars = {}) {
  const m = source.match(
    new RegExp(`private const val ${name} =([\\s\\S]*?)(?:\\n\\s*\\n|private )`),
  );
  if (!m) throw new Error(`${name} not found in InstantAlert.kt`);
  return interpolate(literals(m[1]), vars);
}

/**
 * Substitute $NAME references, LONGEST NAME FIRST.
 *
 * Doing it shortest-first turns "$CUR_AR" into "<value of CUR>_AR" — a
 * pattern that is not the one Kotlin compiles, and which happened to be
 * broken in precisely the way the real one was written to avoid. The test
 * went red against a pattern the app never runs.
 */
function interpolate(text, vars) {
  let out = text;
  for (const key of Object.keys(vars).sort((a, b) => b.length - a.length)) {
    out = out.split(`$${key}`).join(vars[key]);
  }
  return out;
}

const CUR_AR = constant('CUR_AR');
const CUR = constant('CUR', { CUR_AR });

function pattern(name) {
  // Anchored on the trailing RegexOption, not on a closing paren: the
  // patterns contain parens of their own, and a lazy scan to the next ")"
  // silently swallowed the declaration after it.
  const decl = source.match(
    new RegExp(`private val ${name} = Regex\\(([\\s\\S]*?),\\s*RegexOption\\.IGNORE_CASE`),
  )?.[1];
  if (!decl) throw new Error(`${name} not found in InstantAlert.kt`);
  // Kotlin escapes backslashes in a plain string literal; undo one level, and
  // substitute the one interpolated value the file uses.
  const body = interpolate(literals(decl).replace(/\\\\/g, '\\'), { CUR, CUR_AR });
  return new RegExp(body, 'i');
}

const AMOUNT_RE = pattern('AMOUNT_RE');
const LAST4_RE = pattern('LAST4_RE');
const MERCHANT_RE = pattern('MERCHANT_RE');
const DEBIT_RE = pattern('DEBIT_RE');
const CREDIT_RE = pattern('CREDIT_RE');
const REFUSE_RE = pattern('REFUSE_RE');
const BANK_WORD_RE = pattern('BANK_WORD_RE');

ok('the Kotlin patterns can be read out of the source', CUR.includes('AED') && REFUSE_RE.source.includes('otp'));

/* ── The ten lines of control flow, restated ─────────────────────────── */
// Keep in step with InstantAlert.read() and InstantAlert.merchant().

function merchantOf(body) {
  const m = MERCHANT_RE.exec(body);
  if (!m) return null;
  const name = m[1].trim().replace(/[,.\- ]+$/, '');
  if (name.length < 3 || name.length > 28) return null;
  // Kotlin's Char.isLetter() is Unicode-aware, so this restatement has to be
  // too — /[a-z]/i said an Arabic shop name contained no letters and threw it
  // away, which the Kotlin never did.
  if (!/\p{L}/u.test(name)) return null;
  if (BANK_WORD_RE.test(name.split(' ')[0])) return null;
  return name;
}

/** What the banner would say, or null for "post nothing". */
function read(body) {
  if (REFUSE_RE.test(body)) return null;
  const credit = CREDIT_RE.test(body);
  if (!credit && !DEBIT_RE.test(body)) return null;
  const amount = AMOUNT_RE.exec(body);
  if (!amount) return null;
  // Groups 1/2 are "AED 150.00"; groups 3/4 are the Arabic order, "150.00 درهم".
  const currency = amount[1] || amount[4];
  const figure = amount[2] || amount[3];
  if (/[·*Xx]/.test(figure)) return null;
  if (!/\d/.test(figure)) return null;
  return {
    currency: currency.toUpperCase(),
    figure,
    credit,
    merchant: merchantOf(body),
    last4: LAST4_RE.exec(body)?.[1] ?? null,
  };
}

/* ── The corpus: every real bank message we have ─────────────────────── */

function fixtureMessages() {
  const out = [];
  for (const name of ['uae-accuracy-report.txt', 'uae-accuracy-report-2.txt']) {
    const lines = fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8').split('\n');
    let cur = [];
    const flush = () => {
      const s = cur.join('\n').trim();
      if (s.length >= 40) out.push(s);
      cur = [];
    };
    for (const line of lines) {
      if (/^#\d+ \(seen/.test(line)) {
        flush();
        continue;
      }
      if (line.trim() === '') {
        flush();
        continue;
      }
      cur.push(line);
    }
    flush();
  }
  return out;
}

const corpus = fixtureMessages();
ok('the corpus is the real messages, not a handful', corpus.length > 80, `${corpus.length}`);

/* ── Safety: never announce something that did not happen ────────────── */

{
  // The strongest property available: if the real parser refuses a message,
  // the banner must refuse it too. Everything the parser throws away is
  // something that named an amount and moved no money.
  const wrong = corpus.filter((m) => parser.parseSms(m, '2026-07-20T10:00:00Z') === null && read(m));
  ok('nothing the parser refuses produces a banner', wrong.length === 0,
    wrong.slice(0, 2).map((m) => m.replace(/\n/g, ' ⏎ ').slice(0, 90)).join(' || '));
}

{
  // Statements and bill reminders quote the largest figures a bank ever
  // sends. Announcing one as a charge is the single worst thing this can do.
  const wrong = corpus.filter((m) => {
    const p = parser.parseSms(m, '2026-07-20T10:00:00Z');
    return p && (p.kind === 'cardStatement' || p.kind === 'billDue') && read(m);
  });
  ok('no statement or bill reminder is announced as a charge', wrong.length === 0,
    wrong.slice(0, 2).map((m) => m.replace(/\n/g, ' ⏎ ').slice(0, 90)).join(' || '));
}

{
  // When it does speak, the number must be the transaction's. Foreign
  // currency is excluded because the banner shows what the message said and
  // the parser shows the converted dirhams — both correct, not comparable.
  const wrong = [];
  for (const m of corpus) {
    const r = read(m);
    if (!r || !/^(AED|DHS?)$/i.test(r.currency)) continue;
    const p = parser.parseSms(m, '2026-07-20T10:00:00Z');
    if (!p) continue;
    const fils = Math.round(parseFloat(r.figure.replace(/,/g, '')) * 100);
    if (fils !== p.amountFils) wrong.push(`${r.figure} vs ${p.amountFils / 100}`);
  }
  ok('a banner never quotes a figure other than the charge', wrong.length === 0,
    wrong.slice(0, 3).join(' | '));
}

{
  // The merchant is a preview, so it may be rougher than the parser's — but
  // it must not be a banking word dressed up as a shop.
  const wrong = [];
  for (const m of corpus) {
    const name = read(m)?.merchant;
    if (name && BANK_WORD_RE.test(name.split(' ')[0])) wrong.push(name);
  }
  ok('a banner never names a banking word as the merchant', wrong.length === 0, wrong.slice(0, 3).join(' | '));
}

/* ── The traps that are specific to reading a message twice ──────────── */

const cases = [
  // A genuine purchase carrying a statement footer. Refusing on the word
  // "statement" would have silenced every ADCB credit-card charge.
  ['Credit Card Purchase\nCard No XXXX3749\nAED 267.00\nOFF PRICE GENERAL TRAD SHARJAH ARE\n11/07/26 19:38\nAvl Bal AED 9235.93\nJuly statement due on 27/07/2026', true, 'a purchase with a statement footer still gets a banner'],
  // The reminder on its own moves no money.
  ['Your ADCB credit card statement is ready. Total due AED 714.74, minimum due AED 100.00, due on 18/08/2026.', false, 'a statement reminder gets no banner'],
  ['Your OTP for the transaction of AED 500.00 is 448122. Do not share it with anyone.', false, 'an OTP gets no banner'],
  ['Your card ending 1234 was declined for AED 500.00 due to insufficient balance.', false, 'a declined charge gets no banner'],
  ['Payday sale! Up to AED 500 cashback when you shop now. T&Cs apply.', false, 'a promo gets no banner'],
  ['Your purchase of AED 1,101.75 will be charged to your card tomorrow.', false, 'a preview of tomorrow gets no banner'],
  ['Available Balance AED ····1985.47 on your account.', false, 'a masked balance gets no banner'],
  ['Your salary of AED 28,537.50 has been credited to your account 0002.', true, 'a salary credit gets a banner'],
  ['Purchase of AED 150.00 with Debit Card ending 2518 at BISSAN MEDICAL CENTRE, DUBAI. Avl Balance is AED 2,024.14.', true, 'an ordinary purchase gets a banner'],
];
for (const [message, expected, name] of cases) {
  ok(name, !!read(message) === expected);
}

// Arabic. A customer whose bank writes to them in Arabic got no banner at all
// — the app claimed instant alerts and was silent for every charge they made.
{
  const arabic = [
    ['تم خصم مبلغ 150.00 درهم من حسابك رقم 1234 لدى بيسان الطبي', true, 'an Arabic debit gets a banner'],
    ['عملية شراء بمبلغ AED 250.00 لدى نون من بطاقتك المنتهية 8575', true, 'Arabic wording with a Latin amount gets a banner'],
    ['تم إيداع الراتب بمبلغ 12,000.00 درهم في حسابك', true, 'an Arabic salary credit gets a banner'],
    ['سحب نقدي بمبلغ 500.00 درهم من بطاقتك المنتهية 1234', true, 'an Arabic ATM withdrawal gets a banner'],
    // The Arabic counterparts of the English refusals: a statement that says a
    // balance is due has moved no money, in either language.
    ['المبلغ المستحق على بطاقتك 5,000.00 درهم', false, 'an Arabic statement gets no banner'],
    ['الرصيد المتاح في حسابك 3,200.00 درهم', false, 'an Arabic balance notice gets no banner'],
  ];
  for (const [message, expected, name] of arabic) {
    ok(name, !!read(message) === expected, JSON.stringify(read(message)));
  }

  const r = read('تم خصم مبلغ 150.00 درهم من حسابك رقم 1234 لدى بيسان الطبي');
  ok('the Arabic banner quotes the charge', r?.figure === '150.00', r?.figure);
  ok('the Arabic banner names the shop', r?.merchant === 'بيسان الطبي', r?.merchant);

  // The suffix form exists only for Arabic script. A Latin code after digits
  // is a card number followed by a currency, and reading it as an amount put
  // "001" on the banner where the charge should have been.
  const trap = read('Purchase of AED 10.00 with Card ending 001 SR at CARREFOUR');
  ok('digits before a Latin currency are not the amount', trap?.figure === '10.00', trap?.figure);
}

{
  const r = read('Purchase of AED 150.00 with Debit Card ending 2518 at BISSAN MEDICAL CENTRE, DUBAI. Avl Balance is AED 2,024.14.');
  ok('the banner names the shop', r?.merchant === 'BISSAN MEDICAL CENTRE', r?.merchant);
  ok('the banner names the card', r?.last4 === '2518', r?.last4);
  ok('the banner quotes the charge, not the balance', r?.figure === '150.00', r?.figure);
}

/* ── How much of a real inbox actually speaks ────────────────────────── */

{
  const spoken = corpus.filter((m) => read(m)).length;
  const real = corpus.filter((m) => {
    const p = parser.parseSms(m, '2026-07-20T10:00:00Z');
    return p && p.kind !== 'cardStatement' && p.kind !== 'billDue';
  }).length;
  console.log(`\n  banners: ${spoken} of ${real} real transactions (${Math.round((spoken / (real || 1)) * 100)}%)`);
  // Silence on everything would pass every assertion above. This is the floor
  // that stops "post nothing, ever" from looking like a healthy suite.
  ok('most real transactions do get a banner', spoken >= real * 0.6, `${spoken}/${real}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
