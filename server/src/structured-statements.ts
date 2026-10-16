/**
 * Structured bank-statement files — OFX/QFX (v1 SGML and v2 XML), QIF,
 * ISO 20022 camt.053 (and camt.052/054) and SWIFT MT940 — turned into the
 * named-column records parseStatementRecords (imports.ts) already reads, so
 * every downstream rule (header detection, currency checks, merchant
 * classification, card settlement, transfer evidence) is reused unchanged.
 *
 * Direction is never guessed:
 *  - Formats whose entries carry an explicit indicator (camt CdtDbtInd,
 *    MT940 C/D/RC/RD) and bank-account OFX/QIF (negative = money out) are
 *    emitted with separate Debit and Credit columns, so the reader needs no
 *    sign convention at all.
 *  - Credit-card OFX follows the spec (a charge debits the card: negative
 *    TRNAMT) only while the file agrees with itself. A DEBIT with a positive
 *    amount, a CREDIT with a negative one, or a payment/refund printed as a
 *    charge means this issuer signs the other way, and the statement is then
 *    emitted in the same "signed" layout QIF card files always use.
 *  - QIF `!Type:CCard` has no documented sign (issuers print charges both
 *    ways). Its rows are emitted as a signed Amount column beside a card
 *    column, so parseStatementRecords' own card-sign inference decides from
 *    the rows, or refuses them (`ambiguousCardSignRows`).
 *
 * Account identity is only ever what the file states, and only its last four
 * digits travel (`••••1234`): the reader keys accounts by that tail and a full
 * card or account number has no business in the records.
 *
 * Build for tests (from server/):
 *   npx esbuild src/structured-statements.ts --bundle --platform=node --format=cjs \
 *     --outfile=.test-build/structured-statements.cjs
 */
import { ledgerMoneySpec } from '@/lib/ledger-money';

export type StructuredStatementFormat = 'ofx' | 'qif' | 'camt053' | 'mt940';

export interface StructuredStatementAccount {
  kind: 'account' | 'credit' | 'unknown';
  /** The stated number's last four digits, masked (`••••1234`). */
  identifier?: string;
}

export interface StructuredStatement {
  format: StructuredStatementFormat;
  /** A header row then one record per entry, for parseStatementRecords. */
  records: string[][];
  /** The one account/card the file states, or null (none, or several). */
  account: StructuredStatementAccount | null;
  /** The statement currency the file states (ISO 4217), or null. */
  currency: string | null;
  /** Closing (ledger) balance, signed as the file states it, in the statement currency. */
  closingBalance?: { amountMinor: number; date: string } | null;
  /**
   * QIF only: the file's numeric dates were emitted as written and their
   * day/month order cannot be settled from the file itself (the caller's
   * date hint then decides, or the reader refuses them).
   */
  dateOrderAmbiguous?: boolean;
  /** Finer kind: `ofx-sgml`, `ofx-xml`, `camt.052`, `camt.053`, `camt.054`, or absent. */
  variant?: string;
  /**
   * `signed`: card rows carry the file's own signs in one Amount column for
   * parseStatementRecords to infer the convention or refuse; `explicit`:
   * Debit/Credit columns.
   */
  layout: 'explicit' | 'signed';
  /** Entries read but deliberately not emitted (pending, contradictory, unreadable). */
  skippedEntries: number;
}

/** Bytes accepted at all. UTF-16 doubles a text file's size. */
const MAX_STRUCTURED_BYTES = 4 * 1024 * 1024;
/** Decoded characters accepted. */
const MAX_STRUCTURED_CHARS = 2 * 1024 * 1024;
/** Entries per file. */
const MAX_STRUCTURED_ENTRIES = 5_000;
const MAX_XML_DEPTH = 64;
const MAX_XML_NODES = 400_000;
/** parseStatementRecords refuses longer titles. */
const MAX_DESCRIPTION_CHARS = 180;
const SNIFF_BYTES = 16 * 1024;

const PASSTHROUGH_ERRORS = new Set(['too_large', 'too_many_rows', 'unsupported_statement_format']);

class StructuredError extends Error {}
const invalid = (): never => {
  throw new StructuredError('invalid_statement_file');
};

/* ───────────────────────────── decoding ───────────────────────────── */

type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

function byteEncoding(bytes: Uint8Array): { encoding: Encoding; offset: number; declared: boolean } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', offset: 3, declared: true };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'utf-16le', offset: 2, declared: true };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'utf-16be', offset: 2, declared: true };
  // UTF-16 without a BOM: ASCII text leaves every other byte zero.
  if (bytes.length >= 4) {
    if (bytes[0] !== 0 && bytes[1] === 0 && bytes[2] !== 0 && bytes[3] === 0) return { encoding: 'utf-16le', offset: 0, declared: true };
    if (bytes[0] === 0 && bytes[1] !== 0 && bytes[2] === 0 && bytes[3] !== 0) return { encoding: 'utf-16be', offset: 0, declared: true };
  }
  // A single-byte charset named by the file itself: OFX v1 `CHARSET:1252`
  // (unless it says ENCODING:UTF-8) or an XML declaration.
  let head = '';
  for (let index = 0; index < Math.min(bytes.length, 1024); index += 1) head += String.fromCharCode(bytes[index]);
  const ofxCharset = /^\s*OFXHEADER\s*:/i.test(head) && /\bCHARSET\s*:\s*(?:1252|ISO-?8859-1|8859-1|WINDOWS-1252)\b/i.test(head) &&
    !/\bENCODING\s*:\s*UTF-?8\b/i.test(head);
  const xmlCharset = /^\s*<\?xml[^>]*\bencoding\s*=\s*["'](?:windows-1252|iso-8859-1|latin-?1|cp1252)["']/i.test(head);
  if (ofxCharset || xmlCharset) return { encoding: 'windows-1252', offset: 0, declared: true };
  return { encoding: 'utf-8', offset: 0, declared: false };
}

/** Decode a whole file; UTF-8 that is not valid UTF-8 is read as Windows-1252. */
function decodeStatement(bytes: Uint8Array): string {
  const { encoding, offset, declared } = byteEncoding(bytes);
  const body = bytes.subarray(offset);
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    if (encoding !== 'utf-8' || declared) return invalid();
    try {
      text = new TextDecoder('windows-1252', { fatal: true, ignoreBOM: true }).decode(body);
    } catch {
      return invalid();
    }
  }
  text = text.replace(/^\uFEFF/, '');
  if (text.includes('\u0000')) invalid();
  if (text.length > MAX_STRUCTURED_CHARS) throw new StructuredError('too_large');
  return text;
}

