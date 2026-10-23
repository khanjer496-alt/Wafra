/** In-memory normalization for forwarded bank email and text-based statements. */
import PostalMime from 'postal-mime';
import { parse as parseCsvRecords } from 'csv-parse/sync';
import { getDocumentProxy } from 'unpdf';

import { classifyMerchantDescription, type ParsedSms } from '@/lib/sms-parser';
import { ledgerMoneySpec } from '@/lib/ledger-money';
import type { TransferEvidence } from '@/lib/transfer-reconciliation-types';

import { XlsxError, xlsxSheetRecords } from './xlsx-records';
import { readStructuredStatement, type StructuredStatementFormat } from './structured-statements';

const MAX_NORMALIZED_CHARS = 128_000;
const MAX_CSV_RECORD_CHARS = 8_192;
/**
 * How many leading CSV records may precede the header row (bank preambles).
 * ING Germany prints 14 lines and Mashreq 11 before the table.
 */
const MAX_CSV_PREAMBLE_RECORDS = 20;
/** The widest header row a CSV/XLSX statement may have. */
const MAX_STATEMENT_COLUMNS = 64;
/**
 * Month names a statement may print, per language, 1-based. English short and
 * long forms, then French, German, Spanish, Portuguese, Italian, Dutch,
 * Turkish, Indonesian and Arabic (Egyptian/Gulf and Levantine names).
 * Accented words are also listed without their accents, as exports often
 * strip them. Every spelling maps to exactly one month in every language
 * listed, so the table can be one flat lookup.
 */
const MONTH_WORDS: readonly (readonly string[])[] = [
  ['jan', 'january', 'janv', 'janvier', 'januar', 'jänner', 'jaenner', 'ene', 'enero', 'janeiro', 'gen', 'gennaio', 'januari', 'ocak', 'oca', 'يناير', 'كانون الثاني'],
  ['feb', 'february', 'févr', 'fevr', 'février', 'fevrier', 'februar', 'febrero', 'fev', 'fevereiro', 'febbraio', 'februari', 'şubat', 'subat', 'şub', 'sub', 'فبراير', 'شباط'],
  ['mar', 'march', 'mars', 'märz', 'maerz', 'marz', 'mär', 'mrz', 'marzo', 'março', 'marco', 'maart', 'mrt', 'mart', 'maret', 'مارس', 'آذار', 'اذار'],
  ['apr', 'april', 'avr', 'avril', 'abr', 'abril', 'aprile', 'nisan', 'nis', 'أبريل', 'ابريل', 'نيسان'],
  ['may', 'mai', 'mayo', 'maio', 'mag', 'maggio', 'mei', 'mayıs', 'mayis', 'مايو', 'أيار', 'ايار'],
  ['jun', 'june', 'juin', 'juni', 'junio', 'junho', 'giu', 'giugno', 'haziran', 'haz', 'يونيو', 'حزيران'],
  ['jul', 'july', 'juil', 'juillet', 'juli', 'julio', 'julho', 'lug', 'luglio', 'temmuz', 'tem', 'يوليو', 'تموز'],
  ['aug', 'august', 'août', 'aout', 'ago', 'agosto', 'augustus', 'ağustos', 'agustos', 'ağu', 'agu', 'agustus', 'agt', 'أغسطس', 'اغسطس', 'آب'],
  ['sep', 'sept', 'september', 'septembre', 'septiembre', 'setiembre', 'set', 'setembro', 'settembre', 'eylül', 'eylul', 'eyl', 'سبتمبر', 'أيلول', 'ايلول'],
  ['oct', 'october', 'octobre', 'okt', 'oktober', 'octubre', 'out', 'outubro', 'ott', 'ottobre', 'ekim', 'eki', 'أكتوبر', 'اكتوبر', 'تشرين الأول', 'تشرين الاول'],
  ['nov', 'november', 'novembre', 'noviembre', 'novembro', 'kasım', 'kasim', 'kas', 'نوفمبر', 'تشرين الثاني'],
  ['dec', 'december', 'déc', 'décembre', 'decembre', 'dez', 'dezember', 'dic', 'diciembre', 'dezembro', 'dicembre', 'aralık', 'aralik', 'ara', 'des', 'desember', 'ديسمبر', 'كانون الأول', 'كانون الاول'],
];
/** Fold a month word for lookup: case, accents and Turkish dotted/dotless i. */
function foldMonth(word: string): string {
  return word.normalize('NFD').replace(/\p{M}+/gu, '').replace(/İ/g, 'i').replace(/ı/g, 'i').toLowerCase();
}
const MONTH_INDEX = new Map<string, number>(
  MONTH_WORDS.flatMap((words, index) => words.map((word) => [foldMonth(word), index + 1] as const)),
);
/**
 * Regex alternation for every month word, longest first. Written against NFC
 * text; `i` without `u` folds Latin case, but not Turkish capital İ, so each
 * `i` also accepts İ.
 */
const escapeMonth = (word: string): string =>
  word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/i/g, '[iİ]');
const MONTH_NAME = `(?:${[...new Set(MONTH_WORDS.flat())]
  .sort((left, right) => right.length - left.length)
  .map(escapeMonth)
  .join('|')})`;
const ENGLISH_MONTH_NAME = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
// The named forms a statement date cell may take:
//   `03-Apr-2026`, `3 Apr 2026`, `3. März 2026`, `1er mars 2026`, `3 janv. 2026`
//   `3 de marzo de 2026`, `3 de março 2026`        (Spanish, Portuguese)
//   `Apr 3, 2026`, `April 3 2026`                   (English month-first)
const NAMED_DAY_FIRST = String.raw`\d{1,2}(?:er|\.)?[\s-]${MONTH_NAME}\.?[\s-]\d{2,4}`;
const NAMED_DE = String.raw`\d{1,2}\s+de\s+${MONTH_NAME}\.?\s+(?:de\s+)?\d{4}`;
const NAMED_MONTH_FIRST = String.raw`${ENGLISH_MONTH_NAME}\.?\s+\d{1,2},?\s+\d{4}`;
// ISO, numeric day/month with `/`, `-` or `.` (order inferred per file, see
// inferDateOrder), and the named forms above.
const DATE_TOKEN = `(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4}|${NAMED_DE}|${NAMED_DAY_FIRST}|${NAMED_MONTH_FIRST})`;
const DATE_LED_LINE = new RegExp(`^${DATE_TOKEN}\\s`, 'i');
// Statement money follows the ledger's ISO exponent (0, 2 or 3), not a Gulf
// hard-code. This permissive row lexer is narrowed again by amountMinor(),
// which validates grouping, currency and exact fractional precision.
const AMOUNT_TOKEN = String.raw`(?:(?:[A-Z]{3})\s*)?([\d,]+(?:\.\d{1,3})?)`;
const ROW_END_DIRECTION = new RegExp(
  `^(${DATE_TOKEN})\\s+(.{2,180}?)\\s+${AMOUNT_TOKEN}\\s+(DR|CR|DEBIT|CREDIT)$`,
  'i',
);
const ROW_MIDDLE_DIRECTION = new RegExp(
  `^(${DATE_TOKEN})\\s+(.{2,180}?)\\s+(DR|CR|DEBIT|CREDIT)\\s+${AMOUNT_TOKEN}$`,
  'i',
);
const ROW_DATE_PREFIX = new RegExp(`^(${DATE_TOKEN})\\s+(.+)$`, 'i');
const DOTTED_DATE = /^\d{1,2}\.\d{1,2}\.\d{2,4}$/;
// The column branch (parseColumnTail) insists on a decimal point: a bare
// integer at the end of a flattened PDF row is as likely a cheque or reference
// number as money. One decimal place is still money — real statements print
// `32.8` and `715.0`, and requiring two rejected every such row.
// What an empty debit or credit cell becomes once a PDF table is flattened.
const MONEY_PLACEHOLDER = /^(?:-|--|0|0\.0|0\.00|0\.000)$/;
// `\d,\d{1,2}` is a decimal-comma figure a decimal-point file refused: still
// money, so still counted rather than silently dropped.
const LOOKS_LIKE_MONEY_LINE = new RegExp(`\\d\\.\\d{1,3}(?:\\D|$)|\\d,\\d{1,2}(?!\\d)|\\b(?:DR|CR|DEBIT|CREDIT)\\b|\\b[A-Z]{3}\\s+\\d+`, 'i');
// Opening/closing balance, brought/carried forward and total lines carry money
// but are not transactions. A "Balance B/F 1,000.00 CR" would otherwise file
// as income and a "Total 40.00 0.00" as a second expense, and counting them as
// rejected would overstate what the user is missing. Anchored to the start of
// the description so a merchant merely containing the word is untouched.
// "Total" only counts when a figure, a colon or a totals word follows it;
// "TOTAL ENERGIES FUEL 120.00" is a merchant.
const SUMMARY_DESCRIPTION = /^(?:(?:opening|closing|new|previous|prev|beginning|ending|starting|start|end)\s+balance\b|(?:opening|closing)\s+bal\b|balance\s+(?:b\/?f|c\/?f|brought|carried|outstanding)\b|[bc]\/f(?=\s|$)|(?:brought|carried)\s+forward\b|الرصيد السابق|(?:sub)?totals?(?=\s*(?:$|:|(?:[A-Z]{3})?\s*[\d,]+(?:\.\d{1,3})?\b)|\s+(?:debits?|credits?|amounts?|for|of)\b)|الرصيد الافتتاحي|الرصيد الختامي|الإجمالي|المجموع|(?:saldo|solde)\s+(?:iniziale|finale|inicial|final|initial|précédent|precedent|anterior|anteriore|contabile)\b|(?:ancien|nouveau)\s+solde\b|(?:anfangs|end|schluss)saldo\b|(?:alter|neuer)\s+kontostand\b|(?:begin|eind)saldo\b|(?:açılış|acilis|kapanış|kapanis|devir)\s+bakiyes?i?\b|saldo\s+(?:awal|akhir)\b)/iu;
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] !== '#') return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
    const hex = entity[1]?.toLowerCase() === 'x';
    const codepoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(codepoint) && codepoint >= 0 && codepoint <= 0x10ffff
      ? String.fromCodePoint(codepoint)
      : whole;
  });
}

export function htmlToText(html: string): string {
  const withoutActiveContent = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|head|svg|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|header|footer|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(withoutActiveContent);
}

export function normalizeEmailContent(text?: string | null, html?: string | null): string {
  const source = text?.trim() ? text : html ? htmlToText(html) : '';
  return source
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_NORMALIZED_CHARS);
}

export async function parseRawEmail(
  raw: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | string,
): Promise<{
  text: string;
  pdfAttachments: Uint8Array[];
  csvAttachments: { bytes: Uint8Array; filename: string; mimeType: string }[];
}> {
  const email = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer' });
  const text = normalizeEmailContent(email.text, email.html);
  const bytes = (content: ArrayBuffer | Uint8Array | string): Uint8Array => {
    if (content instanceof Uint8Array) return content;
    if (typeof content !== 'string') return new Uint8Array(content);
    const binary = atob(content);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  };
  const attachments = email.attachments ?? [];
  const pdfAttachments = attachments
    .filter((attachment) =>
      attachment.mimeType === 'application/pdf' || /\.pdf$/i.test(attachment.filename ?? ''),
    )
    .map((attachment) => bytes(attachment.content));
  const csvAttachments = attachments
    .filter((attachment) => {
      const filename = attachment.filename ?? '';
      return (
        attachment.mimeType === 'text/csv' ||
        attachment.mimeType === 'application/csv' ||
        attachment.mimeType === 'text/tab-separated-values' ||
        /\.(?:csv|tsv)$/i.test(filename)
      );
    })
    .map((attachment) => ({
      bytes: bytes(attachment.content),
      filename: attachment.filename ?? '',
      mimeType: attachment.mimeType ?? 'application/octet-stream',
    }));
  return { text, pdfAttachments, csvAttachments };
}

type StatementCurrency = string;

type StatementParsedRow = ParsedSms & {
  transferEvidence?: TransferEvidence;
  /** A card statement summary's printed credit limit, in minor units. */
  creditLimitFils?: number;
};

export interface StatementCsvResult {
  rows: StatementParsedRow[];
  totalRows: number;
  rejectedRows: number;
  /**
   * Rejected rows whose only direction evidence was a bare sign on a card
   * statement that never says what its signs mean. Counted inside rejectedRows.
   */
  ambiguousCardSignRows: number;
  /**
   * Rejected rows whose numeric date reads as either day/month or month/day,
   * in a file that never settles which. Counted inside rejectedRows.
   */
  ambiguousDateRows: number;
}

/**
 * Column names a statement export may use, per role. English and Arabic came
 * from the launch fixtures; the other languages are the exact header text of
 * published exports (see docs/statement-import-formats-2026-10-11.md): German
 * (Sparkasse, ING, DKB, comdirect, Commerzbank, Postbank, Deutsche Bank, N26),
 * Dutch (ING, Rabobank, bunq), French (Société Générale, Crédit Agricole,
 * Boursorama, N26), Spanish/Catalan (BBVA, CaixaBank, N26), Portuguese
 * (Nubank, Inter), Italian (Intesa Sanpaolo, Fineco, BancoPosta), and the
 * standard Turkish and Indonesian statement words.
 *
 * Order matters only inside a role: the first alias a file has wins, so a
 * counterparty name is preferred over a booking-type column, and a
 * transaction date over a value date. Matching is exact after headerKey().
 */
const HEADER_ALIASES = {
  date: [
    'transaction date', 'trans date', 'tran date', 'txn date', 'date of transaction',
    'posting date', 'posted date', 'post date', 'booking date', 'completed date', 'started date',
    'value date', 'date',
    'تاريخ العملية', 'تاريخ القيد', 'التاريخ',
    // Booking/transaction dates in German, French, Spanish, Portuguese,
    // Italian, Dutch, Turkish and Indonesian …
    'belegdatum', 'buchungstag', 'buchungsdatum', 'buchung', 'datum',
    'date de l opération', 'date de l operation', 'date opération', 'date operation', 'date op',
    'fecha', 'fecha operación', 'fecha operacion',
    'data', 'data lançamento', 'data lancamento', 'data movimento', 'data operazione',
    'data contabile', 'data registrazione',
    'boekdatum', 'transactiedatum',
    'tarih', 'işlem tarihi', 'islem tarihi', 'hareket tarihi', 'tanggal', 'tanggal transaksi',
    // Polish, Swedish, Danish/Norwegian, Belgian, Irish and app exports.
    'data operacji', 'data księgowania', 'data ksiegowania', 'data transakcji',
    'bokföringsdag', 'bokforingsdag', 'bokföringsdatum', 'bokforingsdatum', 'transaktionsdag',
    'dato', 'bogføringsdato', 'bogforingsdato', 'bokføringsdato',
    'uitvoeringsdatum', 'date d exécution', 'date d execution', 'posted transactions date',
    'date completed utc', 'date completed', 'datum des abschlusses', 'data di completamento',
    'fecha de finalización', 'fecha de finalizacion', 'date de fin',
    // … and only then value dates, which name the date column only when a
    // file has nothing else. Dutch and Italian `Valuta` is a currency column
    // beside a `Datum`/`Data`, so it must never outrank one.
    'wertstellung', 'wert', 'valutadatum', 'date de valeur', 'date valeur', 'fecha valor', 'f valor',
    'data valor', 'data valuta', 'rentedatum', 'valuta',
  ],
  description: [
    'transaction description', 'transaction details', 'description', 'details', 'narration',
    'particulars', 'transaction remarks', 'merchant', 'payee', 'counter party', 'partner name',
    'name description', 'transactions', 'remarks', 'تفاصيل العملية', 'البيان', 'الوصف', 'التفاصيل',
    // German: the counterparty first, then free text, then the booking text.
    'auftraggeber empfänger', 'auftraggeber empfaenger', 'beguenstigter zahlungspflichtiger',
    'begünstigter zahlungspflichtiger', 'begünstigter auftraggeber', 'auftraggeber begünstigter',
    'zahlungsempfänger in', 'zahlungsempfaenger in', 'empfänger', 'beschreibung',
    'transaktionsbeschreibung', 'verwendungszweck', 'buchungstext',
    // Dutch
    'naam tegenpartij', 'name counterpty', 'naam omschrijving', 'naam', 'omschrijving', 'omschrijving 1',
    // French
    'libellé', 'libelle', 'bénéficiaire', 'beneficiaire', 'label',
    // Spanish, Catalan, Portuguese, Italian
    'movimiento', 'concepto', 'descripción', 'descripcion', 'beneficiario', 'moviment',
    'establiment concepte', 'descrição', 'descricao', 'histórico', 'historico',
    'dettagli', 'descrizione', 'descrizione operazioni',
    // Turkish, Indonesian
    'açıklama', 'aciklama', 'açiklama', 'keterangan', 'uraian',
    // Polish, Nordic, Belgian/French, Italian, Turkish and app exports.
    'opis operacji', 'opis transakcji', 'tytuł', 'tytul', 'nadawca odbiorca',
    'beskrivning', 'text', 'tekst', 'rubrik', 'mededeling', 'naam tegenpartij bevat', 'tegenpartij',
    'contrepartie', 'communication', 'libelle operation', 'libellé opération', 'libelle simplifie',
    'causale', 'işlem', 'islem', 'description1', 'counterparty name', 'counterparty', 'merchant name',
    // Barclays exports name the payee only in "Memo".
    'memo',
    // Last: a bare Name may be the account holder's, so any column above wins.
    'name', 'nom', 'note',
  ],
  debit: [
    'debit amount', 'amount debited', 'withdrawal amount', 'withdrawal amt', 'withdrawals', 'withdrawal',
    'paid out', 'funds out', 'outflow', 'debits', 'debit', 'dr', 'مبلغ مدين', 'المسحوبات', 'مدين', 'خصم',
    'soll', 'débit', 'débito', 'debito', 'cargo', 'cargos', 'addebiti', 'uscite', 'debet', 'borç', 'borc',
    'belastung', 'belastungen', 'zahlungsausgang',
  ],
  credit: [
    'credit amount', 'amount credited', 'deposit amount', 'deposit amt', 'deposits', 'deposit',
    'paid in', 'funds in', 'inflow', 'credits', 'credit', 'cr', 'مبلغ دائن', 'الإيداعات', 'دائن', 'إيداع',
    'haben', 'crédit', 'crédito', 'credito', 'abono', 'abonos', 'accrediti', 'entrate', 'kredit', 'alacak',
    'gutschrift', 'gutschriften', 'zahlungseingang',
  ],
  amount: [
    'transaction amount', 'amount', 'مبلغ العملية', 'المبلغ',
    'betrag', 'buchungsbetrag', 'umsatz', 'bedrag', 'transactiebedrag', 'montant',
    'montant de l opération', 'montant de l operation', 'importe', 'import', 'cantidad', 'valor',
    'importo', 'tutar', 'meblağ', 'meblag', 'jumlah',
    // Polish, Swedish, Danish/Norwegian and Turkish.
    'kwota', 'belopp', 'beløb', 'belob', 'beløp', 'işlem tutarı', 'işlem tutari', 'islem tutari',
  ],
  // NatWest's money column, and the money columns of card and wallet apps.
  // Only an amount when no column above is one, so a file with both `Value`
  // (or `Billing Amount`, `Net Amount`) and `Amount` keeps reading `Amount`.
  // A NET or TOTAL figure already includes the fee printed beside it.
  amountFallback: ['value', 'net amount', 'amount total', 'net', 'netto', 'payment amount', 'billing amount', 'money in out'],
  // A column whose cells ARE a direction (DR/CR, Af/Bij, Debit/Credit).
  direction: ['debit credit', 'dr cr', 'cr dr', 'direction', 'af bij', 'نوع القيد',
    'credit debet', 'credit debit indicator', 'credit debit', 'debit credit flag', 'credit debit flag', 'dr cr flag',
    'soll haben', 'borç alacak', 'borc alacak'],
  // A transaction-type column: sometimes a direction (DR, Eingang), more
  // often a channel (POS, ATM, Income). Used as the direction column only
  // when the file has no column of the kind above.
  transactionType: [
    'transaction type', 'type', 'نوع العملية', 'النوع',
    'umsatztyp', 'transaktionstyp', 'type de transaction', 'tipo de transacción', 'tipo de transaccion',
  ],
  status: [
    'transaction status', 'status', 'state', 'stato', 'stato operazione', 'contabilizzazione', 'estat',
  ],
  currency: [
    'currency code', 'transaction currency', 'currency', 'ccy', 'curr', 'العملة',
    'währung', 'waehrung', 'buchungswährung', 'buchungswaehrung', 'munt', 'devise', 'divisa',
    'moeda', 'para birimi', 'mata uang',
  ],
  sourceAccount: [
    'source account number', 'source account no', 'from account number', 'from account no',
    'debit account number', 'debit account no', 'account number', 'account no', 'account no.',
    'a/c number', 'masked account number', 'رقم الحساب', 'الحساب المصدر',
    // The statement's OWN account in German and Dutch exports. The
    // counterparty's account (Kontonummer/IBAN, Tegenrekening) is not one.
    'auftragskonto', 'iban kontoinhaber', 'iban auftraggeberkonto', 'rekening', 'iban bban',
  ],
  sourceCard: [
    'source card number', 'source card no', 'credit card number', 'card number', 'card no',
    'card no.', 'masked card number', 'رقم البطاقة',
  ],
  reference: [
    'transaction reference', 'transaction ref', 'transaction id', 'txn reference', 'txn ref',
    'reference number', 'reference no', 'reference', 'ref no', 'trace number', 'trace id',
    'رقم المرجع', 'مرجع العملية', 'رقم العملية',
  ],
} as const;

type HeaderRole = keyof typeof HEADER_ALIASES;

/**
 * Column names that can only be the statement's OWN account (Sparkasse
 * Auftragskonto, Commerzbank IBAN Kontoinhaber, ING/bunq Rekening, Rabobank
 * IBAN/BBAN). An English `Account Number` column is not one: card exports
 * print the card account there too.
 */
const OWN_ACCOUNT_HEADERS = new Set(['auftragskonto', 'iban kontoinhaber', 'iban auftraggeberkonto', 'rekening', 'iban bban']);

/** Any transaction status word, posted or not. */
const STATUS_WORD = /^(?:posted|completed|cleared|settled|booked|pending|reverted|declined|failed|cancelled|canceled|authori[sz]ed)$/;

/** Status cells that establish a completed posting (Gebucht, Contabilizzato, Liquidat …). */
const POSTED_STATUS = /^(?:posted|completed|cleared|settled|booked|gebucht|geboekt|contabilizzato|liquidat|liquidado|comptabilisé|comptabilise|udført|udfort|utført|utfort|utförd|utford|genomförd|genomford|bokförd|bokford|zaksięgowana|zaksiegowana|zrealizowana|gerçekleşti|gerceklesti|tamamlandı|tamamlandi|abgeschlossen|completato|completada|terminé|termine)$/u;

/** Header names that only a card export carries. */
const CARD_EXPORT_HEADERS = ['credit card number', 'card member', 'card holder name', 'cardholder name',
  // The cardholder column of continental card exports (Amex DE/FR/ES/IT/NL).
  'karteninhaber', 'karteninhaber in', 'titulaire de la carte', 'titular de la tarjeta', 'titolare della carta', 'kaarthouder'];

/** A running-balance column, in any of the supported languages. */
const BALANCE_HEADER = /(?:^|\s)(?:balance|bal|saldo|solde|kontostand|bakiye|disponible)(?:\s|$)|الرصيد/u;
/** A fee or tax column of its own (normalized header text). */
const FEE_HEADER = /^(?:(?:total\s+)?fees?(?:\s+amount)?|tax(?:es)?|withholding\s+tax|geb(?:u|ue|ü)hr(?:en)?|steuern?|commissions?|frais|comisi[oó]n(?:es)?|commissione?|provisie|kosten)$/u;

function normalizedHeader(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/^\uFEFF/, '')
    .trim()
    // Turkish capital dotted I lowercases to i + a combining dot, which the
    // letter filter below would split ("İŞLEM TARİHİ" → "i şlem tari hi").
    .replace(/İ/g, 'i')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const ALIAS_KEYS = new Set(
  Object.values(HEADER_ALIASES).flatMap((aliases) => aliases.map((alias) => normalizedHeader(alias))),
);

/** The ledger currencies a money symbol printed in a column name can stand for. */
const HEADER_SYMBOL_CURRENCIES: Record<string, readonly string[]> = {
  '€': ['EUR'], '£': ['GBP'], '₹': ['INR'], '₺': ['TRY'], '₱': ['PHP'], '₩': ['KRW'], '₦': ['NGN'],
  '₪': ['ILS'], '₫': ['VND'], '¥': ['JPY', 'CNY'], '￥': ['JPY', 'CNY'],
  '$': ['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'MXN', 'ARS', 'CLP', 'COP', 'BRL', 'TWD'],
};

/**
 * A header cell as matched against HEADER_ALIASES, plus the currencies the
 * cell can name, if it names one. `Amount (GBP)`, `Betrag (€)`, `Amount in
 * AED`, `Paid in (£)`, `Withdrawal Amount (INR )`, `Montant(EUROS)` and
 * `Débit euros` are the plain role with a stated currency; it is kept so a
 * money column naming another currency than the ledger is refused, never
 * read as the ledger's. A code suffix is only removed when what remains is a
 * known column name, so `Account Top` or a reference column is left alone.
 * A money symbol this table cannot place names some currency all the same,
 * and matches no ledger. CamelCase names (`TransactionDate`) are split first.
 */
function headerKey(value: string): { key: string; currencies: readonly string[] | null } {
  const symbols = [...value.matchAll(/\p{Sc}/gu)].map((match) => match[0]);
  const symbolCurrencies = symbols.length === 0
    ? null
    : symbols.every((symbol) => symbol === symbols[0]) ? HEADER_SYMBOL_CURRENCIES[symbols[0]] ?? [] : [];
  const key = normalizedHeader(value.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2'));
  if (ALIAS_KEYS.has(key)) return { key, currencies: symbolCurrencies };
  for (const pattern of [/^(.+) ([a-z]{3}|euros?)$/, /^(.+) in ([a-z]{3}|euros?)$/]) {
    const suffixed = pattern.exec(key);
    if (!suffixed || !ALIAS_KEYS.has(suffixed[1])) continue;
    const code = /^euros?$/.test(suffixed[2]) ? 'EUR' : suffixed[2].toUpperCase();
    if (!ledgerMoneySpec(code)) continue;
    const agrees = symbolCurrencies === null || symbolCurrencies.includes(code);
    return { key: suffixed[1], currencies: agrees ? [code] : [] };
  }
  return { key, currencies: symbolCurrencies };
}

function headerIndex(headers: string[], aliases: readonly string[]): number {
  for (const alias of aliases) {
    const index = headers.indexOf(normalizedHeader(alias));
    if (index >= 0) return index;
  }
  return -1;
}

/** Every column whose name is one of the role's aliases. */
function headerIndices(headers: string[], role: HeaderRole): number[] {
  const aliases = new Set(HEADER_ALIASES[role].map((alias) => normalizedHeader(alias)));
  return headers.flatMap((header, index) => aliases.has(header) ? [index] : []);
}

function delimiterCount(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '"') {
      if (quoted && line[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && line[index] === delimiter) {
      count += 1;
    }
  }
  return count;
}

/**
 * Pick the delimiter from the leading lines rather than the first one alone:
 * bank exports often open with a preamble ("Account statement",
 * "Account: XXXX1234") that has no delimiter at all. The delimiter that
 * appears on the most lines wins — the table's own separator recurs on every
 * row, while a stray `;` inside one description or one preamble line does
 * not — and the widest line breaks a tie.
 */
function csvDelimiter(text: string): string | null {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/, MAX_CSV_PREAMBLE_RECORDS + 1);
  // Pipe last: on a tie the long-established separators win.
  const candidates = [',', '\t', ';', '|']
    .map((delimiter) => {
      const counts = lines.map((line) => delimiterCount(line, delimiter));
      return {
        delimiter,
        lines: counts.filter((count) => count > 0).length,
        count: Math.max(...counts),
      };
    })
    .sort((left, right) => right.lines - left.lines || right.count - left.count);
  return candidates[0].count > 0 ? candidates[0].delimiter : null;
}

function normalizeDigits(value: string): string {
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  return value
    .replace(/[\u0660-\u0669]/g, (digit) => String(arabic.indexOf(digit)))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(persian.indexOf(digit)))
    .replace(/\u066b/g, '.')
    .replace(/\u066c/g, ',');
}

function maskedTail(value: string): string | null {
  const normalized = normalizeDigits(value).normalize('NFKC').trim();
  if (!normalized || normalized.length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(normalized)) return null;
  const compact = normalized.replace(/[\s._/-]+/g, '');
  const tail = compact.match(/(\d{4})$/)?.[1] ?? null;
  if (!tail) return null;
  const digitCount = compact.replace(/\D/g, '').length;
  return digitCount >= 4 && digitCount <= 34 ? tail : null;
}

type StatementInstrument = NonNullable<ParsedSms['card']>;

/**
 * The document's header: the lines above its first date-led row. Labels
 * added after launch (Arabic card/account labels, IBANs) are read only here,
 * because transaction narrations print them too ("شراء رقم البطاقة 4321").
 */
function documentHeader(text: string): string {
  const header: string[] = [];
  for (const line of text.split(/\n+/)) {
    if (DATE_LED_LINE.test(line.replace(/\s+/g, ' ').trim())) break;
    header.push(line);
  }
  return header.join('\n');
}

/**
 * Statement-wide identity from explicitly labelled document metadata only.
 * `iban: false` leaves IBAN-shaped values out — the multi-account check
 * must not mistake a card statement's printed IBAN for a second account.
 */
