import {
  prepareUniversalReviewAlert,
  REVIEW_ALERT_TTL_MS,
  usableWalletCardName,
  type UniversalReviewAlert,
} from '@/lib/alert-review-tray';
import { ledgerMoneySpec } from '@/lib/ledger-money';
import {
  missingUniversalField,
  type UniversalBankEvent,
  type UniversalField,
  type UniversalMoney,
} from '@/lib/universal-types';

export type IosApplePayRefusalReason =
  | 'invalid-payload'
  | 'invalid-identity'
  | 'invalid-observed-at'
  | 'unsupported-currency'
  | 'invalid-amount'
  | 'amount-precision'
  | 'amount-range'
  | 'invalid-merchant'
  | 'invalid-card'
  | 'review-unavailable';

/** Refusals are explicit so the queue owner can retain an unhandled record. */
export type IosApplePayRecordOutcome =
  | { kind: 'review'; item: UniversalReviewAlert }
  | { kind: 'refused'; reason: IosApplePayRefusalReason };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL_RE = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const MAX_MINOR_UNITS = '9007199254740991';
const PAYLOAD_KEYS = ['amount', 'currency', 'merchant'];
/** Newer native writers add Wallet's sanitized "Card or Pass" name when one was sent. */
const CARD_PAYLOAD_KEYS = ['amount', 'cardOrPass', 'currency', 'merchant'];
const UNSAFE_MERCHANT_RE = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u;

const refused = (reason: IosApplePayRefusalReason): IosApplePayRecordOutcome => ({ kind: 'refused', reason });
const explicit = <T>(value: T): UniversalField<T> => ({
  value, evidence: 'explicit', spans: [], alternatives: [], issues: [],
});

/**
 * Convert only Apple's explicitly supplied amount/currency/merchant into a
 * review. This does not parse messages or prove settlement, transaction date,
 * issuer, card identity, or that this observation is a unique bank event.
 * Wallet's optional "Card or Pass" name rides along on the review item, on
 * device only, so a confirmed review can remember the card's account.
 */
export function parseIosApplePayRecord(
  structuredText: string,
  observationId: string,
  observedAt: number,
): IosApplePayRecordOutcome {
  if (typeof observationId !== 'string' || !UUID_RE.test(observationId)) return refused('invalid-identity');
  if (!Number.isSafeInteger(observedAt) || observedAt < 0 ||
    !Number.isFinite(new Date(observedAt + REVIEW_ALERT_TTL_MS).getTime())) return refused('invalid-observed-at');
  if (typeof structuredText !== 'string' || structuredText.length > 4096) return refused('invalid-payload');
  let decoded: unknown;
  try {
    decoded = JSON.parse(structuredText);
  } catch {
    return refused('invalid-payload');
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return refused('invalid-payload');
  const payload = decoded as Record<string, unknown>;
  const keys = Object.keys(payload).sort();
  const expectedKeys = Object.hasOwn(payload, 'cardOrPass') ? CARD_PAYLOAD_KEYS : PAYLOAD_KEYS;
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    return refused('invalid-payload');
  }
  // The native writer only ever stores its own sanitized form. Anything else
  // is not a Wallet card name, and the record stays queued like a bad merchant.
  const cardOrPass = payload.cardOrPass;
  if (cardOrPass !== undefined && !usableWalletCardName(cardOrPass)) return refused('invalid-card');
  const spec = typeof payload.currency === 'string' && /^[A-Z]{3}$/.test(payload.currency)
    ? ledgerMoneySpec(payload.currency) : null;
  if (!spec) return refused('unsupported-currency');
  const decimal = typeof payload.amount === 'string' ? payload.amount.match(DECIMAL_RE) : null;
  if (!decimal) return refused('invalid-amount');
  const fraction = decimal[2] ?? '';
  if (fraction.length > spec.exponent) return refused('amount-precision');
  // Decimal text stays text: no binary floating point, rounding or guessed
  // locale. Reject values that the ledger cannot represent exactly later.
  const minorUnits = `${decimal[1]}${fraction.padEnd(spec.exponent, '0')}`.replace(/^0+(?=\d)/, '');
  if (minorUnits === '0' || minorUnits.length > MAX_MINOR_UNITS.length ||
    (minorUnits.length === MAX_MINOR_UNITS.length && minorUnits > MAX_MINOR_UNITS)) return refused('amount-range');
  const merchant = payload.merchant;
  if (typeof merchant !== 'string' || merchant !== merchant.trim() || merchant.length > 96 ||
    UNSAFE_MERCHANT_RE.test(merchant) || Array.from(merchant).some((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint >= 0xd800 && codePoint <= 0xdfff;
    })) return refused('invalid-merchant');
  const amount = explicit<UniversalMoney>({ currency: spec.currency, minorUnits, exponent: spec.exponent });
  const event: UniversalBankEvent = {
    version: 1,
    decision: 'review',
    family: 'purchase',
    status: 'unknown',
    direction: 'debit',
    amount,
    statementTotal: missingUniversalField(),
    minimumDue: missingUniversalField(),
    balance: missingUniversalField(),
    creditLimit: missingUniversalField(),
    merchant: merchant ? explicit(merchant) : missingUniversalField(),
    transactionDate: missingUniversalField(),
    dueDate: missingUniversalField(),
    statementDate: missingUniversalField(),
    instrument: missingUniversalField(),
    observations: [{ role: 'transaction', field: amount }],
    issues: [],
  };
  const opaque = observationId.replace(/-/g, '').toLowerCase();
  const item = prepareUniversalReviewAlert({
    id: `apple_pay_review_id_${opaque}`,
    sourceKey: `apple_pay_review_source_${opaque}`,
    observedAt,
    channel: 'push',
    event,
  });
  if (!item) return refused('review-unavailable');
  return {
    kind: 'review',
    item: usableWalletCardName(cardOrPass) ? { ...item, walletCardOrPass: cardOrPass } : item,
  };
}