/** The leading text only, never fatal: enough to recognise a format. */
function sniffText(bytes: Uint8Array): string {
  const { encoding, offset } = byteEncoding(bytes);
  try {
    return new TextDecoder(encoding, { fatal: false, ignoreBOM: true })
      .decode(bytes.subarray(offset, offset + SNIFF_BYTES)).replace(/^\uFEFF/, '');
  } catch {
    return '';
  }
}

/** The five XML entities and numeric references; anything else stays as written. */
function decodeEntities(value: string): string {
  return value.replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/g, (match, body: string) => {
    switch (body) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default: {
        const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ' ';
        return String.fromCodePoint(code);
      }
    }
  });
}

/* ───────────────────────────── detection ───────────────────────────── */

type Kind = StructuredStatementFormat;

const OFX_SNIFF = /^\s*(?:OFXHEADER\s*:\s*\d|<\?xml[\s\S]{0,600}?<\?OFX\b|<OFX\s*>)/i;
const CAMT_SNIFF = /urn:iso:std:iso:20022:tech:xsd:camt\.05[234]\.001\.\d{2}|<(?:[A-Za-z_][\w.-]*:)?BkToCstmr(?:Stmt|AcctRpt|DbtCdtNtfctn)\b/;
const QIF_SNIFF = /^\s*!(?:Type|Account|Option|Clear)\s*:?/i;

function kindOf(head: string): Kind | null {
  if (OFX_SNIFF.test(head)) return 'ofx';
  if (/^\s*</.test(head) && CAMT_SNIFF.test(head)) return 'camt053';
  if (QIF_SNIFF.test(head)) return 'qif';
  const swiftBlock = /^\s*\{1:F01[^}]*\}\s*\{2:[IO]940/.test(head);
  if (swiftBlock || (/(?:^|\n)\s*:20:/.test(head) && /(?:^|\n)\s*:25:/.test(head) && /(?:^|\n)\s*:(?:60[FM]|61):/.test(head))) {
    return 'mt940';
  }
  return null;
}

/** Which structured format these bytes are, from their content only. */
export function structuredStatementKind(bytes: Uint8Array): StructuredStatementFormat | null {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return null;
  return kindOf(sniffText(bytes));
}

/* ───────────────────────────── shared output ───────────────────────────── */

interface Decimal { negative: boolean; whole: string; fraction: string }

/** `-0012.500` → { negative, whole: '12', fraction: '5' }; null for a zero or unreadable figure. */
function decimal(negative: boolean, whole: string, fraction: string): Decimal | null {
  const w = whole.replace(/^0+(?=\d)/, '') || '0';
  const f = fraction.replace(/0+$/, '');
  if (!/^\d+$/.test(w) || (f && !/^\d+$/.test(f))) return null;
  if (w.length > 15 || f.length > 6) return null;
  if (/^0+$/.test(w) && !f) return null;
  return { negative, whole: w, fraction: f };
}

const decimalText = (value: Decimal): string => value.fraction ? `${value.whole}.${value.fraction}` : value.whole;

function minorUnits(value: Decimal, currency: string | null): number | null {
  const exponent = currency ? ledgerMoneySpec(currency)?.exponent : undefined;
  if (exponent === undefined || value.fraction.length > exponent) return null;
  const minor = Number(value.whole) * 10 ** exponent + Number(value.fraction.padEnd(exponent, '0') || '0');
  if (!Number.isSafeInteger(minor)) return null;
  return value.negative ? -minor : minor;
}

function validIsoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 2100 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** A title parseStatementRecords will accept: no controls or bidi overrides, ≤180 chars. */
function cleanDescription(parts: (string | null | undefined)[], fallback: string): string {
  const seen: string[] = [];
  for (const part of parts) {
    const text = (part ?? '')
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
      .normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (seen.some((earlier) => earlier.toLowerCase().includes(text.toLowerCase()))) continue;
    seen.push(text);
  }
  let joined = seen.join(' ');
  if ([...joined].length < 2) joined = fallback;
  const chars = [...joined];
  return chars.length > MAX_DESCRIPTION_CHARS ? chars.slice(0, MAX_DESCRIPTION_CHARS).join('').trim() : joined;
}

/** The stated identifier's last four digits, masked; undefined when it has none. */
function maskedIdentifier(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const compact = value.normalize('NFKC').replace(/[\s._/-]+/g, '');
  const tail = /(\d{4})$/.exec(compact)?.[1];
  return tail ? `••••${tail}` : undefined;
}

