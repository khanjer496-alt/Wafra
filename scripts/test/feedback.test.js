/**
 * The feedback payload, and the one property it exists to have.
 *
 * This app's positioning is that the ledger stays on the phone. A feedback
 * feature is the one place where that could quietly stop being true — not
 * through malice but through a field nobody thought about: an account name in
 * a diagnostic header, a merchant inside a raw SMS, a last four printed beside
 * a balance. None of those are visible in a screenshot of the screen and all
 * of them are one careless spread away.
 *
 * So the suite is built around a hostile fixture. The ledger below contains a
 * distinctive account name, a distinctive merchant, and a last four, and every
 * one of them appears in more than one place: in the structured fields, inside
 * the raw bank text, and (for the last four) on TWO accounts, which is the
 * shape cardDiagnostics goes looking for. Then the same three strings are
 * searched for in the serialised payload AND in the rendered report, at every
 * attachment level. If any of them survives anywhere, the product's central
 * claim is false and this file says so.
 */
const {
  FEEDBACK_DETAILS,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_SCHEMA,
  FEEDBACK_SHAPES_MAX,
  FeedbackTransportMissingError,
  buildFeedbackPayload,
  formatFeedbackPayload,
  isFeedbackTransportInstalled,
  scrubFeedbackMessage,
  setFeedbackTransport,
  submitFeedback,
} = require('./build/app-feedback.js');
const {
  FEEDBACK_DIAGNOSTIC_MAX_BYTES,
  FEEDBACK_RETENTION_DAYS,
  FEEDBACK_WIRE_SCHEMA,
  serializeFeedbackWire,
  toFeedbackWirePayload,
} = require('./build/feedback-wire.js');

