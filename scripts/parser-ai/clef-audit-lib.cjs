'use strict';
/**
 * Pure helpers for the offline Clef audit (clef-audit.cjs): the request each
 * labelled row sends to Cloudflare's Clef decision model, validation of its
 * answers, and the scoring that compares Clef, the deterministic parser and
 * the TRUE label (schema.cjs). No network, no parser, no file access here.
 *
 * Clef only CLASSIFIES (status / family / direction / should-post). It never
 * extracts amounts, dates or merchants, and nothing it returns reaches the app:
 * the audit only points a developer at rows worth reading.
 */
const { STATUSES, FAMILIES, DIRECTIONS } = require('./schema.cjs');

const MODELS = Object.freeze(['clef', 'clef-flash']);

const STATUS_CRITERIA = Object.freeze({
  completed: 'Money has actually moved: a settled purchase, transfer, withdrawal, deposit, refund, fee or payment.',
  pending: 'An authorisation, hold or reservation that has not settled yet.',
  declined: 'The transaction failed, was declined, rejected or reversed before posting.',
  otp: 'A one-time password, verification or security code message.',
  promo: 'Marketing, an offer, cashback promotion or loan/card advertisement.',
  informational: 'Balance, statement, limit or account notice with no new money movement.',
  future: 'A scheduled, upcoming or due payment that has not happened yet.',
  request: 'Someone is requesting money or asking the user to approve a payment.',
  unknown: 'None of the above can be determined from the message.',
});

const FAMILY_CRITERIA = Object.freeze({
  purchase: 'Card or wallet payment to a merchant.',
  refund: 'Money returned from a merchant.',
  transfer: 'Money sent to or received from a person or another account.',
  salary: 'Salary or payroll credit from an employer.',
  fee: 'A bank charge, fee or interest debit.',
  withdrawal: 'Cash withdrawn at an ATM or branch.',
  'card-payment': 'A payment towards a credit card balance.',
  'bill-payment': 'A utility, telecom, subscription or biller payment.',
  'non-posting': 'The message does not record a completed money movement.',
});

const DIRECTION_CRITERIA = Object.freeze({
  debit: 'Money left the user\'s account or card.',
  credit: 'Money arrived in the user\'s account or card, including a payment made towards a credit card balance.',
  none: 'No completed money movement is stated.',
});

for (const [name, criteria, vocabulary] of [
  ['status', STATUS_CRITERIA, STATUSES], ['family', FAMILY_CRITERIA, FAMILIES], ['direction', DIRECTION_CRITERIA, DIRECTIONS],
]) {
  const keys = Object.keys(criteria);
  if (keys.length !== vocabulary.length || !vocabulary.every((v) => keys.includes(v))) {
    throw new Error(`clef-audit: ${name} criteria drifted from schema.cjs`);
  }
}

const QUESTIONS = Object.freeze({
  status: {
    type: 'choice',
    instructions: 'This is a bank or wallet alert received by the user. What kind of event does it report?',
    criteria: STATUS_CRITERIA,
  },
  family: {
    type: 'choice',
    instructions: 'If this alert records a completed money movement, which kind is it? Otherwise choose non-posting.',
    criteria: FAMILY_CRITERIA,
  },
  direction: {
    type: 'choice',
    instructions: 'For a completed money movement, did money leave or arrive in the user\'s account?',
    criteria: DIRECTION_CRITERIA,
  },
  shouldPost: {
    type: 'noul',
    instructions: 'Should a personal-finance ledger record exactly one completed transaction from this alert?',
    criteria: {
      true: 'Yes: it states one settled money movement with an amount.',
      false: 'No: it is an OTP, promotion, pending hold, declined attempt, reminder, balance notice or otherwise not a settled movement.',
    },
  },
});

const FIELDS = Object.freeze(['status', 'family', 'direction', 'shouldPost']);

/** Request body for POST /accounts/{id}/ai/run/@cf/cloudflare/{model}. */
function buildClefRequest(row, model) {
  if (!MODELS.includes(model)) throw new Error(`clef-audit: unknown model ${model}`);
  return {
    model,
    state: { sender: row.sender ?? '', country: row.country, message: row.body },
    questions: QUESTIONS,
  };
}

const isProbability = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * Validate a Clef response (bare, or inside the Cloudflare `{ result }`
 * envelope) and reduce it to one prediction per field. Throws on any shape the
 * scoring cannot trust rather than guessing.
 */
function readClefAnswers(response) {
  const body = response && typeof response === 'object' && response.result && typeof response.result === 'object'
    ? response.result : response;
  const answers = body?.answers;
  if (!answers || typeof answers !== 'object') throw new Error('clef-audit: response has no answers');
  const out = {};
  for (const field of ['status', 'family', 'direction']) {
    const a = answers[field];
    const options = Object.keys(QUESTIONS[field].criteria);
    if (!a || a.type !== 'choice' || !options.includes(a.choice)) throw new Error(`clef-audit: bad ${field} answer`);
    const probabilities = {};
    for (const option of options) {
      const p = a.probabilities?.[option];
      if (!isProbability(p)) throw new Error(`clef-audit: bad ${field} probability for ${option}`);
      probabilities[option] = p;
    }
    const total = Object.values(probabilities).reduce((sum, p) => sum + p, 0);
    if (Math.abs(total - 1) > 0.02) throw new Error(`clef-audit: ${field} probabilities do not sum to 1`);
    // "confidence" in this audit is the top option's probability, so it can be
    // checked against accuracy; Clef's own `confidence` field is not used.
    out[field] = { choice: a.choice, confidence: probabilities[a.choice], probabilities };
  }
  const post = answers.shouldPost;
  if (!post || post.type !== 'noul' || !isProbability(post.noul)) throw new Error('clef-audit: bad shouldPost answer');
  const yes = post.noul >= 0.5;
  out.shouldPost = {
    choice: yes, confidence: yes ? post.noul : 1 - post.noul, probabilities: { true: post.noul, false: 1 - post.noul },
  };
  return out;
}