const currencyCode = (value: string | null | undefined): string | null => {
  const code = (value ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
};

interface Entry {
  date: string;
  description: string;
  amount: Decimal; // magnitude; `negative` = the file's own sign (signed layout)
  direction: 'expense' | 'income' | null; // explicit layout
  currency: string | null;
  reference: string | null;
  instrument: 'account' | 'credit';
  identifier?: string;
}

function buildRecords(entries: Entry[], layout: 'explicit' | 'signed'): string[][] {
  const withCurrency = entries.length > 0 && entries.every((entry) => entry.currency);
  const withReference = entries.some((entry) => entry.reference);
  const withAccount = entries.some((entry) => entry.instrument === 'account' && entry.identifier);
  const withCard = entries.some((entry) => entry.instrument === 'credit');
  const header = layout === 'explicit' ? ['Date', 'Description', 'Debit', 'Credit'] : ['Date', 'Description', 'Amount'];
  if (withCurrency) header.push('Currency');
  if (withReference) header.push('Reference');
  if (withAccount) header.push('Account number');
  // "Credit card number" is both the card column and a card-export header,
  // which is what tells the reader these rows are a card's.
  if (withCard) header.push('Credit card number');
  const records = [header];
  for (const entry of entries) {
    const figure = decimalText(entry.amount);
    const record = layout === 'explicit'
      ? [entry.date, entry.description, entry.direction === 'expense' ? figure : '', entry.direction === 'income' ? figure : '']
      : [entry.date, entry.description, entry.amount.negative ? `-${figure}` : figure];
    if (withCurrency) record.push(entry.currency ?? '');
    if (withReference) record.push(entry.reference ?? '');
    if (withAccount) record.push(entry.instrument === 'account' ? entry.identifier ?? '' : '');
    if (withCard) record.push(entry.instrument === 'credit' ? entry.identifier ?? '' : '');
    records.push(record);
  }
  return records;
}

/** The single account the entries state, or null. */
function soleAccount(
  statements: { kind: 'account' | 'credit'; identifier?: string }[],
): StructuredStatementAccount | null {
  if (statements.length === 0) return null;
  const keys = new Set(statements.map((statement) => `${statement.kind}:${statement.identifier ?? ''}`));
  if (keys.size !== 1) return null;
  const [first] = statements;
  return first.identifier ? { kind: first.kind, identifier: first.identifier } : { kind: first.kind };
}

function countEntry(state: { entries: number }): void {
  state.entries += 1;
  if (state.entries > MAX_STRUCTURED_ENTRIES) throw new StructuredError('too_many_rows');
}

/** A reference worth carrying: not an "unknown" placeholder. */
function reference(value: string | null | undefined): string | null {
  const text = (value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  if (!text || /^(?:NONREF|NOTPROVIDED|NOT PROVIDED|NONE|N\/A)$/i.test(text)) return null;
  return text.length > 96 ? null : text;
}

/* ───────────────────────────── OFX / QFX ───────────────────────────── */

interface SgmlNode { name: string; text: string; children: SgmlNode[] }

const sgmlChild = (node: SgmlNode | undefined, name: string): SgmlNode | undefined =>
  node?.children.find((child) => child.name === name);
const sgmlText = (node: SgmlNode | undefined, ...path: string[]): string => {
  let current = node;
  for (const name of path) current = sgmlChild(current, name);
  return current ? decodeEntities(current.text).trim() : '';
};

/**
 * OFX v1 is SGML whose leaf elements have no end tag; v2 is XML. One tolerant
 * builder reads both: a tag followed by text is a leaf and closes itself, an
 * end tag closes the nearest open element of that name, and an element never
 * nests inside one of its own name (an unclosed STMTTRN closes at the next).
 */
function parseOfxTree(text: string): SgmlNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) invalid();
  const start = text.search(/<OFX\s*>/i);
  if (start < 0) invalid();
  const header = text.slice(0, start);
  const compression = /\bCOMPRESSION\s*:\s*(\S+)/i.exec(header)?.[1];
  if (compression && !/^NONE$/i.test(compression)) invalid();
  const body = text.slice(start).replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  const root: SgmlNode = { name: '#root', text: '', children: [] };
  const stack: SgmlNode[] = [root];
  let pendingLeaf: SgmlNode | null = null;
  let nodes = 0;
  const token = /<(\/?)([A-Za-z][A-Za-z0-9._]*)([^<>]*)>|([^<]+)|(<)/g;
  for (let match = token.exec(body); match; match = token.exec(body)) {
    if (match[5]) invalid();
    if (match[4] !== undefined) {
      const value = match[4].trim();
      if (!value) continue;
      const top = stack[stack.length - 1];
      if (top !== root && top.children.length === 0 && !top.text) {
        top.text = value;
        stack.pop();
        pendingLeaf = top;
      }
      continue;
    }
    const name = match[2].toUpperCase();
    if (match[1]) {
      if (pendingLeaf && pendingLeaf.name === name) {
        pendingLeaf = null;
        continue;
      }
      pendingLeaf = null;
      const at = stack.map((node) => node.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
      continue;
    }
    pendingLeaf = null;
    if (++nodes > MAX_XML_NODES) throw new StructuredError('too_large');
    const same = stack.map((node) => node.name).lastIndexOf(name);
    if (same > 0) stack.length = same;
    const node: SgmlNode = { name, text: '', children: [] };
    stack[stack.length - 1].children.push(node);
    if (/\/\s*$/.test(match[3])) continue; // <MEMO/>
    if (stack.length > MAX_XML_DEPTH) invalid();
    stack.push(node);
  }
  const ofx = sgmlChild(root, 'OFX');
  if (!ofx) invalid();
  return ofx!;
}

function ofxStatements(node: SgmlNode, found: SgmlNode[] = []): SgmlNode[] {
  for (const child of node.children) {
    if (child.name === 'STMTRS' || child.name === 'CCSTMTRS') found.push(child);
    else ofxStatements(child, found);
  }
  return found;
}

/** `20260105`, `20260105120000.000[-5:EST]` → `2026-01-05` (the date as stated). */
function ofxDate(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:\d{2}(?:\d{2}(?:\d{2}(?:\.\d{1,3})?)?)?)?\s*(?:\[[^\]]{1,24}\])?$/.exec(value.trim());
  return match ? validIsoDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

/** OFX amounts: optional sign, `.` or `,` as the decimal mark, no grouping. */
function ofxAmount(value: string): Decimal | null {
  const match = /^([+-])?(\d*)(?:[.,](\d*))?$/.exec(value.replace(/\s+/g, ''));
  if (!match || !(match[2] || match[3])) return null;
  return decimal(match[1] === '-', match[2] || '0', match[3] ?? '');
}

const OFX_TYPE_TITLES: Record<string, string> = {
  INT: 'Interest', DIV: 'Dividend', FEE: 'Fee', SRVCHG: 'Service charge', DEP: 'Deposit', ATM: 'ATM',
  POS: 'Card purchase', XFER: 'Transfer', CHECK: 'Cheque', PAYMENT: 'Payment', CASH: 'Cash withdrawal',
  DIRECTDEP: 'Direct deposit', DIRECTDEBIT: 'Direct debit', REPEATPMT: 'Standing order',
};

/** A card's money-in wording, which the spec signs positive. */
const CARD_CREDIT_WORDING = /\b(?:payment|pymt)\s*-?\s*(?:received|recd|thank)|\bthank\s+you\b|\brefund(?:ed)?\b/i;