let pass = 0;
let fail = 0;
function ok(name, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail === undefined ? '' : ` — ${detail}`}`);
  }
}

/* ── The hostile fixture ────────────────────────────────────────────────
 *
 * Three secrets, each planted where a different kind of mistake would leak it.
 */
const SECRETS = {
  account: 'Emirates NBD Platinum',
  merchant: 'Carrefour Hypermarket Al Barsha',
  last4: '3644',
};

/** A shorter form of the merchant, to catch a substring escaping intact. */
const MERCHANT_STEM = 'Carrefour';

const ACCOUNTS = [
  {
    id: 'acc-enbd',
    name: SECRETS.account,
    kind: 'card',
    openingFils: 0,
    color: '#101010',
    last4: SECRETS.last4,
    bankName: 'Emirates NBD',
    cardType: 'credit',
    snapshotFils: 452300,
    snapshotKind: 'outstanding',
    snapshotTs: 1_780_000_000_000,
  },
  // Liv is Emirates NBD's digital bank, so one physical card really can show up
  // under two names with one last four. This is the double-count shape.
  {
    id: 'acc-liv',
    name: 'Liv Everyday',
    kind: 'card',
    openingFils: 0,
    color: '#202020',
    last4: SECRETS.last4,
    bankName: 'Liv',
    cardType: 'credit',
    snapshotFils: 452300,
    snapshotKind: 'outstanding',
    snapshotTs: 1_780_000_000_000,
  },
  {
    id: 'acc-cur',
    name: 'Mashreq Salary Account',
    kind: 'bank',
    openingFils: 0,
    color: '#303030',
    last4: '9012',
    bankName: 'Mashreq',
    snapshotFils: 1_875_040,
    snapshotKind: 'balance',
    snapshotTs: 1_780_000_000_000,
  },
];

const TRANSACTIONS = [
  {
    id: 't1',
    type: 'expense',
    amountFils: 4575,
    category: 'groceries',
    accountId: 'acc-enbd',
    title: SECRETS.merchant,
    date: '2026-07-04',
    source: 'sms',
    raw: `ENBD: AED 45.75 spent on card ending ${SECRETS.last4} at CARREFOUR HYPERMARKET AL BARSHA on 04/07/2026. Avl Cr. limit AED 12,340.00`,
  },
  {
    id: 't2',
    type: 'expense',
    amountFils: 9900,
    category: 'groceries',
    accountId: 'acc-enbd',
    title: SECRETS.merchant,
    date: '2026-07-11',
    source: 'sms',
  },
  // Parsed confidently, filed as a card payment. cardDiagnostics is the only
  // thing in the app that can show this being counted twice.
  {
    id: 't3',
    type: 'expense',
    amountFils: 452300,
    category: 'other',
    accountId: 'acc-cur',
    title: 'Card •3644 payment',
    date: '2026-07-25',
    source: 'sms',
    cardPaymentSide: 'debit',
  },
  // The parser found no merchant at all — 'Card purchase' is its fallback, and
  // the merchant is only inside the raw. The vocabulary still knows the name
  // from t1, which is what has to reach this row.
  {
    id: 't4',
    type: 'expense',
    amountFils: 12_000,
    category: 'other',
    accountId: 'acc-enbd',
    title: 'Card purchase',
    date: '2026-07-09',
    source: 'sms',
    raw: `ADCB: Purchase of AED 120.00 at CARREFOUR MARKET JLT using card ****${SECRETS.last4}. Ref 90881723004.`,
  },
  // A structural row: the parser knows exactly what this is and names no shop.
  {
    id: 't5',
    type: 'expense',
    amountFils: 50_000,
    category: 'other',
    accountId: 'acc-cur',
    title: 'ATM withdrawal',
    date: '2026-07-12',
    source: 'sms',
    raw: 'Mashreq: AED 500.00 withdrawn from ATM at DIFC on 12/07/2026.',
  },
  // Hand-entered, with a private note on it. The note is nobody's business.
  {
    id: 't6',
    type: 'expense',
    amountFils: 3300,
    category: 'dining',
    accountId: 'acc-cur',
    title: 'Cafe Rider',
    date: '2026-07-13',
    note: 'split with Hussain, he owes me half',
  },
  {
    id: 't7',
    type: 'income',
    amountFils: 1_800_000,
    category: 'salary',
    accountId: 'acc-cur',
    title: 'Salary',
    date: '2026-07-01',
    source: 'sms',
  },
];

const CARD_DUES = [
  {
    id: 'due-1',
    accountId: 'acc-enbd',
    totalDueFils: 452_300,
    minDueFils: 22_615,
    minDueEstimated: true,
    dueDate: '2026-07-25',
    paidFils: 0,
  },
];

const LEDGER = {
  accounts: ACCOUNTS,
  transactions: TRANSACTIONS,
  cardDues: CARD_DUES,
  merchantOverrides: { [SECRETS.merchant.toLowerCase()]: 'groceries' },
};

const BUILD = {
  version: '1.4.2',
  platform: 'android',
  language: 'en',
  marketId: 'ae',
  currency: 'AED',
  privateMode: false,
};

const build = (over = {}) =>
  buildFeedbackPayload({
    message: 'The July card payment shows up twice in my spending.',
    detail: 'figures',
    build: BUILD,
    ledger: LEDGER,
    ...over,
  });

{
  const suffix = (index) =>
    String.fromCharCode(65 + Math.floor(index / 26)) + String.fromCharCode(65 + (index % 26));
  const many = Array.from({ length: 60 }, (_, index) => ({
    id: `many-${index}`,
    type: 'expense',
    amountFils: 100,
    category: 'other',
    accountId: 'acc-cur',
    title: 'Card purchase',
    date: '2026-07-01',
    source: 'sms',
    raw: `Bank format ${suffix(index)}: AED 1.00 spent at UNKNOWN SHOP.`,
  }));
  const payload = buildFeedbackPayload({
    message: 'Many formats were not understood.',
    detail: 'shapes',
    build: BUILD,
    ledger: { ...LEDGER, transactions: many },
  });
  const serialized = serializeFeedbackWire(payload);
  ok('feedback attaches only the highest-value format shapes',
    payload.shapes.length === FEEDBACK_SHAPES_MAX && payload.counts.formats === 60);
  ok('the preview says how many additional formats stayed local',
    formatFeedbackPayload(payload).includes('35 additional format(s) stayed on this phone.'));
  ok('a many-format report remains below the shared Worker diagnostic ceiling',
    serialized.diagnosticBytes <= FEEDBACK_DIAGNOSTIC_MAX_BYTES,
    `${serialized.diagnosticBytes} bytes`);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1. The redaction. This is the block the feature exists to satisfy.
 * ═════════════════════════════════════════════════════════════════════════ */

for (const detail of FEEDBACK_DETAILS) {
  const payload = build({ detail });
  // Both representations, because they can fail independently: a field could
  // survive in the object and never be rendered, or the renderer could reach
  // for something the builder thought it had removed.
  const surfaces = {
    json: JSON.stringify(payload),
    report: formatFeedbackPayload(payload),
  };
  for (const [where, text] of Object.entries(surfaces)) {
    for (const [what, secret] of Object.entries(SECRETS)) {
      ok(
        `${detail}/${where}: the ${what} is not in the payload`,
        !text.includes(secret),
        text.slice(Math.max(0, text.indexOf(secret) - 60), text.indexOf(secret) + 60),
      );
    }
    ok(
      `${detail}/${where}: not even the merchant's first word survives`,
      !text.toLowerCase().includes(MERCHANT_STEM.toLowerCase()),
    );
    ok(
      `${detail}/${where}: a note the user wrote about a purchase is not in it`,
      !text.includes('Hussain'),
    );
  }
}