function statementInstrument(text: string, options: { iban?: boolean } = {}): StatementInstrument | null {
  const normalized = normalizeDigits(text).normalize('NFKC');
  const header = documentHeader(normalized);
  const labelled = (
    kind: StatementInstrument['kind'],
    pattern: RegExp,
    source = normalized,
  ): StatementInstrument | null => {
    const match = pattern.exec(source);
    if (!match?.[1]) return null;
    // `1234-XXXX`: the visible digits are the number's FIRST four and the
    // tail is masked. Its last four are unknown, so nothing is attributed.
    if (/^[\s-]*[*xX•]/.test(source.slice(match.index + match[0].length))) return null;
    const last4 = maskedTail(match[1]);
    return last4 ? { last4, kind } : null;
  };
  return labelled(
    'credit',
    /\bcredit\s+card\s+(?:number|no\.?|ending(?:\s+(?:in|with))?)\s*[:#-]?\s*([*xX•\s-]*\d(?:[*xX•\s-]*\d){3,23})/i,
  ) ?? labelled(
    // Bilingual PDFs often interleave the translated label between the
    // English label and the value: `Credit Card Number <Arabic> 4111…`.
    // Permit only a short run containing no Latin letters/digits before the
    // explicitly card-labelled number, so a later unrelated amount cannot be
    // captured as card identity.
    'credit',
    /\bcredit\s+card\s+(?:number|no\.?)\b[^A-Za-z0-9\r\n]{0,96}([*xX•\s-]*\d(?:[*xX•\s-]*\d){3,23})/iu,
  ) ?? labelled(
    // Bilingual PDFs can expose the English label in visual/right-to-left
    // extraction order as "Number Card Credit" even though the page renders
    // "Credit Card Number". The following value is still explicitly labelled
    // card metadata, so retaining only its terminal four digits is safe.
    'credit',
    /\bnumber\s+card\s+credit\b\s*[:#-]?\s*([*xX•\s-]*\d(?:[*xX•\s-]*\d){3,23})/i,
  ) ?? labelled(
    'unknown',
    /\bcard\s+(?:number|no\.?|ending(?:\s+(?:in|with))?)\s*[:#-]?\s*([*xX•\s-]*\d(?:[*xX•\s-]*\d){3,23})/i,
  ) ?? labelled(
    'unknown',
    /رقم\s+البطاقة\s*[:#-]?\s*([*xX•\s-]*\d(?:[*xX•\s-]*\d){3,23})/u,
    header,
  ) ?? labelled(
    'account',
    /\b(?:account|a\/c)\s+(?:number|no\.?|ending(?:\s+(?:in|with))?)\s*[:#-]?\s*([*xX•\s-]*\d(?:[*xX•\s-]*\d){3,23})/i,
  ) ?? labelled(
    'account',
    /رقم\s+الحساب\s*[:#-]?\s*([*xX•\s-]*\d(?:[*xX•\s-]*\d){3,23})/u,
    header,
  ) ?? (options.iban === false ? null : labelled(
    // An IBAN carries the domestic account number at its end (AE, SA and GB
    // all do), so its last four digits are the account's. Only an explicitly
    // labelled IBAN-shaped value counts, after every other account label.
    'account',
    new RegExp(String.raw`(?:\b(?:iban|account\s+(?:number|no\.?)|a\/c\s+(?:number|no\.?))|رقم\s+الآيبان|الآيبان|الايبان)\s*[:#-]?\s*(${IBAN_VALUE})`, 'iu'),
    header,
  )) ?? (options.iban === false ? null : labelled(
    // A masked IBAN (`AE..1234`, `DE89 **** **** **** **30 00`): the country
    // code, any check digits, a mask, then the visible end of the number.
    'account',
    /\biban\b\s*[:#-]?\s*([A-Z]{2}\d{0,2}[\s.*xX•-]*[.*xX•][\s.*xX•\d-]*\d)(?![\dA-Z])/i,
    header,
  ));
}

/**
 * An IBAN as statements print it: two letters, two check digits, then the
 * BBAN in optional groups of up to four (`SA03 8000 0000 6080 1016 7519`,
 * `AE070331234567890123456`). Its last four digits are the account's tail.
 */
// Ends on a digit so a following short word (`… 7519 SAR`) is never absorbed.
const IBAN_VALUE = String.raw`[A-Z]{2}\d{2}(?:[ \t]?[A-Z0-9]{1,4}){2,8}?\d(?![A-Z0-9])`;

/**
 * The issuing bank, from the statement's own letterhead only: the lines above
 * the first transaction row. Row descriptions name banks constantly (`ADCB ATM
 * MARINA`, `BARCLAYCARD PAYMENT`) and must never name the statement's bank.
 * The earliest bank named wins; on a tie the order below decides, so Liv (an
 * Emirates NBD brand) and ADIB resolve before their look-alikes. Names that
 * are also ordinary words or initials (Chase, Citi, FAB, SAB, CBD) count only
 * in bank-shaped forms ("Chase Bank", "chase.com"). Names follow
 * the app's market packs where those list the bank.
 */
const STATEMENT_BANKS: readonly (readonly [RegExp, string])[] = [
  [/\bliv\b/i, 'Liv'],
  [/\bemirates\s*nbd\b|\benbd\b/i, 'Emirates NBD'],
  [/\badcb\b|abu\s+dhabi\s+commercial\s+bank/i, 'ADCB'],
  [/first\s+abu\s+dhabi\s+bank|\bbankfab\b|\bfab\s+bank\b/i, 'FAB'],
  [/\bmashreq\b/i, 'Mashreq'],
  [/\brak\s*bank\b|\brakbank\b/i, 'RAKBANK'],
  [/\badib\b|abu\s+dhabi\s+islamic\s+bank/i, 'ADIB'],
  [/\bdib\b|dubai\s+islamic\s+bank/i, 'DIB'],
  [/commercial\s+bank\s+of\s+dubai|\bcbd\s+bank\b/i, 'CBD'],
  [/\bwio\b/i, 'Wio'],
  [/al\s*rajhi|مصرف\s+الراجحي/iu, 'Al Rajhi'],
  [/\bsnb\b|saudi\s+national\s+bank|\balahli\b|\bal\s+ahli\b|البنك\s+الأهلي/iu, 'SNB AlAhli'],
  [/\briyad\s*bank\b|بنك\s+الرياض/iu, 'Riyad Bank'],
  [/\balinma\b|مصرف\s+الإنماء/iu, 'Alinma'],
  [/saudi\s+awwal\s+bank|\bsab\s+bank\b|\bsab\.com\b/i, 'SAB'],
  [/\bjp\s*morgan\s+chase\b|\bchase\s+bank\b|\bchase\.com\b/i, 'Chase'],
  [/\bbank\s+of\s+america\b|\bbofa\b/i, 'Bank of America'],
  [/\bcitibank\b|\bciti\s+(?:bank|cards?)\b|\bciti\.com\b/i, 'Citi'],
  [/\bamerican\s+express\b|\bamex\b/i, 'American Express'],
  [/\bcapital\s+one\b/i, 'Capital One'],
  [/\bbarclay(?:s|card)\b/i, 'Barclays'],
  [/\bhsbc\b/i, 'HSBC'],
  [/\blloyds\b/i, 'Lloyds'],
  [/\bmonzo\b/i, 'Monzo'],
  [/\brevolut\b/i, 'Revolut'],
  [/\bnationwide\b/i, 'Nationwide'],
];

function statementBankHint(text: string): string | undefined {
  const header: string[] = [];
  for (const line of text.split(/\n+/).slice(0, 60)) {
    if (DATE_LED_LINE.test(line.trim())) break;
    header.push(line);
  }
  const letterhead = header.join('\n');
  // The bank named FIRST in the letterhead, not the first in this list: an
  // address or a payee further down must not outrank the issuer's own name.
  let best: { index: number; name: string } | null = null;
  for (const [pattern, name] of STATEMENT_BANKS) {
    const index = letterhead.search(pattern);
    if (index >= 0 && (best === null || index < best.index)) best = { index, name };
  }
  if (best) return best.name;
  // The launch rule, kept for the issuer it was written for: HSBC prints its
  // name in page footers below the table as well as above it.
  if (/\bHSBC\b/i.test(text)) return 'HSBC';
  return undefined;
}

function safeStatementReference(value: string): string | null {
  const normalized = normalizeDigits(value).normalize('NFKC').trim().toUpperCase();
  if (!normalized || normalized.length > 96 || /[\u0000-\u001f\u007f-\u009f]/.test(normalized)) return null;
  const unlabelled = normalized.replace(
    /^(?:REF(?:ERENCE)?|TRANSACTION|TXN|TRACE)(?:\s+(?:ID|NO\.?|NUMBER|REF))?\s*[:#-]?\s*/i,
    '',
  );
  const compact = unlabelled.replace(/[\s/]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!/^[A-Z0-9][A-Z0-9-]{5,39}$/.test(compact) || !/\d/.test(compact)) return null;
  if (/^\d{12,}$/.test(compact) || /^[A-Z]{2}\d{2}[A-Z0-9]{10,}$/.test(compact.replace(/-/g, '')) ||
      /^(?:19|20)\d{2}-?(?:0[1-9]|1[0-2])-?(?:0[1-9]|[12]\d|3[01])$/.test(compact)) return null;
  return compact;
}

function referenceFromDescription(description: string): string | null {
  const match = normalizeDigits(description).match(
    /\b(?:ref(?:erence)?|transaction\s+(?:id|ref(?:erence)?)|txn\s+(?:id|ref)|trace\s+(?:id|no\.?|number))\s*[:#-]?\s*([A-Z0-9][A-Z0-9\s/-]{5,48})/i,
  );
  return match ? safeStatementReference(match[1]) : null;
}

function statementCounterparty(
  description: string,
  type: 'expense' | 'income',
): TransferEvidence['counterparty'] {
  const text = normalizeDigits(description).normalize('NFKC');
  const direction = type === 'expense'
    ? String.raw`(?:to|beneficiary|destination|payee)`
    : String.raw`(?:from|sender|originator|ordering\s+party)`;
  const match = new RegExp(
    String.raw`\b${direction}\b[\s:,-]{0,12}(?:(account|acct|a\/c|iban|card)\b[\s:#-]*)?([Xx*•·\d][Xx*•·\d .\/-]{2,48}\d{4})(?!\d)`,
    'i',
  ).exec(text);
  if (!match) return undefined;
  const last4 = maskedTail(match[2]);
  if (!last4) return undefined;
  return { last4, kind: (match[1] ?? '').toLowerCase() === 'card' ? 'unknown' : 'account' };
}

const STATEMENT_SALARY = /\bsalar(?:y|ies)\b|\bpayroll\b|\bwps\b|\bwages?\b|راتب|رواتب/iu;

function statementTransferMeaning(
  description: string,
  type: 'expense' | 'income',
  currency: StatementCurrency,
  source: ParsedSms['card'],
  explicitReference?: string | null,
): Pick<StatementParsedRow, 'merchant' | 'transferHint'> & { transferEvidence?: TransferEvidence } | null {
  const text = normalizeDigits(description).normalize('NFKC');
  const isTransfer = /\b(?:transfer|remittance|wire|telegraphic\s+transfer|funds?\s+transfer|instant\s+transfer|internal\s+transfer)\b/i.test(text) ||
    /(?:تحويل|حوالة)/u.test(text);
  // A fee/commission about a transfer is its own expense, not the movement.
  // Refuse that semantic promotion rather than hiding a real bank charge from spending.
  const transferCharge = /\b(?:transfer|remittance|wire)\b[\s\S]{0,36}\b(?:fee|fees|charge|commission|vat)\b|\b(?:fee|fees|charge|commission|vat)\b[\s\S]{0,36}\b(?:transfer|remittance|wire)\b/i.test(text) ||
    /(?:رسوم|عمولة)[^\n]{0,36}(?:تحويل|حوالة)|(?:تحويل|حوالة)[^\n]{0,36}(?:رسوم|عمولة)/u.test(text);
  if (!isTransfer || transferCharge) return null;
  // Payroll reaches the account over a transfer rail and banks say so
  // ("SALARY TRANSFER ACME", "WPS SALARY TRANSFER", "INWARD TRANSFER SALARY
  // SEP"). It is still the user's income, never a move between their own
  // accounts, so the salary classifier decides it instead.
  // A move between the user's own accounts stays one, even from a "salary
  // account": that income was already counted where it first arrived.
  const explicitOwn = /\b(?:own|self|internal)\s+(?:account\s+)?transfer\b|\bbetween\s+(?:my|own)\s+accounts\b/i.test(text) ||
    /تحويل\s+(?:بين\s+)?حساب(?:ات)?(?:ي|ك)/u.test(text);
  if (type === 'income' && !explicitOwn && STATEMENT_SALARY.test(text) &&
      !/\bsalary\s+(?:a\/c|acc(?:oun)?t)\b/i.test(text)) return null;
  const reference = explicitReference ?? referenceFromDescription(description);
  const counterparty = statementCounterparty(description, type);
  return {
    merchant: explicitOwn ? 'Own account transfer' : type === 'expense' ? 'Outgoing transfer' : 'Incoming transfer',
    transferHint: true,
    transferEvidence: {
      version: 1,
      currency,
      attribution: source ? 'source' : 'fallback',
      statement: true,
      ...(reference ? { reference } : {}),
      ...(counterparty ? { counterparty } : {}),
      ...(explicitOwn ? { explicitOwn: true } : {}),
    },
  };
}

/**
 * A credit-card settlement on a statement, read the way the SMS parser reads
 * the same event: a transfer onto the card, never spending and never income.
 *
 *   account side  `CREDIT CARD PAYMENT 4111XXXXXXXX4821 1,500.00 DR` — money
 *                 leaving the current account towards a card. Only the explicit
 *                 "credit card"/"CC" wording counts: "CARD PAYMENT TO TESCO" is
 *                 how many banks describe an ordinary POS purchase.
 *   card side     `PAYMENT RECEIVED - THANK YOU 1,500.00 CR` — a payment credit
 *                 on a statement already proven to be a card's.
 *
 * With card digits the row becomes the same `cardPayment` leg the SMS parser
 * emits, so import-plan files it into the card and pairs it with its other
 * leg. Without them it stays an ordinary row flagged as a transfer.
 */
const CARD_SETTLEMENT_EXCLUSION = /\b(?:fees?|charges?|interest|vat|commission|late|annual|penalty|cash\s*back|refund|reversal|return)\b|رسوم|فائدة|استرداد|عمولة/iu;
// The account-side wording also covers issuer names a current account prints
// for the card bill it pays: "CHASE CREDIT CRD AUTOPAY", "BARCLAYCARD
// PAYMENT", "AMEX EPAYMENT", and the Saudi SADAD biller "SADAD CREDIT CARD".
const ACCOUNT_SIDE_CARD_SETTLEMENT = new RegExp([
  String.raw`\b(?:credit\s+card|cc)\s+(?:bill\s+)?(?:payment|repayment|settlement)\b`,
  String.raw`\bpayment\s+(?:to|towards)\s+(?:your\s+|the\s+)?credit\s+card\b`,
  String.raw`\bcredit\s+(?:crd|card)\b[^\n]{0,24}\b(?:auto\s*pay|e?payment|epay|pymt)\b`,
  String.raw`\b(?:barclaycard|amex|american\s+express|capital\s+one|discover\s+card|citi\s*cards?)\b[^\n]{0,24}\b(?:auto\s*pay|e?payment|pymt|bill\s+pay(?:ment)?)\b`,
  String.raw`\bsadad\s+(?:credit\s+card|cc)\b`,
  // A current-account debit named only for a card issuer is that card's bill.
  // Only the bare name, a direct-debit marker or a reference may follow:
  // "AMEX TRAVEL" is a merchant, not the card's bill.
  String.raw`^\s*(?:barclaycard|american\s+express|amex)(?:\s+(?:dd|d\/d|direct\s+debit|[a-z]{0,3}\d[\w*#./-]*))?\s*$`,
  String.raw`سداد\s+(?:ال)?بطاقة\s+(?:ال)?ائتمان`,
].join('|'), 'iu');
// Card-side: the payment credits a card statement prints. Every channel the
// money can arrive through is still a settlement on a PROVEN card statement:
// online/mobile/internet banking, a CDM cash deposit, a CC payment, an issuer
// mobile payment ("CAPITAL ONE MOBILE PYMT") or an autopay.
const CARD_SIDE_SETTLEMENT = new RegExp([
  String.raw`\b(?:payment|pymt)\s+(?:received|recd|thank)`,
  String.raw`\bthank\s+you\b`,
  String.raw`^\s*(?:payment|pymt)\b`,
  String.raw`\b(?:auto\s*pay(?:ment)?|direct\s+debit)\b`,
  String.raw`\b(?:online|mobile|internet|net|ib|digital)\s+(?:banking\s+)?(?:payment|pymt|transfer)\b`,
  String.raw`\b(?:credit\s+card|cc)\s+(?:bill\s+)?(?:payment|pymt|repayment)\b`,
  String.raw`\bcash\s+deposit\b|\bcdm\b`,
  String.raw`\bmobile\s+pymt\b`,
  String.raw`سداد|دفعة\s+مستلمة`,
].join('|'), 'iu');
// Payment companies are merchants: their credits are refunds, not settlements.
const PAYMENT_COMPANY = /\b(?:paypal|amazon\s+payments?|apple\s+pay|google\s+pay|samsung\s+pay|stripe|checkout\.com|payfort|tabby|tamara)\b/i;

type StatementSettlement = Pick<StatementParsedRow,
  'kind' | 'type' | 'merchant' | 'card' | 'transferHint' | 'categoryGuess' | 'categoryDeliberate'
> & { cardPaymentSide?: 'debit' | 'receipt' };

/** HSBC's terse repayment description names the card, not a merchant.
 * Compare full labelled header digits ephemerally; last-four equality alone
 * could mistake a different card for this one. Never persist this number.
 */
function hsbcStatementRepaymentCard(text: string): string | undefined {
  const header = normalizeDigits(text).normalize('NFKC').split(/\n/).slice(0, 80).join('\n');
  if (!/\bHSBC\b/i.test(header)) return undefined;
  const cards = new Set([...header.matchAll(
    /\b(?:credit\s+card\s+(?:number|no\.?)|number\s+card\s+credit)\b[^A-Za-z0-9]{0,96}((?:\d[ \t-]*){15}\d)(?!\d)/gi,
  )].map((match) => match[1].replace(/[ \t-]/g, '')));
  return cards.size === 1 ? [...cards][0] : undefined;
}


/** An exact source-labelled HSBC card match, shared by money and meaning guards. */
function isHsbcStatementRepayment(
  description: string,
  source: ParsedSms['card'],
  headerCard: string | undefined,
): boolean {
  // The full, explicitly credit-card-labelled HSBC header is stronger than an
  // older generic-card reader's unknown kind (for example at a line break).
  // Never override an explicitly account/debit-labelled source.
  if (!headerCard || (source?.kind !== 'credit' && source?.kind !== 'unknown') ||
      source.last4 !== headerCard.slice(-4)) return false;
  const match = /^\s*TO\s+((?:\d[ \t-]*){15}\d)\s*$/i.exec(normalizeDigits(description).normalize('NFKC'));
  return match?.[1].replace(/[ \t-]/g, '') === headerCard;
}

function statementCardSettlement(
  description: string,
  type: 'expense' | 'income',
  cardEvidence: boolean,
  source: ParsedSms['card'],
  hsbcRepaymentCard?: string,
  /**
   * The row's own Type cell says Payment (Chase-style card exports: Sale,
   * Payment, Return). On a card export that IS the settlement, whatever the
   * description says ("ACH PMT 0910", "BILL PAY").
   */
  typeSaysPayment = false,
): StatementSettlement | null {
  const text = normalizeDigits(description).normalize('NFKC');
  if (CARD_SETTLEMENT_EXCLUSION.test(text)) return null;
  const transfer = { transferHint: true, categoryGuess: 'other' as const, categoryDeliberate: true };
  // The account side stays an outflow of the paying account. Turning it into
  // the card's receipt leg lost the account's debit, and with statement clocks
  // at midday a one-day posting lag never paired it with the card statement's
  // own receipt row, so one payment credited the card twice.
  if (!cardEvidence && type === 'expense' && ACCOUNT_SIDE_CARD_SETTLEMENT.test(text)) {
    return { kind: 'transaction', type, merchant: 'Card payment', card: source, ...transfer };
  }
  const toThisHsbcCard = isHsbcStatementRepayment(text, source, hsbcRepaymentCard);
  if (cardEvidence && type === 'income' &&
      (toThisHsbcCard || typeSaysPayment || CARD_SIDE_SETTLEMENT.test(text)) && !PAYMENT_COMPANY.test(text)) {
    // A card statement's own number is a credit card's: debit cards receive
    // no payments. An account-labelled number is not a card at all.
    const last4 = source && (source.kind === 'credit' || source.kind === 'unknown') ? source.last4 : null;
    return last4
      ? {
          kind: 'cardPayment', type: 'expense', merchant: `Card •${last4} payment`,
          card: { last4, kind: 'credit' }, cardPaymentSide: 'receipt', ...transfer,
        }
      : { kind: 'transaction', type, merchant: 'Card payment', card: source, ...transfer };
  }
  return null;
}

/**
 * The acquirer noise a card network appends to a statement descriptor, peeled
 * the way the SMS parser's own descriptor cleaner peels it so the same charge
 * reads alike from both sources: `NOON.COM DUBAI ARE` → `NOON`,
 * `PANDA RIYADH SAU` → `PANDA`, `CARREFOUR MOE DUBAI ARE` → `CARREFOUR MOE`.
 *
 * Only TRAILING country codes, Gulf city names and a host suffix are removed,
 * one at a time, and a peel is discarded unless three letters of name survive
 * it — a shop really can be called "Dubai Something", and a bare "SA" or
 * "DUBAI" is left as it was. This is a title, never an identity: transfer,
 * settlement and category decisions still read the full description.
 */
const DESCRIPTOR_COUNTRY_TAIL = /[\s,-]+(?:AE|ARE|UAE|SA|SAU|KSA|US|USA|GB|GBR|UK|IRL|NLD|SWE|DEU|FRA)$/i;
const DESCRIPTOR_CITY_TAIL = /[\s,-]+(?:DXB|DUBAI|ABU\s?DHABI|AUH|SHARJAH|AJMAN|FUJAIRAH|AL\s+AIN|RAS\s+AL\s+KHAIMAH|UMM\s+AL\s+QUWAIN|RIYADH|JEDDAH|DAMMAM|AL\s+KHOBAR|KHOBAR|MAKKAH|MECCA|MADINAH|MEDINA|DHAHRAN|TABUK|ABHA|BURAIDAH)$/i;
const DESCRIPTOR_HOST_TAIL = /\.(?:com|ae|sa|net|org|io|co)$/i;

export function cleanStatementDescriptor(description: string): string {
  let out = description.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const letters = (value: string) => (value.match(/\p{L}/gu) ?? []).length;
  for (let guard = 0; guard < 6; guard += 1) {
    const before = out;
    for (const tail of [DESCRIPTOR_COUNTRY_TAIL, DESCRIPTOR_CITY_TAIL, DESCRIPTOR_HOST_TAIL]) {
      const peeled = out.replace(tail, '').trim();
      if (peeled !== out && letters(peeled) >= 3) out = peeled;
    }
    if (out === before) break;
  }
  return out.replace(/^www\./i, '').trim() || description;
}

/**
 * A card row's foreign original at the end of its description:
 * `SPOTIFY STOCKHOLM USD 20.00` charged as 73.60 in the ledger currency.
 * The ledger-currency figure stays the row amount; the original travels as
 * the relay's bank-stated FX fields. Null unless the code is a real ISO
 * currency other than the ledger's and the figure is exact in its exponent.
 */
function foreignOriginalTail(
  description: string,
  ledgerCurrency: StatementCurrency,
): { merchant: string; code: string; minorUnits: number; exponent: 0 | 2 | 3 } | null {
  const match = /^(.{2,}?)\s+([A-Z]{3})\s*([\d,]+(?:\.\d{1,3})?)$/.exec(description.trim());
  if (!match) return null;
  const code = match[2].toUpperCase();
  if (code === ledgerCurrency || statementCurrency(code) !== code) return null;
  const exponent = ledgerMoneySpec(code)?.exponent;
  if (exponent !== 0 && exponent !== 2 && exponent !== 3) return null;
  // The figure must carry exactly its currency's decimals: `USD 20.00`,
  // `KWD 1.250`, `JPY 2000`. A bare integer after a three-letter word is a
  // quantity or a name (`STC PAY TOP 100`), not a Tongan pa'anga amount.
  const fraction = /\.(\d+)$/.exec(match[3])?.[1] ?? '';
  if (fraction.length !== exponent) return null;
  const minorUnits = amountMinor(match[3], code, false);
  if (minorUnits === null) return null;
  return { merchant: match[1].trim(), code, minorUnits, exponent };
}

function foreignOriginalFields(
  original: NonNullable<ReturnType<typeof foreignOriginalTail>>,
  localMinor: number,
  ledgerCurrency: StatementCurrency,
): Pick<ParsedSms, 'originalMinorUnits' | 'originalExponent' | 'originalAmountMinor' | 'originalCurrency' | 'fxRate' | 'fxSource'> | null {
  const localExponent = ledgerMoneySpec(ledgerCurrency)?.exponent;
  if (localExponent === undefined) return null;
  const rate = (localMinor / 10 ** localExponent) / (original.minorUnits / 10 ** original.exponent);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  // The legacy two-decimal figure only when it is exact (never for KWD 12.345).
  const legacy = original.exponent === 3
    ? (original.minorUnits % 10 === 0 ? original.minorUnits / 10 : undefined)
    : original.minorUnits * 10 ** (2 - original.exponent);
  return {
    originalMinorUnits: original.minorUnits,
    originalExponent: original.exponent,
    ...(legacy !== undefined && Number.isSafeInteger(legacy) ? { originalAmountMinor: legacy } : {}),
    originalCurrency: original.code,
    fxRate: Number(rate.toPrecision(10)),
    fxSource: 'bank',
  };
}

/**
 * The relay refuses a merchant longer than 160 characters and the phone then
 * drops the whole row. A statement narration can run to 180 (remittance
 * details), so the TITLE is cut at a word boundary instead of losing money.
 */
const MAX_RELAY_TITLE = 160;
function relayTitle(value: string): string {
  if (value.length <= MAX_RELAY_TITLE) return value;
  const cut = value.slice(0, MAX_RELAY_TITLE);
  const space = cut.lastIndexOf(' ');
  return (space >= MAX_RELAY_TITLE / 2 ? cut.slice(0, space) : cut).trim();
}

/**
 * Classify a statement description the way the SMS parser classifies a
 * merchant, with the acquirer's location/country noise peeled from the TITLE
 * only. A recognised service name on the full text (Netflix, ATM withdrawal)
 * wins; the category keeps the full description's verdict unless only the
 * cleaned title is recognised.
 */
function statementMerchantClassification(
  description: string,
  type: 'expense' | 'income',
  market: 'AE' | 'SA' | null,
): ReturnType<typeof classifyMerchantDescription> {
  const full = classifyMerchantDescription(description, type, market);
  const flat = description.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const cleaned = cleanStatementDescriptor(flat);
  if (cleaned === flat) return full;
  const titled = classifyMerchantDescription(cleaned, type, market);
  const merchant = full.merchant !== flat ? full.merchant : titled.merchant;
  return full.categoryDeliberate || !titled.categoryDeliberate
    ? { ...full, merchant }
    : { ...titled, merchant };
}

/** Two leading dates: keep the transaction date, drop the posting date. */
const POSTING_DATE_AFTER_DATE = new RegExp(`^(${DATE_TOKEN})\\s+${DATE_TOKEN}\\s+(?=\\S)`, 'i');

// UK exports print `Start balance`, older ledgers `Opening Bal.` or a bare
// `B/F`, and Arabic statements `الرصيد السابق` (previous balance) as often as
// `الرصيد الافتتاحي`. Missing any of them left the first row of a split
// debit/credit table with no balance to step from, and it was dropped.
const OPENING_BALANCE = /^(?:(?:opening|previous|prev|beginning|starting|start)\s+balance\b|opening\s+bal\b|balance\s+(?:b\/?f|brought\s+forward)\b|b\/f(?=\s|$)|brought\s+forward\b|الرصيد\s+(?:الافتتاحي|السابق))/iu;

/**
 * The figure on an opening-balance line (`Opening Balance 10,000.00`,
 * `Balance B/F 1,200.00 DR`), signed the way the balance chain reads it.
 * Null for anything else, including an opening line with no readable figure.
 */
function openingBalanceMinor(
  rest: string,
  currency: StatementCurrency,
  labels: 'transaction' | 'balance' | null,
): number | null {
  const text = rest.replace(/\s+/g, ' ').trim();
  if (!OPENING_BALANCE.test(text)) return null;
  const words = text.split(' ');
  const label = /^(?:DR|CR|DEBIT|CREDIT)$/i.test(words.at(-1) ?? '') ? words.pop() : undefined;
  const token = classifyMoneyToken(words.at(-1) ?? '', currency);
  // `0.00` is an empty cell inside a row, but an opening balance of exactly
  // zero (a new account) is a real figure the first row steps from. A bare
  // dash stays unreadable.
  if (token?.kind === 'placeholder' && /^0(?:\.0{1,3})?$/.test(words.at(-1) ?? '')) return 0;
  if (!token || token.kind === 'placeholder') return null;
  const value = token.kind === 'signed' && token.type === 'expense' ? -token.minor : token.minor;
  return labels === 'balance' && label && /^(?:DR|DEBIT)$/i.test(label) ? -Math.abs(value) : value;
}

/**
 * A card statement's own summary — what is owed, the minimum, and by when —
 * as the same `cardStatement` row a bank's statement alert produces, so a
 * statement import creates or refreshes the card's due instead of leaving it
 * to an SMS that may never arrive.
 *
 * All three figures must be stated with their labels, in the ledger
 * currency, on lines that are not transaction rows; a minimum above the
 * total, or a due date that is not a real date, refuses the summary. The
 * issue date is carried only when labelled and strictly before the due date.
 */
/** The Worker's per-import row ceiling (MAX_IMPORT_ROWS, relay statementRowIndex < 200). */
const STATEMENT_ROW_CEILING = 200;
// Groups: a minus attached to the figure, the figure, a CR/DR label. A hyphen
// followed by a space is a separator (`Total Due - 380.00`); one touching the
// digits (`New Balance -380.00`) is a credit balance, as is CR.
const SUMMARY_MONEY = String.raw`\s*(?:\(\s*[A-Z]{3}\s*\))?\s*(?:[:=]\s*|-\s+)?(-\s*)?((?:[A-Z]{3}\s*)?-?\s*[\d,]+(?:\.\d{1,3})?)(\s*(?:CR|DR)\b)?`;
// The CURRENT statement's figure, never the previous one printed beside it.
const NOT_PRIOR_PERIOD = String.raw`(?<!\b(?:previous|prior|last|opening|old)\s+)`;
const SUMMARY_TOTAL_LABELS = [
  String.raw`total\s+(?:amount\s+)?due`,
  String.raw`statement\s+balance`,
  String.raw`new\s+balance`,
  String.raw`total\s+outstanding(?:\s+balance)?`,
  String.raw`total\s+(?:statement\s+)?balance`,
];
const SUMMARY_MINIMUM = new RegExp(String.raw`\bmin(?:imum)?\.?\s+(?:amount\s+|payment\s+)?(?:due|payable)\b${SUMMARY_MONEY}|\bminimum\s+payment\b${SUMMARY_MONEY}`, 'i');
const SUMMARY_DUE_DATE = new RegExp(String.raw`\b(?:payment\s+due\s+date|due\s+date|pay(?:ment)?\s+(?:due\s+)?by)\b\s*[:=-]?\s*(${DATE_TOKEN})`, 'i');
const SUMMARY_STATEMENT_DATE = new RegExp(String.raw`\bstatement\s+date\b\s*[:=-]?\s*(${DATE_TOKEN})`, 'i');
// The issue date is the last day of the printed period when no date is labelled.
const SUMMARY_PERIOD_END = new RegExp(String.raw`\bstatement\s+period\b\s*[:=-]?\s*(?:from\s+)?${DATE_TOKEN}\s+(?:to|-|–|until)\s+(${DATE_TOKEN})`, 'i');
// The card's whole limit, never "Available credit limit" or "Amount over credit limit".
const SUMMARY_CREDIT_LIMIT = new RegExp(String.raw`(?<!\b(?:available|over|remaining|unused|cash)\s+)\bcredit\s+limit\b${SUMMARY_MONEY}`, 'i');
const ARABIC_SCRIPT = /[\u0600-\u06ff\u0750-\u077f\ufb50-\ufdff\ufe70-\ufeff]+/g;
const SUMMARY_VALUE = /^(?:[A-Z]{3}\s*)?-?\s*[\d,]+\.\d{1,3}(?:\s*(?:CR|DR))?$/i;

/**
 * Summary label/value pairs from a statement that prints each label on its
 * own line(s) and its figure on a later line ("Total Outstanding" / "on" /
 * "Statement Date (1)" / an Arabic translation / "AED 2,408.76"), or several
 * colon-ended labels in one row with their values in the next row. Arabic
 * text and footnote markers are dropped; a label is the run of word-only
 * lines since the previous value. Labels are matched by the caller, anchored
 * at their start, so "Amount Over Credit Limit" is not "Credit Limit".
 */
function labelledSummaryPairs(lines: readonly string[]): { label: string; value: string }[] {
  const pairs: { label: string; value: string }[] = [];
  let label: string[] = [];
  let columns: string[] | null = null;
  for (const original of lines) {
    // Footnote markers print as `(1)` or, extracted right-to-left, `)1(`.
    const line = original.replace(ARABIC_SCRIPT, ' ').replace(/[()]\s*\d{1,2}\s*[()]/g, ' ')
      .replace(/\s+/g, ' ').replace(/^[\s:.()]+|[\s:()]+$/g, '').trim();
    if (!line) continue;
    const segments = original.replace(ARABIC_SCRIPT, ' ').split(':').map((part) => part.replace(/\s+/g, ' ').trim());
    if (segments.length >= 3 && segments.at(-1) === '' && segments.slice(0, -1).every((part) => /^[A-Za-z][A-Za-z %/&().-]*$/.test(part))) {
      columns = segments.slice(0, -1).map((part) => part.toLowerCase());
      label = [];
      continue;
    }
    if (columns) {
      const values = line.split(' ');
      // Every value must be the kind its label names (a currency code under
      // a currency label, a figure under any other); otherwise a missing
      // value would shift every later one onto the wrong label.
      const fits = values.length === columns.length && columns.every((name, i) => /currency/.test(name)
        ? /^[A-Z]{3}$/.test(values[i]) : /^-?[\d,]+(?:\.\d{1,3})?%?$/.test(values[i]));
      if (values.length === columns.length) {
        if (fits) columns.forEach((name, i) => pairs.push({ label: name, value: values[i] }));
        columns = null;
        continue;
      }
    }
    const date = new RegExp(`^${DATE_TOKEN}$`, 'i').test(line);
    if (SUMMARY_VALUE.test(line) || date) {
      if (label.length > 0) pairs.push({ label: label.join(' ').toLowerCase(), value: line });
      label = [];
      continue;
    }
    if (/^[A-Za-z][A-Za-z %/&.-]*$/.test(line) && line.length <= 60) {
      label = [...label, line].slice(-4);
      continue;
    }
    label = [];
  }
  return pairs;
}

function cardStatementSummary(
  text: string,
  currency: StatementCurrency,
  dateOrder: DateOrder,
  instrument: ParsedSms['card'],
  bankHint: string | undefined,
): StatementParsedRow | null {
  if (!instrument || instrument.kind === 'account' || !/^\d{4}$/.test(instrument.last4)) return null;
  const header = text.split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line && !DATE_LED_LINE.test(line))
    .slice(0, 120);
  // A CR/DR beside the figure is a credit balance or a debit note, not a due.
  // A credit balance owes nothing: 0, which refuses the summary below.
  const money = (match: RegExpExecArray, offset = 1): number | null => {
    const figure = match[offset + 1];
    if (!figure) return null;
    if (match[offset] || figure.includes('-') || /CR/i.test(match[offset + 2] ?? '')) return 0;
    return amountMinor(figure, currency, false);
  };
  const first = <T>(read: (line: string) => T | null): T | null => {
    for (const line of header) {
      const value = read(line);
      if (value !== null) return value;
    }
    return null;
  };
  let total: number | null = null;
  for (const label of SUMMARY_TOTAL_LABELS) {
    const pattern = new RegExp(String.raw`${NOT_PRIOR_PERIOD}\b${label}\b${SUMMARY_MONEY}`, 'i');
    total = first((line) => {
      const match = pattern.exec(line);
      return match ? money(match) : null;
    });
    if (total !== null) break;
  }
  const minimum = first((line) => {
    const match = SUMMARY_MINIMUM.exec(line);
    if (!match) return null;
    return match[2] !== undefined ? money(match, 1) : money(match, 4);
  });
  const due = first((line) => {
    const match = SUMMARY_DUE_DATE.exec(line);
    return match ? isoDate(match[1], dateOrder) : null;
  });
  // Labels above their figures: fill only what the same-line reading missed.
  const pairs = labelledSummaryPairs(header);
  const pairMoney = (label: RegExp): number | null => {
    const pair = pairs.find((entry) => label.test(entry.label) && SUMMARY_VALUE.test(entry.value));
    if (!pair) return null;
    if (/CR\s*$/i.test(pair.value) || /-/.test(pair.value)) return 0;
    return amountMinor(pair.value.replace(/\s*(?:CR|DR)$/i, '').replace(/^[A-Z]{3}\s*/i, ''), currency, false);
  };
  total ??= pairMoney(/^(?:total\s+(?:amount\s+)?(?:outstanding|due|balance)(?!.*\b(?:previous|prior|last)\b)|statement\s+balance|new\s+balance)\b/);
  const minimumFromPairs = minimum ?? pairMoney(/^min(?:imum)?\.?\s+(?:payment|amount)(?:\s+due)?\b/);
  const dueFromPairs = due ?? (() => {
    const pair = pairs.find((entry) => /^(?:payment\s+)?due\s+date\b|^pay(?:ment)?\s+by\b/.test(entry.label));
    return pair ? isoDate(pair.value, dateOrder) : null;
  })();
  if (total === null || minimumFromPairs === null || !dueFromPairs || total <= 0 || minimumFromPairs > total) return null;
  const minimumDue = minimumFromPairs;
  const dueDate = dueFromPairs;
  const issued = first((line) => {
    const match = SUMMARY_STATEMENT_DATE.exec(line) ?? SUMMARY_PERIOD_END.exec(line);
    return match ? isoDate(match[1], dateOrder) : null;
  });
  const sameLineLimit = first((line) => {
    const match = SUMMARY_CREDIT_LIMIT.exec(line);
    return match ? money(match) : null;
  });
  const creditLimit = sameLineLimit ?? pairMoney(/^(?:total\s+)?credit\s+limit$/);
  return {
    kind: 'cardStatement', type: 'expense', amountFils: total, currency,
    merchant: `Card •${instrument.last4}`, date: dueDate,
    dueDay: Number(dueDate.slice(8)), minDueFils: minimumDue,
    card: { last4: instrument.last4, kind: 'credit' }, reference: null,
    transferHint: false,
    // What the card owed on its issue date. Sent only with that date: the
    // relay times the row there (index.ts rowReceiptTimes), so a newer
    // alert's reading still wins.
    ...(issued && issued < dueDate
      ? { snapshotFils: total, snapshotKind: 'outstanding' as const, statementDate: issued }
      : { snapshotFils: null, snapshotKind: null }),
    categoryGuess: 'other', categoryDeliberate: true,
    // Only a limit the statement prints, and only one that could hold its own
    // balance's scale; never a guess.
    ...(creditLimit !== null && creditLimit > 0 && Number.isSafeInteger(creditLimit) ? { creditLimitFils: creditLimit } : {}),
    ...(bankHint ? { bankHint } : {}),
    raw: 'statement summary',
  };
}

function uniqueColumnInstrument(
  records: string[][],
  index: number,
  kind: 'account' | 'unknown',
): ParsedSms['card'] {
  if (index < 0) return null;
  const tails = new Set(
    records
      .map((record) => maskedTail(record[index] ?? ''))
      .filter((tail): tail is string => tail !== null),
  );
  return tails.size === 1 ? { last4: [...tails][0], kind } : null;
}

function statementHeaderInstrument(text: string): ParsedSms['card'] {
  const lines = text.split(/\n+/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const found = new Map<string, NonNullable<ParsedSms['card']>>();
  for (const line of lines.slice(0, 80)) {
    if (ROW_END_DIRECTION.test(line) || ROW_MIDDLE_DIRECTION.test(line)) break;
    for (const candidate of [
      { kind: 'account' as const, re: /\b(?:account|acct|a\/c|iban)(?:\s+(?:no\.?|number))?\s*[:#-]?\s*([Xx*•·\d][Xx*•·\d .\/-]{2,48}\d{4})(?!\d)/i },
      { kind: 'unknown' as const, re: /\bcard(?:\s+(?:no\.?|number))?\s*[:#-]?\s*([Xx*•·\d][Xx*•·\d .\/-]{2,48}\d{4})(?!\d)/i },
    ]) {
      const match = candidate.re.exec(normalizeDigits(line));
      const last4 = match ? maskedTail(match[1]) : null;
      if (last4) found.set(`${candidate.kind}:${last4}`, { last4, kind: candidate.kind });
    }
  }
  return found.size === 1 ? [...found.values()][0] : null;
}

function statementCurrency(value: string): StatementCurrency | null {
  const normalized = normalizeDigits(value).normalize('NFKC').trim().toUpperCase();
  if (/^(?:AED|DHS?|D\.E|DIRHAMS?|د\.?\s*إ|درهم(?: إماراتي)?)$/iu.test(normalized)) return 'AED';
  if (/^(?:SAR|SR|S\.R|RIYALS?|ر\.?\s*س|ريال(?: سعودي)?)$/iu.test(normalized)) return 'SAR';
  return /^[A-Z]{3}$/.test(normalized) && ledgerMoneySpec(normalized) ? normalized : null;
}

/** Only document metadata labels establish a statement-wide currency. */
function assertStatementCurrency(text: string, currency: StatementCurrency): void {
  for (const line of text.split(/\n+/)) {
    const labelled = /^\s*(?:(?:account|statement)\s+)?currency(?:\s*[:=-]\s*|\s+)([A-Z]{3})\b/i.exec(line);
    if (!labelled) continue;
    const stated = statementCurrency(labelled[1]);
    if (stated && stated !== currency) throw new Error('statement_currency_mismatch');
  }
}

/**
 * Which character separates a file's decimals.
 *
 * `point`  1,234.56 · 1'234.56 · 12.50 — the launch-tested reading, and the
 *          reading of every file that does not prove otherwise.
 * `comma`  1.234,56 · 1 234,56 · 12,50 — only when the file's own figures say
 *          so and none of them contradicts it (see inferDecimalConvention).
 */
type DecimalConvention = 'point' | 'comma';

/** Thousands separators besides the opposite decimal mark: apostrophes and (no-break) spaces. */
const GROUP_MARKS = String.raw`'’\u00a0\u202f`;

/**
 * What one figure proves about the decimal mark, or null when it proves
 * nothing. `12,345` proves nothing — twelve thousand, or 12.345 of a
 * three-decimal currency — and neither does `1.234`. `12,50`, `1.234,56` and
 * `1 234,5` can only be decimal-comma; `12.50` and `1,234.56` only
 * decimal-point.
 */
function decimalEvidence(token: string, exponent: number): DecimalConvention | null {
  if (exponent === 0) return null;
  const comma = new RegExp(
    `^(?:\\d{1,3}([.${GROUP_MARKS} ])\\d{3}(?:\\1\\d{3})*|\\d+),(\\d{1,${exponent}})$`,
  ).exec(token);
  if (comma && (comma[1] || comma[2].length !== 3)) return 'comma';
  const point = new RegExp(
    `^(?:\\d{1,3}([,'’])\\d{3}(?:\\1\\d{3})*|\\d+)\\.(\\d{1,${exponent}})$`,
  ).exec(token);
  if (point && (point[1] || point[2].length !== 3)) return 'point';
  return null;
}

/**
 * A file's decimal mark from its own figures. Decimal-comma needs positive
 * evidence and no figure contradicting it; anything else — including a file
 * with both kinds, which is not a file whose convention is known — keeps the
 * decimal-point reading, under which a decimal-comma figure never parses.
 * Zero-decimal currencies have no decimal mark to decide.
 */
function inferDecimalConvention(tokens: Iterable<string>, currency: StatementCurrency): DecimalConvention {
  const exponent = ledgerMoneySpec(currency)?.exponent ?? 0;
  let comma = 0;
  let point = 0;
  for (const token of tokens) {
    const evidence = decimalEvidence(token, exponent);
    if (evidence === 'comma') comma += 1;
    else if (evidence === 'point') point += 1;
  }
  return comma > 0 && point === 0 ? 'comma' : 'point';
}

/** Figure-shaped runs in free text: digits joined by separators, never by a space. */
const TEXT_FIGURE = new RegExp(`\\d[\\d.,${GROUP_MARKS}]*\\d`, 'g');

/**
 * Rewrite a flattened PDF's figures into the one spelling the row parser
 * reads (`1234.56`), so the column, balance and card-table logic below stays
 * the launch-tested code. Only a decimal-comma file changes materially; a
 * decimal-point file only loses apostrophe grouping (`1'234.56`), which it
 * could not parse at all before. Dates are untouched: `03.04.2026` is neither
 * a decimal nor a three-digit group.
 *
 * A plain space is never a thousands mark here — in flattened text it is as
 * likely a column boundary — but a no-break space is.
 */
function normalizeStatementFigures(text: string, currency: StatementCurrency): string {
  return applyFigureConvention(text, statementFigureConvention(text, currency));
}

/** The one decimal convention a flattened statement's figures are read with. */
function statementFigureConvention(text: string, currency: StatementCurrency): DecimalConvention {
  // `RUE 12 345,00` is either 12 345,00 or a 12 beside 345,00. No row of a
  // file that prints such a figure can be read with confidence, so the whole
  // file keeps the decimal-point reading and its comma figures are refused
  // (and counted) rather than half-read.
  const spaceGrouped = /(?<![\d.,])\d{1,3}(?: \d{3})+,\d{1,3}(?!\d)/.test(text);
  return spaceGrouped ? 'point' : inferDecimalConvention(text.match(TEXT_FIGURE) ?? [], currency);
}

function applyFigureConvention(text: string, convention: DecimalConvention): string {
  if (convention === 'point') {
    return text.replace(
      new RegExp(`(?<![\\d.,'’])\\d{1,3}(?:(['’])\\d{3})(?:\\1\\d{3})*(?=\\.\\d|(?![\\d.,'’]))`, 'g'),
      (figure) => figure.replace(/['’]/g, ''),
    );
  }
  return text
    .replace(
      new RegExp(`(?<![\\d.,${GROUP_MARKS}])(\\d{1,3}(?:([.${GROUP_MARKS}])\\d{3})(?:\\2\\d{3})*|\\d+),(\\d{1,3})(?![\\d]|[.,${GROUP_MARKS}]\\d)`, 'g'),
      (_figure, whole: string, _group: string, fraction: string) => `${whole.replace(/\D/g, '')}.${fraction}`,
    )
    .replace(
      new RegExp(`(?<![\\d.,${GROUP_MARKS}])\\d{1,3}(?:([.${GROUP_MARKS}])\\d{3})(?:\\1\\d{3})*(?![\\d]|[.,${GROUP_MARKS}]\\d)`, 'g'),
      (figure) => figure.replace(/\D/g, ''),
    );
}

/** The figure inside one CSV money cell, for inferDecimalConvention. */
function cellFigure(value: string): string {
  return normalizeDigits(value).normalize('NFKC').replace(/[\s\u00a0\u202f]+/g, ' ')
    .replace(/[^\d.,'’ ]/g, '').trim();
}

/** The ledger currencies each money symbol can stand for. */
const CURRENCY_SYMBOLS: Record<string, readonly string[]> = {
  '£': ['GBP'],
  '€': ['EUR'],
  '$': ['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD'],
};

function amountMinor(
  value: string,
  currency: StatementCurrency,
  signed: boolean,
  decimal: DecimalConvention = 'point',
): number | null {
  let normalized = normalizeDigits(value).normalize('NFKC').replace(/[\s\u00a0]+/g, ' ').trim();
  const spec = ledgerMoneySpec(currency);
  if (!spec || !normalized || /^(?:-|--|N\/?A|0(?:[.,]0{1,3})?)$/i.test(normalized)) return null;

  let negative = false;
  let explicitSign = false;
  let contradictorySign = false;
  if (/^\(.+\)$/.test(normalized)) {
    negative = true;
    explicitSign = true;
    normalized = normalized.slice(1, -1).trim();
  }
  const takeSign = () => {
    const prefix = /^([+-])/.exec(normalized)?.[1];
    const suffix = /([+-])$/.exec(normalized)?.[1];
    const sign = prefix ?? suffix;
    if (!sign) return;
    if (explicitSign || (prefix && suffix)) contradictorySign = true;
    explicitSign = true;
    negative = sign === '-';
    normalized = prefix ? normalized.slice(1).trim() : normalized.slice(0, -1).trim();
  };
  takeSign();

  // Amount cells may carry either a canonical ISO code or the two launch-era
  // local aliases. Currency evidence is checked, never used to change the
  // requested ledger denomination.
  // A currency SYMBOL (`£23.40`, `-€5.00`, `$84.12`) is evidence like a code:
  // accepted only when it can name the ledger's own currency.
  const symbol = /^([£€$])\s*/.exec(normalized);
  if (symbol) {
    if (!(CURRENCY_SYMBOLS[symbol[1]] ?? []).includes(currency)) return null;
    normalized = normalized.slice(symbol[0].length).trim();
    takeSign();
  } else {
    // `-10,80 €` (DKB): the symbol after the figure, as continental exports print it.
    const trailing = /\s*([£€$])$/.exec(normalized);
    if (trailing) {
      if (!(CURRENCY_SYMBOLS[trailing[1]] ?? []).includes(currency)) return null;
      normalized = normalized.slice(0, normalized.length - trailing[0].length).trim();
      takeSign();
    }
  }
  const localAlias = String.raw`(?:AED|DHS?|D\.E|DIRHAMS?|د\.?\s*إ|درهم(?: إماراتي)?|SAR|SR|S\.R|RIYALS?|ر\.?\s*س|ريال(?: سعودي)?|[A-Z]{3})`;
  const prefixCurrency = new RegExp(`^(${localAlias})\\s*`, 'iu').exec(normalized)?.[1];
  if (prefixCurrency) {
    if (statementCurrency(prefixCurrency) !== currency) return null;
    normalized = normalized.slice(prefixCurrency.length).trim();
  } else {
    const suffixCurrency = new RegExp(`\\s*(${localAlias})$`, 'iu').exec(normalized)?.[1];
    if (suffixCurrency) {
      if (statementCurrency(suffixCurrency) !== currency) return null;
      normalized = normalized.slice(0, normalized.length - suffixCurrency.length).trim();
    }
  }
  // Also accept sign placement immediately after/before a currency code.
  takeSign();
  if (contradictorySign || signed !== explicitSign) return null;

  // One grouping mark per figure, three digits per group. Decimal-point files
  // group with `,` or an apostrophe; decimal-comma files with `.`, an
  // apostrophe or a space. Zero-decimal currencies read as decimal-point.
  const comma = decimal === 'comma' && spec.exponent > 0;
  const group = comma ? `[.'’ ]` : `[,'’]`;
  const mark = comma ? ',' : '\\.';
  // `-12.400000` (broker exports): decimals past the currency's own are read
  // only when every one of them is zero and there are at least two of them,
  // so the figure is exactly the same and `1,000` (a thousand, or one) is
  // never touched. A zero-decimal currency is left alone (`1.000`).
  if (spec.exponent > 0) normalized = normalized.replace(new RegExp(`(${mark}\\d{${spec.exponent}})0{2,}$`), '$1');
  const fractionPattern = spec.exponent === 0 ? '' : `(?:${mark}(\\d{1,${spec.exponent}}))?`;
  // Rupee figures group in lakhs and crores (`1,85,000.00`, `2,04,759.22`).
  // Only a rupee ledger reads that grouping; elsewhere it is not a figure.
  const lakh = currency === 'INR' && !comma ? String.raw`|\d{1,2}(?:,\d{2})+,\d{3}` : '';
  const match = new RegExp(`^(\\d{1,3}(${group})\\d{3}(?:\\2\\d{3})*|\\d+${lakh})${fractionPattern}$`).exec(normalized);
  if (!match) return null;
  const whole = match[1].replace(/\D/g, '');
  const fraction = spec.exponent === 0 ? '' : (match[3] ?? '');
  let minor: bigint;
  try {
    minor = BigInt(whole) * BigInt(10 ** spec.exponent) +
      BigInt((fraction || '').padEnd(spec.exponent, '0') || '0');
  } catch {
    return null;
  }
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const valueMinor = Number(minor);
  return negative ? -valueMinor : valueMinor;
}

function rowDirection(value: string): 'expense' | 'income' | null {
  const normalized = normalizedHeader(value);
  if (/^(?:dr|d|debit|withdrawal|withdrawn|paid out|مدين|خصم|سحب|af|ausgang|soll|débit|debet|borç)$/.test(normalized)) return 'expense';
  if (/^(?:cr|c|credit|deposit|deposited|paid in|دائن|إيداع|bij|eingang|haben|crédit|kredit|alacak)$/.test(normalized)) return 'income';
  return null;
}

/**
 * How a statement's bare signs read.
 *
 * `account`      minus is money out, plus/unsigned-with-sign is money in — the
 *                account-statement convention, and the only one assumed.
 * `account-unsigned-credit`
 *                a bank export proved by its own rows (inferCsvSignConvention)
 *                to print debits with a minus and credits as plain figures.
 * `minus-credit` the card statement SAYS a minus marks a credit (payment,
 *                refund, cashback), or its rows prove it (Amex-style exports);
 *                plain and plus figures are charges.
 * `minus-debit`  the card statement SAYS charges carry the minus, or its rows
 *                prove it (Chase-style exports); plain and plus figures are
 *                credits.
 * `refuse`       a card statement that says neither. Card issuers use both
 *                conventions, so a bare sign there is not a direction.
 */
type SignConvention = 'account' | 'account-unsigned-credit' | 'minus-credit' | 'minus-debit' | 'refuse';

/** Conventions under which an unsigned figure has a direction of its own. */
const PLAIN_FIGURE_CONVENTIONS: ReadonlySet<SignConvention> = new Set([
  'account-unsigned-credit', 'minus-credit', 'minus-debit',
]);

const SIGN_VERB = String.raw`(?:denotes?|indicates?|represents?|means?|shows?|=)`;
const SIGN_MARK = String.raw`(?:minus|negative)(?:\s+sign)?\s*(?:\(\s*-\s*\)\s*)?(?:amounts?|figures?|values?|entries|transactions)?`;
const CREDIT_WORDS = String.raw`(?:credits?|payments?|refunds?)`;
const DEBIT_WORDS = String.raw`(?:debits?|charges?|purchases?|spend(?:ing)?)`;
const SHOWN_AS = String.raw`(?:are\s+)?(?:shown|marked|displayed|printed|indicated|listed)\s+(?:with|by|as|in)\s+(?:a\s+)?(?:minus|negative|\(\s*-\s*\))`;
function legendPatterns(words: string): RegExp[] {
  // "A negative amount indicates a credit BALANCE" describes the balance line,
  // not how transaction rows are signed.
  const notBalance = String.raw`(?!\s+balances?\b)`;
  return [
    new RegExp(String.raw`\b${SIGN_MARK}\s*${SIGN_VERB}\s+(?:a\s+|an\s+)?${words}\b${notBalance}`, 'i'),
    new RegExp(String.raw`\(\s*-\s*\)\s*${SIGN_VERB}\s*(?:a\s+|an\s+)?${words}\b${notBalance}`, 'i'),
    new RegExp(String.raw`\b${words}(?:\s+(?:and|&|\/)\s+(?:${CREDIT_WORDS}|${DEBIT_WORDS}))?\s+${SHOWN_AS}`, 'i'),
  ];
}
const MINUS_CREDIT_LEGEND = legendPatterns(CREDIT_WORDS);
const MINUS_DEBIT_LEGEND = legendPatterns(DEBIT_WORDS);
/**
 * The sentence the row legends above leave out on purpose, read for the stated
 * balances alone: a card statement saying its MINUS balance is a credit
 * balance (`A negative New Balance indicates a credit balance`, `Credit
 * balances are shown as negative`). Without it a card's minus balance has no
 * direction (see signedBalance).
 */
const BALANCE_WORDS = String.raw`(?:(?:new|previous|statement|closing|opening|account|card)\s+)?balances?`;
const MINUS_BALANCE_CREDIT_LEGEND = [
  new RegExp(String.raw`\b(?:minus|negative)(?:\s+sign)?\s+${BALANCE_WORDS}\s+(?:${SIGN_VERB}|is|are)\s+(?:a\s+|an\s+)?credit(?:\s+balances?)?\b`, 'i'),
  new RegExp(String.raw`\bcredit\s+balances?\s+(?:is\s+)?${SHOWN_AS}`, 'i'),
];

/** The sign legend a card statement prints, when it prints exactly one. */
function cardSignLegend(text: string): 'minus-credit' | 'minus-debit' | null {
  const flat = text.replace(/\s+/g, ' ');
  const credit = MINUS_CREDIT_LEGEND.some((pattern) => pattern.test(flat));
  const debit = MINUS_DEBIT_LEGEND.some((pattern) => pattern.test(flat));
  if (credit === debit) return null;
  return credit ? 'minus-credit' : 'minus-debit';
}

/** Strong single markers that a document is a card statement. */
const CARD_STATEMENT_MARKER = /\bcredit\s+card\s+statement\b|\bminimum\s+(?:amount|payment)\s+due\b|\b(?:available\s+)?credit\s+limit\b/i;

function signConvention(cardEvidence: boolean, text: string): SignConvention {
  if (!cardEvidence) return 'account';
  return cardSignLegend(text) ?? 'refuse';
}

/**
 * Direction of one figure under a convention. `sign` is the explicit sign the
 * cell carried, or null for a plain figure. Null means "not decidable".
 */
function directionFromSign(
  sign: '-' | '+' | null,
  convention: SignConvention,
): 'expense' | 'income' | null {
  switch (convention) {
    case 'account': return sign === '-' ? 'expense' : sign === '+' ? 'income' : null;
    case 'account-unsigned-credit': return sign === '-' ? 'expense' : 'income';
    case 'minus-credit': return sign === '-' ? 'income' : 'expense';
    case 'minus-debit': return sign === '-' ? 'expense' : 'income';
    default: return null;
  }
}

/** A card's own wording for a payment it received. Never a debit on an account. */
const PAYMENT_RECEIVED = /\b(?:payment|pymt)\s*-?\s*(?:received|recd|thank)|\bzahlung(?:\s*\/\s*[üu]berweisung)?\s+erhalten\b|\bpaiement\s+re[çc]u\b|\bpago\s+recibido\b|\bpagamento\s+ricevuto\b|\bbetaling\s+ontvangen\b/iu;

/** Card-side payment wording strong enough to identify a card export. */
// Only wording a card issuer prints for money RECEIVED onto the card. A bare
// AUTOPAY or MOBILE PYMT is just as often a utility bill leaving an account,
// so it never proves a card export; an issuer named with it does.
const CARD_PAYMENT_PHRASE = /\b(?:payment|pymt)\s*-?\s*(?:received|recd|thank)|\bthank\s+you\b|\b(?:capital\s+one|chase|citi|amex|american\s+express|discover|barclaycard)\s+(?:(?:mobile|online|auto)\s*)?(?:pymt|payment)\b|\bzahlung(?:\s*\/\s*[üu]berweisung)?\s+erhalten\b|\bpaiement\s+re[çc]u\b|\bpago\s+recibido\b|\bpagamento\s+ricevuto\b|\bbetaling\s+ontvangen\b/iu;
/** A row a card statement credits: a payment, refund, return or cashback. */
const CARD_CREDIT_ROW = /\brefund|\breturn|\bcash\s*back\b|\bcredit\b|\brevers(?:al|ed)\b/i;
const CARD_CREDIT_TYPE = /^(?:payment|payment credit|return|refund|credit|adjustment)$/;
/** A card export's Type cell for a payment received onto the card. */
const CARD_PAYMENT_TYPE = /^(?:payments?|payment credit|payment received)$/;
/** Money a current account receives. Only used to recognise a bank export. */
const ACCOUNT_INCOME_HINT = /\bsalar(?:y|ies)\b|\bpayroll\b|\bwages?\b|\bdir\s+dep\b|\bdirect\s+dep(?:osit)?\b|\bdeposit|\btransfer\b|\btrf\b|\binterest\b|\bdividend|\bpaid\s+in\b|\breceived\b|\bfrom\b|\bcredit\b|\brefund|\bcash\s*back\b|\brevers|\bzelle\b|راتب|ايداع|إيداع|تحويل/iu;
/**
 * The same money-in words in the other export languages: salary, credit
 * notes, received transfers and deposits. Whole words only, tested against a
 * row's description and its type cell (N26 `Income`, DKB `Gutschrift`).
 */
const ACCOUNT_INCOME_WORDS = /(?<![\p{L}\p{N}])(?:income|gehalt|lohn|gutschrift|eingang|einzahlung|salaire|vir(?:ement)?\s+(?:sepa\s+)?re[çc]u|virement\s+en\s+votre\s+faveur|revenus?|remboursement|n[óo]mina|ingreso|transferencia\s+recibida|sal[áa]rio|recebid[oa]|stipendio|accredito|salaris|bijschrijving|storting|terugbetaling|ma[aâ][sş]|gaji|setoran)(?![\p{L}\p{N}])/iu;

/**
 * The sign convention a bare amount column follows, read from the rows when
 * the file states none. Three shapes, each needing positive evidence:
 *
 *   minus-credit  (Amex-style card export) no plus signs; every minus row is
 *                 a payment, refund or credit, at least one is a card payment
 *                 ("AUTOPAY PAYMENT - THANK YOU"), no plain row looks like
 *                 money a bank account receives, and there is no balance.
 *   minus-debit   (Chase-style card export) no plus signs; every PLAIN row is
 *                 a payment/return/credit by its description or Type cell, at
 *                 least one is a card payment, and no minus row is.
 *   account-unsigned-credit
 *                 (bank export) not a card statement; some minus row is an
 *                 ordinary debit; and the plain rows are credits by proof — a
 *                 running balance column, or every one reading as income.
 *
 * Anything else stays undecided and its plain figures are refused as before.
 */
function inferCsvSignConvention(
  records: string[][],
  options: {
    amountIndex: number; descriptionIndex: number; directionIndex: number; headers: string[];
    currency: StatementCurrency; decimal: DecimalConvention; cardStatement: boolean;
    /** The file labels itself as an ACCOUNT (an account column or preamble). */
    accountLabelled: boolean;
    /**
     * One own-account number in a column on every row (Sparkasse
     * Auftragskonto, Rabobank IBAN/BBAN): an account export by its own
     * statement, which no card export prints.
     */
    ownAccountColumn: boolean;
  },
): SignConvention | null {
  const samples: { sign: '-' | '+' | null; description: string; typeCell: string }[] = [];
  for (const record of records) {
    if (record.length !== options.headers.length) continue;
    const typeCell = options.directionIndex >= 0 ? record[options.directionIndex] ?? '' : '';
    if (rowDirection(typeCell)) continue; // already explicit
    const cell = record[options.amountIndex] ?? '';
    const signed = amountMinor(cell, options.currency, true, options.decimal);
    const plain = signed === null ? amountMinor(cell, options.currency, false, options.decimal) : null;
    if (signed === null && plain === null) continue;
    samples.push({
      sign: signed === null ? null : signed < 0 ? '-' : '+',
      description: normalizeDigits(record[options.descriptionIndex] ?? '').normalize('NFKC'),
      typeCell: normalizedHeader(typeCell),
    });
  }
  const minus = samples.filter((sample) => sample.sign === '-');
  const plus = samples.filter((sample) => sample.sign === '+');
  const plain = samples.filter((sample) => sample.sign === null);
  if (minus.length === 0 || plain.length === 0) return null;
  const creditLike = (sample: typeof samples[number]) => CARD_PAYMENT_PHRASE.test(sample.description) ||
    CARD_CREDIT_ROW.test(sample.description) || CARD_CREDIT_TYPE.test(sample.typeCell);
  const cardPayment = (sample: typeof samples[number]) => CARD_PAYMENT_PHRASE.test(sample.description);
  const incomeLike = (sample: typeof samples[number]) => ACCOUNT_INCOME_HINT.test(sample.description) ||
    ACCOUNT_INCOME_WORDS.test(sample.description) || ACCOUNT_INCOME_WORDS.test(sample.typeCell);
  const balanceColumn = options.headers.some((header) => BALANCE_HEADER.test(header));
  // An account-labelled file is never re-read as a card's: its AUTOPAY rows
  // are bills and its "payment received" rows are money in.
  if (plus.length === 0 && !balanceColumn && !options.accountLabelled) {
    if (minus.every(creditLike) && minus.some(cardPayment) && !plain.some(incomeLike) &&
        !minus.some((sample) => ACCOUNT_SIDE_CARD_SETTLEMENT.test(sample.description))) {
      return 'minus-credit';
    }
    // A NEGATIVE "payment received" names money a card received. Beside
    // minus rows that are not all credits, only a file already proven to be
    // a card's (its header or preamble) is read that way; otherwise neither
    // reading is taken and the signed rows are counted unread.
    if (minus.some((sample) => PAYMENT_RECEIVED.test(sample.description)) && !plain.some(incomeLike) &&
        !minus.some((sample) => ACCOUNT_SIDE_CARD_SETTLEMENT.test(sample.description))) {
      return options.cardStatement ? 'minus-credit' : 'refuse';
    }
    if (plain.every(creditLike) && plain.some(cardPayment) && !minus.some(creditLike) && !minus.some(incomeLike)) {
      return 'minus-debit';
    }
  }
  if (!options.cardStatement && minus.some((sample) => !creditLike(sample)) &&
      (balanceColumn || options.ownAccountColumn || plain.every(incomeLike))) {
    return 'account-unsigned-credit';
  }
  return null;
}

/** A row that undoes an earlier one, in the export languages read here. */
const REVERSAL_WORDING = /(?<![\p{L}\p{N}])(?:revers(?:al|ed)|refund(?:ed)?|returns?|chargeback|cancel(?:led|ed|lation)?|credit\s+adjustment|عكس|استرداد|storno|r[üu]ckbuchung|r[üu]ckerstattung|annulation|remboursement|retour|reembolso|devoluci[óo]n|anulaci[óo]n|rimborso|storno|terugboeking|terugbetaling|estorno|iade)(?![\p{L}\p{N}])/iu;

/** Wording a card statement prints on a payment it receives. */
const PAYMENT_WORDING = /\b(?:payments?|pymt|autopay|directpay|full\s+balance|ach\s+deposit)\b/i;

/**
 * Whether a bare amount column has the shape a card export prints just as
 * well as an account export does: minus figures beside plain ones, no plus
 * anywhere, and every minus row a payment, refund, return or credit by its
 * description or type cell. Read as an account those rows are spending; read
 * as a card export (Discover, Apple Card: plain charges, negative payments
 * and returns) they are money in, and the file does not say which. One minus
 * row that is an ordinary purchase is the account's own evidence and leaves
 * the account reading alone. Rows whose direction column already names a
 * direction are not counted.
 */
function cardShapedSigns(
  records: string[][],
  options: {
    amountIndex: number; descriptionIndex: number; directionIndex: number; headers: string[];
    currency: StatementCurrency; decimal: DecimalConvention;
  },
): boolean {
  let minus = 0;
  let plus = 0;
  let plain = 0;
  let minusPurchase = false;
  for (const record of records) {
    if (record.length !== options.headers.length) continue;
    const typeCell = options.directionIndex >= 0 ? record[options.directionIndex] ?? '' : '';
    if (rowDirection(typeCell)) continue;
    const cell = record[options.amountIndex] ?? '';
    const signed = amountMinor(cell, options.currency, true, options.decimal);
    if (signed !== null) {
      if (signed > 0) {
        plus += 1;
        continue;
      }
      minus += 1;
      const description = normalizeDigits(record[options.descriptionIndex] ?? '').normalize('NFKC');
      const type = normalizedHeader(typeCell);
      if (!(CARD_PAYMENT_PHRASE.test(description) || CARD_CREDIT_ROW.test(description) ||
          PAYMENT_WORDING.test(description) || CARD_CREDIT_TYPE.test(type))) {
        minusPurchase = true;
      }
    } else if (amountMinor(cell, options.currency, false, options.decimal) !== null) {
      plain += 1;
    }
  }
  return minus > 0 && plain > 0 && plus === 0 && !minusPurchase;
}

/**
 * Decode an exported statement without guessing past what the bytes say.
 * A UTF-16 BOM names its encoding outright (Excel "Unicode text" exports);
 * otherwise the file is UTF-8, or — when it is not valid UTF-8 — the single-byte
 * Windows encoding older bank portals still emit. Replacement characters are
 * never produced: a byte sequence that decodes to NUL is binary, not a table.
 */
export function decodeCsv(bytes: Uint8Array): string {
  let text: string;
  try {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      text = new TextDecoder('utf-16le', { fatal: true, ignoreBOM: false }).decode(bytes);
    } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      text = new TextDecoder('utf-16be', { fatal: true, ignoreBOM: false }).decode(bytes);
    } else {
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
      } catch {
        text = new TextDecoder('windows-1252', { fatal: true, ignoreBOM: false }).decode(bytes);
      }
    }
  } catch {
    throw new Error('invalid_csv');
  }
  // Both decoders strip their own BOM; a stray one inside the body is not text.
  text = text.replace(/^\uFEFF/, '');
  if (text.includes('\u0000')) throw new Error('invalid_csv');
  return text;
}

/**
 * Parse an exported statement with named columns. Direction must be explicit:
 * separate debit/credit columns, an amount plus direction column, or a signed
 * amount on every accepted row. Unmarked positive amounts are never guessed.
 */
export function parseStatementCsv(
  text: string,
  defaultCurrency: StatementCurrency,
  maxRows = 200,
  dateHint: StatementDateHint = legacyStatementDateHint(defaultCurrency),
): StatementCsvResult {
  if (!ledgerMoneySpec(defaultCurrency)) throw new Error('unsupported_statement_currency');
  const delimiter = csvDelimiter(text);
  if (!delimiter) throw new Error('invalid_csv');
  let records: string[][];
  try {
    records = parseCsvRecords(text, {
      bom: true,
      delimiter,
      max_record_size: MAX_CSV_RECORD_CHARS,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    }) as string[][];
  } catch {
    throw new Error('invalid_csv');
  }
  return parseStatementRecords(records, delimiter, defaultCurrency, maxRows, dateHint);
}

/**
 * The first worksheet of an Excel .xlsx export, read by exactly the same
 * named-column rules as a CSV (parseStatementRecords): same header detection,
 * same explicit-direction requirement, same refusals. xlsx-records.ts turns
 * the sheet into the rows a CSV export of it would hold; date-formatted cells
 * arrive as ISO dates and numbers as their stored decimal text.
 *
 * Throws `invalid_xlsx` for anything that is not a well-formed, unencrypted,
 * size-bounded workbook, `too_many_rows` past the row ceiling, and otherwise
 * the CSV reader's own codes.
 */
export async function parseStatementXlsx(
  bytes: Uint8Array,
  defaultCurrency: StatementCurrency,
  maxRows = 200,
  dateHint: StatementDateHint = legacyStatementDateHint(defaultCurrency),
): Promise<StatementCsvResult> {
  if (!ledgerMoneySpec(defaultCurrency)) throw new Error('unsupported_statement_currency');
  let records: string[][];
  try {
    records = await xlsxSheetRecords(bytes, {
      // Past this many non-empty rows a CSV export of the sheet is refused
      // as too_many_rows whatever its header is; stop materialising there.
      maxRecords: maxRows + MAX_CSV_PREAMBLE_RECORDS + 1,
      maxColumns: MAX_STATEMENT_COLUMNS,
      maxRecordChars: MAX_CSV_RECORD_CHARS,
    });
  } catch (error) {
    if (error instanceof XlsxError) throw new Error(error.code);
    throw new Error('invalid_xlsx');
  }
  return parseStatementRecords(records, ',', defaultCurrency, maxRows, dateHint);
}

/**
 * An OFX/QFX, QIF, camt.05x or MT940 file, read by the same named-column
 * rules as a CSV: structured-statements.ts turns it into records with
 * explicit Debit/Credit (or the file's own signed card amounts), and
 * parseStatementRecords does the rest. Null when the bytes are none of
 * these formats. Entries the reader deliberately left out (pending,
 * contradictory) are counted as unread rows, never dropped silently.
 *
 * The file's stated closing balance becomes the account's balance on its
 * newest row's date, under the same rules as a CSV's running balance: an
 * account (never a card) statement read in full, a non-negative figure, and
 * only when no running balance column already gave one.
 */
export function parseStructuredStatement(
  bytes: Uint8Array,
  defaultCurrency: StatementCurrency,
  maxRows = 200,
  dateHint: StatementDateHint = legacyStatementDateHint(defaultCurrency),
): (StatementCsvResult & { format: StructuredStatementFormat }) | null {
  if (!ledgerMoneySpec(defaultCurrency)) throw new Error('unsupported_statement_currency');
  const statement = readStructuredStatement(bytes);
  if (!statement) return null;
  if (statement.currency && statement.currency !== defaultCurrency) throw new Error('statement_currency_mismatch');
  const parsed = parseStatementRecords(statement.records, ',', defaultCurrency, maxRows, dateHint);
  const rejectedRows = parsed.rejectedRows + statement.skippedEntries;
  const closing = statement.closingBalance;
  if (closing && statement.account?.kind !== 'credit' && rejectedRows === 0 && closing.amountMinor >= 0 &&
      Number.isSafeInteger(closing.amountMinor) && !parsed.rows.some((row) => row.snapshotFils !== null)) {
    let newest = -1;
    parsed.rows.forEach((row, index) => {
      if (row.kind === 'transaction' && row.card?.kind !== 'credit' && row.date && row.date <= closing.date &&
          (newest < 0 || row.date >= (parsed.rows[newest].date ?? ''))) newest = index;
    });
    const latest = parsed.rows.reduce((max, row) => (row.date && row.date > max ? row.date : max), '');
    if (newest >= 0 && parsed.rows[newest].date === latest) {
      parsed.rows[newest].snapshotFils = closing.amountMinor;
      parsed.rows[newest].snapshotKind = 'balance';
    }
  }
  return { ...parsed, rejectedRows, totalRows: parsed.totalRows + statement.skippedEntries, format: statement.format };
}

/**
 * Named-column statement rows from already-split records — the shared core of
 * the CSV and XLSX readers. `delimiter` only rebuilds each row's transient
 * `raw` text, which never leaves the Worker.
 */
export function parseStatementRecords(
  records: string[][],
  delimiter: string,
  defaultCurrency: StatementCurrency,
  maxRows = 200,
  dateHint: StatementDateHint = legacyStatementDateHint(defaultCurrency),
): StatementCsvResult {
  if (!ledgerMoneySpec(defaultCurrency)) throw new Error('unsupported_statement_currency');
  // The header is the first leading record that names a date column AND a money
  // column, not necessarily the first record: bank exports open with account
  // preambles, and a blank or repeated header cell is a column to ignore (first
  // occurrence wins), not grounds to refuse the whole file.
  const headerRow = records.slice(0, MAX_CSV_PREAMBLE_RECORDS).findIndex((record) => {
    const candidate = record.map((cell) => headerKey(cell).key);
    return candidate.length >= 3 && candidate.length <= MAX_STATEMENT_COLUMNS &&
      headerIndex(candidate, HEADER_ALIASES.date) >= 0 && (
        headerIndex(candidate, HEADER_ALIASES.amount) >= 0 ||
        headerIndex(candidate, HEADER_ALIASES.amountFallback) >= 0 ||
        headerIndex(candidate, HEADER_ALIASES.debit) >= 0 ||
        headerIndex(candidate, HEADER_ALIASES.credit) >= 0
      );
  });
  if (headerRow < 0 || records.length < headerRow + 2) {
    throw new Error('unsupported_statement_format');
  }
  const headerCells = records[headerRow].map(headerKey);
  const headers = headerCells.map((cell) => cell.key);
  // Exports pad rows and headers differently: a trailing delimiter on every
  // data row (ADCB) or only on the header (Lloyds). Blank cells past the other
  // side's width are padding, never a column; a non-blank one still makes the
  // row the wrong shape and it is rejected below.
  const fitWidth = (record: string[]): string[] => {
    if (record.length > headers.length && record.slice(headers.length).every((cell) => !cell.trim())) {
      return record.slice(0, headers.length);
    }
    if (record.length < headers.length && headers.slice(record.length).every((header) => !header)) {
      return [...record, ...Array<string>(headers.length - record.length).fill('')];
    }
    return record;
  };
  let dataRecords = records.slice(headerRow + 1).map(fitWidth);
  // Apply the resource limit to every record, including summaries and headers.
  const inputRows = dataRecords.length;
  if (inputRows > maxRows) throw new Error('too_many_rows');
  const dateIndex = headerIndex(headers, HEADER_ALIASES.date);
  const descriptionIndex = headerIndex(headers, HEADER_ALIASES.description);
  const debitIndex = headerIndex(headers, HEADER_ALIASES.debit);
  const creditIndex = headerIndex(headers, HEADER_ALIASES.credit);
  const amountIndex = headerIndices(headers, 'amount').length > 0
    ? headerIndex(headers, HEADER_ALIASES.amount)
    : headerIndex(headers, HEADER_ALIASES.amountFallback);
  const directionIndex = headerIndices(headers, 'direction').length > 0
    ? headerIndex(headers, HEADER_ALIASES.direction)
    : headerIndex(headers, HEADER_ALIASES.transactionType);
  // A type column beside the direction column: when its cell also names a
  // direction (DR, Credit) and disagrees, the row is refused.
  const typeIndex = headerIndex(headers, HEADER_ALIASES.transactionType);
  const secondTypeIndex = typeIndex !== directionIndex ? typeIndex : -1;
  const currencyIndices = headerIndices(headers, 'currency');
  // `State` is Revolut's status column, and a US address column elsewhere.
  // It is a status only when some row holds a status word.
  const statusCandidate = headerIndex(headers, HEADER_ALIASES.status);
  const statusIndex = statusCandidate >= 0 && headers[statusCandidate] === 'state' &&
      !records.slice(headerRow + 1).some((record) => STATUS_WORD.test(normalizedHeader(record[statusCandidate] ?? '')))
    ? -1
    : statusCandidate;
  const sourceAccountIndex = headerIndex(headers, HEADER_ALIASES.sourceAccount);
  const sourceCardIndex = headerIndex(headers, HEADER_ALIASES.sourceCard);
  const referenceIndex = headerIndex(headers, HEADER_ALIASES.reference);
  const splitColumns = debitIndex >= 0 && creditIndex >= 0;
  const directedAmount = amountIndex >= 0 && directionIndex >= 0;
  const signedAmount = amountIndex >= 0 && directionIndex < 0;
  if (dateIndex < 0 || descriptionIndex < 0 || (!splitColumns && !directedAmount && !signedAmount)) {
    throw new Error('unsupported_statement_format');
  }
  // Competing monetary/identity columns have no safe first-column default.
  // Several currency columns are allowed: each row must then name one
  // currency in all of them (ING Germany prints Währung beside both Saldo
  // and Betrag; BBVA prints Divisa twice).
  for (const role of ['debit', 'credit', 'amount', 'amountFallback', 'direction', 'sourceAccount', 'sourceCard', 'status'] as const) {
    if (headerIndices(headers, role).length > 1) throw new Error('unsupported_statement_format');
  }
  if (headerIndices(headers, 'direction').length === 0 && headerIndices(headers, 'transactionType').length > 1) {
    throw new Error('unsupported_statement_format');
  }
  // A money column that names its currency (`Amount (GBP)`, `Débit euros`)
  // must name the ledger's: those figures are never read as another currency.
  for (const index of [debitIndex, creditIndex, amountIndex]) {
    const stated = index >= 0 ? headerCells[index].currencies : null;
    if (stated && !stated.includes(defaultCurrency)) throw new Error('statement_currency_mismatch');
  }
  dataRecords = dataRecords.filter((record) => {
    if (record.length !== headers.length) return true;
    const candidate = record.map((cell) => headerKey(cell).key);
    if (candidate.every((cell, index) => cell === headers[index])) return false;
    if (headerIndex(candidate, HEADER_ALIASES.date) >= 0 &&
        headerIndex(candidate, HEADER_ALIASES.description) >= 0 &&
        (['debit', 'credit', 'amount'] as const).some((role) =>
          headerIndex(candidate, HEADER_ALIASES[role]) >= 0)) {
      throw new Error('unsupported_statement_format');
    }
    return !SUMMARY_DESCRIPTION.test((record[descriptionIndex] ?? '').trim());
  });
  const totalRows = dataRecords.length;
  // A source instrument column is useful only when the whole export identifies
  // one statement account/card. A varying column is transaction metadata, not
  // authority to route every row to a different local account.
  const columnInstrument = sourceAccountIndex >= 0 && sourceCardIndex >= 0
    ? null
    : sourceAccountIndex >= 0
      ? uniqueColumnInstrument(dataRecords, sourceAccountIndex, 'account')
      : uniqueColumnInstrument(dataRecords, sourceCardIndex, 'unknown');
  const dateOrder = inferDateOrder(dataRecords.map((record) => record[dateIndex] ?? ''), dateHint);
  const decimal = inferDecimalConvention(
    dataRecords.flatMap((record) => [debitIndex, creditIndex, amountIndex]
      .filter((index) => index >= 0)
      .map((index) => cellFigure(record[index] ?? ''))),
    defaultCurrency,
  );
  // Card exports carry their identity, when they carry it at all, in the
  // preamble above the table or in a card-number column name. A signed amount
  // column is then only a direction when the preamble says what a minus means.
  const preamble = records.slice(0, headerRow).map((record) => record.join(' ')).join('\n');
  assertStatementCurrency(preamble, defaultCurrency);
  // The statement's own account/card, from a labelled preamble line
  // ("Card Number,4567XXXXXXXX1234", "رقم الحساب,XXXX4455", an IBAN) when no
  // instrument column says it. Without it every row landed on the unassigned
  // holding and never met the same charge from an SMS, PDF or re-export.
  // Labelled numbers first; an IBAN only when nothing else names the account.
  const preambleIdentity = (iban: boolean): NonNullable<ParsedSms['card']> | null => {
    const found = new Map<string, NonNullable<ParsedSms['card']>>();
    for (const record of records.slice(0, headerRow)) {
      const line = record.filter((cell) => cell.trim()).join(' ');
      const instrument = statementInstrument(line, { iban }) ?? statementHeaderInstrument(line);
      if (instrument) found.set(`${instrument.kind === 'account' ? 'account' : 'card'}:${instrument.last4}`, instrument);
    }
    return found.size === 1 ? [...found.values()][0] : null;
  };
  const preambleInstrument = preambleIdentity(false) ?? preambleIdentity(true);
  const statedInstrument = columnInstrument ??
    (sourceAccountIndex < 0 && sourceCardIndex < 0 ? preambleInstrument : null);
  const bankHint = statementBankHint(preamble);
  const creditMarker = CARD_STATEMENT_MARKER.test(preamble);
  // Card-side payment wording in the rows themselves ("PAYMENT RECEIVED -
  // THANK YOU", "MOBILE PYMT", "AUTOPAY"): with a card-number column and no
  // account column, that is a card statement even with no preamble at all.
  const cardPaymentRows = dataRecords.some((record) =>
    CARD_PAYMENT_PHRASE.test(normalizeDigits(record[descriptionIndex] ?? '').normalize('NFKC')));
  const cardColumnOnly = sourceCardIndex >= 0 && sourceAccountIndex < 0;
  const cardHeader = CARD_EXPORT_HEADERS.some((name) => headers.includes(name));
  let cardEvidence = isCardStatement(preamble) || cardHeader ||
    (cardColumnOnly && (creditMarker || cardPaymentRows));
  const signEvidence = cardEvidence || (sourceAccountIndex < 0 && creditMarker);
  let convention = signConvention(signEvidence, preamble);
  // A payment-wallet export (PayPal, and its translations) prints Gross, Fee
  // and Net: money out carries a minus and money in is a plain figure.
  const walletExport = (headers.includes('gross') && headers.includes('net')) ||
    (headers.includes('brutto') && headers.includes('netto')) ||
    (headers.includes('avant commission') && headers.includes('net'));
  if (walletExport && convention === 'account' && !cardEvidence) convention = 'account-unsigned-credit';
  // A bare amount column with no stated legend: read the file's convention
  // from its own rows (see inferCsvSignConvention). An inferred card layout
  // proves the export is a card's.
  if ((signedAmount || directedAmount) && (convention === 'account' || convention === 'refuse')) {
    const inferred = inferCsvSignConvention(dataRecords, {
      amountIndex, descriptionIndex, directionIndex, headers, currency: defaultCurrency, decimal,
      cardStatement: signEvidence,
      accountLabelled: sourceAccountIndex >= 0 || statedInstrument?.kind === 'account',
      ownAccountColumn: columnInstrument?.kind === 'account' && OWN_ACCOUNT_HEADERS.has(headers[sourceAccountIndex]) &&
        dataRecords.every((record) => record.length !== headers.length || maskedTail(record[sourceAccountIndex] ?? '') !== null),
    });
    if (inferred) {
      convention = inferred;
      if (inferred !== 'account-unsigned-credit') cardEvidence = true;
    } else if (convention === 'account' && cardShapedSigns(dataRecords, {
      amountIndex, descriptionIndex, directionIndex, headers, currency: defaultCurrency, decimal,
    })) {
      // Both an account and a card reading fit (see cardShapedSigns), so
      // neither is taken: the bare signs are refused exactly like an
      // unexplained card statement's.
      convention = 'refuse';
    }
  }
  const creditCard = cardEvidence && (creditMarker || cardPaymentRows ||
    cardHeader || convention === 'minus-credit' || convention === 'minus-debit');
  // A card export's own header or preamble (a cardholder column, "credit card
  // statement") proves its "Account Number" is the CARD account's number.
  const provenCardFile = isCardStatement(preamble) ||
    (cardHeader && (creditMarker || cardPaymentRows || convention === 'minus-credit' || convention === 'minus-debit'));
  const asCredit = (instrument: ParsedSms['card']): ParsedSms['card'] =>
    instrument?.kind === 'unknown' && creditCard ? { last4: instrument.last4, kind: 'credit' }
      : instrument?.kind === 'account' && provenCardFile
        ? { last4: instrument.last4, kind: creditCard ? 'credit' : 'unknown' }
        : instrument;
  const sourceInstrument = asCredit(statedInstrument);

  // A sign that only repeats its column: EVERY figure in the debit column
  // carries a minus (Postbank and Deutsche Bank Soll, Mashreq, Fineco
  // Uscite), or every figure in the credit column a plus (Mashreq). Then the
  // sign is the column's convention and agrees with it. A minus on just some
  // debit rows is a reversal or refund written as a negative debit, and a
  // minus in a credit column (Citi) contradicts it; both stay refused. A sign
  // never overrides a named column.
  // At least three figures, none of them described as a reversal, so a
  // column holding only a storno or two is not mistaken for a convention.
  // Once one column proves its convention that way, the other column's
  // mirrored sign (a + on every credit beside a - on every debit, Mashreq)
  // needs only one clean figure: a month can carry a single salary credit.
  const signedColumn = (index: number, sign: 'expense' | 'income'): number => {
    let seen = 0;
    for (const record of dataRecords) {
      if (record.length !== headers.length) continue;
      const cell = record[index] ?? '';
      if (/^(?:|--?|N\/?A|0+(?:[.,]0{1,3})?)$/i.test(normalizeDigits(cell).normalize('NFKC').trim())) continue;
      const signed = amountMinor(cell, defaultCurrency, true, decimal);
      if (signed === null || (signed < 0 ? 'expense' : 'income') !== sign) return 0;
      if (REVERSAL_WORDING.test(normalizeDigits(record[descriptionIndex] ?? '').normalize('NFKC'))) return 0;
      seen += 1;
    }
    return seen;
  };
  const debitSigned = splitColumns ? signedColumn(debitIndex, 'expense') : 0;
  const creditSigned = splitColumns ? signedColumn(creditIndex, 'income') : 0;
  const debitRepeatsMinus = debitSigned >= 3 || (debitSigned >= 1 && creditSigned >= 3);
  const creditRepeatsPlus = creditSigned >= 3 || (creditSigned >= 1 && debitSigned >= 3);

  // A Debit/Credit flag column beside a signed amount that EVERY signed row
  // contradicts (at least two, none agreeing): the amount is signed the
  // card's way and the flag, the file's explicit word, is the direction.
  // Only an explicit indicator column ("Debit/Credit Flag", "Credit Debit
  // Indicator") and never beside a balance, whose Dr/Cr may be its polarity.
  const explicitFlag = directionIndex >= 0 && /^(?:debit credit flag|credit debit flag|dr cr flag|credit debit indicator)$/.test(headers[directionIndex]) &&
    !headers.some((header) => BALANCE_HEADER.test(header));
  const flagOverridesSign = directedAmount && explicitFlag && (() => {
    let disagree = 0;
    for (const record of dataRecords) {
      if (record.length !== headers.length) continue;
      const labelled = rowDirection(record[directionIndex] ?? '');
      const signed = amountMinor(record[amountIndex] ?? '', defaultCurrency, true, decimal);
      if (!labelled || signed === null) continue;
      if ((signed < 0 ? 'expense' : 'income') === labelled) return false;
      disagree += 1;
    }
    return disagree >= 2;
  })();
  const rows: StatementParsedRow[] = [];
  let rejectedRows = 0;
  let ambiguousCardSignRows = 0;
  let ambiguousDateRows = 0;
  // One running-balance column, for the statement's closing balance below.
  const balanceColumns = headers.map((header, index) => (BALANCE_HEADER.test(header) &&
    !/\b(?:available|disponible|verfugbar|verfügbar|opening|closing|start|end)\b/.test(header) ? index : -1))
    .filter((index) => index >= 0 && ![debitIndex, creditIndex, amountIndex].includes(index));
  const balanceIndex = balanceColumns.length === 1 ? balanceColumns[0] : -1;
  // A fee or tax printed in its own column beside the amount (brokers,
  // neobanks): the amount alone is then not the cash that moved, and the
  // exports disagree on whether the fee is already inside it.
  // A net or total amount (PayPal Net, Cash App Net Amount, Venmo Amount
  // (total)) already includes it.
  const inclusiveAmount = amountIndex >= 0 && /^(?:net|netto|net amount|amount total)$/.test(headers[amountIndex]);
  const feeColumns = inclusiveAmount ? [] : headers.map((header, index) => (FEE_HEADER.test(header) ? index : -1))
    .filter((index) => index >= 0 && ![debitIndex, creditIndex, amountIndex, balanceIndex].includes(index));
  /** Per accepted row (same index as rows): its signed movement and stated balance. */
  const chain: { signed: number; balance: number | null }[] = [];
  for (const record of dataRecords) {
    if (record.length !== headers.length) {
      rejectedRows += 1;
      continue;
    }
    // An export may include authorisations, rejected requests and cancelled
    // entries beside posted transactions. Explicit status must establish a
    // completed posting; absent status keeps the supported legacy format.
    if (statusIndex >= 0 && !POSTED_STATUS.test(
      normalizedHeader(record[statusIndex] ?? ''),
    )) {
      rejectedRows += 1;
      continue;
    }
    const date = isoDate(record[dateIndex] ?? '', dateOrder);
    const description = record[descriptionIndex] ?? '';
    // Tabs and line breaks inside a quoted cell are whitespace (Barclays pads
    // its Memo with tabs; Crédit Agricole wraps its Libellé); every other
    // control or bidi-override character is not text a title may carry.
    const unsafeDescription = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(description);
    const merchant = description.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const rowCurrencies = currencyIndices.map((index) => statementCurrency(record[index] ?? ''));
    const currency: StatementCurrency | null = rowCurrencies.length === 0
      ? defaultCurrency
      : rowCurrencies.every((value) => value !== null && value === rowCurrencies[0]) ? rowCurrencies[0] : null;
    let type: 'expense' | 'income' | null = null;
    let minor: number | null = null;
    if (currency === defaultCurrency && splitColumns) {
      // A signed cell is read only where its whole column prints that sign
      // (see signedColumn above); anywhere else it stays a contradiction.
      const columnMinor = (cell: string, repeatsSign: boolean): number | null => {
        const plain = amountMinor(cell, currency, false, decimal);
        if (plain !== null || !repeatsSign) return plain;
        const signed = amountMinor(cell, currency, true, decimal);
        return signed === null ? null : Math.abs(signed);
      };
      const debit = columnMinor(record[debitIndex] ?? '', debitRepeatsMinus);
      const credit = columnMinor(record[creditIndex] ?? '', creditRepeatsPlus);
      // A failed parse is not an empty cell: foreign amounts, bad precision,
      // signs or corrupt data on the other side make the row contradictory.
      const emptyMoney = (cell: string) => /^(?:|--?|N\/?A|0+(?:[.,]0{1,3})?)$/i.test(
        normalizeDigits(cell).normalize('NFKC').trim(),
      );
      if ((debit !== null && emptyMoney(record[creditIndex] ?? '')) ||
          (credit !== null && emptyMoney(record[debitIndex] ?? ''))) {
        type = debit === null ? 'income' : 'expense';
        minor = debit ?? credit;
      }
    } else if (currency === defaultCurrency && directedAmount) {
      // A `Type` column often carries the channel (POS, ATM, TRF) rather than
      // the direction. When the cell says nothing about direction but the
      // amount carries a sign, the sign is the explicit marker; when both
      // speak and disagree, neither is trusted.
      const labelled = rowDirection(record[directionIndex] ?? '');
      const typeLabel = secondTypeIndex >= 0 ? rowDirection(record[secondTypeIndex] ?? '') : null;
      const unsignedMinor = amountMinor(record[amountIndex] ?? '', currency, false, decimal);
      const signedMinor = unsignedMinor === null
        ? amountMinor(record[amountIndex] ?? '', currency, true, decimal)
        : null;
      const signedType = signedMinor === null
        ? null
        : directionFromSign(signedMinor < 0 ? '-' : '+', convention);
      if (!labelled && signedMinor !== null && convention === 'refuse') ambiguousCardSignRows += 1;
      // A plain figure has a direction only under a convention that gives it
      // one: a stated card legend or one inferred from the file's own rows.
      const plainType = !labelled && unsignedMinor !== null && PLAIN_FIGURE_CONVENTIONS.has(convention)
        ? directionFromSign(null, convention)
        : null;
      if (flagOverridesSign && labelled && (!typeLabel || typeLabel === labelled)) {
        type = labelled;
        minor = unsignedMinor ?? (signedMinor === null ? null : Math.abs(signedMinor));
      } else if ((labelled && signedType && labelled !== signedType) || (labelled && typeLabel && labelled !== typeLabel)) {
        type = null;
      } else {
        type = labelled ?? signedType ?? plainType;
        minor = unsignedMinor ?? (signedMinor === null ? null : Math.abs(signedMinor));
      }
    } else if (currency === defaultCurrency && signedAmount) {
      const signedMinor = amountMinor(record[amountIndex] ?? '', currency, true, decimal);
      // A stated card convention also gives a plain figure its meaning; the
      // account convention and an unstated card one never do.
      const plainMinor = signedMinor === null && PLAIN_FIGURE_CONVENTIONS.has(convention)
        ? amountMinor(record[amountIndex] ?? '', currency, false, decimal)
        : null;
      if (signedMinor !== null) {
        type = directionFromSign(signedMinor < 0 ? '-' : '+', convention);
        minor = type ? Math.abs(signedMinor) : null;
        if (convention === 'refuse') ambiguousCardSignRows += 1;
      } else if (plainMinor !== null) {
        type = directionFromSign(null, convention);
        minor = plainMinor;
      } else if (convention === 'refuse' && amountMinor(record[amountIndex] ?? '', currency, false, decimal) !== null) {
        ambiguousCardSignRows += 1;
      }
    }
    const separateFee = feeColumns.some((index) => {
      const cell = record[index] ?? '';
      return (amountMinor(cell, defaultCurrency, false, decimal) ?? amountMinor(cell, defaultCurrency, true, decimal)) !== null;
    });
    if (
      !date || unsafeDescription || merchant.length < 2 || merchant.length > 180 ||
      !type || !minor || separateFee
    ) {
      if (!date && dateOrder === 'unknown' && ambiguousLocalDate(record[dateIndex] ?? '')) {
        ambiguousDateRows += 1;
      }
      rejectedRows += 1;
      continue;
    }
    const classification = statementMerchantClassification(
      merchant,
      type,
      defaultCurrency === 'AED' ? 'AE' : defaultCurrency === 'SAR' ? 'SA' : null,
    );
    const reference = referenceIndex >= 0
      ? safeStatementReference(record[referenceIndex] ?? '')
      : referenceFromDescription(merchant);
    const rowAccountTail = sourceAccountIndex >= 0 ? maskedTail(record[sourceAccountIndex] ?? '') : null;
    const rowCardTail = sourceCardIndex >= 0 ? maskedTail(record[sourceCardIndex] ?? '') : null;
    const rowInstrument: ParsedSms['card'] = rowCardTail
      ? asCredit({ last4: rowCardTail, kind: 'unknown' })
      : rowAccountTail
        ? asCredit({ last4: rowAccountTail, kind: 'account' })
        : null;
    // Only an exact Payment type: Sale, Return, Fee and Adjustment rows keep
    // their own meaning, and a description naming fees, interest or a refund
    // still never reads as a settlement (CARD_SETTLEMENT_EXCLUSION).
    const typeSaysPayment = typeIndex >= 0 && CARD_PAYMENT_TYPE.test(normalizedHeader(record[typeIndex] ?? ''));
    const settlement = statementCardSettlement(
      merchant, type, cardEvidence, rowInstrument ?? sourceInstrument, undefined, typeSaysPayment,
    );
    chain.push({
      signed: type === 'income' ? minor : -minor,
      balance: balanceIndex >= 0
        ? amountMinor(record[balanceIndex] ?? '', defaultCurrency, false, decimal) ??
          amountMinor(record[balanceIndex] ?? '', defaultCurrency, true, decimal)
        : null,
    });
    if (settlement) {
      rows.push({
        amountFils: minor, currency: defaultCurrency, date,
        dueDay: null, minDueFils: null, reference,
        ...(bankHint ? { bankHint } : {}),
        snapshotFils: null, snapshotKind: null,
        ...settlement,
        raw: record.join(delimiter),
      });
      continue;
    }
    const transfer = statementTransferMeaning(
      merchant,
      type,
      defaultCurrency,
      sourceInstrument,
      reference,
    );
    rows.push({
      kind: 'transaction', type, amountFils: minor, currency: defaultCurrency,
      merchant: transfer?.merchant ?? relayTitle(classification.merchant), date,
      dueDay: null, minDueFils: null, card: rowInstrument ?? sourceInstrument, reference,
      transferHint: transfer?.transferHint ?? false,
      ...(bankHint ? { bankHint } : {}),
      snapshotFils: null, snapshotKind: null,
      categoryGuess: transfer ? 'other' : classification.categoryGuess,
      categoryDeliberate: transfer ? true : classification.categoryDeliberate,
      ...(transfer?.transferEvidence ? { transferEvidence: transfer.transferEvidence } : {}),
      raw: record.join(delimiter),
    });
  }
  // The closing running balance of a fully read account statement, as the
  // account's balance on its last date. Exports print oldest-first or newest-
  // first; the balances themselves must prove which (every step equal to its
  // row's movement in exactly one order), and the closing row is then the
  // last or the first. A card export's running figure is what is owed, so
  // it is never sent as an account balance.
  const closing = !cardEvidence && balanceIndex >= 0 && rejectedRows === 0 && rows.length >= 2 &&
    chain.length === rows.length && chain.every((link) => link.balance !== null)
    ? (() => {
      const steps = (from: number, to: number, signedAt: number) => chain[to].balance! - chain[from].balance! === chain[signedAt].signed;
      const ascending = chain.every((_, i) => i === 0 || steps(i - 1, i, i));
      const descending = chain.every((_, i) => i === chain.length - 1 || steps(i + 1, i, i));
      return ascending === descending ? -1 : ascending ? chain.length - 1 : 0;
    })()
    : -1;
  const closingRow = closing >= 0 ? rows[closing] : undefined;
  if (closingRow && closingRow.kind === 'transaction' && closingRow.card?.kind !== 'credit' &&
      Number.isSafeInteger(chain[closing].balance) && chain[closing].balance! >= 0) {
    closingRow.snapshotFils = chain[closing].balance!;
    closingRow.snapshotKind = 'balance';
  }
  // The preamble's own summary (total, minimum, due date) beside the rows.
  const summary = cardEvidence && rows.length > 0 && totalRows < Math.min(maxRows, STATEMENT_ROW_CEILING)
    ? cardStatementSummary(preamble, defaultCurrency, dateOrder, sourceInstrument, bankHint)
    : null;
  if (summary) rows.push({ ...summary, raw: 'statement summary' });
  return { rows, totalRows: totalRows + (summary ? 1 : 0), rejectedRows, ambiguousCardSignRows, ambiguousDateRows };
}

type DateOrder = 'day-first' | 'month-first' | 'unknown';

/**
 * How the user's country writes a bare numeric date, as the app sends it
 * (`x-wafra-date-order`, or stored with the email forwarding address). Null
 * means the country is unknown or does not settle it.
 */
export type StatementDateHint = 'day-first' | 'month-first' | null;

/**
 * The hint for a caller that sent none: a client that predates the header,
 * or an email address minted before its country was recorded. Those ledgers
 * could only ever be AED or SAR for a numeric date to be read, and both are
 * day-first; anything else stays undecided. This is the launch behaviour,
 * kept byte-for-byte for those callers.
 */
export function legacyStatementDateHint(currency: StatementCurrency): StatementDateHint {
  return currency === 'AED' || currency === 'SAR' ? 'day-first' : null;
}

/** Parse a hint from a header or stored column; undefined when it is not one. */
export function statementDateHintFrom(value: unknown): StatementDateHint | undefined {
  if (value === 'day-first' || value === 'month-first') return value;
  if (value === 'unknown') return null;
  return undefined;
}

const LOCAL_NUMERIC_DATE = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/;

/**
 * A date cell without the clock time some exports append
 * (`02/09/2026 09:15:00` ADCB, `2026-09-02 09:00:00` Revolut,
 * `2026-09-30T17:43:43` comdirect). Only a colon-separated time is removed;
 * the date before it is read exactly as it would be alone.
 */
function dateCellText(value: string): string {
  return normalizeDigits(value).normalize('NFC').replace(/\s+/g, ' ').trim()
    .replace(/(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?: ?[AaPp][Mm])?(?:Z|[+-]\d{2}:?\d{2})?)$/, '');
}

/**
 * Decide how a file's numeric dates read. A first field above 12 can only be
 * a day; a second field above 12 can only be a month-first export. File
 * evidence always wins over the country. Contradictory evidence leaves the
 * order unknown: individually unambiguous dates can still be read, but the
 * country cannot resolve a file that contradicts itself. With no evidence the
 * country decides; with no country the order is `unknown` and isoDate refuses every date whose day and
 * month could swap.
 */
function inferDateOrder(values: Iterable<string>, hint: StatementDateHint): DateOrder {
  let dayFirst = false;
  let monthFirst = false;
  for (const value of values) {
    const local = LOCAL_NUMERIC_DATE.exec(dateCellText(value));
    if (!local) continue;
    if (Number(local[1]) > 12) dayFirst = true;
    if (Number(local[2]) > 12) monthFirst = true;
  }
  if (monthFirst && !dayFirst) return 'month-first';
  if (dayFirst && !monthFirst) return 'day-first';
  if (dayFirst && monthFirst) return 'unknown';
  return hint ?? 'unknown';
}

/** A numeric date whose day and month are both ≤ 12 and differ. */
function ambiguousLocalDate(value: string): boolean {
  const local = LOCAL_NUMERIC_DATE.exec(dateCellText(value));
  if (!local) return false;
  const first = Number(local[1]);
  const second = Number(local[2]);
  return first <= 12 && second <= 12 && first !== second;
}

const NAMED_DAY_FIRST_DATE = new RegExp(`^(\\d{1,2})(?:er|\\.)?[\\s-](${MONTH_NAME})\\.?[\\s-](\\d{2,4})$`, 'i');
const NAMED_DE_DATE = new RegExp(`^(\\d{1,2})\\s+de\\s+(${MONTH_NAME})\\.?\\s+(?:de\\s+)?(\\d{4})$`, 'i');
const NAMED_MONTH_FIRST_DATE = new RegExp(`^(${ENGLISH_MONTH_NAME})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})$`, 'i');

function isoDate(value: string, order: DateOrder = 'day-first'): string | null {
  value = dateCellText(value);
  let year: number;
  let month: number;
  let day: number;
  // Year-first is unambiguous in any country: ISO, `2026/09/01` and
  // `2026.09.01` (South African, Al Rajhi, Colombian exports), and the
  // compact `20260901` Dutch exports print (checked as a real date below).
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) ??
    /^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/.exec(value) ??
    /^((?:19|20)\d{2})(\d{2})(\d{2})$/.exec(value);
  const named = NAMED_DAY_FIRST_DATE.exec(value) ?? NAMED_DE_DATE.exec(value);
  const monthFirstNamed = named ? null : NAMED_MONTH_FIRST_DATE.exec(value);
  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
  } else if (named || monthFirstNamed) {
    const [dayText, monthText, yearText] = named
      ? [named[1], named[2], named[3]]
      : [monthFirstNamed![2], monthFirstNamed![1], monthFirstNamed![3]];
    const index = MONTH_INDEX.get(foldMonth(monthText));
    if (!index) return null;
    day = Number(dayText); month = index; year = Number(yearText);
    if (year < 100) year += 2000;
  } else {
    const local = LOCAL_NUMERIC_DATE.exec(value);
    if (!local) return null;
    if (order === 'unknown' && ambiguousLocalDate(value)) return null;
    if (order === 'month-first' || (order === 'unknown' && Number(local[2]) > 12)) {
      month = Number(local[1]); day = Number(local[2]);
    } else {
      day = Number(local[1]); month = Number(local[2]);
    }
    year = Number(local[3]);
    if (year < 100) year += 2000;
  }
  // A four-digit year in the 14th–15th Hijri century is an Umm al-Qura date
  // (Saudi statements print them): read as the Gregorian day it names.
  if (year >= 1400 && year <= 1500) return hijriToIsoDate(year, month, day);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 2000 || year > 2100 || date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

let hijriFormat: Intl.DateTimeFormat | null | undefined;
/**
 * The Gregorian ISO day of an Umm al-Qura (Saudi civil) Hijri date, found by
 * formatting candidate days in that calendar until one names exactly this
 * year, month and day. Null for a date that does not exist, or where the
 * runtime has no Umm al-Qura calendar — never an approximation.
 */
function hijriToIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 30) return null;
  if (hijriFormat === undefined) {
    try {
      hijriFormat = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn',
        { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
      if (hijriFormat.resolvedOptions().calendar !== 'islamic-umalqura') hijriFormat = null;
    } catch {
      hijriFormat = null;
    }
  }
  if (!hijriFormat) return null;
  // Mean Hijri year/month lengths put the estimate within a day or two.
  const estimate = Date.UTC(622, 6, 19) + Math.round((year - 1) * 354.36667 + (month - 1) * 29.5306 + (day - 1)) * 86_400_000;
  for (let offset = -6; offset <= 6; offset += 1) {
    const candidate = new Date(estimate + offset * 86_400_000);
    const parts = Object.fromEntries(hijriFormat.formatToParts(candidate).map((part) => [part.type, part.value]));
    if (Number(parts.year) === year && Number(parts.month) === month && Number(parts.day) === day) {
      const iso = candidate.toISOString().slice(0, 10);
      const gregorianYear = candidate.getUTCFullYear();
      return gregorianYear >= 2000 && gregorianYear <= 2100 ? iso : null;
    }
  }
  return null;
}

/**
 * A row date printed without its year, at the start of a line: US `09/01`,
 * UK `1 Sep`, `Sep 1`. Chase, Bank of America, Wells Fargo, Barclays, HSBC UK
 * and Lloyds PDFs print every row this way and state the year once, in the
 * statement period. The numeric form is slashed, dashed or dotted, but a
 * dotted pair (`5.09 1,977.18`) is as likely two figures as a date and
 * counts only with words after it, and no date has a zero day or month.
 * Only English month names, the languages whose statements print yearless
 * rows. Never a line that already leads with a full date.
 */
const YEARLESS_NUMERIC_LEAD = /^(\d{1,2})([/.-])(\d{1,2})(?=\s+\S)/;
const YEARLESS_DAY_MONTH_LEAD = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?[\\s-](${ENGLISH_MONTH_NAME})\\.?(?=\\s+\\S)`, 'i');
const YEARLESS_MONTH_DAY_LEAD = new RegExp(`^(${ENGLISH_MONTH_NAME})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?=\\s+\\S)`, 'i');

type YearlessDate =
  | { length: number; month: number; day: number }
  | { length: number; first: number; second: number };

function yearlessLead(line: string): YearlessDate | null {
  // A full numeric date has a third field, which the lookahead refuses.
  const numeric = YEARLESS_NUMERIC_LEAD.exec(line);
  if (numeric) {
    const [first, second] = [Number(numeric[1]), Number(numeric[3])];
    const dayMonth = first > 0 && second > 0 && ((first <= 31 && second <= 12) || (first <= 12 && second <= 31));
    if (!dayMonth || (numeric[2] === '.' && !/\p{L}/u.test(line.slice(numeric[0].length)))) return null;
    return { length: numeric[0].length, first, second };
  }
  const dayMonth = YEARLESS_DAY_MONTH_LEAD.exec(line);
  const monthDay = dayMonth ? null : YEARLESS_MONTH_DAY_LEAD.exec(line);
  // `1 Sep 2026 …` matches `1 Sep` too: a line that already leads with a
  // full date is not yearless.
  if ((!dayMonth && !monthDay) || DATE_LED_LINE.test(line)) return null;
  const named = dayMonth
    ? { length: dayMonth[0].length, monthText: dayMonth[2], day: Number(dayMonth[1]) }
    : monthDay ? { length: monthDay[0].length, monthText: monthDay[1], day: Number(monthDay[2]) } : null;
  const month = named ? MONTH_INDEX.get(foldMonth(named.monthText)) : undefined;
  return named && month ? { length: named.length, month, day: named.day } : null;
}

/** Month and day of a yearless date, read the way isoDate reads a numeric one. */
function yearlessMonthDay(date: YearlessDate, order: DateOrder): { month: number; day: number } | 'ambiguous' {
  if ('month' in date) return { month: date.month, day: date.day };
  const { first, second } = date;
  if (order === 'month-first' || (order === 'unknown' && second > 12)) return { month: first, day: second };
  if (order === 'day-first' || (order === 'unknown' && first > 12)) return { month: second, day: first };
  return first === second ? { month: first, day: second } : 'ambiguous';
}

/**
 * An explicit statement-period line: a short label (or none) and two dates
 * joined by a range word, and nothing else on the line.
 *
 *   `September 01, 2026 through September 30, 2026`         (Chase)
 *   `1 September 2026 - 30 September 2026`, `1 Sep - 30 Sep 2026`   (UK)
 *   `Opening/Closing Date 08/28/26 - 09/27/26`              (US card)
 *   `Statement period: From 11 August 26 to 10 September 26`
 *
 * The start may omit its year when the end states it; nothing else may.
 */
const PERIOD_LABEL = String.raw`(?:(?:statement|billing)\s+(?:period|cycle|dates?)|period(?:\s+covered)?|opening\s*\/\s*closing\s+dates?|for\s+the\s+period(?:\s+of)?|statement\s+(?:from|for))`;
const PERIOD_YEARLESS_START = String.raw`\d{1,2}(?:st|nd|rd|th)?\s+${ENGLISH_MONTH_NAME}\.?|${ENGLISH_MONTH_NAME}\.?\s+\d{1,2}(?:st|nd|rd|th)?`;
const STATEMENT_PERIOD_LINE = new RegExp(
  String.raw`^(?:${PERIOD_LABEL}\s*:?\s*)?(?:from\s*:?\s*)?(${DATE_TOKEN}|${PERIOD_YEARLESS_START}),?\s*(?:-|–|—|to|through|thru|until|till)\s*:?\s*(${DATE_TOKEN})\.?$`,
  'i',
);

/** The ISO date when it is a real calendar date within `[start, end]` (both inclusive), else null. */
function dateWithinPeriod(
  year: number, month: number, day: number, period: { start: string; end: string },
): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return iso >= period.start && iso <= period.end ? iso : null;
}

interface YearlessFill {
  text: string;
  /** How the file's numeric dates read, yearless ones included. */
  order: DateOrder;
  /** The one statement period the file states, when it states exactly one. */
  period: { start: string; end: string } | null;
  /**
   * Whether the file prints its rows without a year: it has yearless money
   * lines and no full-dated one. Only then are yearless lines rows (dated,
   * counted, never another row's continuation); in a file whose rows carry
   * full dates they are read exactly as before (see fillYearlessRowDates).
   */
  rows: boolean;
}

/**
 * Give yearless row dates their year, from the statement's own period and
 * nothing else.
 *
 * A row's year is written in only when the file states exactly one period,
 * that period runs forward for at most twelve months, and exactly one year
 * puts the row's month and day inside it (a December-to-January period gives
 * December rows the first year and January rows the second). The row is then
 * rewritten to lead with an ISO date, which every reader below already takes
 * as unambiguous. Any other yearless row is left as it was, and the row loop
 * counts it as rejected: `dates_without_year` when no period settles it,
 * `ambiguous_dates` when only the day/month order is missing.
 *
 * Only in a file that prints no full-dated money row. A statement prints its
 * rows one way; in a full-dated one, a yearless-led money line (`1 Sep - 30 Sep
 * 9.99`, `12/09 004512 250.00`) is a wrapped description's continuation or a
 * side table, and dating it would make a row of it.
 */
function fillYearlessRowDates(text: string, dateHint: StatementDateHint): YearlessFill {
  const lines = text.split('\n');
  const flat = lines.map((line) => line.replace(/\s+/g, ' ').trim());
  // Only a line carrying money is a row to date, as the row loop counts
  // them: a yearless heading or note is left as printed.
  const rowLead = (line: string): YearlessDate | null => LOOKS_LIKE_MONEY_LINE.test(line) ? yearlessLead(line) : null;
  // Most statements print full dates: nothing below runs for them.
  const none: YearlessFill = { text, order: 'unknown', period: null, rows: false };
  if (!flat.some((line) => rowLead(line))) return none;
  const periodLines = flat.map((line) => line.length <= 120 ? STATEMENT_PERIOD_LINE.exec(line) : null);
  // `1 Sep - 30 Sep 2026` leads with a yearless date too, and is the period.
  const leads = flat.map((line, index) => periodLines[index] ? null : rowLead(line));
  if (!leads.some(Boolean)) return none;
  const fullDatedRow = flat.some((line, index) => {
    const prefixed = periodLines[index] ? null : ROW_DATE_PREFIX.exec(line);
    return prefixed !== null && !SUMMARY_DESCRIPTION.test(prefixed[2]) && LOOKS_LIKE_MONEY_LINE.test(line);
  });
  if (fullDatedRow) return none;
  const periodMatches = periodLines.filter((match): match is RegExpExecArray => match !== null);
  // The order is the file's: its full row dates, its period, its yearless
  // rows (as stand-ins carrying only their two fields), then the country.
  const order = inferDateOrder([
    ...flat.map((line) => ROW_DATE_PREFIX.exec(line)?.[1] ?? ''),
    ...periodMatches.flatMap((match) => [match[1], match[2]]),
    ...leads.flatMap((lead) => lead && 'first' in lead ? [`${lead.first}/${lead.second}/2000`] : []),
  ], dateHint);
  const periods = new Set<string>();
  for (const match of periodMatches) {
    // A Hijri period (`01/03/1448 - 30/03/1448`) is read as its Gregorian
    // days, but a yearless row beside it names a Hijri day and month, which
    // no Gregorian year fits: such a period settles nothing.
    const end = /\b(?:14\d\d|1500)\b/.test(`${match[1]} ${match[2]}`) ? null : isoDate(match[2], order);
    if (!end) {
      periods.add('unreadable');
      continue;
    }
    let start = isoDate(match[1], order);
    const yearless = start ? null : yearlessLead(`${match[1]} -`);
    if (!start && yearless && 'month' in yearless) {
      // `1 Sep - 30 Sep 2026`: the start's year is the end's, or the one
      // before when its month and day come later in the year.
      const endYear = Number(end.slice(0, 4));
      const monthDay = `${String(yearless.month).padStart(2, '0')}-${String(yearless.day).padStart(2, '0')}`;
      const year = monthDay <= end.slice(5) ? endYear : endYear - 1;
      start = dateWithinPeriod(year, yearless.month, yearless.day, { start: '0000-01-01', end });
    }
    periods.add(start ? `${start}|${end}` : 'unreadable');
  }
  const stated = periods.size === 1 ? [...periods][0] : null;
  if (!stated || stated === 'unreadable') return { text, order, period: null, rows: true };
  const [start, end] = stated.split('|');
  // Forward, and twelve months at most: a longer range can hold the same
  // month and day twice.
  if (start > end || end > `${Number(start.slice(0, 4)) + 1}${start.slice(4)}`) return { text, order, period: null, rows: true };
  const period = { start, end };
  const yearFor = (lead: YearlessDate): string | null => {
    const monthDay = yearlessMonthDay(lead, order);
    if (monthDay === 'ambiguous') return null;
    const fits: string[] = [];
    for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year += 1) {
      const iso = dateWithinPeriod(year, monthDay.month, monthDay.day, period);
      if (iso) fits.push(iso);
    }
    return fits.length === 1 ? fits[0] : null;
  };
  const filled = lines.map((original, index) => {
    const lead = leads[index];
    if (!lead) return original;
    const first = yearFor(lead);
    if (!first) return original;
    let rest = flat[index].slice(lead.length).trim();
    // A posting date after the transaction date is filled the same way, or
    // the row is left whole: never half a rewrite.
    const second = yearlessLead(rest);
    if (second) {
      const posted = yearFor(second);
      if (!posted) return original;
      rest = `${posted} ${rest.slice(second.length).trim()}`;
    }
    return `${first} ${rest}`;
  });
  return { text: filled.join('\n'), order, period, rows: true };
}

type ColumnOrder = 'debit-first' | 'credit-first' | 'unknown';

/**
 * Which of the two money columns comes first in this statement's table. Gulf
 * statements print Debit before Credit almost without exception; the header
 * line is checked anyway so the rare Credit | Debit layout is not read inverted.
 */
function statementColumnOrder(text: string): ColumnOrder {
  const orders = columnOrderEvidence(text);
  return orders.size > 1 ? 'unknown' : [...orders][0] ?? 'debit-first';
}

/** The column orders the document's own table headers state (empty when none does). */
function columnOrderEvidence(text: string): Set<ColumnOrder> {
  const orders = new Set<ColumnOrder>();
  for (const original of text.split(/\n+/)) {
    const line = original.replace(/\s+/g, ' ').trim();
    // Only a table header counts. A header is a short run of column names —
    // date, a debit word, a credit word and at least one more column such as
    // balance or description — not a sentence. Prose in the preamble
    // ("Credits are listed before debits for each transaction date …") names
    // all three words too, and reading it as the header would invert every
    // sign in the file, so anything sentence-length or missing a fourth
    // column name is skipped and the Gulf default stands.
    if (!line || line.length > 120 || line.split(' ').length > 12 || DATE_LED_LINE.test(line)) continue;
    if (!/\bdate\b|تاريخ/iu.test(line) || /\b(?:credit|debit)\s+card\b|\bdirect\s+debit\b/i.test(line)) continue;
    if (!/\b(?:balance|description|details|particulars|narration|narrative|amount|reference)\b|الرصيد|البيان|التفاصيل|الوصف/iu.test(line)) continue;
    const debit = line.search(/\b(?:debits?|withdrawals?|paid out)\b|مدين|سحب/iu);
    const credit = line.search(/\b(?:credits?|deposits?|paid in)\b|دائن|إيداع/iu);
    if (debit < 0 || credit < 0) continue;
    orders.add(credit < debit ? 'credit-first' : 'debit-first');
  }
  return orders;
}

type MoneyToken =
  | { kind: 'placeholder' }
  | { kind: 'unsigned'; minor: number }
  | { kind: 'signed'; minor: number; type: 'expense' | 'income' };

function classifyMoneyToken(token: string, currency: StatementCurrency): MoneyToken | null {
  if (MONEY_PLACEHOLDER.test(token)) return { kind: 'placeholder' };
  const spec = ledgerMoneySpec(currency);
  if (!spec) return null;
  // Flattened PDF rows lose column boundaries. For decimal currencies, a bare
  // integer at the tail is more likely a cheque/reference number than money;
  // preserve the old conservative requirement for a decimal point. Zero-decimal
  // ledgers (JPY/KRW/etc.) necessarily use whole-unit money and are the exception.
  const numericSurface = token.replace(/[()\sA-Za-z+\-]/g, '');
  if (spec.exponent > 0 && !numericSurface.includes('.')) return null;
  // `00012345678.00` is a zero-padded reference a wrapped description carries
  // onto its own line, not money: no amount is printed with leading zeros.
  if (/^0\d/.test(numericSurface)) return null;
  const unsigned = amountMinor(token, currency, false);
  if (unsigned !== null) return { kind: 'unsigned', minor: unsigned };
  const signed = amountMinor(token, currency, true);
  return signed === null
    ? null
    : { kind: 'signed', minor: Math.abs(signed), type: signed < 0 ? 'expense' : 'income' };
}

/**
 * Read the money columns off the end of a flattened statement row without
 * guessing. Accepted shapes, after the description:
 *   signed [balance]             — `-125.00`, `125.00-`, `(125.00)`, `+125.00`
 *   debit credit [balance]       — one of the two populated, the other an
 *                                  empty-cell placeholder (`-`, `0.00`)
 * Anything else — a lone unsigned amount, both columns populated, a sign that
 * is not on the first money token, a currency that is not the statement's —
 * is left for the caller to count as rejected rather than read a direction in.
 */
/**
 * Whether this is a credit-card statement rather than an account statement.
 *
 * It matters because the two have opposite defaults. On an account statement an
 * unlabelled figure could be either direction, so `parseColumnTail` is right to
 * refuse it. A card statement lists charges and marks the exceptions: every
 * payment, refund and cashback carries CR, so an unlabelled row is a purchase,
 * and reading it as one is the convention rather than a guess.
 *
 * Two independent markers are required so that an account statement mentioning
 * a credit-card payment is not mistaken for one.
 */
function isCardStatement(text: string): boolean {
  const header = text.split(/\n+/).slice(0, 60).join('\n');
  const markers = [
    /\bcredit\s+card\s+statement\b/i,
    /\bminimum\s+(?:amount|payment)\s+due\b/i,
    /\b(?:available\s+)?credit\s+limit\b/i,
    /\bcard\s*(?:no\.?|number)\b/i,
    /\bbalance\s+outstanding\b/i,
    /\bstatement\s+(?:period|date)\b/i,
  ];
  return markers.filter((marker) => marker.test(header)).length >= 2;
}

/**
 * One statement, not two bound into one PDF: it states a payment due date,
 * and every due date, statement date and minimum it prints agrees. A
 * repeated page header prints the same values again, so it still counts as one.
 */
function singleStatementSummary(text: string): boolean {
  const distinct = (pattern: RegExp) => new Set(
    text.split(/\n+/)
      .map((line) => pattern.exec(line.replace(/\s+/g, ' '))?.[1]?.replace(/\s+/g, ''))
      .filter((value): value is string => !!value),
  );
  const dues = distinct(SUMMARY_DUE_DATE);
  if (dues.size !== 1) return false;
  if (distinct(SUMMARY_STATEMENT_DATE).size > 1) return false;
  const minimums = new Set(
    text.split(/\n+/)
      .map((line) => SUMMARY_MINIMUM.exec(line.replace(/\s+/g, ' '))?.[0]?.replace(/^\D+/, '').replace(/\s+/g, ''))
      .filter((value): value is string => !!value),
  );
  return minimums.size <= 1;
}

/** A statement's own top-level card label, not a cardholder section's `Card No :`. */
const TOP_LEVEL_CARD_LABEL = /\b(?:credit\s+)?card\s+number\b|\bnumber\s+card\s+credit\b|رقم\s+البطاقة/iu;

/**
 * The one card a card statement belongs to: exactly one distinct top-level
 * "Card Number" / "Credit Card Number" in the whole file, and the same card is
 * the first one its header names. Cardholder sections ("Card No : XXXX - NAME")
 * are not top-level labels. Null whenever that is not proven.
 */
function soleStatementCard(text: string): StatementInstrument | null {
  const tails = new Set<string>();
  let card: StatementInstrument | null = null;
  for (const line of normalizeDigits(text).split(/\n+/)) {
    if (!TOP_LEVEL_CARD_LABEL.test(line)) continue;
    const instrument = statementInstrument(line, { iban: false });
    if (!instrument || instrument.kind === 'account') continue;
    tails.add(instrument.last4);
    card ??= instrument;
  }
  if (tails.size !== 1 || !card) return null;
  const header = statementInstrument(documentHeader(text), { iban: false });
  return header && header.kind !== 'account' && header.last4 === card.last4 ? card : null;
}

// Any date a transaction could carry, including the yearless `03 Sep`,
// `Sep 3` and line-leading `01/09` the row reader may refuse: a page with one
// may hold rows in a shape (wrapped, packed, dash-led) that are reassembled
// or counted, so it is never an information page.
const ANY_DATE = new RegExp(String.raw`${DATE_TOKEN}|\b\d{1,2}[\s/-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|^\d{1,2}[/.-]\d{1,2}\s`, 'gi');
// `Payment Due Date 30/08/26`, `Statement period from 01/08/26`: a date the
// page labels as metadata, not a transaction's.
const METADATA_DATE_LEAD = /\b(?:date|dated|period|from|to|till|until|by|before|as\s+(?:of|at))\s*[:-]?\s*$/i;
function hasTransactionDate(line: string): boolean {
  for (const match of line.matchAll(ANY_DATE)) {
    if (!METADATA_DATE_LEAD.test(line.slice(0, match.index ?? 0))) return true;
  }
  return false;
}

/**
 * How many text lines at the end of a PDF belong to pages printed after the
 * last page that carries a date other than labelled metadata: payment
 * instructions ("pay to Account Number …", an IBAN), rewards summaries,
 * terms. A card statement's how-to-pay page names the bank's own collection
 * account, and counting it as a second statement account refused the whole
 * file. Those pages hold no row, so they can route none to the wrong account.
 *
 * Zero unless the per-page text maps exactly onto `lines`, and zero for a
 * single page: without page boundaries there is no telling such a page from
 * a section that holds rows.
 */
function trailingInformationLines(pages: readonly string[] | undefined, lines: string[]): number {
  if (!pages || pages.length < 2) return 0;
  const pageLines = pages.map((page) => normalizeDigits(page).normalize('NFC').split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean));
  if (pageLines.reduce((count, page) => count + page.length, 0) !== lines.filter(Boolean).length) return 0;
  let lastTransactionPage = -1;
  pageLines.forEach((page, index) => {
    if (page.some(hasTransactionDate)) lastTransactionPage = index;
  });
  if (lastTransactionPage < 0) return 0;
  return pageLines.slice(lastTransactionPage + 1).reduce((count, page) => count + page.length, 0);
}

/**
 * Credit-card transaction tables that expose both the original and posted
 * total amount need different semantics from an account Debit/Credit table.
 * The card itself is the direction authority: ordinary rows are charges and
 * CR/credit marks the exceptions. Requiring all of these column labels keeps
 * that convention scoped to an actual table, not prose that merely mentions a
 * transaction or a total amount somewhere in the document.
 */
function hasCardTotalAmountTable(text: string, cardStatement: boolean): boolean {
  if (!cardStatement) return false;
  const normalized = text.replace(/\s+/g, ' ');
  return (
    /\btransaction\s*date\b/i.test(normalized) &&
    /\b(?:posting|post)\s*date\b/i.test(normalized) &&
    /\btransaction\s*(?:details?|description)\b/i.test(normalized) &&
    /\boriginal\s+amount\b/i.test(normalized) &&
    /\btotal\s+amount\b/i.test(normalized)
  );
}

interface TrailingAmountCell {
  before: string;
  surface: string;
  direction: 'expense' | 'income' | null;
}

// PDF text extraction may join a direction label directly to the figure
// (`13.92CR`) or leave it as a separate text item (`13.92 CR`). The optional
// ISO token covers original-amount cells in foreign currency; only the final
// Total Amount cell is later required to match the ledger currency.
const TRAILING_AMOUNT_CELL = /(?:^|\s)((?:(?:[A-Z]{3})\s*)?[\d,]+(?:\.\d{1,3})?(?:\s*[A-Z]{3})?)\s*(DR|CR|DEBIT|CREDIT)?\s*$/i;

function trailingAmountCell(value: string): TrailingAmountCell | null {
  const match = TRAILING_AMOUNT_CELL.exec(value);
  if (!match) return null;
  const label = match[2]?.toUpperCase();
  const direction = label === 'CR' || label === 'CREDIT'
    ? 'income'
    : label === 'DR' || label === 'DEBIT'
      ? 'expense'
      : null;
  return {
    before: value.slice(0, match.index).trim(),
    surface: match[1].trim(),
    direction,
  };
}

function ledgerCellMinor(cell: TrailingAmountCell, currency: StatementCurrency): number | null {
  const positive = amountMinor(cell.surface, currency, false);
  if (positive !== null) return positive;
  // amountMinor deliberately refuses zero because zero is not a transaction.
  // VAT can legitimately be an explicit 0.00 cell, and here it is used only to
  // prove a column boundary, never emitted as a transaction amount.
  const code = /\b([A-Z]{3})\b/i.exec(cell.surface)?.[1];
  if (code && statementCurrency(code) !== currency) return null;
  const numeric = cell.surface.replace(/[A-Za-z\s]/g, '').replace(/,/g, '');
  return /^0(?:\.0{1,3})?$/.test(numeric) ? 0 : null;
}

function directionsAgree(values: Array<'expense' | 'income' | null>): 'expense' | 'income' | null | false {
  const explicit = values.filter((value): value is 'expense' | 'income' => value !== null);
  if (new Set(explicit).size > 1) return false;
  return explicit[0] ?? null;
}

function cardTotalAmountRowComplete(line: string): boolean {
  const first = ROW_DATE_PREFIX.exec(line);
  if (!first) return false;
  const posting = ROW_DATE_PREFIX.exec(first[2]);
  if (!posting) return false;
  const total = trailingAmountCell(posting[2]);
  if (!total) return false;
  return trailingAmountCell(total.before) !== null;
}

function reconcilesThirdAmountContinuation(
  pending: string,
  continuationLine: string,
  currency: StatementCurrency,
): boolean {
  const continuation = trailingAmountCell(continuationLine);
  if (!continuation || continuation.before) return false;
  const totalMinor = ledgerCellMinor(continuation, currency);
  if (totalMinor === null) return false;

  const second = trailingAmountCell(pending);
  if (!second) return false;
  const secondMinor = ledgerCellMinor(second, currency);
  const first = trailingAmountCell(second.before);
  const firstMinor = first ? ledgerCellMinor(first, currency) : null;
  return firstMinor !== null && secondMinor !== null && firstMinor + secondMinor === totalMinor;
}

function startsCardTotalAmountRow(line: string): boolean {
  return CARD_ROW_PREFIX.test(line);
}

function cardTotalAmountRowPrefix(line: string, dateOrder: DateOrder): boolean {
  const first = ROW_DATE_PREFIX.exec(line);
  if (!first || !isoDate(first[1], dateOrder)) return false;
  const posting = ROW_DATE_PREFIX.exec(first[2]);
  return !!posting && isoDate(posting[1], dateOrder) !== null;
}

/**
 * PDF extraction sometimes appends a visual subheader/footer after a complete
 * row (`... 101.75 CR - 4111… cardholder`) instead of emitting an EOL. Trim
 * such trailer text only when the prefix before a separator is already a fully
 * formed two-date/two-amount card row. Hyphens inside merchant names therefore
 * cannot truncate a transaction.
 */
function trimCompletedCardRowTrailer(line: string): string {
  if (cardTotalAmountRowComplete(line)) return line;
  const separators = [...line.matchAll(/\s[-–—]\s*/gu)].map((match) => match.index ?? -1).filter((index) => index > 0);
  for (let index = separators.length - 1; index >= 0; index -= 1) {
    const prefix = line.slice(0, separators[index]).trim();
    if (cardTotalAmountRowComplete(prefix)) return prefix;
  }
  return line;
}

// The description may wrap immediately after Posting Date, so the second date
// is allowed to end the extracted text line. The next line is then coalesced
// into this pending row before amount parsing.
const CARD_ROW_START = new RegExp(`(${DATE_TOKEN})\\s+(${DATE_TOKEN})(?=\\s|$)`, 'ig');
const CARD_ROW_PREFIX = new RegExp(`^${DATE_TOKEN}\\s+${DATE_TOKEN}(?=\\s|$)`, 'i');
const EMBEDDED_CARD_DATE_PAIR = new RegExp(`${DATE_TOKEN}\\s+${DATE_TOKEN}`, 'i');

interface CardTextSegment {
  text: string;
  /** A visual row separator or a preceding money cell proved this boundary. */
  explicitBoundary: boolean;
}

function packedCardRowBoundary(line: string, index: number): { valid: boolean; explicit: boolean } {
  if (index === 0) return { valid: true, explicit: false };
  const before = line.slice(0, index).trimEnd();
  if (/[-–—]$/u.test(before)) return { valid: true, explicit: true };
  // The first transaction on a flattened page can follow an Opening Balance
  // directly, with no row separator. A money cell immediately before the date
  // pair is a valid boundary; ordinary merchant prose is not.
  const afterMoney = /(?:^|\s)(?:[A-Z]{3}\s*)?[\d,]+(?:\.\d{1,3})?\s*(?:DR|CR|DEBIT|CREDIT)?$/i.test(before);
  return { valid: afterMoney, explicit: afterMoney };
}

/**
 * Some PDF generators put an entire table page into one text line and separate
 * visual rows only with a hyphen. Split only at the very strong "transaction
 * date + posting date" signature. A lone date in a merchant or footer cannot
 * create a row this way.
 */
function splitPackedCardRows(line: string): CardTextSegment[] {
  const starts: { index: number; explicitBoundary: boolean }[] = [];
  CARD_ROW_START.lastIndex = 0;
  for (let match = CARD_ROW_START.exec(line); match; match = CARD_ROW_START.exec(line)) {
    const boundary = packedCardRowBoundary(line, match.index);
    if (boundary.valid) starts.push({ index: match.index, explicitBoundary: boundary.explicit });
  }
  CARD_ROW_START.lastIndex = 0;
  if (starts.length === 0) return [{ text: line, explicitBoundary: false }];
  const parts: CardTextSegment[] = [];
  if (starts[0].index > 0) {
    const prefix = line.slice(0, starts[0].index)
      .replace(/\s*[-–—]\s*$/u, '')
      .trim();
    if (prefix) parts.push({ text: prefix, explicitBoundary: false });
  }
  for (let index = 0; index < starts.length; index += 1) {
    const part = line.slice(starts[index].index, starts[index + 1]?.index ?? line.length)
      .replace(/^[-–—]\s*/u, '')
      .replace(/\s*[-–—]\s*$/u, '')
      .trim();
    if (part) parts.push({ text: part, explicitBoundary: starts[index].explicitBoundary });
  }
  return parts;
}

/**
 * unpdf preserves PDF.js `hasEOL`, which means a visually single table row can
 * arrive as several lines (description/location, then amount cells). Rebuild
 * only rows in the strongly identified card Total Amount table, and stop as
 * soon as the mandatory Original Amount + Total Amount tail is present.
 */
function coalesceCardTotalAmountRows(lines: string[], currency: StatementCurrency): string[] {
  const result: string[] = [];
  let pending: string | null = null;
  const flush = () => {
    if (pending) result.push(pending);
    pending = null;
  };
  for (const segment of lines.flatMap(splitPackedCardRows)) {
    const line = trimCompletedCardRowTrailer(
      segment.text.replace(/^[-–—]\s*(?=\d{1,2}[\s/-])/u, '').trim(),
    );
    // A wrapped merchant/location line can itself begin with a date-looking
    // token (for example a hotel stay period). In this table a REAL row starts
    // with Transaction Date + Posting Date, so one leading date alone must stay
    // attached to the pending description instead of flushing it as a new row.
    if (startsCardTotalAmountRow(line)) {
      if (pending && !cardTotalAmountRowComplete(pending) && !segment.explicitBoundary) {
        // No visual/structural boundary proves this is a new transaction. Keep
        // the two fragments together and let parseCardTotalAmountRow reject an
        // embedded second date-pair as ambiguous rather than silently moving
        // the money to the wrong transaction date.
        pending = `${pending} ${line}`.replace(/\s+/g, ' ').trim();
        continue;
      }
      flush();
      pending = line;
      continue;
    }
    if (pending) {
      // Two trailing figures can be either Original + Total (complete row) OR
      // Original + VAT with Total wrapped to the next text line. Extend only
      // when the next line is a pure amount cell and all three reconcile.
      if (cardTotalAmountRowComplete(pending) &&
          !reconcilesThirdAmountContinuation(pending, line, currency)) {
        flush();
        if (line) result.push(line);
        continue;
      }
      // A bare separator is a PDF table artefact, not part of the merchant.
      if (!/^[-–—]$/u.test(line)) pending = `${pending} ${line}`.replace(/\s+/g, ' ').trim();
      continue;
    }
    result.push(line);
  }
  flush();
  return result;
}

function parseCardTotalAmountRow(
  line: string,
  currency: StatementCurrency,
  dateOrder: DateOrder,
): { date: string; merchant: string; amountFils: number; type: 'expense' | 'income' } | null {
  const first = ROW_DATE_PREFIX.exec(line);
  if (!first) return null;
  const date = isoDate(first[1], dateOrder);
  const posting = ROW_DATE_PREFIX.exec(first[2]);
  if (!date || !posting || !isoDate(posting[1], dateOrder)) return null;

  const total = trailingAmountCell(posting[2]);
  if (!total) return null;
  const totalMinor = ledgerCellMinor(total, currency);
  if (totalMinor === null || totalMinor <= 0) return null;

  // One preceding amount is mandatory (Original Amount). If VAT is populated,
  // there are three trailing cells and Original + VAT must reconcile exactly to
  // Total before we strip the extra cell. This avoids eating a decimal number
  // that legitimately belongs to the merchant description.
  const nearest = trailingAmountCell(total.before);
  if (!nearest) return null;
  const nearestMinor = ledgerCellMinor(nearest, currency);
  const prior = trailingAmountCell(nearest.before);
  const priorMinor = prior ? ledgerCellMinor(prior, currency) : null;
  const hasExplicitVat = prior !== null && nearestMinor !== null && priorMinor !== null &&
    priorMinor + nearestMinor === totalMinor;
  let merchant = (hasExplicitVat ? prior.before : nearest.before).trim();
  if (merchant.length < 2 || merchant.length > 180) return null;
  // A foreign Original Amount cell (`EUR 100.00`) stays beside the merchant
  // so push() can carry it as the bank-stated FX original.
  const foreignOriginal = !hasExplicitVat && /^[A-Z]{3}\s*[\d,]+(?:\.\d{1,3})?$/.test(nearest.surface) &&
    !nearest.direction && statementCurrency(nearest.surface.slice(0, 3)) !== currency;
  if (foreignOriginal) merchant = `${merchant} ${nearest.surface}`;
  if (EMBEDDED_CARD_DATE_PAIR.test(merchant)) return null;

  const direction = directionsAgree([
    total.direction,
    nearest.direction,
    hasExplicitVat && prior ? prior.direction : null,
  ]);
  if (direction === false) return null;
  return {
    date,
    merchant,
    amountFils: totalMinor,
    // In a proved credit-card Total Amount table, an unlabelled row is a card
    // charge. Credits/refunds/payments are the rows explicitly marked CR.
    type: direction ?? 'expense',
  };
}

/** `10.14` before `USD`: a figure printed exactly to that currency's minor unit. */
function foreignOriginalFigure(word: string, foreign: StatementCurrency): boolean {
  const exponent = ledgerMoneySpec(foreign)?.exponent;
  if (exponent === undefined) return false;
  const match = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(word);
  return match !== null && (match[1]?.length ?? 0) === exponent;
}

function parseColumnTail(
  rest: string,
  currency: StatementCurrency,
  order: ColumnOrder,
  loneAmountIsCharge = false,
  convention: SignConvention = 'account',
  foreignOriginalBeforeLedger = false,
): { merchant: string; amountFils: number; type: 'expense' | 'income' } | 'ambiguous-card-sign' | null {
  const words = rest.split(' ');
  const tail: MoneyToken[] = [];
  let cut = words.length;
  while (cut > 0 && tail.length < 4) {
    const word = words[cut - 1];
    const standaloneCurrency = statementCurrency(word);
    if (standaloneCurrency) {
      // `www*MobileRecharge.com ATLANTA USA 10.14 USD 38.79` under a table
      // whose one amount column is "Amount in AED" (ADCB): the original is
      // printed figure-first and the one bare figure after its code is the
      // ledger charge. Only that exact shape, only on a card table that
      // names the ledger currency as its single amount column, and only
      // when the original carries exactly its own currency's decimals. The
      // original is handed on code-first, the way push() lifts it into the
      // FX fields.
      if (foreignOriginalBeforeLedger && loneAmountIsCharge && standaloneCurrency !== currency &&
          tail.length === 1 && tail[0].kind === 'unsigned' && cut >= 2 &&
          foreignOriginalFigure(words[cut - 2], standaloneCurrency)) {
        const merchant = [...words.slice(0, cut - 2), standaloneCurrency, words[cut - 2]].join(' ').trim();
        return merchant.length < 2 || merchant.length > 180 ? null : {
          merchant,
          amountFils: tail[0].minor,
          type: convention === 'minus-debit' ? 'income' : 'expense',
        };
      }
      // A card row printing its foreign original before the charged figure:
      // `SPOTIFY STOCKHOLM USD 20.00 73.60`. The LAST figure is the ledger
      // charge; the code and the figure after it stay in the description,
      // where push() lifts them into the FX fields. Only on a card table,
      // whose rows carry one charged figure and never a running balance.
      // A figure on BOTH sides of the code (`10.14 USD 38.79 120.00`) says
      // neither which is the original nor which the charge: refused.
      if (standaloneCurrency !== currency && loneAmountIsCharge && tail.length === 2 &&
          tail.every((token) => token.kind === 'unsigned') && !classifyMoneyToken(words[cut - 2] ?? '', currency)) {
        const merchant = [...words.slice(0, cut), words[cut]].join(' ').trim();
        const charge = tail[1] as Extract<MoneyToken, { kind: 'unsigned' }>;
        return merchant.length < 2 || merchant.length > 180 ? null : {
          merchant,
          amountFils: charge.minor,
          type: convention === 'minus-debit' ? 'income' : 'expense',
        };
      }
      // A currency word only qualifies the money token after it; one that
      // names another market's currency means this row is not ours.
      if (tail.length === 0 || standaloneCurrency !== currency) return null;
      cut -= 1;
      continue;
    }
    const token = classifyMoneyToken(word, currency);
    if (!token) break;
    tail.unshift(token);
    cut -= 1;
  }
  const merchant = words.slice(0, cut).join(' ').trim();
  if (merchant.length < 2 || merchant.length > 180 || tail.length === 0 || tail.length > 3) return null;
  // `PAYMENT RECEIVED AED 1,000.00 CR - 125.50` (RAKBANK): a direction label
  // just before the columns means the amount and its label were left in the
  // description, and the columns read here are a separator and the balance.
  if (/^(?:DR|CR|DEBIT|CREDIT)$/i.test(words[cut - 1] ?? '') && classifyMoneyToken(words[cut - 2] ?? '', currency)) return null;
  const [first, second] = tail;
  if (first.kind === 'signed') {
    if (tail.length > 2) return null;
    // classifyMoneyToken reports a minus (or parentheses) as `expense` and a
    // plus as `income`: that IS the account convention. A card statement
    // reads the same mark through what it says its signs mean, or not at all.
    const type = directionFromSign(first.type === 'expense' ? '-' : '+', convention);
    if (!type) return 'ambiguous-card-sign';
    return { merchant, amountFils: first.minor, type };
  }
  // `03/08/2026 NOON.COM DUBAI ARE 68.93` — the whole body of a card
  // statement. One figure, no label, no second column, because a charge is
  // what the statement is for; the CR rows are handled by the branch above.
  // A statement that says its CHARGES carry the minus has told us the
  // opposite: there a plain figure is the credit.
  if (loneAmountIsCharge && tail.length === 1 && first.kind === 'unsigned') {
    return {
      merchant,
      amountFils: first.minor,
      type: convention === 'minus-debit' ? 'income' : 'expense',
    };
  }
  if (tail.length < 2 || second.kind === 'signed' || order === 'unknown') return null;
  const [debit, credit] = order === 'debit-first' ? [first, second] : [second, first];
  if (debit.kind === 'unsigned' && credit.kind === 'placeholder') {
    return { merchant, amountFils: debit.minor, type: 'expense' };
  }
  if (credit.kind === 'unsigned' && debit.kind === 'placeholder') {
    return { merchant, amountFils: credit.minor, type: 'income' };
  }
  return null;
}

/**
 * The running balance at the end of a flattened `debit credit balance` row:
 * the last of three trailing money figures, the first two of which may be an
 * empty-cell placeholder. Null for any other shape.
 */
function columnRowBalance(rest: string, currency: StatementCurrency): number | null {
  const words = rest.trim().split(' ');
  if (words.length < 4) return null;
  const [first, second, last] = words.slice(-3).map((word) => classifyMoneyToken(word, currency));
  if (!first || !second || !last || last.kind === 'placeholder') return null;
  if (first.kind === 'placeholder' && second.kind === 'placeholder') return null;
  return last.kind === 'signed' && last.type === 'expense' ? -last.minor : last.minor;
}

/**
 * The description and the last two money figures on a row, ignoring a trailing
 * DR/CR label. Null unless the row really ends in two figures, so a reference
 * number cannot stand in for one: `CENTS_MONEY` requires the cents.
 */
function rowBalanceFigures(
  rest: string,
  currency: StatementCurrency,
): { merchant: string; amountMinor: number; balanceMinor: number } | null {
  const words = rest.trim().split(' ');
  if (/^(?:DR|CR|DEBIT|CREDIT)$/i.test(words.at(-1) ?? '')) words.pop();
  const balance = classifyMoneyToken(words.at(-1) ?? '', currency);
  const amount = classifyMoneyToken(words.at(-2) ?? '', currency);
  // A currency code before the figure marks the foreign original Gulf
  // statements print inside the description, not a column of its own. Tested
  // against real codes rather than any three capitals, because company
  // suffixes end descriptions constantly here — every `… FZ LLC 5.00 4,998.75`
  // would otherwise be unreadable, and with it the row after it. A code this
  // does not know costs nothing: the row then has to satisfy the exact balance
  // step like any other, and simply breaks the chain when it cannot.
  if (!balance || !amount || balance.kind === 'placeholder' || amount.kind === 'placeholder' ||
    statementCurrency(words.at(-3) ?? '') !== null) {
    return null;
  }
  // A running balance goes negative — an overdraft, and every credit card that
  // states what is owed. `-1,204.55` and `(1,204.55)` are balances like any
  // other; refusing them stopped reading the statement at the row the account
  // first went into the red.
  const balanceMinor = balance.kind === 'unsigned' || balance.type === 'income'
    ? balance.minor
    : -balance.minor;
  const merchant = words.slice(0, -2).join(' ').trim();
  return merchant.length < 2 || merchant.length > 180
    ? null
    : { merchant, amountMinor: amount.minor, balanceMinor };
}

/**
 * A row printing a marked amount AND a marked running balance:
 * `CARREFOUR DUBAI 120.00 DR 4,880.00 CR`. ROW_END_DIRECTION reads the LAST
 * figure and its label, which here is the balance, so every such row imported
 * its balance as the amount (and a CR balance as income).
 *
 * Returns the description, the inner amount with its own label, and the
 * balance signed the way the chain reads it (CR held, DR owed or overdrawn).
 * `'unreadable'` when the shape is this one but its money cannot be taken as
 * the ledger's: a currency code naming another currency, or a figure that is
 * not money. Null for any other shape.
 */
function markedAmountBeforeBalance(
  rest: string,
  currency: StatementCurrency,
): { merchant: string; amountMinor: number; credit: boolean; balanceMinor: number } | 'unreadable' | null {
  const words = rest.trim().split(' ');
  const marker = (word: string | undefined) => /^(?:DR|CR|DEBIT|CREDIT)$/i.test(word ?? '');
  // Both labels are required, each on its own word: `120.00 DR 4,880.00 CR`,
  // either figure possibly led by a currency code (`AED 4,880.00 CR`).
  if (words.length < 5 || !marker(words.at(-1))) return null;
  const balanceMark = words.pop()!;
  const balanceWord = words.pop()!;
  const balanceCode = statementCurrency(words.at(-1) ?? '') !== null ? words.pop()! : null;
  if (!marker(words.at(-1))) return null;
  const amountMark = words.pop()!;
  const amountWord = words.pop() ?? '';
  const amountCode = statementCurrency(words.at(-1) ?? '') !== null ? words.pop()! : null;
  const amount = classifyMoneyToken(amountWord, currency);
  const balance = classifyMoneyToken(balanceWord, currency);
  // Only two figures make this shape. A label after a word (a reference, a
  // payee called "CR") is a different row and stays with the other readers.
  if (!amount || !balance) return null;
  if ((balanceCode && statementCurrency(balanceCode) !== currency) ||
      (amountCode && statementCurrency(amountCode) !== currency)) return 'unreadable';
  // A zero balance is real (`100.00 DR 0.00 CR`); a zero AMOUNT is not a row.
  const balanceZero = balance.kind === 'placeholder' && /^0(?:\.0{1,3})?$/.test(balanceWord);
  if (amount.kind !== 'unsigned' || (balance.kind !== 'unsigned' && !balanceZero)) return 'unreadable';
  const merchant = words.join(' ').trim();
  if (merchant.length < 2 || merchant.length > 180) return 'unreadable';
  const balanceMinor = balance.kind === 'unsigned' ? balance.minor : 0;
  return {
    merchant,
    amountMinor: amount.minor,
    credit: /^(?:CR|CREDIT)$/i.test(amountMark),
    balanceMinor: /^(?:DR|DEBIT)$/i.test(balanceMark) ? -balanceMinor : balanceMinor,
  };
}

/**
 * Whether the final figure on each row is a running balance.
 *
 * Two bare figures at the end of a row are ambiguous — `40.00 9,960.00` is a
 * debit and a balance, or a debit and a credit — and `parseColumnTail` is
 * right to refuse to guess between them. But a running balance is not a guess:
 * it has to reconcile. When every row's final figure differs from the previous
 * row's by exactly that row's other figure, the last column is a balance and
 * the sign of each step is that row's direction.
 *
 * This is what makes the commonest PDF layout readable at all. A statement
 * printing `Date Description Debit Credit Balance` marks the empty cell with a
 * placeholder only sometimes; when the cell is merely blank, extraction emits
 * spaces and the flattening at the top of `parseStatementLines` removes them,
 * leaving two indistinguishable figures. Every such row was rejected.
 *
 * Deliberately strict: four comparisons at minimum and near-total agreement,
 * so a file that merely happens to contain a few reconciling pairs does not
 * license reading the rest of it.
 */
function trailingBalanceRuns(lines: string[], currency: StatementCurrency): boolean {
  let previous: number | null = null;
  let checked = 0;
  let agreed = 0;
  for (const line of lines) {
    const prefixed = ROW_DATE_PREFIX.exec(line);
    const opening = openingBalanceMinor(prefixed ? prefixed[2] : line, currency, null);
    if (opening !== null) {
      previous = opening;
      continue;
    }
    if (!prefixed || SUMMARY_DESCRIPTION.test(prefixed[2])) continue;
    const figures = rowBalanceFigures(prefixed[2], currency);
    // A row this cannot read is a hole in the chain, not a disagreement. Its
    // successor must not be measured against a balance two rows back, or a
    // statement whose descriptions merely happen to end in a three-letter word
    // fails a test it never actually took.
    if (!figures) {
      previous = null;
      continue;
    }
    if (previous !== null) {
      checked += 1;
      if (Math.abs(figures.balanceMinor - previous) === figures.amountMinor) agreed += 1;
    }
    previous = figures.balanceMinor;
  }
  return checked >= 4 && agreed >= Math.ceil(checked * 0.9);
}

/**
 * The lines a statement parse actually works on.
 *
 * Shared so that anything reasoning ABOUT a parse — reconciliation, the layout
 * fingerprint — sees the same lines the parse was handed. Reading the file a
 * second way would let a diagnosis describe a table the parser never saw.
 */
function statementLines(
  text: string,
  currency: StatementCurrency,
  cardTotalAmountTable: boolean,
  yearlessRows = false,
): { lines: string[]; wrapped: ReturnType<typeof joinWrappedRows> | null } {
  const raw = rawStatementLines(text);
  // Two-date layouts (transaction date, then posting date) outside the
  // strongly identified Total Amount table: the FIRST date is the
  // transaction's, and the posting date is dropped rather than left at the
  // front of the merchant ("04/09/2026 CARREFOUR CITY CENTRE").
  const flattened = (cardTotalAmountTable ? coalesceCardTotalAmountRows(raw, currency) : raw)
    .map((line) => cardTotalAmountTable ? line : line.replace(POSTING_DATE_AFTER_DATE, '$1 '));
  // A description wrapped onto further lines is rejoined (joinWrappedRows),
  // except in the Total Amount table, which coalesces its own rows.
  const wrapped = cardTotalAmountTable ? null : joinWrappedRows(flattened, currency, yearlessRows);
  return { lines: wrapped ? wrapped.lines : flattened, wrapped };
}

/**
 * The statement's lines before any row coalescing.
 *
 * Header detection wants these rather than `statementLines`: coalescing glues a
 * card row to its continuation, which can only hide a header line, never reveal
 * one.
 */
function rawStatementLines(text: string): string[] {
  return text.split(/\n+/).map((original) => original.replace(/\s+/g, ' ').trim());
}

/**
 * A money token and any direction marker glued to it.
 *
 * Extraction emits a credit either as `21.40 CR` or as `21.40CR`, and this
 * parser reads the glued form at row level, in `trailingAmountCell`. Anything
 * that reads a token on its own has to split it the same way, or a credit
 * balance is simply unreadable — which is how an overpaid card came back
 * `unknown` while its row had been read correctly.
 */
function splitDirectionSuffix(word: string): { figure: string; marker?: string } {
  const glued = /^(.*?)(DR|CR|DEBIT|CREDIT)$/i.exec(word);
  return glued ? { figure: glued[1], marker: glued[2] } : { figure: word };
}

/**
 * Whether a line is nothing BUT figures.
 *
 * Used to find a stated balance's own value in a bilingual summary box, where
 * the labels are stacked above the figures rather than beside them. Merely
 * containing money is not enough for that: `Total 1,234.00` carries money and
 * is not a value cell.
 */
function isMoneyOnlyLine(line: string, currency: StatementCurrency): boolean {
  const words = line.split(' ');
  let figures = 0;
  for (const word of words) {
    if (/^(?:DR|CR|DEBIT|CREDIT)$/i.test(word) || statementCurrency(word) !== null) continue;
    const token = classifyMoneyToken(splitDirectionSuffix(word).figure, currency);
    if (!token) return false;
    if (token.kind !== 'placeholder') figures += 1;
  }
  return figures > 0;
}

/**
 * Whether a date-led line has a DESCRIPTION under its date, rather than more
 * date.
 *
 * `10-Aug-26 to 09-Sept-26` is a statement period; a wrapped row's first line is
 * a merchant. Both are date-led and carry no money, and only the second is a
 * transaction this parser failed to account for.
 */
function hasDescriptionUnderDate(line: string, currency: StatementCurrency): boolean {
  const prefixed = ROW_DATE_PREFIX.exec(line);
  if (!prefixed || SUMMARY_DESCRIPTION.test(prefixed[2]) || STATEMENT_PERIOD_LINE.test(line)) return false;
  return prefixed[2].split(' ').some((word) => {
    if (new RegExp(`^${DATE_TOKEN}$`, 'i').test(word)) return false;
    if (/^(?:to|through|until|till|and|-|–|—)$/i.test(word)) return false;
    if (/^(?:DR|CR|DEBIT|CREDIT)$/i.test(word) || statementCurrency(word) !== null) return false;
    if (classifyMoneyToken(word, currency)) return false;
    return /[A-Za-z\p{Script=Arabic}]{2,}/u.test(word);
  });
}

/**
 * A column header stated on a line of its own.
 *
 * Bilingual statements print the Arabic and English name of a column together
 * and the extractor sometimes glues the pair into one line, so Arabic is
 * stripped before the line is compared. Anything else left on it — a word of
 * prose, another column's name — means this is not a header.
 */
const COLUMN_LABEL_ONLY = /^[(\s]*([a-z][a-z ]*[a-z])[)\s]*(?:\([A-Z]{3}\))?$/i;

/**
 * What a money column is called, which is not one thing per bank: what the card
 * was charged ("original amount", "transaction amount") beside what it settled
 * to in the ledger's own currency ("total amount", "amount in AED"). Keyed on
 * the ledger's currency rather than a Gulf hard-code.
 */
const CHARGED_AMOUNT_LABELS = [
  'original amount', 'transaction amount', 'foreign currency amount', 'original currency amount',
];
const settlementAmountLabels = (currency: StatementCurrency): string[] => {
  const code = currency.toLowerCase();
  return ['total amount', 'billing amount', 'settlement amount', `amount in ${code}`, `${code} amount`];
};

/** Every standalone column-header label in the file, in the order they appear. */
function columnHeaderLabels(text: string): string[] {
  const labels: string[] = [];
  for (const original of text.split(/\n+/)) {
    const line = original.replace(/[\p{Script=Arabic}‏‎]/gu, '').replace(/\s+/g, ' ').trim();
    if (!line || line.length > 40) continue;
    const label = COLUMN_LABEL_ONLY.exec(line)?.[1];
    if (label) labels.push(label.toLowerCase());
  }
  return labels;
}

/**
 * The two figures a statement states about itself: what it opened at and what
 * it closed at.
 *
 * Both are matched from a SHORT label line, never a sentence. "Total
 * Outstanding" heads the summary box of a UAE card statement and also appears
 * five times in its small print ("Amount by which the Total Outstanding on
 * Statement Date amount exceeds your current credit limit"), and anchoring a
 * reconciliation to a sentence would contradict a parse that was right.
 *
 * The figure is taken from the label's own line when it is there, and otherwise
 * from the first line of nothing but money within a short window after it: a
 * bilingual summary box lays its labels and values out as separate lines, so a
 * statement can state "Total Outstanding" and its figure five lines apart with
 * its Arabic twin and a stray bracket in between.
 *
 * The opening labels are the ones the balance chain reads (OPENING_BALANCE),
 * and the closing ones their counterparts (`Ending Balance` beside a US
 * `Beginning Balance`, `End balance` beside a UK `Start balance`).
 *
 * `Current Balance` is not a closing label. An account statement downloaded
 * for a past period prints it in its header as the balance on the day it was
 * printed, which is not the period's closing balance, so taking it as one
 * refused a correct read of every such statement whose account has moved since.
 */
const OPENING_BALANCE_LABEL =
  /\b(?:opening|previous|prev|beginning|starting|start)\s+balance\b|\bopening\s+bal\b|\bbalance\s+b\/?f\b|(?:^|\s)b\/f(?=\s|$)|\bbrought\s+forward\b|الرصيد\s+(?:الافتتاحي|السابق)/iu;
const CLOSING_BALANCE_LABEL =
  /\b(?:closing|new|ending|end)\s+balance\b|\bclosing\s+bal\b|\btotal\s+outstanding\b|\bbalance\s+c\/?f\b|\bcarried\s+forward\b|\bstatement\s+balance\b|الرصيد\s+الختامي/iu;
/** A label line is a label, not prose. */
const MAX_BALANCE_LABEL_CHARS = 48;
/** How far past a label its own figure may sit in a stacked bilingual box. */
const MAX_BALANCE_VALUE_LOOKAHEAD = 8;

/**
 * A stated balance as a SIGNED figure in the statement's own terms.
 *
 * DR and CR mean opposite things to the two kinds of statement and the sign has
 * to follow, because reconciliation compares this against a sum. A card balance
 * is what is owed, so `200.00 DR` is +200 owed and `200.00CR` is an overpaid
 * card at -200. An account balance is what is held, so the same two words run
 * the other way. Reading a CR as positive on a card would make an overpaid
 * statement miss by twice its balance and report `contradicted` against a parse
 * that was right.
 *
 * The marker is popped whether it is glued to the figure or stands as its own
 * word: `Total Outstanding 1,100.00 DR` ends in a direction, and leaving it
 * there makes the whole line unreadable, so the lookahead runs on and takes the
 * minimum-payment figure underneath as the closing balance.
 *
 * `'ambiguous'` when the figure is there but its direction is not known: a
 * CARD balance whose only direction is a sign. US issuers print an overpaid
 * card as `-$50.00`, a credit balance, so reading the minus as money owed
 * accused a right read of an overpaid card of not adding up. Only the
 * statement's own legend for its balance (`minusIsCredit`, see
 * MINUS_BALANCE_CREDIT_LEGEND) gives a card's minus a direction. An account's
 * minus is an overdraft and is read as one.
 */
function signedBalance(
  line: string,
  currency: StatementCurrency,
  owed: boolean,
  minusIsCredit = false,
): number | 'ambiguous' | null {
  const words = line.split(' ');
  let trailing = /^(?:DR|CR|DEBIT|CREDIT)$/i.exec(words.at(-1) ?? '')?.[0];
  if (trailing) words.pop();
  const split = splitDirectionSuffix(words.at(-1) ?? '');
  const figure = classifyMoneyToken(split.figure, currency);
  // `0.00` is a PLACEHOLDER in a transaction cell — an empty debit or credit
  // column prints exactly that — but it is a real figure in a balance anchor: a
  // fully paid card and a newly opened account both legitimately state zero.
  // Rejecting it left such a statement `unknown` even when its rows reached the
  // stated zero exactly. A bare `-` or `--` really is an empty cell and stays out.
  if (figure?.kind === 'placeholder') {
    return /^0(?:\.0{1,3})?$/.test(split.figure) ? 0 : null;
  }
  if (!figure) return null;
  trailing = trailing ?? split.marker;
  if (!trailing && figure.kind === 'signed') {
    if (owed && !minusIsCredit) return 'ambiguous';
    // A card's legend says its minus balance is a credit, so a minus is CR and
    // a plus what is owed. An account's minus is a debit: overdrawn.
    trailing = owed
      ? (figure.type === 'expense' ? 'CR' : 'DR')
      : (figure.type === 'income' ? 'CR' : 'DR');
  }
  const credit = trailing ? /^(?:CR|CREDIT)$/i.test(trailing) : null;
  if (credit === null) return figure.minor;
  // Owed: a credit is money the card does NOT owe. Held: a debit is overdrawn.
  return owed === credit ? -figure.minor : figure.minor;
}

/**
 * How many figures a line carries: money tokens, a stated zero included (it
 * is a real balance), an empty-cell dash not. DR/CR words, currency codes and
 * words that are not money are not figures.
 */
function balanceFigureCount(line: string, currency: StatementCurrency): number {
  let figures = 0;
  for (const word of line.split(' ')) {
    if (/^(?:DR|CR|DEBIT|CREDIT)$/i.test(word) || statementCurrency(word) !== null) continue;
    const { figure } = splitDirectionSuffix(word);
    const token = classifyMoneyToken(figure, currency);
    if (token && (token.kind !== 'placeholder' || /^0(?:\.0{1,3})?$/.test(figure))) figures += 1;
  }
  return figures;
}

/**
 * What may stand between a balance label and its value in a stacked bilingual
 * box: the label's Arabic twin, a stray bracket, a currency code. A line with
 * any other word on it is another label, and the value below it is that
 * label's, not this one's.
 */
function balanceLabelGap(line: string): boolean {
  return line.replace(/[\p{Script=Arabic}\u200e\u200f]+/gu, ' ')
    .split(/[\s()[\]{}:;.,/|*\u2013\u2014-]+/)
    .filter(Boolean)
    .every((word) => statementCurrency(word) !== null);
}

function statedBalance(
  lines: string[],
  label: RegExp,
  other: RegExp,
  currency: StatementCurrency,
  owed: boolean,
  minusIsCredit: boolean,
): number | null {
  // Every stated reading, not the first: a statement prints its balances more
  // than once (a summary box, a page header, a payment slip), and they must
  // all agree. Multi-page statements end each page with `Balance carried
  // forward` and open the next with `Brought forward`, each a different
  // running balance; taking page one's as THE closing balance accused a
  // correct read of every later page. Disagreement is no anchor at all.
  //
  // A reading comes only from a line holding exactly ONE figure, so its label
  // is that figure's. A summary laid out as columns (`Opening Balance Debits
  // Credits Closing Balance` over `10,000.00 1,200.00 300.00 9,100.00`) pairs
  // no figure with a label by position; taking the last one gave the opening
  // balance the closing figure, and every statement with any movement was
  // then refused as not reconciling. The same summary stacked down the page
  // (each label on its own line, then each value) pairs them by position just
  // the same. A label line this cannot read for certain is no anchor at all.
  const readings = new Set<number>();
  const readOne = (line: string): number | 'ambiguous' | null =>
    balanceFigureCount(line, currency) === 1 ? signedBalance(line, currency, owed, minusIsCredit) : 'ambiguous';
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || line.length > MAX_BALANCE_LABEL_CHARS || !label.test(line)) continue;
    // A line naming BOTH balances (`Opening Balance Closing Balance`,
    // `Opening Bal 5,000.00 Closing Bal 4,100.00`, `الرصيد الافتتاحي الرصيد
    // الختامي`) anchors neither, and its values, on it or under it, are never
    // read: the lookahead from any other label line stops at it.
    if (other.test(line)) continue;
    if (balanceFigureCount(line, currency) > 0) {
      // On the label's own line its one figure is the balance, and it has to
      // end the line (a DR/CR after it aside). A figure there is never a
      // reason to look further down for another one.
      const own = readOne(line);
      if (own === null || own === 'ambiguous') return null;
      readings.add(own);
      continue;
    }
    for (let ahead = index + 1; ahead <= index + MAX_BALANCE_VALUE_LOOKAHEAD && ahead < lines.length; ahead += 1) {
      const next = lines[ahead];
      if (!next) continue;
      // Stop at ANY balance label, not just this one. A summary box stacks its
      // labels and then its values, so a lookahead that only knew its own label
      // would run straight into the other balance's figure and report the
      // opening one as the closing one - a difference of the whole statement.
      if (label.test(next) || other.test(next) || ROW_DATE_PREFIX.test(next)) break;
      if (!isMoneyOnlyLine(next, currency)) {
        if (balanceLabelGap(next)) continue;
        break;
      }
      // A value with another bare value straight under it is one of a column
      // of values printed under a stack of labels, and which label it belongs
      // to is a guess.
      const after = lines.slice(ahead + 1).find(Boolean);
      if (after !== undefined && isMoneyOnlyLine(after, currency)) return null;
      const figure = readOne(next);
      if (figure === 'ambiguous') return null;
      if (figure !== null) readings.add(figure);
      break;
    }
  }
  return readings.size === 1 ? [...readings][0] : null;
}

/**
 * Date-led lines that are neither a transaction this parser read nor one it
 * counted as rejected - a row it never saw at all.
 *
 * A description wide enough to wrap past what `coalesceCardTotalAmountRows`
 * spans leaves its date line carrying no money, and `LOOKS_LIKE_MONEY_LINE` is
 * what makes a line countable, so such a row falls out of the accounting
 * entirely. Reconciliation has to know about it, or it will call a correct
 * partial read a contradiction.
 */
function unaccountedDateLedLines(lines: string[], currency: StatementCurrency): number {
  let unaccounted = 0;
  for (const line of lines) {
    if (!line || line.length > 400) continue;
    const prefixed = ROW_DATE_PREFIX.exec(line);
    if (!prefixed) continue;
    if (SUMMARY_DESCRIPTION.test(prefixed[2])) {
      // A DATE-LED summary line is ambiguous, and both readings are plausible: a
      // balance row the table dated, or a transaction at a payee whose name
      // starts with a balance word. `01/07/2026 NEW BALANCE 100.00 - 4,900.00`
      // is read as a summary and so is neither accepted nor rejected, which
      // leaves the sum short by a transaction that may well be real. Counting it
      // here is what keeps that from being reported as the parse contradicting
      // itself. An undated summary line is the normal shape and is not counted.
      if (LOOKS_LIKE_MONEY_LINE.test(line)) unaccounted += 1;
      continue;
    }
    if (LOOKS_LIKE_MONEY_LINE.test(line)) continue;
    // A line with no description under its date is a period or a heading, not a
    // transaction this parser lost. See `hasDescriptionUnderDate`.
    if (hasDescriptionUnderDate(line, currency)) unaccounted += 1;
  }
  return unaccounted;
}

/**
 * Whether the rows that were read actually ADD UP to what the statement says.
 *
 * Recognising a layout and reading it correctly are not the same thing, and
 * nothing in this file could previously tell them apart: a reading that put the
 * wrong figure in every row, or every direction the wrong way round, produced a
 * full set of plausible transactions and no complaint. A statement states its
 * own opening and closing balance, so the arithmetic between them is a proof
 * that costs nothing to run.
 *
 * A card statement's balance is what is OWED, so a purchase raises it and a
 * payment lowers it; an account statement runs the other way. Which one is
 * the parser's own decision (`cardEvidence`), the one its rows were read
 * under, never a second opinion: checking a right read with the other sign
 * misses by twice the traffic and refuses it. Where that decision rests on
 * evidence that disagrees with itself the verdict is `unknown` (see
 * StatementKindEvidence).
 *
 * Only money movements are summed: the card summary row (`cardStatement`, the
 * due) is not one, and a payment received onto a card (`cardPayment`, filed as
 * the expense leg of a transfer) LOWERS what is owed whatever its ledger type.
 *
 * Attempted only on a complete read. A file with rejected rows is missing
 * transactions by definition, so it cannot close, and calling that a
 * contradiction would report every partial import as wrong. The verdict is
 * `unknown` wherever the statement does not state both anchors - this exists to
 * ADD proof, never to cast doubt on a parse it cannot check.
 */
export type StatementReconciliation =
  | { verdict: 'unknown' }
  | { verdict: 'proven'; openingMinor: number; closingMinor: number }
  | { verdict: 'contradicted'; openingMinor: number; closingMinor: number; differenceMinor: number };

/**
 * What the parser decided a statement is, and the evidence against it.
 *
 * `card` is the parser's own decision (cardEvidence: two header markers, or a
 * number the statement labels `Credit Card Number`), the one its rows were
 * read under, so the check runs the same arithmetic. It is set aside, and the
 * verdict is `unknown`, only where the statement's own wording says the other
 * thing too: two card markers are printed by account statements as well
 * (`Statement Date` beside a `Debit Card Number`, `Statement Period` beside an
 * overdraft's `Credit Limit`), and an account statement can carry a single
 * card marker (`Credit Limit`) that a one-marker card statement carries too.
 */
interface StatementKindEvidence {
  /** The rows were read as a card's (cardEvidence). */
  card: boolean;
  /**
   * That card decision stands on the statement's header: two card markers,
   * or a `Credit Card Number` above its first row. A credit card number named
   * only inside a row (`PAYMENT TO CREDIT CARD NUMBER 4111…` on a current
   * account) says what was paid, not what the statement is.
   */
  cardInHeader: boolean;
  /** Wording only a credit card's statement prints: a minimum payment due, "credit card statement". */
  creditOnly: boolean;
  /** Any single card marker in the header (CARD_STATEMENT_MARKER). */
  cardMarker: boolean;
  /**
   * The header names an account: an account-labelled number or IBAN, a debit
   * or mada card, an overdraft.
   */
  accountSide: boolean;
  /** The statement says a minus balance is a credit balance. */
  minusBalanceCredit: boolean;
}

/** Card or account arithmetic, or null when the statement says both. */
function reconciliationOwed(kind: StatementKindEvidence): boolean | null {
  // US issuers label a card's own number "Account Number", so an account
  // label weighs against a card only where nothing credit-only stands with it.
  if (kind.card) return !kind.cardInHeader || (kind.accountSide && !kind.creditOnly) ? null : true;
  return kind.cardMarker ? null : false;
}

function reconcileStatement(
  rows: StatementParsedRow[],
  lines: string[],
  kind: StatementKindEvidence,
  currency: StatementCurrency,
  rejectedRows: number,
): StatementReconciliation {
  if (rejectedRows > 0) return { verdict: 'unknown' };
  // `rejectedRows === 0` is not the same as a complete read. A row the PDF
  // wrapped over more continuations than the coalescer spans stays a date-led
  // line carrying no money - never accepted, never counted, invisible. A parse
  // missing those cannot close, and reporting it `contradicted` would accuse a
  // correct reading of being wrong, which is what this is documented never to do.
  if (unaccountedDateLedLines(lines, currency) > 0) return { verdict: 'unknown' };
  const owed = reconciliationOwed(kind);
  if (owed === null) return { verdict: 'unknown' };
  const minusIsCredit = owed && kind.minusBalanceCredit;
  const openingMinor = statedBalance(lines, OPENING_BALANCE_LABEL, CLOSING_BALANCE_LABEL, currency, owed, minusIsCredit);
  const closingMinor = statedBalance(lines, CLOSING_BALANCE_LABEL, OPENING_BALANCE_LABEL, currency, owed, minusIsCredit);
  if (openingMinor === null || closingMinor === null) return { verdict: 'unknown' };
  let debits = 0;
  let credits = 0;
  let movements = 0;
  for (const row of rows) {
    if (row.kind === 'cardPayment') {
      credits += row.amountFils;
    } else if (row.kind === 'transaction') {
      if (row.type === 'expense') debits += row.amountFils;
      else credits += row.amountFils;
    } else {
      continue;
    }
    movements += 1;
  }
  // Nothing read, so nothing to prove or to refuse.
  if (movements === 0) return { verdict: 'unknown' };
  const expected = owed
    ? openingMinor + debits - credits
    : openingMinor - debits + credits;
  const differenceMinor = expected - closingMinor;
  return differenceMinor === 0
    ? { verdict: 'proven', openingMinor, closingMinor }
    : { verdict: 'contradicted', openingMinor, closingMinor, differenceMinor };
}

/** How many distinct row shapes a fingerprint reports, commonest first. */
const MAX_FINGERPRINT_SHAPES = 8;
/** How many column-header labels it reports. */
const MAX_FINGERPRINT_HEADERS = 16;

/**
 * A statement's LAYOUT with its contents removed.
 *
 * When a file reads zero rows the parser knows exactly why and the user is told
 * nothing that can be acted on - and nobody upstream learns which bank, which
 * table, which shape defeated it. Every such failure has so far had to arrive
 * as a person reporting it, and the HSBC case took a real statement to diagnose.
 *
 * What makes that fixable without handling anyone's money is that the answer is
 * never in the values. It is in the SHAPE: how many date columns a row leads
 * with, whether its figures carry a direction, where the amounts sit. So every
 * token that could carry content becomes its class and nothing else -
 *
 *   `09-Aug-26 11-Aug-26 COFFEE HOUSE DUBAI AE 41.25 41.25`
 *     becomes  `DATE DATE WORD+ MONEY MONEY`
 *
 * - which is enough to write a fixture from and carries no merchant, no amount,
 * no balance, no account number, no name. Digits never survive: a token that is
 * money becomes MONEY whatever its value, and one that is anything else becomes
 * WORD whatever it spells. Column headers are the one exception, and they are
 * reported only when they name a column - see `reportableColumnLabels`.
 */
export interface StatementLayoutFingerprint {
  /** Column labels the file states, in order. Named only when they name a
   *  column - see `reportableColumnLabels`, which is what keeps a cardholder's
   *  name and address out of this. */
  headers: string[];
  /** Standalone header-shaped lines that were NOT reported, counted only. */
  otherHeaderLines: number;
  /** Distinct date-led row shapes with their counts, commonest first. */
  shapes: { shape: string; count: number }[];
  /** Date-led lines seen, and how many of those carried money. */
  dateLedLines: number;
  moneyLines: number;
  /** Whether the file read as a card statement, and which layouts it proved. */
  cardStatement: boolean;
  cardTotalAmountTable: boolean;
  trailingBalance: boolean;
}

/**
 * The nouns a money table names its columns with.
 *
 * `columnHeaderLabels` answers "does this line stand alone like a header", which
 * is all a presence check needs. A fingerprint REPORTS its labels, so the same
 * rule is nowhere near enough: an address block is short standalone alphabetic
 * lines too, and fingerprinting a real statement emitted the cardholder's name,
 * their employer and their city alongside the real headers.
 *
 * So a label is reported only when it names a column - it carries one of these
 * nouns and is no longer than a header gets. That keeps the discovery this
 * exists for (the next bank's word for an amount column is still learned) while
 * a name, an employer or a street cannot satisfy it. Anything else is counted
 * and not named, so the count still says how much was passed over.
 */
const KNOWN_COLUMN_LABELS = [
  'transaction date', 'posting date', 'post date', 'value date', 'date',
  'transaction details', 'transaction description', 'description', 'details',
  'narration', 'particulars', 'reference', 'reference number',
  'debit', 'credit', 'debit amount', 'credit amount', 'withdrawal', 'withdrawals',
  'deposit', 'deposits', 'amount', 'balance', 'running balance', 'closing balance',
  'opening balance', 'previous balance', 'new balance', 'statement balance',
  'total outstanding', 'minimum payment', 'minimum amount due', 'payment due date',
  'credit limit', 'available limit', 'finance charges', 'vat', 'tax', 'fees',
  'currency', 'rate', 'exchange rate', 'card number', 'total', 'charges',
  // Seen on real statements and added here deliberately: this list is how a new
  // bank's column vocabulary enters the diagnostic, and every entry is generic
  // column wording rather than anything out of anyone's file.
  'other debits', 'other credits', 'start date', 'end date', 'transaction',
  'statement date', 'due date', 'amount due', 'total amount due', 'payments',
];

/**
 * Whether a label is one this parser already knows the name of.
 *
 * A CLOSED SET, and it has to be, because every heuristic tried here leaked. A
 * bare "does the line contain a column word" emitted a cardholder's employer
 * (`GULF PAYMENTS SERVICES LLC` carries "payments"). Requiring the noun to be
 * the LAST word emitted their name (`ALICE CREDIT`, `MOHAMMED TOTAL` - a name
 * followed by a column noun passes that test exactly as a real header does).
 *
 * There is no test over free text that separates "a column called X" from "a
 * person called X", because the strings are the same shape. So the only
 * defensible rule is to report nothing that did not already exist in this file:
 * a label is named only when it matches a constant here, which makes the output
 * PROVABLY content-free rather than carefully filtered. Everything else is
 * counted, so the count still says how much was passed over.
 *
 * The cost is that a bank's novel word for a column is no longer learned from
 * the fingerprint. The row shapes still show the table's structure, which is the
 * actionable half, and a new label can be added here once someone has seen it.
 * That is a smaller loss than a name in a diagnostic.
 */
function namesAColumn(label: string, currency: StatementCurrency): boolean {
  return KNOWN_COLUMN_LABELS.includes(label)
    || CHARGED_AMOUNT_LABELS.includes(label)
    || settlementAmountLabels(currency).includes(label);
}

function reportableColumnLabels(
  text: string,
  currency: StatementCurrency,
): { headers: string[]; otherHeaderLines: number } {
  const headers: string[] = [];
  let otherHeaderLines = 0;
  for (const label of columnHeaderLabels(text)) {
    if (namesAColumn(label, currency)) {
      if (!headers.includes(label)) headers.push(label);
    } else {
      otherHeaderLines += 1;
    }
  }
  return { headers, otherHeaderLines };
}

/** One token's CLASS. Never its value - see StatementLayoutFingerprint. */
function tokenClass(word: string, currency: StatementCurrency): string {
  if (new RegExp(`^${DATE_TOKEN}$`, 'i').test(word)) return 'DATE';
  if (/^(?:DR|CR|DEBIT|CREDIT)$/i.test(word)) return 'DIR';
  if (statementCurrency(word) !== null) return 'CUR';
  const token = classifyMoneyToken(word, currency);
  if (token) return token.kind === 'placeholder' ? 'EMPTY' : 'MONEY';
  // `21.40CR` is ONE token that is money and states its direction, which is how
  // extraction often emits a credit. Reporting it as WORD would describe the
  // table as having a text column where it has an amount column — the shape
  // would send the next reader of this fingerprint the wrong way.
  const glued = splitDirectionSuffix(word);
  if (glued.marker && classifyMoneyToken(glued.figure, currency)) return 'MONEY+DIR';
  // A bare integer is not money to this parser, but a row full of them is a
  // reference or a card number and the difference matters when reading a shape.
  if (/^[\d,]+$/.test(word)) return 'DIGITS';
  return 'WORD';
}

export function statementLayoutFingerprint(
  text: string,
  currency: StatementCurrency = 'AED',
): StatementLayoutFingerprint {
  // The text the parser reads (digits and figures normalized), through the
  // same coalescer, so a shape reported here is the shape it was handed.
  text = normalizeStatementFigures(normalizeDigits(text).normalize('NFC'), currency);
  const cardStatement = isCardStatement(text);
  const cardTotalAmountTable = hasCardTotalAmountTable(text, cardStatement);
  const { lines } = statementLines(text, currency, cardTotalAmountTable);
  const counts = new Map<string, number>();
  let dateLedLines = 0;
  let moneyLines = 0;
  for (const line of lines) {
    if (!line || line.length > 400 || !ROW_DATE_PREFIX.test(line)) continue;
    dateLedLines += 1;
    if (LOOKS_LIKE_MONEY_LINE.test(line)) moneyLines += 1;
    // Collapsed, so one shape is not reported once per merchant-name length:
    // `WORD WORD WORD` and `WORD WORD` are the same table, differently wide.
    const shape = line.split(' ').map((word) => tokenClass(word, currency))
      .join(' ').replace(/(?:WORD )+WORD/g, 'WORD+');
    counts.set(shape, (counts.get(shape) ?? 0) + 1);
  }
  const shapes = [...counts.entries()]
    .map(([shape, count]) => ({ shape, count }))
    .sort((a, b) => b.count - a.count || a.shape.localeCompare(b.shape))
    .slice(0, MAX_FINGERPRINT_SHAPES);
  const { headers, otherHeaderLines } = reportableColumnLabels(text, currency);
  return {
    headers: headers.slice(0, MAX_FINGERPRINT_HEADERS),
    otherHeaderLines,
    shapes,
    dateLedLines,
    moneyLines,
    cardStatement,
    cardTotalAmountTable,
    trailingBalance: trailingBalanceRuns(lines, currency),
  };
}

/** A final DR/CR may label the transaction OR the balance's polarity. */
function labelledBalanceConvention(
  lines: string[], currency: StatementCurrency,
): 'transaction' | 'balance' | null {
  let previous: { numeric: number; polarity: number } | null = null;
  let checked = 0;
  let transactionAgrees = true;
  let balanceAgrees = true;
  for (const line of lines) {
    const prefixed = ROW_DATE_PREFIX.exec(line);
    if (!prefixed || SUMMARY_DESCRIPTION.test(prefixed[2])) continue;
    const label = /\s(DR|CR|DEBIT|CREDIT)$/i.exec(line)?.[1];
    const figures = label ? rowBalanceFigures(prefixed[2], currency) : null;
    if (!figures || !label) { previous = null; continue; }
    const credit = /^(?:CR|CREDIT)$/i.test(label);
    const polarity = Math.abs(figures.balanceMinor) * (credit ? 1 : -1);
    if (previous) {
      checked += 1;
      const delta = figures.balanceMinor - previous.numeric;
      transactionAgrees &&= delta === figures.amountMinor * (credit ? 1 : -1);
      balanceAgrees &&= Math.abs(polarity - previous.polarity) === figures.amountMinor;
    }
    previous = { numeric: figures.balanceMinor, polarity };
  }
  // Do not choose between two valid financial interpretations of identical
  // flattened text. Four exact comparisons are the existing minimum proof.
  if (checked < 4 || transactionAgrees === balanceAgrees) return null;
  return transactionAgrees ? 'transaction' : 'balance';
}

/**
 * Which table column a money figure was drawn in, read from the PDF's own
 * geometry (see pdfTextAndLayout). `debit`/`credit` say the row's direction
 * outright; flattened text loses that the moment a blank cell becomes a space.
 */
export type StatementColumn = 'debit' | 'credit' | 'balance';
export interface StatementLayoutCell { text: string; column: StatementColumn }
/** Money cells by line index in `text.split(/\n+/)` of the text they came with. */
export type StatementLayout = ReadonlyMap<number, readonly StatementLayoutCell[]>;

/** The last figure on a line, past any trailing DR/CR label, if it is money. */
function endsWithMoneyFigure(text: string, currency: StatementCurrency): boolean {
  const words = text.trim().split(' ');
  if (/^(?:DR|CR|DEBIT|CREDIT)$/i.test(words.at(-1) ?? '')) words.pop();
  const token = classifyMoneyToken(words.at(-1) ?? '', currency);
  return token !== null && token.kind !== 'placeholder';
}

/**
 * Rejoin a row whose description wrapped onto further lines.
 *
 * A PDF table row is one baseline for its date and figures, but a long
 * description wraps below it. pdf.js emits the wrapped lines in drawing
 * order, which for many statements is: the date line ("28-Jul UADDS Cr"),
 * the wrapped reference, and only then the figures ("1,234.56 5,615.44").
 * Read line by line, the date line had no money and the figures line had no
 * date, so the row was lost and the next row's balance step lost with it.
 *
 * Only a date line that carries description text and no money of its own is
 * joined, only with up to three following lines that are not date-led, and
 * only when one of them ends in a figure. A block followed by more bare
 * money lines (a date heading over several undated rows) is left alone: one
 * row read out of many would look like a complete import.
 *
 * Absorbed lines become empty strings so line indices — which the PDF
 * layout cells are keyed by — still line up; `sources` lists, per joined row,
 * every original line it now holds.
 */
function joinWrappedRows(
  lines: string[], currency: StatementCurrency, yearlessRows = false,
): { lines: string[]; sources: Map<number, number[]> } {
  const joined = [...lines];
  const sources = new Map<number, number[]>();
  const dateLed = (line: string) => ROW_DATE_PREFIX.test(line) || DATE_LED_LINE.test(line);
  for (let i = 0; i < joined.length; i += 1) {
    const prefixed = ROW_DATE_PREFIX.exec(joined[i]);
    if (!prefixed || SUMMARY_DESCRIPTION.test(prefixed[2]) || !/\p{L}/u.test(prefixed[2])) continue;
    if (endsWithMoneyFigure(prefixed[2], currency)) continue;
    // `September 01, 2026 through September 30, 2026` leads with a date and
    // carries words, but it is the statement period, never a row.
    if (STATEMENT_PERIOD_LINE.test(joined[i])) continue;
    let end = -1;
    for (let j = i + 1; j < joined.length && j <= i + 3; j += 1) {
      const next = joined[j];
      if (!next) continue;
      // In a file that prints its rows without a year, a yearless row the
      // period did not date (`08/31 EARLY 5.00 DR`) is a row of its own,
      // counted unread, never another row's continuation.
      if (dateLed(next) || (yearlessRows && yearlessLead(next) !== null) || next.length > 120) break;
      if (endsWithMoneyFigure(next, currency)) { end = j; break; }
    }
    if (end < 0) continue;
    let after = end + 1;
    while (after < joined.length && !joined[after]) after += 1;
    if (after < joined.length && !dateLed(joined[after]) && endsWithMoneyFigure(joined[after], currency)) continue;
    const held = [];
    for (let k = i; k <= end; k += 1) if (joined[k]) held.push(k);
    joined[i] = held.map((k) => joined[k]).join(' ');
    for (let k = i + 1; k <= end; k += 1) joined[k] = '';
    sources.set(i, held);
    i = end;
  }
  return { lines: joined, sources };
}

/** The description of a row with its trailing money columns taken off. */
function descriptionBeforeFigures(rest: string, currency: StatementCurrency): string {
  const words = rest.trim().split(' ');
  let cut = words.length;
  while (cut > 0) {
    const word = words[cut - 1];
    if (/^(?:DR|CR|DEBIT|CREDIT)$/i.test(word) || statementCurrency(word) !== null || classifyMoneyToken(word, currency)) {
      cut -= 1;
      continue;
    }
    break;
  }
  return words.slice(0, cut).join(' ').trim();
}

/** The one figure a row's cells put in the Balance column, or null. */
function layoutBalance(
  cells: readonly StatementLayoutCell[],
  readFigure: (text: string) => MoneyToken | null,
): number | null {
  const balances = cells.flatMap((cell) => {
    if (cell.column !== 'balance') return [];
    const token = readFigure(cell.text);
    if (!token || token.kind === 'placeholder') return [];
    return [token.kind === 'signed' && token.type === 'expense' ? -token.minor : token.minor];
  });
  return balances.length === 1 ? balances[0] : null;
}

interface LayoutRowDirection {
  type: 'expense' | 'income';
  amountMinor: number;
  /** The figure in the balance column, when exactly one was drawn there. */
  balanceMinor: number | null;
}

/**
 * The direction a row's own geometry states: exactly one non-empty figure in
 * the Debit or the Credit column. Two (both columns populated), none, or a
 * sign that contradicts its column answer nothing.
 */
function layoutRowDirection(
  cells: readonly StatementLayoutCell[],
  readFigure: (text: string) => MoneyToken | null,
): LayoutRowDirection | null {
  const money: { column: 'debit' | 'credit'; token: Exclude<MoneyToken, { kind: 'placeholder' }> }[] = [];
  const balances: number[] = [];
  for (const cell of cells) {
    const token = readFigure(cell.text);
    if (!token || token.kind === 'placeholder') continue;
    if (cell.column === 'balance') {
      balances.push(token.kind === 'signed' && token.type === 'expense' ? -token.minor : token.minor);
      continue;
    }
    money.push({ column: cell.column, token });
  }
  if (money.length !== 1) return null;
  const [{ column, token }] = money;
  const type = column === 'debit' ? 'expense' : 'income';
  if (token.kind === 'signed' && token.type !== type) return null;
  return { type, amountMinor: token.minor, balanceMinor: balances.length === 1 ? balances[0] : null };
}

export interface StatementTextResult {
  rows: StatementParsedRow[];
  /** Every date-led money row this parser accounted for, accepted or rejected. */
  totalRows: number;
  /** Date-led lines that carried money but could not be read as a transaction. */
  rejectedRows: number;
  /** True when every row in totalRows is represented by rows or rejectedRows. */
  completeRowAccounting: boolean;
  /**
   * Rejected rows whose only direction evidence was a bare sign on a card
   * statement that never says what its signs mean. Counted inside rejectedRows.
   */
  ambiguousCardSignRows: number;
  /** Rejected rows whose numeric date the file never settles as day- or month-first. */
  ambiguousDateRows: number;
  /**
   * Rejected rows printed without a year that no statement period settles
   * (see fillYearlessRowDates). Counted inside rejectedRows.
   */
  yearlessDateRows: number;
  /** Whether the rows add up to the balances the statement states for itself. */
  reconciliation: StatementReconciliation;
}

/**
 * Conservative statement-row parser. A row is accepted only when its direction
 * is explicit: a DR/CR label (tried first, unchanged), a signed amount, or a
 * debit/credit column pair with exactly one side populated. A bare amount in a
 * visual column is rejected rather than guessed after PDF layout has been
 * flattened to text — and, so that a partial import is not reported as a
 * complete one, every date-led line carrying money that fails is counted.
 *
 * `pages` is the same text split per PDF page, when the caller has it: it is
 * what lets an information page after the last transaction page be told
 * apart from a section that holds rows (see trailingInformationLines).
 */
export function parseStatementLines(
  text: string,
  currency: StatementCurrency,
  identity: { card: ParsedSms['card']; bankHint?: string } = { card: null },
  dateHint: StatementDateHint = legacyStatementDateHint(currency),
  layout: StatementLayout | null = null,
  pages?: readonly string[],
): StatementTextResult {
  if (!ledgerMoneySpec(currency)) throw new Error('unsupported_statement_currency');
  const unifiedText = normalizeDigits(text).normalize('NFC');
  const figureConvention = statementFigureConvention(unifiedText, currency);
  text = applyFigureConvention(unifiedText, figureConvention);
  assertStatementCurrency(text, currency);
  // A layout cell is read with the same figure convention as its line.
  const readLayoutFigure = (cellText: string): MoneyToken | null => {
    const words = applyFigureConvention(normalizeDigits(cellText).normalize('NFC'), figureConvention)
      .replace(/\s+/g, ' ').trim().split(' ')
      .filter((word) => !/^(?:DR|CR|DEBIT|CREDIT)$/i.test(word) && statementCurrency(word) !== currency);
    return words.length === 1 ? classifyMoneyToken(words[0], currency) : null;
  };
  // Yearless row dates take their year from the statement period, or stay
  // yearless and are counted below. Rewrites only the lines it fills.
  const yearlessFill = fillYearlessRowDates(text, dateHint);
  text = yearlessFill.text;
  const rows: StatementParsedRow[] = [];
  // The running balance each accepted row stated, when one was read (same
  // index as rows). Only the closing one is ever used; see below the loop.
  const rowBalances: (number | null)[] = [];
  // The line each accepted row came from (same index as rows), and the last
  // date-led row line of the document, for the closing-balance check.
  const rowLines: number[] = [];
  let lastDatedLine = -1;
  let rejectedRows = 0;
  let yearlessDateRows = 0;
  const rawLines = rawStatementLines(text);
  // Pages printed after the last page carrying a transaction date (how to
  // pay, rewards, terms) name the bank's own accounts, not this statement's.
  // They hold no rows, so they are left out of the account checks and the
  // statement's identity below, and only there.
  const trailingLines = trailingInformationLines(pages, rawLines);
  const accountText = trailingLines > 0
    ? rawLines.filter(Boolean).slice(0, -trailingLines).join('\n')
    : text;
  // A flattened document has no safe table-to-account mapping. Repeated page
  // headers are fine; distinct labelled statement accounts must be split before
  // import instead of silently routing every section to the first account.
  //
  // One exception: a credit-card statement with a single summary. Its
  // "Card No : XXXX7316 - NAME" sections are the supplementary or replacement
  // cards billed on that one card account (ADCB prints one per cardholder),
  // and the statement's one total, minimum and due date cover all of them.
  // It needs a positive single-account signal, not just agreeing dates: one
  // top-level card number in the whole file, the one its header prints. Two
  // card numbers, or two different ACCOUNT numbers, still refuse.
  const singleCardAccount = isCardStatement(accountText) && singleStatementSummary(accountText)
    ? soleStatementCard(accountText)
    : null;
  const sectionInstruments = new Set<string>();
  const accountLines = accountText.split(/\n+/).map((line) => line.replace(/\s+/g, ' ').trim());
  // Lines of the single card account's own card numbers (its header and its
  // cardholder sections), and of an account number beside it that is not the
  // card's last four.
  const cardLines = new Set<number>();
  const otherAccountLines: number[] = [];
  accountLines.forEach((line, index) => {
    if (!/^\s*(?:credit\s+card|card|account|a\/c)\s+(?:number|no\.?|ending)\b/i.test(line) &&
        !/^\s*(?:account|acct|a\/c|iban|card)\s*[:#-]?\s*[*xX•·\d]/i.test(line) &&
        !/^\s*number\s+card\s+credit\b/i.test(line)) return;
    // `Card 123456789` under a card-payment row (Bank AlJazira) names the
    // card that was paid, not a statement section: an unmasked run of fewer
    // than 12 digits after a bare `Card` is not a card number at all.
    if (/^\s*card\s*[:#-]?\s*\d{1,11}\s*$/i.test(normalizeDigits(line))) return;
    const instrument = statementInstrument(line, { iban: false }) ?? statementHeaderInstrument(line);
    if (!instrument) return;
    if (instrument.kind !== 'account' && singleCardAccount) {
      cardLines.add(index);
      return;
    }
    sectionInstruments.add(`${instrument.kind === 'account' ? 'account' : 'card'}:${instrument.last4}`);
    if (singleCardAccount && instrument.kind === 'account' && instrument.last4 !== singleCardAccount.last4) {
      otherAccountLines.push(index);
    }
  });
  if (sectionInstruments.size > 1) throw new Error('multiple_statement_accounts');
  // Beside a single card account one account-labelled number may stand, as
  // `main` always allowed: the card's own last four, or the card ACCOUNT's
  // number in the statement header (ADCB prints `Account Number
  // 0101234567890` beside `Card Number XXXXXXXXXXXX2280`), whatever page or
  // file type it comes in. It refuses only where it is a second section: it
  // heads rows of its own, which would be filed to the card. That is an
  // account number printed after the first row, with rows under it before any
  // card section, and not a page header repeated beside the statement's own
  // top-level card number. One that heads no rows (printed after the last of
  // them) names nothing that could be misfiled. The bank's own pay-to account
  // on an information page is not here at all (accountText).
  if (otherAccountLines.length > 0) {
    // A line the row reader would take for a transaction: led by a date, with
    // money or a description under it. A statement-period line is neither.
    const rowLine = (line: string): boolean =>
      (DATE_LED_LINE.test(line) || yearlessLead(line) !== null) && !STATEMENT_PERIOD_LINE.test(line) &&
      (LOOKS_LIKE_MONEY_LINE.test(line) || hasDescriptionUnderDate(line, currency));
    const firstRow = accountLines.findIndex(rowLine);
    const headsRows = (index: number): boolean => {
      if (firstRow < 0 || index < firstRow) return false;
      let below = index + 1;
      for (; below < accountLines.length && !rowLine(accountLines[below]); below += 1) {
        // The rows under it belong to the card section printed between.
        if (cardLines.has(below)) return false;
      }
      if (below >= accountLines.length) return false;
      let above = index;
      while (above > 0 && !rowLine(accountLines[above - 1])) above -= 1;
      for (let line = above; line < below; line += 1) {
        if (cardLines.has(line) && TOP_LEVEL_CARD_LABEL.test(accountLines[line])) return false;
      }
      return true;
    };
    if (otherAccountLines.some(headsRows)) throw new Error('multiple_statement_accounts');
  }
  // Every row of a single card account goes to the statement's own card, never
  // to whichever cardholder section happens to come first.
  const statedInstrument = identity.card ?? singleCardAccount ??
    statementInstrument(accountText) ?? statementHeaderInstrument(accountText);
  const bankHint = identity.bankHint ?? statementBankHint(text);
  const hsbcRepaymentCard = hsbcStatementRepaymentCard(text);
  const cardStatement = isCardStatement(text);
  // Refusing a bare sign needs less proof than reading every plain figure as
  // a charge does: one strong marker, or a header card explicitly labelled a
  // credit card, is enough to stop the account convention being assumed.
  // Two proofs, for two jobs. Reading a row as a card SETTLEMENT or switching
  // off the balance chain needs the card statement proved (two markers, or a
  // header number labelled credit card). Refusing a bare sign needs less —
  // one strong marker — but never on a statement labelled with an ACCOUNT
  // number: "Available Credit Limit" on an overdrawn current account is not a
  // card statement.
  const cardEvidence = cardStatement || statedInstrument?.kind === 'credit';
  const creditMarker = CARD_STATEMENT_MARKER.test(rawLines.slice(0, 60).join('\n'));
  // Except for the two markers no current account prints: a minimum payment
  // due, or the words "credit card statement". US issuers label the card's own
  // number "Account Number", and under the account convention a card's
  // `Payment Thank You -500.00` was filed as 500.00 spent.
  const cardOnlyMarker = /\bcredit\s+card\s+statement\b|\bminimum\s+(?:amount|payment)\s+due\b/i
    .test(rawLines.slice(0, 60).join('\n'));
  // What an ACCOUNT statement that happens to print two card markers says
  // about itself in its header: an account number or IBAN, a debit or mada
  // card, an overdraft. Only weighs against a card reading, and only in the
  // reconciliation below.
  const accountSide = statedInstrument?.kind === 'account' || statedInstrument?.kind === 'debit' ||
    accountLines.slice(0, 60).some((line) =>
      /\b(?:debit|mada)\s+card\b|\boverdraft\b|\biban\b|بطاقة\s+(?:ال)?(?:خصم|صراف|مدى)/iu.test(line) ||
      statementInstrument(line, { iban: false })?.kind === 'account');
  const signEvidence = cardEvidence || (statedInstrument?.kind !== 'account' && creditMarker) || cardOnlyMarker;
  // A proven card statement that also carries a credit-only marker (a credit
  // limit, a minimum due, "credit card statement") is a CREDIT card's, even
  // when its number is labelled just "Card Number". Without this the card's
  // account was created as a card of unknown type, and a month with no
  // payment row never got marked credit at all.
  const sourceInstrument: ParsedSms['card'] = statedInstrument?.kind === 'unknown' && cardEvidence && creditMarker
    ? { last4: statedInstrument.last4, kind: 'credit' }
    : statedInstrument;
  const convention = signConvention(signEvidence, text);
  let ambiguousCardSignRows = 0;
  const cardTotalAmountTable = hasCardTotalAmountTable(text, cardStatement);
  // The lines the rows are read from, shared with the reconciliation below
  // and the layout fingerprint (see statementLines). The card Total Amount
  // table has its own row coalescing, and its lines no longer match the
  // text's line indices, so the PDF layout is not used there.
  const { lines, wrapped } = statementLines(text, currency, cardTotalAmountTable, yearlessFill.rows);
  const rowLayout = layout && wrapped
    ? (index: number): StatementLayoutCell[] => (wrapped.sources.get(index) ?? [index]).flatMap((k) => layout.get(k) ?? [])
    : null;
  const dateOrder = inferDateOrder(lines.map((line) => ROW_DATE_PREFIX.exec(line)?.[1] ?? ''), dateHint);
  // A card table whose ONE amount column is the ledger's (`Transaction Date
  // | Transaction Description | Amount in AED`, a translated header may
  // follow) prints a foreign original inside the description, figure first.
  // Decided per table, by the nearest table header above the row: any second
  // amount, original, currency or balance column means a figure's column
  // cannot be told from its place.
  const tableHeader = (line: string): string | null => {
    const english = line.replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').trim();
    return line.length <= 160 && !DATE_LED_LINE.test(line) && /\bdate\b/i.test(english) &&
      /\b(?:amount|description|details|particulars|narration)\b/i.test(english) ? english : null;
  };
  const ledgerOnlyHeader = (english: string): boolean =>
    (english.match(/\bamount\b/gi) ?? []).length === 1 &&
    !/\b(?:balance|original|foreign|currency|debit|credit|fx|rate|vat)\b/i.test(english) &&
    new RegExp(String.raw`\bamount\s*(?:in\s+${currency}|\(\s*${currency}\s*\))$`, 'i').test(english);
  let ledgerAmountColumn = false;
  let ambiguousDateRows = 0;
  const columnOrder = statementColumnOrder(text);
  // No header names the debit and credit columns: the order is the Gulf
  // Debit-first default, which only the running balance can check.
  const columnOrderAssumed = columnOrderEvidence(text).size === 0;
  const trailingBalanceHeader = rawLines.some((line) => line.length <= 120 &&
    line.split(' ').length <= 12 && !DATE_LED_LINE.test(line) &&
    /\bdate\b/i.test(line) && /\b(?:description|details|particulars|narration)\b/i.test(line) &&
    /\bbalance\s*$/i.test(line));
  // Proven once for the whole file, then used to resolve rows the branches
  // below would otherwise have to reject as ambiguous.
  // Not on a card statement: its running figure is what is OWED, which rises
  // with a charge, and whether it prints as positive or negative varies by
  // issuer. Reading its steps with the account direction filed every charge
  // as money in.
  const balanceLabels = !cardEvidence ? labelledBalanceConvention(lines, currency) : null;
  const balanceTrailing = !cardEvidence && (balanceLabels === 'balance' || trailingBalanceRuns(lines, currency));
  let previousBalance: number | null = null;
  let previousTailBalance: number | null = null;
  // The last date-led row's running balance as either reading saw it (the
  // proven text chain or the PDF's Balance column), proof or not: only used
  // to refuse a column reading the balance contradicts.
  let previousStatedBalance: number | null = null;
  // The stated balance a `120.00 DR 4,880.00 CR` row steps from: an opening
  // line, or the row just before it in the same shape (see
  // markedAmountBeforeBalance). Any other date-led row breaks it.
  let markedBalance: number | null = null;
  // The nearest table header above names an original (foreign) amount column
  // and no balance column: a row's two marked figures there are its original
  // and charged amounts, never an amount and a balance.
  let twoAmountColumns = false;
  // Rows read through the debit/credit column order, and whether any row's
  // own balance disproved that order (see below the loop).
  const columnRowIndices: number[] = [];
  let columnOrderContradictions = 0;
  let columnOrderAgreements = 0;
  let lineIndex = 0;
  const push = (
    date: string,
    description: string,
    amountFils: number,
    type: 'expense' | 'income',
    line: string,
    balance: number | null = null,
  ): boolean => {
    // "PAYMENT RECEIVED - THANK YOU" is money a card RECEIVED. Read as
    // spending, the statement's card nature went unproven: the row is
    // counted unread rather than filed the wrong way.
    if (!cardEvidence && type === 'expense' && PAYMENT_RECEIVED.test(description)) return false;
    rowBalances.push(balance);
    rowLines.push(lineIndex);
    // A card row's foreign original rides in its description; lift it into
    // the FX fields and keep the ledger-currency figure as the amount.
    const foreign = cardEvidence ? foreignOriginalTail(description, currency) : null;
    const fx = foreign ? foreignOriginalFields(foreign, amountFils, currency) : null;
    const merchant = foreign && fx ? foreign.merchant : description;
    const classification = statementMerchantClassification(
      merchant,
      type,
      currency === 'AED' ? 'AE' : currency === 'SAR' ? 'SA' : null,
    );
    const reference = referenceFromDescription(merchant);
    const settlement = statementCardSettlement(merchant, type, cardEvidence, sourceInstrument, hsbcRepaymentCard);
    if (settlement) {
      rows.push({
        amountFils, currency, date,
        dueDay: null, minDueFils: null, reference,
        ...(bankHint ? { bankHint } : {}),
        snapshotFils: null, snapshotKind: null,
        ...settlement,
        raw: line,
      });
      return true;
    }
    const transfer = statementTransferMeaning(merchant, type, currency, sourceInstrument, reference);
    rows.push({
      kind: 'transaction', type, amountFils, currency,
      merchant: transfer?.merchant ?? relayTitle(classification.merchant), date,
      dueDay: null, minDueFils: null, card: sourceInstrument, reference,
      transferHint: transfer?.transferHint ?? false,
      ...(bankHint ? { bankHint } : {}),
      snapshotFils: null, snapshotKind: null,
      categoryGuess: transfer ? 'other' : classification.categoryGuess,
      categoryDeliberate: transfer ? true : classification.categoryDeliberate,
      ...(transfer?.transferEvidence ? { transferEvidence: transfer.transferEvidence } : {}),
      ...(!transfer && fx ? fx : {}),
      raw: line,
    });
    return true;
  };
  for (lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) continue;
    const anyHeader = tableHeader(line);
    if (anyHeader !== null) {
      twoAmountColumns = /\b(?:original|foreign)\s+(?:currency\s+)?amount\b|\boriginal\s+currency\b/i.test(anyHeader) &&
        !/\bbalance\b/i.test(anyHeader);
    }
    const header = cardStatement ? anyHeader : null;
    if (header !== null) ledgerAmountColumn = ledgerOnlyHeader(header);
    const prefixed = ROW_DATE_PREFIX.exec(line);
    if (prefixed && !SUMMARY_DESCRIPTION.test(prefixed[2])) lastDatedLine = lineIndex;
    // The column branch's running balance is only valid from the row just
    // before: any other date-led row (labelled, summary, skipped) breaks it.
    const tailBefore: number | null = previousTailBalance;
    if (prefixed) previousTailBalance = null;
    // An opening balance is not a transaction, but it IS the running balance
    // the first row steps from. Without it that row's direction had nothing
    // to be measured against and, with blank debit/credit cells, was lost.
    const opening = balanceTrailing ? openingBalanceMinor(prefixed ? prefixed[2] : line, currency, balanceLabels) : null;
    // The marked chain reads an opening line's own label (`5,000.00 CR`), as
    // its rows do. An opening line is never a transaction, so skipping it
    // here changes nothing for any other layout.
    const markedOpening = openingBalanceMinor(prefixed ? prefixed[2] : line, currency, 'balance');
    if (markedOpening !== null) markedBalance = markedOpening;
    if (opening !== null) {
      previousBalance = opening;
      continue;
    }
    if (markedOpening !== null) continue;
    if (prefixed && SUMMARY_DESCRIPTION.test(prefixed[2])) continue;
    // A yearless row the statement period did not settle (fillYearlessRowDates
    // left it as printed). With a period and only the day/month order
    // missing it is an ambiguous date; otherwise its year is missing.
    // Only in a file whose rows are yearless (see fillYearlessRowDates);
    // elsewhere such a line is counted below exactly as before.
    const yearlessRow = prefixed || !yearlessFill.rows ? null : yearlessLead(line);
    if (yearlessRow && LOOKS_LIKE_MONEY_LINE.test(line) && !STATEMENT_PERIOD_LINE.test(line)) {
      rejectedRows += 1;
      if (yearlessFill.period && yearlessMonthDay(yearlessRow, yearlessFill.order) === 'ambiguous') ambiguousDateRows += 1;
      else yearlessDateRows += 1;
      previousBalance = null;
      previousTailBalance = null;
      markedBalance = null;
      continue;
    }
    // Date-like rows with unsupported yearless/year-first spellings are still
    // missing transactions, not evidence of complete coverage.
    // A line of bare figures (`25.00 1,977.18`) is a row's money columns
    // printed below its description, not a yearless date, and no date has a
    // zero day or month (`0.00 AED 15,000.00` is a summary box). A dotted
    // pair with no words after it is read as figures; a slashed or dashed
    // one (`12/09 004512 250.00`) is still a dated row. Either breaks the chain.
    const yearless = !prefixed ? /^(\d{1,4})([/.\-])(\d{1,2})(?:[/.\-]\d{1,4})?\s/.exec(line) : null;
    if (yearless && LOOKS_LIKE_MONEY_LINE.test(line)) {
      const [first, second] = [Number(yearless[1]), Number(yearless[3])];
      const dayMonth = first > 0 && second > 0 && ((first <= 31 && second <= 12) || (first <= 12 && second <= 31) ||
        yearless[1].length === 4);
      if (dayMonth && (yearless[2] !== '.' || /\p{L}/u.test(line))) rejectedRows += 1;
      previousBalance = null;
      continue;
    }
    // Tested on the row after its date: `03.04.2026` itself looks like a
    // decimal. Every other date spelling is tested with its line, as before.
    const countable = prefixed !== null && (
      LOOKS_LIKE_MONEY_LINE.test(DOTTED_DATE.test(prefixed[1]) ? prefixed[2] : line) ||
      (ledgerMoneySpec(currency)?.exponent === 0 && /\s[\d,]+$/.test(prefixed[2]))
    );
    if (line.length > 400) {
      if (countable) rejectedRows += 1;
      if (prefixed) previousBalance = null;
      continue;
    }
    const accepted = rows.length;
    // Read before either branch and carried forward whether or not this row is
    // accepted, so one unreadable row cannot break the chain for the next.
    const figures = balanceTrailing && prefixed ? rowBalanceFigures(prefixed[2], currency) : null;
    if (figures && balanceLabels === 'balance' && /\s(?:DR|DEBIT)$/i.test(line)) {
      figures.balanceMinor = -Math.abs(figures.balanceMinor);
    }
    const priorBalance = previousBalance;
    // Same hole rule as the proving pass, and here it is a correctness one:
    // a delta measured across a row that was skipped could carry the wrong
    // sign and file a credit as a debit.
    if (prefixed && !SUMMARY_DESCRIPTION.test(prefixed[2])) previousBalance = figures?.balanceMinor ?? null;
    const cells = rowLayout && prefixed ? rowLayout(lineIndex) : null;
    const statedBefore = previousStatedBalance;
    if (prefixed && !SUMMARY_DESCRIPTION.test(prefixed[2])) {
      previousStatedBalance = figures?.balanceMinor ?? (cells ? layoutBalance(cells, readLayoutFigure) : null);
    }
    // Same rule for the marked chain: carried forward whether or not this
    // row is accepted, broken by any date-led row of another shape.
    // Not on a card statement: a card table prints no running balance (the
    // balance chains above are off there too), and its two marked figures are
    // the original and the charged amount (`SPOTIFY 20.00 DR 73.60 DR`),
    // which the last-figure reader below files at the charge, as before. Nor
    // under a table header that names those two columns.
    const priorMarked = markedBalance;
    const markedRead = prefixed && !cardEvidence && !twoAmountColumns
      ? markedAmountBeforeBalance(prefixed[2], currency)
      : null;
    const marked = markedRead === 'unreadable' ? null : markedRead;
    const markedSigned = marked ? (marked.credit ? marked.amountMinor : -marked.amountMinor) : 0;
    // The same figure under the same label twice is the one amount either way,
    // but nothing about it shows its second figure to be a balance: two
    // amount columns print exactly that. It is never a step and never seeds
    // one, even from a stated zero, or a later row whose charge happened to
    // equal the running total of the others would step by coincidence and be
    // filed at its original figure.
    const markedSameFigure = marked !== null && marked.balanceMinor === markedSigned;
    const markedStepped = marked !== null && !markedSameFigure && priorMarked !== null &&
      priorMarked + markedSigned === marked.balanceMinor;
    if (prefixed) markedBalance = marked && !markedSameFigure ? marked.balanceMinor : null;
    const cardTableCandidate = cardTotalAmountTable && prefixed
      ? cardTotalAmountRowPrefix(line, dateOrder)
      : false;
    const cardTableRow = cardTableCandidate
      ? parseCardTotalAmountRow(line, currency, dateOrder)
      : null;
    if (cardTableCandidate) {
      if (cardTableRow) {
        push(cardTableRow.date, cardTableRow.merchant, cardTableRow.amountFils, cardTableRow.type, line);
      }
      if (countable && rows.length === accepted) rejectedRows += 1;
      continue;
    }
    const match = markedRead ? null : ROW_END_DIRECTION.exec(line) ?? ROW_MIDDLE_DIRECTION.exec(line);
    if (markedRead) {
      // `CARREFOUR DUBAI 120.00 DR 4,880.00 CR`: the inner figure is the
      // amount with its own label, the outer one the running balance. Filed
      // only when the statement proves that reading: the balance moved from
      // the one before it by exactly this amount, in this label's direction.
      // The same figure under the same label twice (`101.75 CR 101.75 CR`)
      // is the one amount either way. Anything else, the first row with no
      // opening balance included, is counted as rejected rather than guessed.
      const date = prefixed ? isoDate(prefixed[1], dateOrder) : null;
      if (marked && date && (markedStepped || markedSameFigure)) {
        // Only a balance the chain proved is this row's running balance
        // (for the closing snapshot below).
        push(date, marked.merchant, marked.amountMinor, marked.credit ? 'income' : 'expense', line,
          markedStepped ? marked.balanceMinor : null);
      }
    } else if (match) {
      // Only treat the three-letter token before an amount as currency when
      // it is actually a supported ISO currency. Merchant/location suffixes
      // such as `PARKING RTA 4.00 DR` are common statement text and must not
      // be mistaken for a foreign-currency marker just because they are three
      // uppercase letters.
      const explicitCurrencyToken = /\s([A-Z]{3})\s*[\d,]+(?:\.\d{1,3})?(?:\s+(?:DR|CR|DEBIT|CREDIT))?$/i
        .exec(line)?.[1]?.toUpperCase();
      const explicitCurrency = explicitCurrencyToken ? statementCurrency(explicitCurrencyToken) : null;
      const date = isoDate(match[1], dateOrder);
      let merchant = match[2].replace(/\s+/g, ' ').trim();
      // AMOUNT_TOKEN is intentionally permissive enough to recognize global
      // three-letter ISO codes. That also means the regex may temporarily eat
      // an ordinary three-letter merchant/location suffix such as RTA or LLC.
      // Put unrecognized tokens back into the description; recognized ISO
      // currency evidence stays out of the merchant title.
      if (explicitCurrencyToken) {
        if (explicitCurrency) {
          merchant = merchant.replace(new RegExp(`\\s*${explicitCurrencyToken}$`, 'i'), '').trim();
        } else if (!new RegExp(`(?:^|\\s)${explicitCurrencyToken}$`, 'i').test(merchant)) {
          merchant = `${merchant} ${explicitCurrencyToken}`.trim();
        }
      }
      const endDirection = /^(?:DR|CR|DEBIT|CREDIT)$/i.test(match[4] ?? '');
      const amountText = endDirection ? match[3] : match[4];
      const direction = (endDirection ? match[4] : match[3]).toUpperCase();
      const amountFils = amountMinor(amountText, currency, false);
      // `CARREFOUR 40.00 1,234.00 CR`: the labelled figure is the running
      // balance and the purchase sits at the end of the description. Two
      // money figures before one DR/CR label are ambiguous, so the line is
      // left for the rejected count rather than filed as a 1,234.00 credit.
      // `AMAZON AE USD 45.00 165.30 DR` is not that case: a currency code
      // before the figure marks the original foreign amount Gulf statements
      // print inside the description, and 165.30 DR is the real charge.
      const descriptionWords = merchant.split(' ');
      // Against real codes, not any three capitals: `ADCB ATM 200.00 5,300.00
      // DR` and `SPINNEYS JLT 120.00 27,890.00 DR` read their SECOND figure as
      // a currency marker under `[A-Z]{3}`, which switched this guard off and
      // imported the running balance as the amount.
      const credit = direction === 'CR' || direction === 'CREDIT';
      // In a zero-decimal currency a card's digits also look like unsigned
      // money. Exempt only the exact, source-labelled repayment description;
      // arbitrary numeric merchants and running balances remain ambiguous.
      const exactRepayment = credit && cardEvidence &&
        isHsbcStatementRepayment(merchant, sourceInstrument, hsbcRepaymentCard);
      const descriptionCurrency = /(?:^|\s)([A-Z]{3})\s*[\d,]+(?:\.\d{1,3})?$/.exec(merchant)?.[1];
      const foreignBeforeBalance = trailingBalanceHeader && descriptionCurrency !== undefined &&
        statementCurrency(descriptionCurrency) !== null && statementCurrency(descriptionCurrency) !== currency;
      // A SIGNED figure before the label is the same case: ENBD prints
      // `-1250.00 3341.06 Cr`, the debit and then the balance's polarity.
      const lastDescriptionFigure = classifyMoneyToken(descriptionWords.at(-1) ?? '', currency)?.kind;
      const balanceLabelled = !exactRepayment &&
        (lastDescriptionFigure === 'unsigned' || lastDescriptionFigure === 'signed') &&
        statementCurrency(descriptionWords.at(-2) ?? '') === null;
      if (
        (!explicitCurrency || explicitCurrency === currency) && date && !balanceLabelled && !foreignBeforeBalance &&
        amountFils !== null && merchant
      ) {
        push(date, merchant, amountFils, credit ? 'income' : 'expense', line);
      } else if (
        balanceLabelled && date && figures &&
        (!explicitCurrency || explicitCurrency === currency)
      ) {
        const amountToken = classifyMoneyToken(descriptionWords.at(-1) ?? '', currency);
        const signDisagrees = amountToken?.kind === 'signed' && amountToken.type !== (credit ? 'income' : 'expense');
        if (balanceLabels === 'transaction' && !signDisagrees) {
          push(date, figures.merchant, figures.amountMinor, credit ? 'income' : 'expense', line, figures.balanceMinor);
        } else if (balanceLabels === 'balance' && priorBalance !== null) {
          const delta = figures.balanceMinor - priorBalance;
          if (delta !== 0 && Math.abs(delta) === figures.amountMinor) {
            push(date, figures.merchant, figures.amountMinor, delta < 0 ? 'expense' : 'income', line, figures.balanceMinor);
          }
        }
      }
    } else {
      const date = prefixed ? isoDate(prefixed[1], dateOrder) : null;
      const tail = prefixed && date
        ? parseColumnTail(prefixed[2], currency, columnOrder, cardStatement, convention, ledgerAmountColumn)
        : null;
      if (tail === 'ambiguous-card-sign') ambiguousCardSignRows += 1;
      const column = tail === 'ambiguous-card-sign' ? null : tail;
      // A debit/credit/balance row whose running balance moved by exactly its
      // amount the OTHER way was read with the columns swapped (a headerless
      // table keeps the Debit-first default). The balance is evidence the
      // column guess is wrong, so the row is refused rather than filed.
      const tailBalance = prefixed ? columnRowBalance(prefixed[2], currency) : null;
      const priorTail = tailBefore;
      previousTailBalance = prefixed ? tailBalance : tailBefore;
      const balanceChecks = columnOrderAssumed && column !== null && !cardEvidence && priorTail !== null &&
        tailBalance !== null && Math.abs(tailBalance - priorTail) === column.amountFils;
      const balanceContradicts = balanceChecks && (tailBalance! > priorTail! ? 'income' : 'expense') !== column!.type;
      if (balanceContradicts) columnOrderContradictions += 1;
      else if (balanceChecks) columnOrderAgreements += 1;
      // The column the PDF drew this row's figure in, when its geometry is
      // known (pdfTextAndLayout). Positive evidence of its own, and a check
      // on every other reading: a row whose readings disagree is not filed.
      const placed = cells && date ? layoutRowDirection(cells, readLayoutFigure) : null;
      const delta = figures && priorBalance !== null ? figures.balanceMinor - priorBalance : null;
      const balanceStep = delta !== null && delta !== 0 && Math.abs(delta) === figures!.amountMinor
        ? (delta < 0 ? 'expense' : 'income') : null;
      if (date && column && !balanceContradicts) {
        if (!placed || placed.type === column.type) {
          // Only a three-figure `debit credit balance` row depends on the order.
          const at = rows.length;
          // Recorded only for a row actually filed (push may refuse one).
          if (push(date, column.merchant, column.amountFils, column.type, line, tailBalance) && tailBalance !== null) {
            columnRowIndices.push(at);
          }
        }
      }
      else if (date && figures && balanceStep) {
        // No label and no placeholder to say which column is populated: the
        // step in the balance says it instead, and only when it matches this
        // row's other figure exactly.
        if (!placed || placed.type === balanceStep) {
          push(date, figures.merchant, figures.amountMinor, balanceStep, line, figures.balanceMinor);
        }
      }
      else if (date && placed && prefixed) {
        // Nothing before it to measure a step from — the first row of a
        // statement that prints no opening balance, or the row after one
        // that could not be read — but the figure sits in the Debit or the
        // Credit column, which is the direction the bank itself printed.
        // The amount must be a figure this row's own text carries, and a
        // balance step that exists must not point the other way.
        const merchant = descriptionBeforeFigures(prefixed[2], currency);
        const carried = prefixed[2].split(' ').some((word) => {
          const token = classifyMoneyToken(word, currency);
          return token !== null && token.kind !== 'placeholder' && token.minor === placed.amountMinor;
        });
        const ownBalance = placed.balanceMinor ?? figures?.balanceMinor ?? null;
        const step = ownBalance !== null && statedBefore !== null ? ownBalance - statedBefore : null;
        const stepDisagrees = step !== null && step !== 0 && Math.abs(step) === placed.amountMinor &&
          (step < 0 ? 'expense' : 'income') !== placed.type;
        if (carried && !stepDisagrees && merchant.length >= 2 && merchant.length <= 180) {
          push(date, merchant, placed.amountMinor, placed.type, line,
            placed.balanceMinor ?? figures?.balanceMinor ?? null);
        }
      }
    }
    if (countable && rows.length === accepted) {
      rejectedRows += 1;
      if (dateOrder === 'unknown' && prefixed && ambiguousLocalDate(prefixed[1])) ambiguousDateRows += 1;
    }
  }
  // A balance step that disproves the assumed column order, with none
  // confirming it, disproves it for the whole table, including rows with no
  // prior balance to check (the first row of a page). Every row read through
  // that order is refused and counted. (A newest-first table can produce
  // such a step by coincidence; refusing it is the safe side.)
  if (columnOrderContradictions >= 1 && columnOrderAgreements === 0) {
    for (const index of columnRowIndices.reverse()) {
      rows.splice(index, 1);
      rowBalances.splice(index, 1);
      rowLines.splice(index, 1);
      rejectedRows += 1;
    }
  }
  // The statement's closing running balance is the account's balance on its
  // last date, which may be newer than any alert the phone has seen. It
  // travels as a balance snapshot on the closing row only (the planner keeps
  // the newest-timed snapshot per account, and every earlier row of the same
  // day would otherwise compete with it). Only on an account statement read
  // completely and in date order — at least two dates, oldest first, so a
  // newest-first table whose rows share a date cannot pass — and only from
  // the document's last dated row, whose balance was read.
  const closingIndex = rows.length - 1;
  const closing = rows[closingIndex];
  const ascending = rows.every((row, index) => index === 0 || (rows[index - 1].date ?? '') <= (row.date ?? ''));
  const distinctDates = new Set(rows.map((row) => row.date)).size;
  const closingBalance = rowBalances[closingIndex];
  if (
    !cardEvidence && closing?.kind === 'transaction' && closing.card?.kind !== 'credit' &&
    rejectedRows === 0 && distinctDates >= 2 && rowLines[closingIndex] === lastDatedLine &&
    ascending && closingBalance !== null && closingBalance !== undefined &&
    // An overdrawn close is not sent: the app's row contract carries balance
    // snapshots as non-negative figures and drops the WHOLE row otherwise.
    Number.isSafeInteger(closingBalance) && closingBalance >= 0
  ) {
    closing.snapshotFils = closingBalance;
    closing.snapshotKind = 'balance';
  }
  // Only beside transactions this parser could read: a summary alone is what
  // a scanned statement's text layer looks like, not a statement imported.
  // Never at the cost of the row ceiling: a full statement keeps its rows.
  const summary = cardEvidence && rows.length > 0 && rows.length + rejectedRows < STATEMENT_ROW_CEILING
    ? cardStatementSummary(text, currency, dateOrder, sourceInstrument, bankHint)
    : null;
  if (summary) rows.push(summary);
  return {
    rows,
    totalRows: rows.length + rejectedRows,
    rejectedRows,
    completeRowAccounting: true,
    ambiguousCardSignRows,
    ambiguousDateRows,
    yearlessDateRows,
    reconciliation: reconcileStatement(rows, lines, {
      card: cardEvidence,
      cardInHeader: cardStatement ||
        statementInstrument(documentHeader(accountText), { iban: false })?.kind === 'credit',
      creditOnly: cardOnlyMarker,
      cardMarker: creditMarker,
      accountSide,
      minusBalanceCredit: MINUS_BALANCE_CREDIT_LEGEND.some((legend) => legend.test(text.replace(/\s+/g, ' '))),
    }, currency, rejectedRows),
  };
}

/**
 * Whether a forwarded email BODY is a statement rather than one alert.
 *
 * A statement email carries its own summary — total, minimum, due date — and
 * the alert reader recognises that summary as a single card-statement alert.
 * Read first, it swallowed every transaction row below it. A body counts as a
 * statement when it has at least two date-led money rows and either a
 * statement marker or a third such row; an alert has one date at most.
 */
export function looksLikeStatementBody(text: string): boolean {
  const lines = normalizeDigits(text).normalize('NFC').split(/\n+/).map((line) => line.replace(/\s+/g, ' ').trim());
  let dated = 0;
  for (const line of lines) {
    const prefixed = ROW_DATE_PREFIX.exec(line);
    if (!prefixed || SUMMARY_DESCRIPTION.test(prefixed[2])) continue;
    if (LOOKS_LIKE_MONEY_LINE.test(prefixed[2])) dated += 1;
  }
  if (dated < 2) return false;
  return dated >= 3 || isCardStatement(text) ||
    /\b(?:account|card|bank)\s+statement\b|\bstatement\s+(?:period|date)\b|\bopening\s+balance\b|\btransaction\s+date\b|كشف\s+(?:ال)?حساب/iu.test(text);
}

export function parseStatementText(
  text: string,
  currency: StatementCurrency,
  identity: { card: ParsedSms['card']; bankHint?: string } = { card: null },
  dateHint: StatementDateHint = legacyStatementDateHint(currency),
): StatementParsedRow[] {
  return parseStatementLines(text, currency, identity, dateHint).rows;
}

/** One text run pdf.js reports, as much of it as layout reading needs. */
interface PdfTextRun {
  str: string;
  x: number;
  y: number;
  width: number;
  hasEOL: boolean;
}

const DEBIT_HEADER = /^(?:debits?|debit\s+amount|withdrawals?|withdrawal\s+amount|paid\s+out|money\s+out|مدين|سحب|المدين)$/iu;
const CREDIT_HEADER = /^(?:credits?|credit\s+amount|deposits?|deposit\s+amount|paid\s+in|money\s+in|دائن|إيداع|ايداع|الدائن)$/iu;
const BALANCE_HEADER_CELL = /^(?:balance|running\s+balance|balance\s+amount|الرصيد|رصيد)$/iu;
/** A run that is one money figure and nothing else (currency code and DR/CR allowed). */
const MONEY_RUN = /^(?:[A-Z]{3}\s*)?[-+(]?\s*\d[\d.,'’\u00a0\u202f]*\)?-?(?:\s*(?:[A-Z]{3}|CR|DR))?$/i;

interface HeaderColumn { column: StatementColumn; x: number; right: number }
const TABLE_HEADER_LABEL = /^(?:(?:transaction|value|posting|txn|trans\.?)\s+)?date$|^(?:description|details|particulars|narration|narrative|transaction\s+details)$|تاريخ|البيان|التفاصيل|الوصف/iu;

/**
 * The money columns a page's transaction table header names: a Debit run and
 * a Credit run (and a Balance run if printed), each its own run, on one
 * baseline that also carries a Date or Description label — so a summary box
 * above the table ("Credits | Debits | Balance") is not taken for it. Two
 * such headers on a page that disagree on positions answer nothing.
 */
function pageHeaderColumns(runs: readonly PdfTextRun[]): { y: number; columns: HeaderColumn[] } | null {
  const candidates = runs.flatMap((run) => {
    const label = run.str.replace(/\s+/g, ' ').trim();
    const column: StatementColumn | null = DEBIT_HEADER.test(label) ? 'debit'
      : CREDIT_HEADER.test(label) ? 'credit'
      : BALANCE_HEADER_CELL.test(label) ? 'balance' : null;
    return column ? [{ column, x: run.x, right: run.x + run.width, y: run.y }] : [];
  });
  const headers: { y: number; columns: HeaderColumn[] }[] = [];
  for (const debit of candidates.filter((c) => c.column === 'debit')) {
    const row = candidates.filter((c) => Math.abs(c.y - debit.y) <= 2);
    const count = (column: StatementColumn) => row.filter((c) => c.column === column).length;
    if (count('debit') !== 1 || count('credit') !== 1 || count('balance') > 1) continue;
    const labelled = runs.some((run) => Math.abs(run.y - debit.y) <= 2 &&
      TABLE_HEADER_LABEL.test(run.str.replace(/\s+/g, ' ').trim()));
    if (!labelled) continue;
    const columns = row.map(({ column, x, right }) => ({ column, x, right })).sort((a, b) => a.x - b.x);
    // Overlapping or touching labels cannot be told apart by position.
    if (columns.some((c, i) => i > 0 && c.x <= columns[i - 1].right)) continue;
    headers.push({ y: debit.y, columns });
  }
  if (headers.length === 0) return null;
  const same = (a: HeaderColumn[], b: HeaderColumn[]) => a.length === b.length &&
    a.every((c, i) => c.column === b[i].column && Math.abs(c.x - b[i].x) <= 2 && Math.abs(c.right - b[i].right) <= 2);
  if (headers.some((header) => !same(header.columns, headers[0].columns))) return null;
  // The lowest (last drawn above the rows) of identical repeated headers.
  return headers.reduce((low, header) => header.y < low.y ? header : low);
}

type FigureAlignment = 'right' | 'left';

/** How many distinct positions `edges` take, two within 1.5pt counting as one. */
function edgeClusters(edges: readonly number[]): number {
  const sorted = [...edges].sort((a, b) => a - b);
  let clusters = 0;
  let last = -Infinity;
  for (const edge of sorted) {
    if (edge - last > 1.5) clusters += 1;
    last = edge;
  }
  return clusters;
}

/**
 * Whether a page's money figures are right- or left-aligned, from the
 * figures themselves: an aligned edge takes one position per column, the
 * other edge moves with each figure's width. Null when neither is clearly
 * the case (centred figures, too few to tell): no column is then read.
 */
function figureAlignment(figures: readonly { x: number; right: number }[], columns: number): FigureAlignment | null {
  if (figures.length < 2) return null;
  const right = edgeClusters(figures.map((figure) => figure.right));
  const left = edgeClusters(figures.map((figure) => figure.x));
  if (right <= columns && left > right) return 'right';
  if (left <= columns && right > left) return 'left';
  return null;
}

/**
 * The header column a figure was drawn under, or null.
 *
 * Header labels are printed left, centred or right over their column, so the
 * figure's ALIGNED edge is compared with header edges, not centres. A
 * right-aligned figure in column k ends after header k starts and before
 * header k+1 ends; a left-aligned one starts after header k-1 starts (or no
 * more than one column-width left of the first header) and before header k
 * ends. Neighbouring windows overlap only across one header's width; a
 * figure whose edge lands there could belong to either column and gets none,
 * as does one outside every window (a reference in the description).
 */
function columnAt(
  figure: { x: number; right: number }, columns: readonly HeaderColumn[], alignment: FigureAlignment,
): StatementColumn | null {
  const firstLeft = columns[0].x - (columns.length > 1 ? columns[1].x - columns[0].x : 0);
  const candidates = columns.filter((column, i) => alignment === 'right'
    ? figure.right > column.x && figure.right < (i + 1 < columns.length ? columns[i + 1].right : Infinity)
    : figure.x > (i > 0 ? columns[i - 1].x : firstLeft) && figure.x < column.right);
  return candidates.length === 1 ? candidates[0].column : null;
}

/**
 * The document's text exactly as `unpdf`'s extractText builds it (each run's
 * string, a newline after a run pdf.js marks end-of-line), plus the table
 * column each money figure was drawn under, keyed by the figure's line in
 * `text.join('\n').split(/\n+/)`. A page with no table header of its own
 * uses the last header seen, as a statement's continuation pages do; each
 * page's figure alignment is judged on that page's own figures.
 */
async function pdfTextAndLayout(document: Awaited<ReturnType<typeof getDocumentProxy>>): Promise<{
  totalPages: number; text: string[]; layout: StatementLayout;
}> {
  const pageRuns: PdfTextRun[][] = [];
  for (let page = 1; page <= document.numPages; page += 1) {
    const content = await (await document.getPage(page)).getTextContent();
    pageRuns.push(content.items.flatMap((item) => {
      if (!('str' in item) || item.str == null) return [];
      return [{ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width, hasEOL: item.hasEOL }];
    }));
  }
  const text = pageRuns.map((runs) => runs.map((run) => run.str + (run.hasEOL ? '\n' : '')).join(''));
  const layout = new Map<number, StatementLayoutCell[]>();
  let lineIndex = 0;
  let inBreak = false;
  let header: { y: number; columns: HeaderColumn[] } | null = null;
  pageRuns.forEach((runs, page) => {
    if (page > 0) inBreak = true;
    const own = pageHeaderColumns(runs);
    if (own) header = own;
    const active = header;
    const figures: { line: number; text: string; x: number; right: number }[] = [];
    for (const run of runs) {
      let startLine: number | null = null;
      for (const ch of run.str) {
        if (ch === '\n') { inBreak = true; continue; }
        if (inBreak) { lineIndex += 1; inBreak = false; }
        startLine ??= lineIndex;
      }
      if (run.hasEOL) inBreak = true;
      if (!active || startLine === null) continue;
      // Above the page's own header is the preamble, not the table.
      if (own && run.y > own.y + 1) continue;
      const figure = normalizeDigits(run.str).replace(/\s+/g, ' ').trim();
      if (!MONEY_RUN.test(figure)) continue;
      figures.push({ line: startLine, text: figure, x: run.x, right: run.x + run.width });
    }
    if (!active) return;
    const { columns } = active;
    // Only figures right of where the money columns could begin say how
    // the money is aligned; a reference number in the description does not.
    const firstLeft = columns[0].x - (columns.length > 1 ? columns[1].x - columns[0].x : 0);
    const alignment = figureAlignment(figures.filter((figure) => figure.right > firstLeft), columns.length);
    if (!alignment) return;
    for (const figure of figures) {
      const column = columnAt(figure, columns, alignment);
      if (!column) continue;
      const cells = layout.get(figure.line) ?? [];
      cells.push({ text: figure.text, column });
      layout.set(figure.line, cells);
    }
  });
  return { totalPages: document.numPages, text, layout };
}

export async function extractPdfStatementRows(
  bytes: Uint8Array,
  currency: StatementCurrency,
  password?: string,
  dateHint: StatementDateHint = legacyStatementDateHint(currency),
): Promise<{
  pages: number;
  rows: ParsedSms[];
  totalRows: number;
  rejectedRows: number;
  completeRowAccounting: boolean;
  ambiguousCardSignRows: number;
  ambiguousDateRows: number;
  /** Rejected rows printed without a year that no statement period settles. */
  yearlessDateRows: number;
  /** Carried from the parse: a statement that proves itself says so here too. */
  reconciliation: StatementReconciliation;
  /**
   * The layout of a file this parser read NOTHING from, so the failure can be
   * diagnosed without anyone sending in their statement. Null on every parse
   * that read a row: there is nothing to diagnose, and it costs a pass to build.
   */
  layout: StatementLayoutFingerprint | null;
  /** False when no page carries any text at all: a scan, not a statement layout. */
  textLayer: boolean;
}> {
  // pdf.js reads a password two ways depending on the file's security
  // handler. AES-256 (revision 6) takes the Unicode string and encodes it as
  // UTF-8 itself. RC4/AES-128 (revisions 2–4) and revision 5 take one byte per
  // character, so an Arabic password reaches them truncated unless it is
  // handed over as its UTF-8 bytes — which is how PDF writers commonly encode
  // a non-Latin password there. Which handler a file uses is only known once
  // pdf.js has opened it, so a non-ASCII password that is refused as
  // incorrect is tried once more as UTF-8 bytes. pdf.js detaches the buffer
  // it is given, so that second attempt needs its own copy.
  const utf8Password = password && /[^\x00-\x7f]/.test(password)
    ? Array.from(new TextEncoder().encode(password), (byte) => String.fromCharCode(byte)).join('')
    : undefined;
  const retryBytes = utf8Password === undefined ? null : bytes.slice();
  let document: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    document = await getDocumentProxy(bytes, password ? { password } : undefined);
  } catch (error) {
    const incorrect = !!error && typeof error === 'object' &&
      (error as { name?: unknown }).name === 'PasswordException' &&
      (error as { code?: unknown }).code === 2;
    if (!retryBytes || !incorrect) throw error;
    document = await getDocumentProxy(retryBytes, { password: utf8Password });
  }
  try {
    const extracted = await pdfTextAndLayout(document);
    const text = extracted.text.join('\n');
    // Its own code, not the generic unreadable one: a long text statement is
    // not a scan, and telling the user it is sends them the wrong way.
    if (text.length > MAX_NORMALIZED_CHARS) throw new Error('pdf_too_long');
    const parsed = parseStatementLines(text, currency, { card: null }, dateHint, extracted.layout, extracted.text);
    return {
      pages: extracted.totalPages,
      rows: parsed.rows,
      totalRows: parsed.totalRows,
      rejectedRows: parsed.rejectedRows,
      // A blank text layer may be a scanned transaction page. It cannot
      // establish coverage even when other pages yielded valid transactions.
      completeRowAccounting: parsed.completeRowAccounting && extracted.text.every((page) => page.trim().length > 0),
      ambiguousCardSignRows: parsed.ambiguousCardSignRows,
      ambiguousDateRows: parsed.ambiguousDateRows,
      yearlessDateRows: parsed.yearlessDateRows,
      reconciliation: parsed.reconciliation,
      layout: parsed.rows.length === 0 ? statementLayoutFingerprint(text, currency) : null,
      textLayer: extracted.text.some((page) => page.trim().length > 0),
    };
  } finally {
    const disposable = document as unknown as {
      destroy?: () => Promise<void> | void;
      cleanup?: () => Promise<void> | void;
    };
    if (disposable.destroy) await disposable.destroy();
    else if (disposable.cleanup) await disposable.cleanup();
  }
}

/**
 * The PDF failures pdf.js names precisely enough to tell the user something
 * truer than "this is a scan". Anything else returns null and stays the
 * generic unreadable code.
 *
 *  - InvalidPDFException: no usable document structure at all (truncated,
 *    not really a PDF past its header). Errors raised inside pdf.js's parser
 *    reach here wrapped as UnknownErrorException, with the original class in
 *    `details`; end-of-file inside an object and broken cross-reference
 *    tables are structural damage too.
 *  - A security handler pdf.js does not implement — a certificate (public
 *    key) handler, an unknown algorithm version or crypt method — cannot be
 *    opened even with the right password.
 *
 * Password failures are not handled here; see pdfPasswordFailure in the
 * Worker.
 */
export function pdfOpenFailure(error: unknown): 'pdf_damaged' | 'pdf_encryption_unsupported' | null {
  if (!error || typeof error !== 'object') return null;
  const row = error as { name?: unknown; details?: unknown };
  if (row.name === 'InvalidPDFException') return 'pdf_damaged';
  if (row.name !== 'UnknownErrorException' || typeof row.details !== 'string') return null;
  if (/^FormatError: (?:unknown encryption method|unsupported encryption algorithm|Unknown crypto method)$/.test(row.details)) {
    return 'pdf_encryption_unsupported';
  }
  if (/^(?:InvalidPDFException|ParserEOFException|XRefParseException|XRefEntryException): /.test(row.details)) {
    return 'pdf_damaged';
  }
  return null;
}