function readOfx(text: string): StructuredStatement {
  const ofx = parseOfxTree(text);
  const variant = /^\s*OFXHEADER\s*:\s*1\d\d/i.test(text) ? 'ofx-sgml' : 'ofx-xml';
  const statements = ofxStatements(ofx);
  if (statements.length === 0) invalid();
  const state = { entries: 0 };
  let skipped = 0;
  const explicit: Entry[] = [];
  const signedGroups: Entry[][] = [];
  const identities: { kind: 'account' | 'credit'; identifier?: string }[] = [];
  const currencies = new Set<string>();
  const balances: ({ amount: Decimal; date: string; currency: string | null } | null)[] = [];

  for (const statement of statements) {
    const card = statement.name === 'CCSTMTRS';
    const curdef = currencyCode(sgmlText(statement, 'CURDEF'));
    if (curdef) currencies.add(curdef);
    const from = sgmlChild(statement, card ? 'CCACCTFROM' : 'BANKACCTFROM');
    const identifier = maskedIdentifier(sgmlText(from, 'ACCTID'));
    const instrument: 'account' | 'credit' = card ? 'credit' : 'account';
    identities.push({ kind: instrument, identifier });
    const ledger = sgmlChild(statement, 'LEDGERBAL');
    const balanceText = sgmlText(ledger, 'BALAMT');
    const balanceAmount = ofxAmount(balanceText) ?? (/^[+-]?0*(?:[.,]0*)?$/.test(balanceText) && /0/.test(balanceText)
      ? { negative: false, whole: '0', fraction: '' } : null);
    const balanceDate = ofxDate(sgmlText(ledger, 'DTASOF'));
    balances.push(balanceAmount && balanceDate ? { amount: balanceAmount, date: balanceDate, currency: curdef } : null);

    const transactions = sgmlChild(statement, 'BANKTRANLIST')?.children.filter((child) => child.name === 'STMTTRN') ?? [];
    const rows: { entry: Entry; type: string }[] = [];
    let contradictions = 0;
    for (const trn of transactions) {
      countEntry(state);
      const type = sgmlText(trn, 'TRNTYPE').toUpperCase();
      const amount = ofxAmount(sgmlText(trn, 'TRNAMT'));
      const date = ofxDate(sgmlText(trn, 'DTUSER')) ?? ofxDate(sgmlText(trn, 'DTPOSTED'));
      if (!amount || !date) {
        skipped += 1;
        continue;
      }
      // CURRENCY: the amounts are in that currency; ORIGCURRENCY: they were
      // already converted into CURDEF.
      const currency = currencyCode(sgmlText(trn, 'CURRENCY', 'CURSYM')) ?? curdef;
      const name = sgmlText(trn, 'NAME') || sgmlText(trn, 'PAYEE', 'NAME');
      const memo = sgmlText(trn, 'MEMO');
      const description = cleanDescription([name, memo], OFX_TYPE_TITLES[type] ?? 'Bank transaction');
      const contradicts = (type === 'DEBIT' && !amount.negative) || (type === 'CREDIT' && amount.negative) ||
        (card && amount.negative && CARD_CREDIT_WORDING.test(`${name} ${memo}`));
      if (contradicts) contradictions += 1;
      rows.push({
        type,
        entry: {
          date, description, amount, currency, instrument, identifier,
          // The spec signs statement amounts by their effect on the account:
          // negative debits it (money out of an account, a charge on a card).
          direction: amount.negative ? 'expense' : 'income',
          reference: reference(sgmlText(trn, 'FITID')) ?? reference(sgmlText(trn, 'CHECKNUM')),
        },
      });
    }
    if (card && contradictions > 0) {
      // This issuer does not sign by the spec: let the reader infer from the rows.
      signedGroups.push(rows.map((row) => row.entry));
      continue;
    }
    for (const row of rows) {
      const contradicts = (row.type === 'DEBIT' && !row.entry.amount.negative) || (row.type === 'CREDIT' && row.entry.amount.negative);
      if (contradicts) skipped += 1;
      else explicit.push(row.entry);
    }
  }

  let layout: 'explicit' | 'signed' = 'explicit';
  let entries = explicit;
  if (signedGroups.length > 0) {
    if (explicit.length === 0 && signedGroups.length === 1) {
      layout = 'signed';
      entries = signedGroups[0];
    } else {
      // A signed card statement cannot share a table with explicit rows.
      skipped += signedGroups.reduce((sum, group) => sum + group.length, 0);
    }
  }
  const balance = balances.length === 1 ? balances[0] : null;
  return {
    format: 'ofx',
    variant,
    records: buildRecords(entries, layout),
    account: soleAccount(identities),
    currency: currencies.size === 1 ? [...currencies][0] : null,
    closingBalance: balance ? closing(balance.amount, balance.date, balance.currency) : null,
    layout,
    skippedEntries: skipped,
  };
}

function closing(amount: Decimal, date: string, currency: string | null): { amountMinor: number; date: string } | null {
  if (/^0+$/.test(amount.whole) && !amount.fraction) return { amountMinor: 0, date };
  const minor = minorUnits(amount, currency);
  return minor === null ? null : { amountMinor: minor, date };
}

/* ───────────────────────────── QIF ───────────────────────────── */

type QifSection = 'bank' | 'ccard' | 'cash' | 'unsupported' | 'account-list' | null;
type DecimalMark = 'point' | 'comma';

function qifSection(header: string): QifSection {
  const type = /^!Type\s*:\s*(.+)$/i.exec(header)?.[1].trim().toLowerCase();
  if (type === undefined) {
    if (/^!Account\b/i.test(header)) return 'account-list';
    return null; // !Option / !Clear: no change
  }
  if (type === 'bank') return 'bank';
  if (type === 'ccard') return 'ccard';
  if (type === 'cash') return 'cash';
  return 'unsupported'; // Invst, Oth A, Oth L, Cat, Class, Memorized, Prices …
}

/** What one QIF figure proves about its decimal mark. */
function qifMarkEvidence(token: string): DecimalMark | null {
  const dot = token.lastIndexOf('.');
  const comma = token.lastIndexOf(',');
  if (dot >= 0 && comma >= 0) return dot > comma ? 'point' : 'comma';
  const mark = dot >= 0 ? '.' : comma >= 0 ? ',' : null;
  if (!mark) return null;
  const parts = token.split(mark);
  if (parts.length > 2) return mark === '.' ? 'comma' : 'point'; // the repeated mark groups
  return parts[1].length === 3 ? null : mark === '.' ? 'point' : 'comma';
}