/* The vocabulary rule, stated as the two facts that make it up. */
{
  const shapes = build({ detail: 'shapes' });
  const text = formatFeedbackPayload(shapes);

  // A merchant read correctly ANYWHERE is removed from EVERY message, which is
  // what reaches the raw of a row the parser could not read at all.
  ok(
    'a name the ledger knows is stripped from a message the parser failed on',
    !text.includes('CARREFOUR MARKET JLT') && !text.toLowerCase().includes('carrefour'),
  );

  // ...and the honest limit, pinned rather than left to be discovered. A trade
  // name that appears ONLY inside a format the parser has never once read has
  // no entry in the vocabulary and is not removed. Every digit is still gone,
  // and this is precisely why the screen shows the user the exact text before
  // sending it. If someone later claims a stronger guarantee, this fails.
  const orphan = buildFeedbackPayload({
    message: '',
    detail: 'shapes',
    build: BUILD,
    ledger: {
      accounts: [],
      transactions: [
        {
          id: 'o1',
          type: 'expense',
          amountFils: 1000,
          category: 'other',
          accountId: 'x',
          title: 'Card purchase',
          date: '2026-07-01',
          source: 'sms',
          raw: 'BANK: AED 10.00 at ZAROOB RESTAURANT LLC on 01/07/2026',
        },
      ],
      cardDues: [],
    },
  });
  const orphanText = formatFeedbackPayload(orphan);
  ok(
    'a merchant only ever seen in an unread format is NOT removed (known limit)',
    orphanText.includes('ZAROOB RESTAURANT LLC'),
  );
  ok('…but every digit in that message is gone', !/AED [\d,]*\d/.test(orphanText) &&
    orphanText.includes('AED ##.##'));
}

