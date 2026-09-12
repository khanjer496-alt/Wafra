import { MARKETS, bankFromName, bankFromSender, bankIdentityForName } from '@/lib/markets';
import { normalizeArabic, type ParsedSms } from '@/lib/sms-parser';
import type { TransferEvidence } from '@/lib/transfer-reconciliation-types';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

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
  sourceKindAmbiguous: boolean;
}

/** Read only immediate, labelled endpoints. Never join digits across masks. */
function endpoints(raw: string): Endpoint[] {
  const found: Endpoint[] = [];
  const re = /\b(from|to)\s+(your\s+)?(?:([\p{L}][\p{L} .&'-]{0,60}?)\s+)?((?:(?:IBAN\s*\/\s*)?account\s*\/\s*card)|account|(?:(?:credit|debit|covered|charge|prepaid)\s+)?card)\b\s*(?:(?:no\.?|number)\s*)?(?:ending(?:\s+(?:in|with))?\s*)?[:#]?\s*([Xx*·•\d][Xx*·•\d.-]*(?:[ -]+\d{4}\b)?)(?![\w*·•-])/giu;
  for (const match of raw.matchAll(re)) {
    if (found.length >= 8) return []; // Unusual multi-party text is not auto-evidence.
    const terminal = match[5].match(/(\d{4})\.?$/)?.[1];
    const label = match[4].toLowerCase();
    const kind = label === 'account' ? 'account' : /^credit|covered|charge/.test(label) ? 'credit' :
      /^debit|prepaid/.test(label) ? 'debit' : 'unknown';
    const bankIdentity = recognizedBankIdentity(match[3]);
    found.push({ direction: match[1].toLowerCase() as Endpoint['direction'], own: !!match[2],
      index: match.index!, end: match.index! + match[0].length,
      party: terminal ? { last4: terminal, kind, ...(bankIdentity ? { bankIdentity } : {}) } : undefined,
      sourceKindAmbiguous: /account\s*\/\s*card/.test(label) });
  }
  return found;
}

/** Recipient names remain display/suggestion evidence, never an automatic self rule. */
function safeName(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80 || !/^[\p{L}\p{M} .'&-]+$/u.test(name) ||
      /\b(?:account|card|iban|unknown|beneficiary)\b/i.test(name)) return;
  return name;
}

function maskedSourceKey(raw: string, bank: string): string | undefined {
  // A mask with only one to three final digits cannot become a four-digit
  // account. Preserve a scoped opaque hint, not a guessed bank account number.
  const tokens = [...raw.matchAll(/\b(?:from\s+your|to\s+(?:your\s+)?|your\s+)?account\s*(?:no\.?|number)?\s*[:#]?\s*([\dXx*.-]{4,40})(?![\w*.-])/gi)]
    .map(match => match[1]);
  if (bank === 'hsbc' && tokens.length === 0) {
    const token = raw.match(/^From HSBC:\s*\d{2}[A-Z]{3}\d{2}\s+TT Payment to\s+([\dXx*.-]{4,40})(?![\w*.-])/i)?.[1];
    if (token) tokens.push(token);
  }
  if (tokens.length !== 1 || !/[x*]/i.test(tokens[0]) || /\d{4}$/.test(tokens[0])) return;
  const mask = tokens[0].replace(/[.-]/g, '').replace(/x/gi, '*');
  return bytesToHex(sha256(utf8ToBytes(`wafra-transfer-mask-v1\0${bank}\0${mask}`)));
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
  const carried = alert.transferEvidence?.version === 1 && alert.transferEvidence.currency === currency
    ? alert.transferEvidence : undefined;
  let counterparty: TransferEvidence['counterparty'] = carried?.statement ? safeCounterparty(carried.counterparty) : undefined;
  let explicitOwn = OWN_TITLE.test(alert.merchant.trim()) && alert.transferHint;
  if (carried?.statement && carried.explicitOwn === true) explicitOwn = true;
  const reference = normalizedReference(alert.reference) ?? (carried?.statement ? normalizedReference(carried.reference) : undefined);
  let sourceAccountKey: string | undefined;
  let sourceKindAmbiguous = false;
  let counterpartyName: string | undefined;
  let endpointProof: TransferEvidence['endpointProof'];
  let postingForm: TransferEvidence['postingForm'];
  let explicitExternal = false;

  if (typeof alert.raw === 'string') {
    const raw = normalizeArabic(alert.raw);
    const parties = endpoints(raw);
    const ownDirection = alert.type === 'expense' ? 'from' : 'to';
    // FAB's completed account-to-account grammar omits "your" on both
    // endpoints. A narrow completed-transfer clause supplies the source role;
    // an arbitrary "from account" mention in a footer does not.
    const completedRequest = sourceBankIdentity !== undefined &&
      /^\s*(?:Dear Customer,?\s*)?(?:your\s+)?funds?\s+transfer\s+request\b[\s\S]*\bhas been processed(?: successfully)?\b/i.test(raw);
    const sources = parties.filter(party => party.direction === ownDirection && (party.own || completedRequest));
    if (sources.length === 1) {
      const source = sources[0];
      const sourceMatches = source.party && sourceCard && source.party.last4 === sourceCard.last4 &&
        (source.party.kind === sourceCard.kind || source.party.kind === 'unknown' || sourceCard.kind === 'unknown') &&
        (!source.party.bankIdentity || !sourceBankIdentity || source.party.bankIdentity === sourceBankIdentity);
      if (!sourceMatches) attributed = false;
      if (sourceMatches && source.sourceKindAmbiguous && sourceCard?.kind === 'unknown') sourceKindAmbiguous = true;
      const others = parties.filter(party => party.direction !== ownDirection &&
        !/[.!?]\s/.test(raw.slice(Math.min(source.end, party.end), Math.max(source.index, party.index))));
      if (sourceMatches && others.length === 1) {
        counterparty = others[0].party;
        // This FAB intra-bank receipt has two explicit bank-account labels.
        // Its other template (IBAN/Account/Card) makes no such issuer claim.
        if (sourceBankIdentity === 'fab' && completedRequest && counterparty?.kind === 'account' &&
            /\bfrom account\s+[Xx*\d]+\s+to account\s+[Xx*\d]+\s+has been processed\b/i.test(raw)) {
          counterparty = { ...counterparty, bankIdentity: sourceBankIdentity };
        }
        explicitOwn ||= !!counterparty && others[0].own;
        if (counterparty && sourceBankIdentity) endpointProof = 'explicit-transfer';
      }
    } else if (sources.length > 1) {
      attributed = false;
    }
    if (sourceBankIdentity) {
      if (!sourceCard) sourceAccountKey = maskedSourceKey(raw, sourceBankIdentity);
      if (completedRequest && alert.type === 'expense') postingForm = 'transfer-detail';
      if (sourceBankIdentity === 'fab' && /^\s*Outward Remittance\s+Debit\s+Account\b/i.test(raw)) postingForm = 'remittance-debit';
      if (alert.type === 'income' && /\bcredited\b|^\s*Inward Remittance\s+Credit\b/i.test(raw)) postingForm = 'credit-receipt';
      // The bank's word "external" means outside that bank, NOT outside the
      // user's ownership. Only explicit third-party ownership is retained.
      explicitExternal = /\b(?:to|from)\s+(?:a\s+)?third[- ]party(?:'s)?\s+account\b/i.test(raw);
      if (sourceBankIdentity === 'wio' && alert.type === 'expense') {
        counterpartyName = safeName(raw.match(/\bYour local transfer of\s+[A-Z]{3}\s+[\d,.]+\s+to\s+(.{2,80}?)\s+from your account number\b/i)?.[1]);
      }
    }
  } else {
    if (carried) {
      counterparty = safeCounterparty(carried.counterparty);
      explicitOwn ||= carried.explicitOwn === true;
      sourceAccountKey = typeof carried.sourceAccountKey === 'string' && /^[a-f0-9]{64}$/.test(carried.sourceAccountKey)
        ? carried.sourceAccountKey : undefined;
      sourceKindAmbiguous = carried.sourceKindAmbiguous === true && sourceCard?.kind === 'unknown';
      counterpartyName = safeName(carried.counterpartyName);
      endpointProof = carried.endpointProof === 'explicit-transfer' ? carried.endpointProof : undefined;
      postingForm = ['transfer-detail', 'remittance-debit', 'credit-receipt'].includes(carried.postingForm ?? '')
        ? carried.postingForm : undefined;
      explicitExternal = carried.explicitExternal === true;
      // A contradiction found while the body existed cannot be upgraded by
      // later account routing after the original text has been discarded.
      attributed &&= carried.attribution === 'source';
    }
  }
  return { version: 1, currency, attribution: attributed ? 'source' : 'fallback',
    ...(sourceBankIdentity ? { sourceBank: sourceBankIdentity } : {}),
    ...(sourceAccountKey ? { sourceAccountKey } : {}),
    ...(sourceKindAmbiguous ? { sourceKindAmbiguous: true } : {}),
    ...(reference ? { reference } : {}), ...(counterparty ? { counterparty } : {}),
    ...(counterpartyName ? { counterpartyName } : {}), ...(endpointProof ? { endpointProof } : {}),
    ...(postingForm ? { postingForm } : {}),
    ...(carried?.statement === true ? { statement: true } : {}),
    ...(explicitOwn && !explicitExternal ? { explicitOwn: true } : {}),
    ...(explicitExternal && !explicitOwn ? { explicitExternal: true } : {}) };
}