function qifAmount(token: string, mark: DecimalMark | null): Decimal | null {
  const compact = token.replace(/[\s\u00a0]+/g, '');
  const match = /^([+-])?([\d.,]+)$/.exec(compact);
  if (!match) return null;
  const figure = match[2];
  const evidence = qifMarkEvidence(figure);
  const decimalMark = evidence ?? mark;
  if (!/[.,]/.test(figure)) return decimal(match[1] === '-', figure, '');
  if (!decimalMark || (evidence && mark && evidence !== mark)) return null;
  const [group, point] = decimalMark === 'point' ? [',', '.'] : ['.', ','];
  const shape = new RegExp(`^(\\d{1,3}(?:\\${group}\\d{3})+|\\d+)(?:\\${point}(\\d+))?$`).exec(figure);
  if (!shape) return null;
  return decimal(match[1] === '-', shape[1].split(group).join(''), shape[2] ?? '');
}

interface QifDate { text: string; first?: number; second?: number; numeric: boolean }

/**
 * A QIF date as written, with a four-digit year so the reader never has to
 * guess a century: `1/ 5'26` → `1/5/2026` (Quicken's apostrophe marks the
 * 2000s), `01/05/26` → `01/05/2026`, `01/05/96` → `01/05/1996`. The
 * day/month order is left exactly as the file wrote it.
 */
function qifDate(value: string): QifDate {
  const text = value.replace(/\s+/g, '');
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) {
    const date = validIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return { text: date ?? text, numeric: false };
  }
  const local = /^(\d{1,2})([\/.-])(\d{1,2})(?:(')|[\/.-])(\d{2}|\d{4})$/.exec(text);
  if (!local) return { text, numeric: false };
  let year = Number(local[5]);
  if (local[5].length === 2) year += local[4] ? 2000 : year >= 70 ? 1900 : 2000;
  return { text: `${local[1]}/${local[3]}/${year}`, first: Number(local[1]), second: Number(local[3]), numeric: true };
}

function readQif(text: string): StructuredStatement {
  const lines = text.split(/\r\n|\n|\r/);
  const state = { entries: 0 };
  let section: QifSection = null;
  let sawSupported = false;
  let sawUnsupported = false;
  let accountSections = 0;
  let skipped = 0;
  interface Raw { section: 'bank' | 'ccard' | 'cash'; date?: string; amount?: string; payee?: string; memo?: string; number?: string; account: number }
  const raws: Raw[] = [];
  let current: Partial<Raw> | null = null;
  const finish = () => {
    if (current && (section === 'bank' || section === 'ccard' || section === 'cash')) {
      if (current.date !== undefined || current.amount !== undefined || current.payee !== undefined) {
        countEntry(state);
        raws.push({ ...current, section, account: accountSections } as Raw);
      }
    }
    current = null;
  };
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith('!')) {
      finish();
      const next = qifSection(line.trim());
      if (next === null) continue;
      section = next;
      if (next === 'account-list') accountSections += 1;
      if (next === 'bank' || next === 'ccard' || next === 'cash') sawSupported = true;
      if (next === 'unsupported') sawUnsupported = true;
      continue;
    }
    if (section === 'account-list') {
      // `!Account` blocks name the account that follows; only the name and
      // type are printed, never a number, so nothing is taken from them.
      if (line.startsWith('^')) section = null;
      continue;
    }
    if (section === null) invalid(); // data before any header
    if (section === 'unsupported') continue;
    if (line.startsWith('^')) {
      finish();
      continue;
    }
    current ??= {};
    const code = line[0];
    const value = line.slice(1).trim();
    if (code === 'D') current.date = value;
    else if (code === 'T') current.amount = value;
    else if (code === 'U') current.amount ??= value;
    else if (code === 'P') current.payee = value;
    else if (code === 'M') current.memo = value;
    else if (code === 'N') current.number = value;
  }
  finish();
  if (!sawSupported) {
    if (sawUnsupported) throw new StructuredError('unsupported_statement_format');
    invalid();
  }

  // The file's decimal mark, from figures that prove it.
  let point = 0;
  let comma = 0;
  for (const raw of raws) {
    const evidence = raw.amount ? qifMarkEvidence(raw.amount.replace(/^[+-]/, '').replace(/\s+/g, '')) : null;
    if (evidence === 'point') point += 1;
    if (evidence === 'comma') comma += 1;
  }
  const mark: DecimalMark | null = point > 0 && comma === 0 ? 'point' : comma > 0 && point === 0 ? 'comma' : null;

  let dayFirst = false;
  let monthFirst = false;
  let swappable = false;
  const bank: Entry[] = [];
  const cards: Entry[] = [];
  const cardAccounts = new Set<number>();
  const bankAccounts = new Set<number>();
  for (const raw of raws) {
    const amount = raw.amount ? qifAmount(raw.amount, mark) : null;
    const date = raw.date ? qifDate(raw.date) : null;
    if (!amount || !date) {
      skipped += 1;
      continue;
    }
    if (date.numeric) {
      if (date.first! > 12) dayFirst = true;
      if (date.second! > 12) monthFirst = true;
      if (date.first! <= 12 && date.second! <= 12 && date.first !== date.second) swappable = true;
    }
    const entry: Entry = {
      date: date.text,
      description: cleanDescription([raw.payee, raw.memo], raw.section === 'ccard' ? 'Card transaction' : 'Transaction'),
      amount,
      // Quicken: "For payments, a leading minus sign is required" — the
      // bank/cash convention. Card files carry no documented sign.
      direction: raw.section === 'ccard' ? null : amount.negative ? 'expense' : 'income',
      currency: null,
      reference: reference(raw.number),
      instrument: raw.section === 'ccard' ? 'credit' : 'account',
    };
    if (raw.section === 'ccard') {
      cards.push(entry);
      cardAccounts.add(raw.account);
    } else {
      bank.push(entry);
      bankAccounts.add(raw.account);
    }
  }
  let layout: 'explicit' | 'signed' = 'explicit';
  let entries = bank;
  if (cards.length > 0) {
    if (bank.length === 0 && cardAccounts.size === 1) {
      layout = 'signed';
      entries = cards;
    } else {
      skipped += cards.length;
    }
  }
  const accounts = layout === 'signed' ? cardAccounts : bankAccounts;
  const kind: 'account' | 'credit' = layout === 'signed' ? 'credit' : 'account';
  return {
    format: 'qif',
    records: buildRecords(entries, layout),
    account: entries.length > 0 && accounts.size === 1 ? { kind } : null,
    currency: null,
    closingBalance: null,
    dateOrderAmbiguous: swappable && dayFirst === monthFirst,
    layout,
    skippedEntries: skipped,
  };
}

