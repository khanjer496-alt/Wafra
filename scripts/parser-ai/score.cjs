'use strict';
/**
 * Field-level scoring shared by the baseline runner and model probes.
 * A prediction has the shape produced by pipeline.cjs (ledger / extraction).
 */
const { merchantMatch } = require('./schema.cjs');

const sameAmount = (a, b) => !!a && !!b && String(a.minor) === String(b.minor);
const sameCurrency = (a, b) => !!a && !!b && a.currency === b.currency;

const ratio = (num, den) => (den ? Number((num / den).toFixed(4)) : null);

function newBucket() {
  return {
    n: 0, pos: 0, neg: 0,
    // ledger
    posted: 0, postedPos: 0, postedNeg: 0, postedCorrect: 0, e2e: 0,
    lAmt: [0, 0], lCur: [0, 0], lDir: [0, 0], lMerS: [0, 0], lMerL: [0, 0], lDate: [0, 0], lFam: [0, 0],
    // extraction
    xStatus: [0, 0], xDecision: [0, 0], xAmtCover: [0, 0], xAmt: [0, 0], xCur: [0, 0], xDir: [0, 0],
    xFam: [0, 0], xMerS: [0, 0], xMerL: [0, 0], xDate: [0, 0], xFalseCompleted: [0, 0],
  };
}

const hit = (pair, ok) => { pair[1] += 1; if (ok) pair[0] += 1; };

function scoreRow(bucket, row, ledger, extraction) {
  const L = row.label;
  bucket.n += 1;
  if (L.shouldPost) bucket.pos += 1; else bucket.neg += 1;

  if (ledger) {
    if (ledger.posted) {
      bucket.posted += 1;
      if (L.shouldPost) bucket.postedPos += 1; else bucket.postedNeg += 1;
    }
    let rowCorrect = !L.shouldPost ? !ledger.posted : ledger.posted;
    if (ledger.posted && L.shouldPost) {
      if (L.amount) { hit(bucket.lAmt, sameAmount(ledger.amount, L.amount)); hit(bucket.lCur, sameCurrency(ledger.amount, L.amount)); }
      hit(bucket.lDir, ledger.direction === L.direction);
      if (L.merchant) {
        const m = merchantMatch(ledger.merchant, L.merchant);
        hit(bucket.lMerS, m.strict); hit(bucket.lMerL, m.loose);
      }
      if (L.date !== undefined) hit(bucket.lDate, (ledger.date ?? null) === L.date);
      if (L.family) hit(bucket.lFam, ledger.family === L.family);
      const moneyOk = !L.amount || (sameAmount(ledger.amount, L.amount) && sameCurrency(ledger.amount, L.amount));
      const ok = moneyOk && ledger.direction === L.direction;
      if (ok) bucket.postedCorrect += 1;
      rowCorrect = ok && (L.date === undefined || (ledger.date ?? null) === L.date);
    }
    if (rowCorrect) bucket.e2e += 1;
  }

  if (extraction && !extraction.error) {
    const X = extraction;
    hit(bucket.xStatus, X.status === L.status);
    hit(bucket.xDecision, (X.status === 'completed') === L.shouldPost);
    if (!L.shouldPost) hit(bucket.xFalseCompleted, X.status === 'completed' && X.family !== 'non-posting');
    if (L.amount) {
      hit(bucket.xAmtCover, !!X.amount);
      hit(bucket.xAmt, sameAmount(X.amount, L.amount));
      hit(bucket.xCur, sameCurrency(X.amount, L.amount));
    }
    if (L.shouldPost) {
      hit(bucket.xDir, X.direction === L.direction);
      if (L.family) hit(bucket.xFam, X.family === L.family);
    }
    if (L.merchant) {
      const m = merchantMatch(X.merchant, L.merchant);
      hit(bucket.xMerS, m.strict); hit(bucket.xMerL, m.loose);
    }
    if (L.date !== undefined) hit(bucket.xDate, (X.date ?? null) === L.date);
  }
}

function summarize(b) {
  const f = (pair) => ({ acc: ratio(pair[0], pair[1]), n: pair[1] });
  return {
    n: b.n, shouldPost: b.pos, nonPosting: b.neg,
    ledger: {
      autoPostRecall: ratio(b.postedPos, b.pos),
      noPostRate: ratio(b.pos - b.postedPos, b.pos),
      falsePostRate: ratio(b.postedNeg, b.neg),
      falsePosts: b.postedNeg,
      postedPrecision: ratio(b.postedCorrect, b.posted),
      endToEnd: ratio(b.e2e, b.n),
      fieldsOnCorrectPosts: {
        amount: f(b.lAmt), currency: f(b.lCur), direction: f(b.lDir),
        merchantStrict: f(b.lMerS), merchantLoose: f(b.lMerL), date: f(b.lDate), family: f(b.lFam),
      },
    },
    extraction: {
      status: f(b.xStatus), postDecision: f(b.xDecision), readsCompletedOnNonPosting: f(b.xFalseCompleted),
      amountCoverage: f(b.xAmtCover), amount: f(b.xAmt), currency: f(b.xCur),
      direction: f(b.xDir), family: f(b.xFam), merchantStrict: f(b.xMerS), merchantLoose: f(b.xMerL), date: f(b.xDate),
    },
  };
}

module.exports = { newBucket, scoreRow, summarize, sameAmount, sameCurrency };