const BINS = 10;

function newFieldBucket() {
  return {
    n: 0, parserRight: 0, clefRight: 0, agree: 0,
    bothRight: 0, onlyParserRight: 0, onlyClefRight: 0, bothWrong: 0,
    brier: 0,
    bins: Array.from({ length: BINS }, () => ({ n: 0, confidence: 0, right: 0 })),
  };
}

function newAudit() {
  return { rows: 0, fields: Object.fromEntries(FIELDS.map((f) => [f, newFieldBucket()])), leads: [], overconfident: [] };
}

/** Family and direction are scored only on posting rows, as score.cjs does. */
const POSTING_ONLY = new Set(['family', 'direction']);

/**
 * Score one labelled row. `parser` holds the parser's value per field
 * (`status`/`family`/`direction` strings, `shouldPost` boolean); `clef` is
 * readClefAnswers output. A field whose label is undefined is skipped.
 *
 * leads:         parser wrong, Clef right with confidence >= threshold — the
 *                rows most worth a human look.
 * overconfident: Clef wrong with confidence >= threshold — where Clef itself
 *                cannot be trusted for this data.
 */
function scoreClefRow(audit, row, parser, clef, threshold) {
  audit.rows += 1;
  for (const field of FIELDS) {
    const truth = row.label[field];
    if (truth === undefined) continue;
    if (POSTING_ONLY.has(field) && row.label.shouldPost !== true) continue;
    const b = audit.fields[field];
    const c = clef[field];
    const parserRight = parser[field] === truth;
    const clefRight = c.choice === truth;
    b.n += 1;
    b.parserRight += parserRight ? 1 : 0;
    b.clefRight += clefRight ? 1 : 0;
    b.agree += parser[field] === c.choice ? 1 : 0;
    if (parserRight && clefRight) b.bothRight += 1;
    else if (parserRight) b.onlyParserRight += 1;
    else if (clefRight) b.onlyClefRight += 1;
    else b.bothWrong += 1;
    if (field === 'shouldPost') {
      // Conventional binary Brier (0-1): squared error of P(yes).
      b.brier += (c.probabilities.true - (truth ? 1 : 0)) ** 2;
    } else {
      // Multi-class Brier (0-2): summed over every option.
      for (const [option, p] of Object.entries(c.probabilities)) b.brier += (p - (option === truth ? 1 : 0)) ** 2;
    }
    const bin = b.bins[Math.min(BINS - 1, Math.floor(c.confidence * BINS))];
    bin.n += 1;
    bin.confidence += c.confidence;
    bin.right += clefRight ? 1 : 0;
    const entry = {
      id: row.id, source: row.source, field, label: truth, parser: parser[field], clef: c.choice,
      confidence: Number(c.confidence.toFixed(3)),
    };
    if (!parserRight && clefRight && c.confidence >= threshold) audit.leads.push(entry);
    if (!clefRight && c.confidence >= threshold) audit.overconfident.push(entry);
  }
}

const ratio = (a, n) => (n ? Number((a / n).toFixed(4)) : null);

function summarizeClefAudit(audit) {
  const fields = {};
  for (const [field, b] of Object.entries(audit.fields)) {
    // Expected calibration error over top-choice confidence.
    const ece = b.n ? b.bins.reduce((sum, bin) => sum + (bin.n ? Math.abs(bin.right - bin.confidence) : 0), 0) / b.n : null;
    fields[field] = {
      n: b.n,
      parserAccuracy: ratio(b.parserRight, b.n),
      clefAccuracy: ratio(b.clefRight, b.n),
      agreement: ratio(b.agree, b.n),
      bothRight: b.bothRight, onlyParserRight: b.onlyParserRight, onlyClefRight: b.onlyClefRight, bothWrong: b.bothWrong,
      clefBrier: ratio(b.brier, b.n),
      clefEce: ece === null ? null : Number(ece.toFixed(4)),
      reliability: b.bins.map((bin, i) => ({
        bin: `${(i / BINS).toFixed(1)}-${((i + 1) / BINS).toFixed(1)}`,
        n: bin.n, meanConfidence: ratio(bin.confidence, bin.n), accuracy: ratio(bin.right, bin.n),
      })).filter((bin) => bin.n),
    };
  }
  const byConfidence = (a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id);
  return {
    rows: audit.rows,
    fields,
    leads: [...audit.leads].sort(byConfidence),
    overconfident: [...audit.overconfident].sort(byConfidence),
  };
}

module.exports = {
  MODELS, QUESTIONS, FIELDS, buildClefRequest, readClefAnswers, newAudit, scoreClefRow, summarizeClefAudit,
};