/* ───────────────────────────── XML (camt) ───────────────────────────── */

interface XmlNode { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string }

const localName = (qualified: string): string => qualified.slice(qualified.indexOf(':') + 1);

/**
 * A minimal, non-validating XML reader: elements, attributes, text, CDATA.
 * Processing instructions and comments are skipped; any DOCTYPE or other
 * markup declaration is refused, so no entity can be declared or expanded.
 */
function parseXml(text: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let index = 0;
  let nodes = 0;
  while (index < text.length) {
    const lt = text.indexOf('<', index);
    const chunk = text.slice(index, lt < 0 ? text.length : lt);
    if (chunk.trim()) {
      if (stack.length === 1) invalid();
      stack[stack.length - 1].text += decodeEntities(chunk);
    }
    if (lt < 0) break;
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      if (end < 0) invalid();
      index = end + 2;
    } else if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end < 0) invalid();
      index = end + 3;
    } else if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end < 0 || stack.length === 1) invalid();
      stack[stack.length - 1].text += text.slice(lt + 9, end);
      index = end + 3;
    } else if (text.startsWith('<!', lt)) {
      return invalid(); // DOCTYPE, ENTITY …
    } else if (text.startsWith('</', lt)) {
      const end = text.indexOf('>', lt);
      if (end < 0) invalid();
      const name = text.slice(lt + 2, end).trim();
      const top = stack.pop();
      if (!top || top === root || top.name !== localName(name)) invalid();
      index = end + 1;
    } else {
      // Find the tag's end outside quoted attribute values.
      let end = lt + 1;
      let quote = '';
      for (; end < text.length; end += 1) {
        const char = text[end];
        if (quote) {
          if (char === quote) quote = '';
        } else if (char === '"' || char === "'") {
          quote = char;
        } else if (char === '>') {
          break;
        } else if (char === '<') {
          invalid();
        }
      }
      if (end >= text.length) invalid();
      let inner = text.slice(lt + 1, end);
      const selfClosing = inner.endsWith('/');
      if (selfClosing) inner = inner.slice(0, -1);
      const nameMatch = /^([A-Za-z_][\w.:-]*)/.exec(inner);
      if (!nameMatch) invalid();
      const attrs: Record<string, string> = {};
      const rest = inner.slice(nameMatch![1].length);
      const attr = /\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gy;
      let consumed = 0;
      for (let found = attr.exec(rest); found; found = attr.exec(rest)) {
        attrs[localName(found[1])] = decodeEntities(found[2] ?? found[3] ?? '');
        consumed = attr.lastIndex;
      }
      if (rest.slice(consumed).trim()) invalid();
      if (++nodes > MAX_XML_NODES) throw new StructuredError('too_large');
      if (stack.length === 1 && root.children.length > 0) invalid(); // one document element
      const node: XmlNode = { name: localName(nameMatch![1]), attrs, children: [], text: '' };
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) {
        if (stack.length > MAX_XML_DEPTH) invalid();
        stack.push(node);
      }
      index = end + 1;
    }
  }
  if (stack.length !== 1 || root.children.length !== 1) invalid();
  return root.children[0];
}

const xmlChild = (node: XmlNode | undefined, name: string): XmlNode | undefined =>
  node?.children.find((child) => child.name === name);
const xmlChildren = (node: XmlNode | undefined, name: string): XmlNode[] =>
  node?.children.filter((child) => child.name === name) ?? [];
const xmlPath = (node: XmlNode | undefined, ...path: string[]): XmlNode | undefined => {
  let current = node;
  for (const name of path) current = xmlChild(current, name);
  return current;
};
const xmlText = (node: XmlNode | undefined, ...path: string[]): string => xmlPath(node, ...path)?.text.trim() ?? '';

/** `2026-01-05` or `2026-01-05T10:00:00+01:00` → `2026-01-05`. */
function camtDate(node: XmlNode | undefined): string | null {
  const value = xmlText(node, 'Dt') || xmlText(node, 'DtTm');
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  return match ? validIsoDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

function camtAmount(node: XmlNode | undefined): Decimal | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(node?.text.trim() ?? '');
  return match ? decimal(false, match[1], match[2] ?? '') : null;
}

/** A party name in any camt version (`Cdtr/Nm` or, from v.02 on, `Cdtr/Pty/Nm`). */
function partyName(parties: XmlNode | undefined, role: string): string {
  const party = xmlChild(parties, role);
  return xmlText(party, 'Nm') || xmlText(party, 'Pty', 'Nm');
}

