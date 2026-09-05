/** A malformed complete local-money token, before any numeric conversion. */
export interface MalformedMoneyToken {
  start: number;
  end: number;
  /** Currency start for prefix amounts, number start for suffix amounts. */
  contextStart: number;
}

const VALID_LOCAL_NUMBER = /^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?|\.\d{1,2})$/;
const scanners = new Map<string, { prefix: RegExp; suffix: RegExp; localCode: RegExp }>();

/**
 * Inspect complete AED/SAR-style tokens rather than trusting a regex prefix.
 * Input and currency aliases are already orthography-normalized by the caller.
 * This validates syntax only; it never guesses comma-decimal interpretations,
 * rounds excess precision, chooses a transaction, or changes foreign money.
 */
export function malformedLocalMoneyTokens(
  text: string,
  currencyAliases: readonly string[],
): MalformedMoneyToken[] {
  const key = currencyAliases.join('|');
  let scanner = scanners.get(key);
  if (!scanner) {
    const currency = `(?:${key})`;
    const number = String.raw`(?:\d[\d.,]*|\.\d[\d.,]*)(?:[ \u00a0\u2009\u202f]+\d[\d.,]*)*(?:[eE][+-]?\d+)?`;
    scanner = {
      prefix: new RegExp(String.raw`(?<![\p{L}])${currency}(?![\p{L}])\s*(${number})`, 'giu'),
      suffix: new RegExp(String.raw`(${number})\s*${currency}(?![\p{L}])`, 'giu'),
      localCode: new RegExp(`^${currency}$`, 'iu'),
    };
    scanners.set(key, scanner);
  }
  const { prefix, suffix, localCode } = scanner;
  const invalid = new Map<string, MalformedMoneyToken>();
  const note = (match: RegExpMatchArray, prefixForm: boolean) => {
    const numberText = match[1].replace(/[.,]+$/, '');
    const start = prefixForm ? match.index! + match[0].length - match[1].length : match.index!;
    if (!prefixForm) {
      // A masked/identifier fragment cannot become money, nor can an adjacent
      // foreign prefix ("KWD 12.345 AED ...") acquire the local scale.
      if (/[\p{L}\d*•·.,/\-]/u.test(text[start - 1] ?? '')) return;
      if (/[Xx*•·]+\s*$/.test(text.slice(Math.max(0, start - 20), start))) return;
      const foreign = text.slice(Math.max(0, start - 10), start).match(/\b([A-Z]{3})\s*$/i);
      if (foreign && !localCode.test(foreign[1])) return;
    }
    if (VALID_LOCAL_NUMBER.test(numberText)) return;
    const end = start + numberText.length;
    const key = `${start}:${end}`;
    if (!invalid.has(key)) invalid.set(key, { start, end, contextStart: match.index! });
  };
  for (const match of text.matchAll(prefix)) note(match, true);
  for (const match of text.matchAll(suffix)) note(match, false);
  return [...invalid.values()].sort((a, b) => a.start - b.start);
}