/* Aliases: stable, and structure-preserving. */
{
  const p = build({ detail: 'figures' });
  const d = p.diagnostic;
  ok('the diagnostic was produced', typeof d === 'string' && d.length > 0);
  ok('account names became aliases', /\[card A\]/.test(d) && /\[account A\]/.test(d));
  // Both cards carry the same last four in the fixture, so they must carry the
  // same ALIAS — the double-count check is "same last four on more than one
  // account that contributes", and a redaction that gave them different tokens
  // would hide the exact bug this report exists to surface.
  ok('one physical last four keeps one alias on both accounts',
    (d.match(/\[·A\]/g) ?? []).length >= 2);
  ok('the double-count warning survives redaction',
    /MORE THAN ONE OF THESE IS COUNTED/.test(d));
  ok('the parser-minted titles are kept verbatim, not aliased',
    d.includes('ATM withdrawal') || formatFeedbackPayload(p).includes('Card purchase'));
  ok('a card-payment title keeps its shape with the digits aliased',
    /Card •\[·A\] payment/.test(d));
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2. The three levels are what they say they are.
 * ═════════════════════════════════════════════════════════════════════════ */

{
  const none = build({ detail: 'none' });
  ok('none: the schema is stamped', none.schema === FEEDBACK_SCHEMA);
  ok('none: nothing from the ledger is attached',
    none.counts === null && none.shapes === null && none.diagnostic === null);
  ok('none: the user\'s own words are still there', none.message.includes('twice'));
  ok('none: nothing was withheld — this is what was asked for', none.withheld === null);
}

{
  const shapes = build({ detail: 'shapes' });
  const text = formatFeedbackPayload(shapes);
  ok('shapes: counts are attached', shapes.counts !== null && shapes.counts.imported === 6);
  ok('shapes: message shapes are attached', Array.isArray(shapes.shapes) && shapes.shapes.length > 0);
  ok('shapes: no card diagnostic', shapes.diagnostic === null);
  // The whole claim of this level: the shape is there and the money is not.
  ok('shapes: every digit in every shape is blanked',
    shapes.shapes.every((s) => !/\d/.test(s.shape)));
  ok('shapes: the amounts from the ledger are nowhere in the report',
    !text.includes('45.75') && !text.includes('4,523.00') && !text.includes('18,750.40'));
  ok('shapes: the shape is still recognisable as a bank message',
    shapes.shapes.some((s) => /ADCB: Purchase of AED/.test(s.shape)));
  ok('shapes: identical formats are collapsed and counted',
    shapes.shapes.every((s) => s.count >= 1));
}

{
  const figures = build({ detail: 'figures' });
  const text = formatFeedbackPayload(figures);
  ok('figures: the card diagnostic is attached', typeof figures.diagnostic === 'string');
  ok('figures: it is a strict superset — shapes and counts come too',
    figures.shapes !== null && figures.counts !== null);
  ok('figures: the balances the bank quoted are present',
    text.includes('4,523.00') && text.includes('18,750.40'));
  ok('figures: the statement figures are present', text.includes('226.15'));
  ok('figures: net worth is still computed from real numbers',
    /NET WORTH  AED/.test(figures.diagnostic));
}

/* The counts are the ones accuracy.ts computes, over the redacted ledger —
 * which is only true if the merchant pins were remapped along with the titles.
 * Leave the keys alone and every lookup misses, `decided` collapses to zero,
 * and the report accuses the parser of failing on rows the user had settled. */
{
  const c = build({ detail: 'shapes' }).counts;
  ok('counts: only rows the parser wrote are counted as imported', c.imported === 6);
  ok('counts: the manual row is not in the denominator', c.transactions === 7 && c.imported === 6);
  ok('counts: transfers, structural rows and credits are skipped', c.skipped === 3);
  ok('counts: the purchases are measured', c.measured === 3);
  ok('counts: a merchant the user pinned still reads as decided', c.decided === 2, `${c.decided}`);
  ok('counts: the pin did not swallow the unnamed row', c.categoryMeasured === 1);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3. Private Mode.
 * ═════════════════════════════════════════════════════════════════════════ */

for (const asked of ['shapes', 'figures']) {
  const p = build({ detail: asked, build: { ...BUILD, privateMode: true } });
  ok(`private mode: "${asked}" is refused by the builder, not just by the screen`,
    p.detail === 'none' && p.counts === null && p.shapes === null && p.diagnostic === null);
  ok(`private mode: what was asked for is recorded (${asked})`, p.detailRequested === asked);
  ok(`private mode: the reason is recorded (${asked})`, p.withheld === 'private-mode');
  ok(`private mode: the report says why it is thin (${asked})`,
    /Private Mode is on/.test(formatFeedbackPayload(p)));
}
{
  const p = build({ detail: 'none', build: { ...BUILD, privateMode: true } });
  ok('private mode: asking for nothing withholds nothing', p.withheld === null);
  ok('private mode: the message is still sendable', p.message.length > 0);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. The user's own words.
 * ═════════════════════════════════════════════════════════════════════════ */

{
  ok('a long digit run in the note is masked',
    scrubFeedbackMessage('card 4532109988776655 charged twice') ===
      'card ····6655 charged twice');
  ok('an ordinary amount the user typed is left alone',
    scrubFeedbackMessage('it charged me 45.75 twice') === 'it charged me 45.75 twice');
  ok('the note is capped', scrubFeedbackMessage('x'.repeat(FEEDBACK_MESSAGE_MAX + 500)).length ===
    FEEDBACK_MESSAGE_MAX);
  ok('the builder applies the same scrub',
    build({ message: 'ref 4532109988776655' }).message === 'ref ····6655');
  ok('the sentence is otherwise untouched',
    build({ message: '  I think the totals are wrong.  ' }).message ===
      'I think the totals are wrong.');
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5. The preview is the payload.
 *
 * "See exactly what will be sent" is only true if the rendering is COMPLETE.
 * A field that exists in the object and appears nowhere in the text is a field
 * the user never consented to.
 * ═════════════════════════════════════════════════════════════════════════ */

{
  const p = build({ detail: 'figures' });
  const text = formatFeedbackPayload(p);
  const missing = [];
  const seen = (label, value) => {
    if (!text.includes(String(value))) missing.push(`${label}=${value}`);
  };
  seen('schema', p.schema);
  seen('message', p.message);
  seen('version', p.build.version);
  seen('platform', p.build.platform);
  seen('language', p.build.language);
  seen('marketId', p.build.marketId);
  seen('currency', p.build.currency);
  seen('retentionDays', p.delivery.retentionDays);
  seen('reviewedBy', 'Wafra maintainers');
  seen('thirdPartyAi', p.delivery.thirdPartyAi ? 'yes' : 'no');
  for (const [k, v] of Object.entries(p.counts)) seen(k, v);
  ok('every field of the payload is rendered in the report', missing.length === 0,
    missing.join(' | '));
  ok('every message shape is rendered',
    p.shapes.every((s) => text.includes(s.shape.split('\n')[0])));
  ok('the diagnostic is rendered whole',
    text.includes(p.diagnostic.split('\n')[0]) &&
      text.includes(p.diagnostic.trimEnd().split('\n').pop()));
  ok('the report says what level it is', /^ {2}message shapes, counts/m.test(text));
  ok('the report explains its own aliases', /\[shop A\] is the same shop everywhere/.test(text));
}

{
  const p = build({ detail: 'figures' });
  const wire = toFeedbackWirePayload(p);
  ok('the app and Worker share one versioned feedback contract',
    wire.schema === FEEDBACK_WIRE_SCHEMA && wire.diagnostic.reportSchema === FEEDBACK_SCHEMA);
  ok('feedback is retained for the disclosed maximum',
    p.delivery.retentionDays === FEEDBACK_RETENTION_DAYS &&
    wire.diagnostic.delivery.retentionDays === FEEDBACK_RETENTION_DAYS);
  ok('third-party AI is disabled in both the previewed report and wire payload',
    p.delivery.thirdPartyAi === false && wire.aiReviewConsent === false);
  ok('the wire carries every redacted diagnostic field without device identity',
    wire.text === p.message && wire.appVersion === p.build.version &&
    wire.diagnostic.counts === p.counts && wire.diagnostic.shapes === p.shapes &&
    wire.diagnostic.cardDiagnostic === p.diagnostic &&
    !('deviceId' in wire) && !('installId' in wire) && !('pushToken' in wire));
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6. The transport seam. Absent must be LOUD.
 * ═════════════════════════════════════════════════════════════════════════ */

async function transportTests() {
  const payload = build({ detail: 'none' });

  ok('no transport is installed by default', isFeedbackTransportInstalled() === false);

  let threw = null;
  await submitFeedback(payload).catch((e) => (threw = e));
  ok('submitting without a transport throws rather than resolving quietly',
    threw instanceof FeedbackTransportMissingError, String(threw));
  ok('the error names itself so a screen can tell it from a network failure',
    threw && threw.name === 'FeedbackTransportMissingError');

  let received = null;
  setFeedbackTransport(async (p) => {
    received = p;
    return { id: 'WAFRA-17' };
  });
  ok('installing a transport is visible', isFeedbackTransportInstalled() === true);
  const receipt = await submitFeedback(payload);
  ok('the receipt comes back to the caller', receipt.id === 'WAFRA-17');
  ok('the transport is handed the payload unchanged', received === payload);

  setFeedbackTransport(async () => {
    throw new Error('502');
  });
  let failed = null;
  await submitFeedback(payload).catch((e) => (failed = e));
  ok('a transport failure reaches the caller',
    failed instanceof Error && !(failed instanceof FeedbackTransportMissingError));

  setFeedbackTransport(null);
  ok('the transport can be removed again', isFeedbackTransportInstalled() === false);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7. The screen, and the route.
 * ═════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

{
  // Comments first, always. The header of each of these files EXPLAINS why
  // there is no alert and no react in it, so a naive scan for those words
  // fails on the prose that documents the property being checked — the same
  // trap routes.test.js names in its own alert scan.
  const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const screen = code(read('src/app/feedback.tsx'));
  const lib = code(read('src/lib/feedback.ts'));

  // The whole guarantee: the screen shows the payload by RENDERING it, not by
  // describing it. One function produces the text, and both the preview and
  // the copy come from that one call.
  ok('the screen previews the payload through the same formatter it sends',
    /const preview = useMemo\(\(\) => formatFeedbackPayload\(payload\)/.test(screen) &&
      /shareText\('wafra-feedback\.txt', preview\)/.test(screen));
  // Rendered, in braces, whatever else shares the expression with it — the
  // screen now shows a "preparing" line in its place while a level is being
  // built, because a STALE preview under a new heading is this screen's one
  // guarantee being false rather than a cosmetic lag.
  ok('the preview is drawn on the screen, not hidden behind a share sheet',
    /\{[^{}]*\bpreview\b[^{}]*\}/.test(screen));

  // Nothing is sent on mount, on a timer, or on anything but a tap that has
  // been confirmed. If submitFeedback is ever called from a useEffect, this is
  // the line that notices.
  ok('submitFeedback is reached only from the confirmed send path',
    (screen.match(/submitFeedback\(/g) ?? []).length === 1 &&
      /<ConfirmSheet[\s\S]{0,400}onConfirm=\{\(\) => void send\(\)\}/.test(screen));
  /**
   * The property, not the proxy.
   *
   * This used to be `!/useEffect/.test(screen)` — no effects at all, as a
   * stand-in for "nothing submits from one". That held while the screen had no
   * effects and stopped being usable the moment it needed one: building the
   * `figures` attachment had to come off the render path, because doing it
   * during render froze the app for seconds on a real ledger.
   *
   * So the body of every effect is read and checked for the call itself. That
   * is strictly narrower than the old line — it still fails on the thing the
   * old line existed to catch, and no longer fails on an effect that does
   * something else.
   */
  const effectBodies = [];
  for (let at = screen.indexOf('useEffect('); at >= 0; at = screen.indexOf('useEffect(', at + 1)) {
    let depth = 0;
    let end = at;
    for (let i = screen.indexOf('(', at); i < screen.length; i += 1) {
      if (screen[i] === '(') depth += 1;
      else if (screen[i] === ')') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    effectBodies.push(screen.slice(at, end + 1));
  }
  ok('nothing is submitted from an effect',
    effectBodies.length > 0 && effectBodies.every((body) => !/submitFeedback\(/.test(body)),
    `${effectBodies.length} effect(s) read`);

  /**
   * And the expensive build IS in one.
   *
   * Measured at ~270ms in Node on a 14,314-row ledger with twelve cards, which
   * is seconds under Hermes. Run during render — which is where a `useMemo`
   * keyed on `detail` runs it — the app stops answering the moment the third
   * option is chosen, with no spinner and nothing to cancel. That was reported
   * from a real phone as "lags and stops working".
   */
  ok('the attachment is built off the render path',
    effectBodies.some((body) => /requestIdleCallback/.test(body) && /buildFeedbackPayload\(/.test(body)),
    'the figures build must not run during render');
  ok('Send is blocked while the attachment is still being built',
    /const ready = [^;]*!preparing/.test(screen),
    'sending mid-build would post the previous level under the new label');

  // The repo-wide rule, restated here because this screen is new: an alert on
  // react-native-web is an empty method, so a confirmation built from one is a
  // dead control. routes.test.js scans all of src/; this pins the screen.
  /**
   * Every cause the transport can throw is answered, or is deliberately not.
   *
   * The transport names five and the screen used to answer two: "no transport
   * in this build", and everything else as "save a copy and try again later".
   * The send handler's own comment argued against exactly that — "collapsing
   * them is how a user ends up retrying a build that has no transport in it at
   * all" — and then collapsed the five underneath it.
   *
   * It matters because the advice differs. A build with no relay address will
   * fail identically forever and "later" never comes; an oversized report needs
   * a smaller attachment; a refused report will be refused again unchanged.
   * Only a network failure was ever worth retrying, and that is the one case
   * the old wording fitted. A real report came back from a phone reading
   * "Could not send ... try again later" when the truth was that the build
   * predated the commit compiling the relay URL in.
   *
   * The two files are edited independently, so the list is read out of the
   * transport rather than restated here. `bad_response` and `no_id` fall
   * through on purpose: after either, the report may or may not have arrived,
   * and "keep a copy" is the only honest thing to say.
   */
  const transport = code(read('src/lib/feedback-transport.ts'));
  const thrown = [...transport.matchAll(/new FeedbackSendError\([^,]+,\s*'([a-z_]+)'/g)].map((m) => m[1]);
  const fallThrough = new Set(['bad_response', 'no_id']);
  ok('the transport still names its causes', thrown.length >= 4, thrown.join(', '));
  const unanswered = thrown.filter(
    (c) => !fallThrough.has(c) && !new RegExp(`case '${c}':`).test(screen),
  );
  ok('every actionable send failure gets its own answer',
    unanswered.length === 0,
    unanswered.length ? `unanswered: ${unanswered.join(', ')}` : '');

  // And the one that was actually wrong: a build that can never send must not
  // be told that waiting will help.
  ok('a build with no relay address is not told to try again later',
    /case 'no_relay_url':[\s\S]{0,160}feedbackNoRelayBody/.test(screen));

  ok('the screen uses no alert at all', !/\bAlert\b/.test(screen));

  ok('the attachment choice is drawn as a sheet', /<ChoiceSheet/.test(screen));
  ok('Private Mode disables the other levels visibly, with the reason on the row',
    /state\.privateMode && value !== 'none'/.test(screen) &&
      /disabled: blocked/.test(screen) &&
      /t\('feedbackPrivateBlocked'\)/.test(screen));

  // The refusal is in the pure function too. A guard that lives only in the UI
  // is one refactor away from not existing.
  ok('the builder itself refuses to attach a ledger in Private Mode',
    /input\.build\.privateMode && requested !== 'none'/.test(lib));

  ok('the library has no network in it',
    !/\bfetch\(|XMLHttpRequest|WebSocket|axios/.test(lib));
  ok('the library has no react in it', !/from 'react|react-native/.test(lib));

  // ...and this one reads the file WITH its comments, because the thing being
  // checked for is a comment: the banner an implementer lands on.
  ok('the stub is marked as one, in the place an implementer will look',
    /STUB — the transport agent implements the other side/.test(read('src/lib/feedback.ts')));
}

{
  const routes = read('src/lib/routes.ts');
  ok('the route is declared', /'\/feedback'/.test(routes));
  ok('the screen file exists behind it', fs.existsSync(path.join(ROOT, 'src/app/feedback.tsx')));

  const settings = read('src/app/settings.tsx');
  const sourceFile = ts.createSourceFile(
    'settings.tsx',
    settings,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let feedbackRow = null;
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        node.expression.text === 'linkRow') {
      const first = node.arguments[0];
      if (first && ts.isCallExpression(first) && ts.isIdentifier(first.expression) &&
          first.expression.text === 't' && ts.isStringLiteral(first.arguments[0]) &&
          first.arguments[0].text === 'sendFeedback') {
        feedbackRow = node;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const feedbackRowText = feedbackRow?.getText(sourceFile) ?? '';
  ok('Settings reaches it', /router\.push\('\/feedback'\)/.test(feedbackRowText));
  ok('the Settings row is not paywalled',
    feedbackRow !== null && !/\bgated\(|\bpro\s*:/.test(feedbackRowText));

  // Every string the two files ask for exists in both languages. contracts.js
  // checks this repo-wide; doing it here means a missing Arabic value fails in
  // the suite that owns the feature.
  const i18n = require('./build/i18n.js');
  const source = read('src/app/feedback.tsx') + read('src/app/settings.tsx');
  const keys = [...source.matchAll(/\bt f?\('|\btf?\('([a-zA-Z0-9_]+)'/g)]
    .map((m) => m[1])
    .filter(Boolean)
    .filter((k) => k.startsWith('feedback') || k.startsWith('sendFeedback'));
  ok('the screen asks for its own strings', keys.length >= 15, `${keys.length}`);
  const untranslated = keys.filter(
    (k) => !i18n.hasArabicScript(i18n.t(k, 'ar')) || i18n.t(k, 'ar') === i18n.t(k, 'en'),
  );
  ok('every feedback string has a real Arabic value', untranslated.length === 0,
    [...new Set(untranslated)].join(' | '));
}

transportTests().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