function readCamt(text: string): StructuredStatement {
  const document = parseXml(text);
  if (document.name !== 'Document') invalid();
  const message = document.children.find((child) => /^BkToCstmr(?:Stmt|AcctRpt|DbtCdtNtfctn)$/.test(child.name));
  if (!message) invalid();
  const [variant, itemName] = message!.name === 'BkToCstmrStmt'
    ? ['camt.053', 'Stmt']
    : message!.name === 'BkToCstmrAcctRpt' ? ['camt.052', 'Rpt'] : ['camt.054', 'Ntfctn'];
  const items = xmlChildren(message, itemName);
  if (items.length === 0) invalid();
  const state = { entries: 0 };
  let skipped = 0;
  const entries: Entry[] = [];
  const identities: { kind: 'account' | 'credit'; identifier?: string }[] = [];
  const currencies = new Set<string>();
  let lastClosing: { amount: Decimal; date: string; currency: string | null } | null = null;

  for (const item of items) {
    const account = xmlChild(item, 'Acct');
    const stated = xmlText(account, 'Id', 'IBAN') || xmlText(account, 'Id', 'Othr', 'Id');
    const identifier = maskedIdentifier(stated);
    identities.push({ kind: 'account', identifier });
    const accountCurrency = currencyCode(xmlText(account, 'Ccy'));
    if (accountCurrency) currencies.add(accountCurrency);

    for (const balance of xmlChildren(item, 'Bal')) {
      const code = xmlText(balance, 'Tp', 'CdOrPrtry', 'Cd') || xmlText(balance, 'Tp', 'Cd');
      if (code !== 'CLBD') continue;
      const amountNode = xmlChild(balance, 'Amt');
      const amount = camtAmount(amountNode);
      const date = camtDate(xmlChild(balance, 'Dt'));
      const indicator = xmlText(balance, 'CdtDbtInd');
      if (!date || (indicator !== 'CRDT' && indicator !== 'DBIT')) continue;
      const value = amount ?? (/^0+(?:\.0+)?$/.test(amountNode?.text.trim() ?? '') ? { negative: false, whole: '0', fraction: '' } : null);
      if (!value) continue;
      lastClosing = {
        amount: { ...value, negative: indicator === 'DBIT' },
        date,
        currency: currencyCode(amountNode?.attrs.Ccy) ?? accountCurrency,
      };
    }

    for (const ntry of xmlChildren(item, 'Ntry')) {
      countEntry(state);
      const status = xmlText(ntry, 'Sts') || xmlText(ntry, 'Sts', 'Cd');
      if (status && status !== 'BOOK') {
        skipped += 1; // pending or information-only
        continue;
      }
      const amountNode = xmlChild(ntry, 'Amt');
      const amount = camtAmount(amountNode);
      const indicator = xmlText(ntry, 'CdtDbtInd');
      const date = camtDate(xmlChild(ntry, 'BookgDt')) ?? camtDate(xmlChild(ntry, 'ValDt'));
      if (!amount || !date || (indicator !== 'CRDT' && indicator !== 'DBIT')) {
        skipped += 1;
        continue;
      }
      // ISO 20022: on a reversal the indicator is the reversal booking's own
      // direction (CRDT undoes a debit), so it is still the money movement.
      const reversal = /^(?:true|1)$/i.test(xmlText(ntry, 'RvslInd'));
      const details = xmlChildren(xmlChild(ntry, 'NtryDtls'), 'TxDtls');
      const single = details.length === 1 ? details[0] : undefined;
      const parties = xmlChild(single, 'RltdPties');
      // The counterparty is whoever the money went to (debit) or came from (credit).
      const counterRole = (indicator === 'DBIT') !== reversal ? 'Cdtr' : 'Dbtr';
      const counterparty = partyName(parties, counterRole) || partyName(parties, counterRole === 'Cdtr' ? 'Dbtr' : 'Cdtr');
      const remittance = xmlChildren(xmlChild(single, 'RmtInf'), 'Ustrd').map((node) => node.text).join(' ');
      const description = cleanDescription([
        reversal ? 'Reversal' : null,
        counterparty,
        remittance,
        xmlText(single, 'AddtlTxInf'),
        xmlText(ntry, 'AddtlNtryInf'),
      ], 'Bank transaction');
      entries.push({
        date, description, amount,
        direction: indicator === 'DBIT' ? 'expense' : 'income',
        currency: currencyCode(amountNode?.attrs.Ccy) ?? accountCurrency,
        reference: reference(xmlText(ntry, 'AcctSvcrRef')) ?? reference(xmlText(single, 'Refs', 'AcctSvcrRef')) ??
          reference(xmlText(single, 'Refs', 'EndToEndId')),
        instrument: 'account',
        identifier,
      });
    }
  }
  const account = soleAccount(identities);
  return {
    format: 'camt053',
    variant,
    records: buildRecords(entries, 'explicit'),
    account,
    currency: currencies.size === 1 ? [...currencies][0] : null,
    closingBalance: account && lastClosing ? closing(lastClosing.amount, lastClosing.date, lastClosing.currency) : null,
    layout: 'explicit',
    skippedEntries: skipped,
  };
}

/* ───────────────────────────── MT940 ───────────────────────────── */

interface SwiftField { tag: string; value: string }

/** The tagged fields of an MT940 text, SWIFT blocks unwrapped, continuation lines kept. */
function swiftFields(text: string): SwiftField[] {
  let body = text;
  if (/\{4:/.test(body)) {
    const blocks = [...body.matchAll(/\{4:\s*([\s\S]*?)\n-\}/g)].map((match) => match[1]);
    if (blocks.length === 0) invalid();
    body = blocks.join('\n');
  }
  const fields: SwiftField[] = [];
  for (const line of body.split(/\r\n|\n|\r/)) {
    const tagged = /^:(\d{2}[A-Z]?):(.*)$/.exec(line);
    if (tagged) fields.push({ tag: tagged[1], value: tagged[2] });
    else if (/^-\s*$/.test(line) || !line.trim()) continue;
    else if (fields.length > 0) fields[fields.length - 1].value += `\n${line}`;
    // Anything before the first tag (a transmission header line) is ignored.
  }
  return fields;
}

/** `C260131EUR1234,56` (:60F:/:62F:) */
function swiftBalance(value: string): { amount: Decimal; date: string; currency: string } | null {
  const match = /^([CD])(\d{2})(\d{2})(\d{2})([A-Z]{3})(\d+),(\d*)\s*$/.exec(value.trim());
  if (!match) return null;
  const date = validIsoDate(2000 + Number(match[2]), Number(match[3]), Number(match[4]));
  const amount = decimal(match[1] === 'D', match[6], match[7]) ?? (/^0+$/.test(match[6] + match[7]) ? { negative: false, whole: '0', fraction: '' } : null);
  return date && amount ? { amount, date, currency: match[5] } : null;
}

const SEPA_TAGS = /(?:EREF|KREF|MREF|CRED|DEBT|COAM|OAMT|SVWZ|ABWA|ABWE|IBAN|BIC)\+/g;

/** A German structured :86: (`166?00GUTSCHRIFT?20…?32Name`) or free text. */
function swiftNarrative(value: string): string {
  const flat = value.replace(/\r?\n/g, '');
  if (!/^\d{3}\?/.test(flat) && !/\?2\d/.test(flat)) return value.replace(/\s*\n\s*/g, ' ');
  const sub: Record<string, string> = {};
  const parts = flat.split(/\?(\d{2})/);
  for (let index = 1; index + 1 < parts.length; index += 2) sub[parts[index]] = (sub[parts[index]] ?? '') + parts[index + 1];
  const name = [sub['32'], sub['33']].filter(Boolean).join('');
  let purpose = ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '60', '61', '62', '63']
    .map((code) => sub[code] ?? '').join('');
  const svwz = /SVWZ\+([\s\S]*?)(?=(?:EREF|KREF|MREF|CRED|DEBT|COAM|OAMT|ABWA|ABWE|IBAN|BIC)\+|$)/.exec(purpose);
  if (svwz) purpose = svwz[1];
  else purpose = purpose.replace(SEPA_TAGS, ' ');
  return [name, purpose.trim() || sub['00']].filter(Boolean).join(' ');
}

