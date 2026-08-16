/**
 * Deterministic mutations for the privacy-safe global alert corpus.
 *
 * They model transport/layout noise and common bank boilerplate. They are
 * synthetic robustness probes only: passing them cannot certify a bank or
 * market for automatic import.
 */

const THREE_DECIMAL = new Set(['KWD', 'BHD', 'OMR', 'JOD']);

const fullWidthDigits = (source) => source.replace(/[0-9]/g,
  (digit) => String.fromCharCode(0xff10 + Number(digit)));

const formattingMutations = Object.freeze([
  {
    id: 'irregular-whitespace',
    apply: (source) => `  ${source.replace(/:\s*/g, ':\n').replace(/\s+/g, '  ')}  `,
  },
  {
    id: 'nonbreaking-spaces',
    apply: (source) => source.replace(/ /g, '\u00a0'),
  },
  {
    id: 'lowercase-latin',
    apply: (source) => source.toLowerCase(),
  },
  {
    id: 'fullwidth-digits',
    apply: fullWidthDigits,
  },
]);

const postedFooterMutations = Object.freeze([
  {
    id: 'otp-safety-footer',
    apply: (source) => `${source} Security reminder: never share your OTP or verification code.`,
  },
  {
    id: 'due-date-footer',
    apply: (source) => `${source} Your card payment due date is next month.`,
  },
  {
    id: 'balance-decoy',
    apply: (source, row) => `${source} Available balance ${row.expected.currency} ${
      THREE_DECIMAL.has(row.expected.currency) ? '9,876.543' : '9,876.54'
    }.`,
  },
  {
    id: 'promotional-feature-footer',
    apply: (source) => `${source} Learn more about scheduled transfers and recurring payments in our app.`,
  },
]);

module.exports = Object.freeze({ formattingMutations, postedFooterMutations });
