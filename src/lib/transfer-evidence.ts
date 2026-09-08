import { MARKETS, bankFromName, bankFromSender, bankIdentityForName } from '@/lib/markets';
import { normalizeArabic, type ParsedSms } from '@/lib/sms-parser';
import type { TransferEvidence } from '@/lib/transfer-reconciliation-types';

type TransferAlert = Omit<ParsedSms, 'raw'> & {
  raw?: string;
  sender?: string;
  transferEvidence?: TransferEvidence;
};

const TRANSFER_TITLE = /^(?:(?:outgoing|incoming|bank|own account|self|savings) transfer|inward remittance|outward remittance|telegraphic transfer)$/i;
const OWN_TITLE = /^(?:own account|self|savings) transfer$/i;
const KINDS = new Set(['credit', 'debit', 'account', 'unknown']);

/** A reference is supporting evidence, never an account number or free text. */
function normalizedReference(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const ref = normalizeArabic(value).trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{5,39}$/.test(ref) || !/\d/.test(ref)) return undefined;
  // Long numeric strings and IBAN shapes can be full banking identifiers.
  // Losing a possible match is preferable to retaining those as a reference.
  if (/^\d{12,}$/.test(ref) || /^[A-Z]{2}\d{2}[A-Z0-9]{10,}$/.test(ref) ||
      /^(\d)\1+$/.test(ref) || /^X+\d*$/i.test(ref) ||
      /^(?:19|20)\d{2}-?(?:0[1-9]|1[0-2])-?(?:0[1-9]|[12]\d|3[01])$/.test(ref)) return undefined;
  return ref;
}

/** Exact recognized bank labels only; a footer or arbitrary name is no proof. */
function recognizedBankIdentity(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const value = label.trim();
  for (const market of MARKETS) for (const bank of market.banks) {
    if (bank.name.toLowerCase() === value.toLowerCase() ||
        new RegExp(`^(?:${bank.re.source})$`, 'i').test(value)) {
      return bankIdentityForName(bank.name);
    }
  }
  return undefined;
}

function safeCounterparty(value: unknown): TransferEvidence['counterparty'] {
  if (!value || typeof value !== 'object') return undefined;
  const party = value as Record<string, unknown>;
  if (typeof party.last4 !== 'string' || !/^\d{4}$/.test(party.last4) ||
      typeof party.kind !== 'string' || !KINDS.has(party.kind)) return undefined;
  const bankIdentity = typeof party.bankIdentity === 'string'
    ? recognizedBankIdentity(party.bankIdentity) : undefined;
  return { last4: party.last4, kind: party.kind as NonNullable<TransferEvidence['counterparty']>['kind'],
    ...(bankIdentity ? { bankIdentity } : {}) };
}

interface Endpoint {
  direction: 'from' | 'to';
  own: boolean;
  index: number;
  end: number;
  party: TransferEvidence['counterparty'];
}

/** Read only immediate, labelled endpoints. Never join digits across masks. */
function endpoints(raw: string): Endpoint[] {
  const found: Endpoint[] = [];
  const re = /\b(from|to)\s+(your\s+)?(?:([\p{L}][\p{L} .&'-]{0,60}?)\s+)?((?:account\s*\/\s*card)|account|(?:(?:credit|debit|covered|charge|prepaid)\s+)?card)\b\s*(?:(?:no\.?|number)\s*)?(?:ending(?:\s+(?:in|with))?\s*)?[:#]?\s*([Xx*·•\d][Xx*·•\d.-]*(?:[ -]+\d{4}\b)?)(?![\w*·•-])/giu;
  for (const match of raw.matchAll(re)) {
    if (found.length >= 8) return []; // Unusual multi-party text is not auto-evidence.
    const terminal = match[5].match(/(\d{4})\.?$/)?.[1];
    const label = match[4].toLowerCase();
    const kind = label === 'account' ? 'account' : /^credit|covered|charge/.test(label) ? 'credit' :
      /^debit|prepaid/.test(label) ? 'debit' : 'unknown';
    const bankIdentity = recognizedBankIdentity(match[3]);
    found.push({ direction: match[1].toLowerCase() as Endpoint['direction'], own: !!match[2],
      index: match.index!, end: match.index! + match[0].length,
      party: terminal ? { last4: terminal, kind, ...(bankIdentity ? { bankIdentity } : {}) } : undefined });
  }
  return found;
}

/**
 * Compact bank-stated facts survive native body discard and future rereads.
 * Account routing is supplied independently by the importer; matching a tail
 * to a user's Accounts list never establishes counterparty ownership.
 */
export function buildTransferEvidence(
  alert: TransferAlert,
  sourceAttributed: boolean,
): TransferEvidence | undefined {
  if (alert.kind !== 'transaction' || alert.cardPaymentSide || alert.paymentFlowSide ||
      alert.categoryGuess === 'salary' ||
      !TRANSFER_TITLE.test(alert.merchant.trim())) return undefined;
  const currency = alert.originalCurrency ?? alert.currency;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return undefined;
  const sourceCard = alert.card && /^\d{4}$/.test(alert.card.last4) && KINDS.has(alert.card.kind)
    ? alert.card : undefined;
  const sourceBank = (alert.bankHint ? bankFromName(alert.bankHint) : null) ?? bankFromSender(alert.sender);
  const sourceBankIdentity = sourceBank ? bankIdentityForName(sourceBank.name) : undefined;
  let attributed = sourceAttributed && !!sourceCard;
  let counterparty: TransferEvidence['counterparty'];
  let explicitOwn = OWN_TITLE.test(alert.merchant.trim()) && alert.transferHint;
  const reference = normalizedReference(alert.reference);

  if (typeof alert.raw === 'string') {
    const raw = normalizeArabic(alert.raw);
    const parties = endpoints(raw);
    const ownDirection = alert.type === 'expense' ? 'from' : 'to';
    const sources = parties.filter(party => party.direction === ownDirection && party.own);
    if (sources.length === 1) {
      const source = sources[0];
      const sourceMatches = source.party && sourceCard && source.party.last4 === sourceCard.last4 &&
        (source.party.kind === sourceCard.kind || source.party.kind === 'unknown' || sourceCard.kind === 'unknown') &&
        (!source.party.bankIdentity || !sourceBankIdentity || source.party.bankIdentity === sourceBankIdentity);
      if (!sourceMatches) attributed = false;
      const others = parties.filter(party => party.direction !== ownDirection &&
        !/[.!?]\s/.test(raw.slice(Math.min(source.end, party.end), Math.max(source.index, party.index))));
      if (sourceMatches && others.length === 1) {
        counterparty = others[0].party;
        explicitOwn ||= !!counterparty && others[0].own;
      }
    } else if (sources.length > 1) {
      attributed = false;
    }
  } else {
    const carried = alert.transferEvidence;
    if (carried?.version === 1 && carried.currency === currency) {
      counterparty = safeCounterparty(carried.counterparty);
      explicitOwn ||= carried.explicitOwn === true;
      // A contradiction found while the body existed cannot be upgraded by
      // later account routing after the original text has been discarded.
      attributed &&= carried.attribution === 'source';
    }
  }
  return { version: 1, currency, attribution: attributed ? 'source' : 'fallback',
    ...(reference ? { reference } : {}), ...(counterparty ? { counterparty } : {}),
    ...(explicitOwn ? { explicitOwn: true } : {}) };
}