/** `2601050105C1234,56NTRFREF//BANKREF\nDETAILS` (:61:) */
const SWIFT_LINE = /^(\d{2})(\d{2})(\d{2})(\d{4})?(RC|RD|C|D)([A-Z])?(\d+),(\d*)([NSF][A-Z0-9]{3})([^\n]*?)(?:\/\/([^\n]*))?(?:\n([\s\S]*))?$/;

function readMt940(text: string): StructuredStatement {
  const fields = swiftFields(text);
  if (!fields.some((field) => field.tag === '20')) invalid();
  const state = { entries: 0 };
  let skipped = 0;
  interface Line { entry: Entry; reversal: boolean; supplementary: string; narrative: string }
  const lines: Line[] = [];
  const identities: { kind: 'account' | 'credit'; identifier?: string }[] = [];
  const currencies = new Set<string>();
  let closingBalance: { amount: Decimal; date: string; currency: string } | null = null;
  let statementCurrency: string | null = null;
  let identifier: string | undefined;
  let statements = 0;
  // The :61: line a following :86: describes; any other field ends it.
  let open: Line | null = null;

  for (const field of fields) {
    const describes = open;
    open = null;
    switch (field.tag) {
      case '20':
        statements += 1;
        statementCurrency = null;
        identifier = undefined;
        break;
      case '25': {
        // `37040044/0532013000`, an IBAN, or an IBAN with its currency code appended.
        const stated = field.value.trim().replace(/\s+/g, '');
        const suffix = /\d([A-Z]{3})$/.exec(stated)?.[1];
        identifier = maskedIdentifier(suffix && ledgerMoneySpec(suffix) ? stated.slice(0, -3) : stated);
        identities.push({ kind: 'account', identifier });
        break;
      }
      case '60F':
      case '60M': {
        const balance = swiftBalance(field.value);
        if (!balance) invalid();
        statementCurrency = balance!.currency;
        currencies.add(balance!.currency);
        break;
      }
      case '61': {
        countEntry(state);
        const match = SWIFT_LINE.exec(field.value.trim());
        if (!match) {
          skipped += 1;
          break;
        }
        const [, yy, mm, dd, entryDate, mark, , whole, fraction, , customerRef, bankRef, supplementary] = match;
        const valueYear = 2000 + Number(yy);
        let date = validIsoDate(valueYear, Number(mm), Number(dd));
        if (date && entryDate) {
          // The booking date carries no year: the one nearest the value date.
          const valueTime = Date.parse(date);
          const candidates = [valueYear - 1, valueYear, valueYear + 1]
            .map((year) => validIsoDate(year, Number(entryDate.slice(0, 2)), Number(entryDate.slice(2))))
            .filter((candidate): candidate is string => candidate !== null)
            .sort((a, b) => Math.abs(Date.parse(a) - valueTime) - Math.abs(Date.parse(b) - valueTime));
          date = candidates[0] ?? date;
        }
        const amount = decimal(false, whole, fraction);
        if (!date || !amount) {
          skipped += 1;
          break;
        }
        const line: Line = {
          entry: {
            date, description: '', amount,
            // RC reverses a credit (a debit entry); RD reverses a debit (a credit entry).
            direction: mark === 'C' || mark === 'RD' ? 'income' : 'expense',
            currency: statementCurrency,
            reference: reference(customerRef) ?? reference(bankRef),
            instrument: 'account',
            identifier,
          },
          reversal: mark.startsWith('R'),
          supplementary: supplementary ?? '',
          narrative: '',
        };
        lines.push(line);
        open = line;
        break;
      }
      case '86':
        if (describes) describes.narrative = swiftNarrative(field.value);
        break;
      case '62F':
      case '62M': {
        const balance = swiftBalance(field.value);
        if (!balance) invalid();
        if (field.tag === '62F' || !closingBalance) closingBalance = balance;
        break;
      }
      default:
        break;
    }
  }
  if (statements === 0) invalid();
  const entries = lines.map((line) => ({
    ...line.entry,
    description: cleanDescription(
      [line.reversal ? 'Reversal' : null, line.narrative, line.supplementary],
      'Bank transaction',
    ),
  }));
  const account = soleAccount(identities);
  return {
    format: 'mt940',
    records: buildRecords(entries, 'explicit'),
    account,
    currency: currencies.size === 1 ? [...currencies][0] : null,
    closingBalance: account && closingBalance
      ? closing(closingBalance.amount, closingBalance.date, closingBalance.currency)
      : null,
    layout: 'explicit',
    skippedEntries: skipped,
  };
}

/* ───────────────────────────── entry point ───────────────────────────── */

/**
 * Read a structured statement file into parseStatementRecords records.
 * Null when the bytes are none of these formats. Throws `too_large`,
 * `too_many_rows`, `unsupported_statement_format` (a QIF holding only
 * investment/asset/liability sections), or `invalid_statement_file` for a
 * malformed file of a recognised kind — never a raw parser error.
 */
export function readStructuredStatement(bytes: Uint8Array): StructuredStatement | null {
  const kind = structuredStatementKind(bytes);
  if (!kind) return null;
  try {
    if (bytes.length > MAX_STRUCTURED_BYTES) throw new StructuredError('too_large');
    const text = decodeStatement(bytes);
    switch (kind) {
      case 'ofx': return readOfx(text);
      case 'qif': return readQif(text);
      case 'camt053': return readCamt(text);
      case 'mt940': return readMt940(text);
    }
  } catch (error) {
    if (error instanceof StructuredError && PASSTHROUGH_ERRORS.has(error.message)) throw new Error(error.message);
    throw new Error('invalid_statement_file');
  }
}
