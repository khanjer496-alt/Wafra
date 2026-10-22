// The ten lines of control flow around InstantAlert.kt's patterns, restated
// once for every suite that needs them: instant-alert.test.js runs them over
// the corpus, and export-instant-alert-fixture.cjs records what they say so the
// iPhone reader (WafraInstantAlertReader.swift) can be checked against them.
// Keep in step with InstantAlert.read() and InstantAlert.merchant().

const fs = require('fs');
const path = require('path');

function createReader(re) {
  function merchantOf(body) {
    const m = re.PAYMENT_MERCHANT_RE.exec(body) || re.MERCHANT_RE.exec(body);
    if (!m) return null;
    const name = m[1].trim().replace(/[,.\- ]+$/, '');
    if (name.length < 3 || name.length > 28) return null;
    // Kotlin's Char.isLetter() is Unicode-aware, so this restatement has to be
    // too — /[a-z]/i said an Arabic shop name contained no letters and threw it
    // away, which the Kotlin never did.
    if (!/\p{L}/u.test(name)) return null;
    if (re.BANK_WORD_RE.test(name.split(' ')[0])) return null;
    return name;
  }

  /** What the banner would say, or null for "post nothing". */
  function read(body) {
    if (re.UNSAFE_TRANSACTION_RE.test(body)) return null;
    if (re.PURCHASE_PREFIX_RE.test(body)) {
      body = body.replace(new RegExp(re.PROMO_FOOTER_RE.source, `${re.PROMO_FOOTER_RE.flags}g`), '');
    }
    if (re.REFUSE_RE.test(body)) return null;
    const credit = re.CREDIT_RE.test(body);
    if (!credit && !re.DEBIT_RE.test(body)) return null;
    const amount = re.AMOUNT_RE.exec(body);
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
      last4: re.LAST4_RE.exec(body)?.[1] ?? null,
    };
  }

  return { read, merchantOf };
}

/** Real-derived fixtures plus labelled synthetic transfer regressions. */
function corpusMessages() {
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
  const namedBankFormats = require('./fixtures/uae-bank-formats');
  return [...out, ...namedBankFormats.map((row) => row.body),
    ...require('./fixtures/enbd-transfer-capture.js').map(row => row.body)];
}

module.exports = { createReader, corpusMessages };
