#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseSms } = process.env.WAFRA_PARSER_SOURCE === '1'
  ? await import('../src/lib/sms-parser.ts')
  : require('./test/build/sms-parser.js');

const cases = [
  {
    id: 'normal-purchase', sender: 'ENBD',
    body: 'Purchase of AED 187.50 with Debit Card ending 1234 at CARREFOUR on 17/07/2026',
    expected: { kind: 'transaction', direction: 'expense' },
  },
  {
    id: 'talabat-income', sender: 'Liv',
    body: 'AED 776.00 has been credited to your account XX0004 from TALABAT MIDDLE EAST',
    expected: { kind: 'transaction', direction: 'income' },
  },
  {
    id: 'own-account-transfer', sender: 'ENBD',
    body: 'AED 5,000.00 was debited from your account for own account transfer',
    expected: { kind: 'transaction', direction: 'transfer' },
  },
  {
    id: 'card-payment-received', sender: 'ENBD',
    body: 'Payment of AED 3,240.00 received towards your Credit Card ending 4821. Thank you.',
    expected: { kind: 'card_payment', direction: 'transfer' },
  },
  {
    id: 'card-statement', sender: 'ENBD',
    body: 'Your Credit Card ending 4821 statement is generated. Total due AED 3,240.00, minimum due AED 162.00 by 05/08/2026',
    expected: { kind: 'card_statement', direction: 'none' },
  },
  {
    id: 'utility-due-reminder', sender: 'e&',
    body: 'Your e& bill of AED 325.00 is due on 20/09/2026. Please pay before the due date to avoid interruption.',
    expected: { kind: 'bill_due', direction: 'none' },
  },
  {
    id: 'declined-card-attempt', sender: 'ADCB',
    body: 'Your card transaction of AED 120.00 at SAMPLE STORE was declined. No amount was charged.',
    expected: { kind: 'not_posting', direction: 'none' },
  },
  {
    id: 'random-chat', sender: '',
    body: 'Hey can you send me AED 200 for the dinner yesterday?',
    expected: { kind: 'not_posting', direction: 'none' },
  },
];

function normalizeLocal(parsed) {
  if (!parsed) return { kind: 'not_posting', direction: 'none' };
  const kind = parsed.kind === 'billDue' ? 'bill_due'
    : parsed.kind === 'cardStatement' ? 'card_statement'
      : parsed.kind === 'cardPayment' ? 'card_payment'
        : 'transaction';
  let direction = 'none';
  if (kind === 'card_payment') direction = 'transfer';
  else if (kind === 'transaction') {
    if (parsed.transferHint) direction = 'transfer';
    else direction = parsed.type === 'income' ? 'income' : 'expense';
  }
  return { kind, direction };
}

function evaluate(rows, key) {
  let decisions = 0;
  let correct = 0;
  for (const row of rows) {
    const actual = row[key];
    if (!actual) continue;
    for (const field of ['kind', 'direction']) {
      decisions += 1;
      if (actual[field] === row.expected[field]) correct += 1;
    }
  }
  return { correct, decisions, accuracy: decisions ? correct / decisions : null };
}

const rows = cases.map((sample) => ({
  ...sample,
  local: normalizeLocal(parseSms(sample.body, undefined, { sender: sample.sender || undefined })),
}));

const requireTypeSafe = process.argv.includes('--require-typesafe');
let typeSafeStatus = 'not-run';
let typeSafeError = null;

if (process.env.TYPESAFE_API_KEY) {
  try {
    const { choice, TypeSafeClient } = await import('@typesafe-ai/sdk');
    const client = new TypeSafeClient();
    for (const row of rows) {
      const response = await client.systemOne({
        state: {
          bankAlert: { sender: row.sender || 'unknown', text: row.body },
          ledgerPolicy: 'Only posted financial events become ledger transactions. Due reminders and statements are informational. Own-account transfers and credit-card repayments are transfers, not spending. Declined attempts do not post.',
        },
        questions: {
          kind: choice('Classify `bankAlert.text` by the event it represents.', {
            transaction: 'A posted purchase, debit, credit, refund, fee, cash withdrawal, deposit, or transfer leg.',
            bill_due: 'A bill or utility amount is due or reminded, but payment has not posted.',
            card_statement: 'A credit-card statement or amount-due notice was generated; no repayment posted.',
            card_payment: 'A credit-card repayment or settlement posted.',
            not_posting: 'No ledger event posted, such as a decline, OTP, promotion, or ordinary chat.',
          }),
          direction: choice('Classify the ledger direction for `bankAlert.text` from the account holder perspective.', {
            expense: 'Posted money out that is genuine spending or a fee.',
            income: 'Posted money in, including salary, refund, payout, or incoming external funds.',
            transfer: 'Movement between the user\'s own accounts/cards or a credit-card repayment; not spending.',
            none: 'No posted ledger movement: reminder, statement-only notice, decline, OTP, promotion, or ordinary chat.',
          }),
        },
      });
      row.typesafe = {
        kind: response.answers.kind.choice,
        direction: response.answers.direction.choice,
        confidence: {
          kind: response.answers.kind.confidence ?? null,
          direction: response.answers.direction.confidence ?? null,
        },
      };
    }
    typeSafeStatus = 'completed';
  } catch (error) {
    typeSafeStatus = 'failed';
    typeSafeError = error instanceof Error ? error.message : String(error);
  }
} else {
  typeSafeStatus = 'missing-api-key';
}

const localScore = evaluate(rows, 'local');
const typeSafeScore = typeSafeStatus === 'completed' ? evaluate(rows, 'typesafe') : null;

console.log('Wafra parser × TypeSafe semantic evaluation');
console.log('Synthetic fixtures only; no real user SMS is transmitted.');
console.log('');
for (const row of rows) {
  const localMark = row.local.kind === row.expected.kind && row.local.direction === row.expected.direction ? 'PASS' : 'MISS';
  const ts = row.typesafe ? `${row.typesafe.kind}/${row.typesafe.direction}` : '—';
  const tsMark = row.typesafe
    ? (row.typesafe.kind === row.expected.kind && row.typesafe.direction === row.expected.direction ? 'PASS' : 'MISS')
    : typeSafeStatus;
  console.log(`${row.id.padEnd(24)} expected=${row.expected.kind}/${row.expected.direction} local=${row.local.kind}/${row.local.direction} ${localMark} typesafe=${ts} ${tsMark}`);
}
console.log('');
console.log(`local decisions: ${localScore.correct}/${localScore.decisions} (${(localScore.accuracy * 100).toFixed(1)}%)`);
if (typeSafeScore) console.log(`TypeSafe decisions: ${typeSafeScore.correct}/${typeSafeScore.decisions} (${(typeSafeScore.accuracy * 100).toFixed(1)}%)`);
else console.log(`TypeSafe: ${typeSafeStatus}${typeSafeError ? ` — ${typeSafeError}` : ''}`);

if (requireTypeSafe && typeSafeStatus !== 'completed') process.exitCode = 2;
else if (localScore.correct !== localScore.decisions) process.exitCode = 1;
