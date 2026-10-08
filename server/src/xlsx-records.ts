/**
 * The first worksheet of an Excel .xlsx file, as the rows a CSV export of it
 * would hold — and nothing else.
 *
 * This exists so a bank's "Export to Excel" button can feed the SAME named-
 * column statement parser a CSV does (imports.ts › parseStatementRecords).
 * Nothing here interprets money, dates or direction beyond turning a cell's
 * stored value into the text a careful CSV export would print:
 *
 *  - shared, inline and formula-string cells → their text;
 *  - booleans → TRUE / FALSE;
 *  - numbers → their stored decimal text, never re-formatted through a float,
 *    so a stored 1234.5 is "1234.5" and cents cannot drift. An exponent the
 *    writer used ("1.5E+2") is expanded by moving the decimal point in the
 *    digit string, not by arithmetic;
 *  - numbers whose cell style is a DATE format → an ISO YYYY-MM-DD from the
 *    workbook's own date system (1900 or 1904). That is unambiguous, so the
 *    day/month question a CSV's "05/07/2026" raises never comes up.
 *
 * No dependency. A .xlsx is a ZIP of XML parts; this reads the ZIP central
 * directory itself and inflates entries with the runtime's
 * DecompressionStream('deflate-raw') (Workers and Node 22 both ship it).
 * Untrusted input, so every limit is explicit and every unexpected shape is a
 * refusal (`invalid_xlsx`), never a best guess:
 *
 *  - stored (0) and deflate (8) entries only; encrypted entries, ZIP64 and
 *    multi-disk archives are refused;
 *  - at most MAX_ZIP_ENTRIES entries and MAX_DECLARED_ARCHIVE_BYTES of
 *    declared output across the archive; of that, only the handful of parts
 *    read here are ever inflated, together at most
 *    MAX_TOTAL_UNCOMPRESSED_BYTES, and each inflate is cut off the moment it
 *    produces more than its entry declared — the zip-bomb ratio cannot
 *    exceed the cap;
 *  - every inflated entry must match its declared size and CRC-32;
 *  - XML is read by a small tokenizer with no DTD support at all: a DOCTYPE
 *    or ENTITY declaration is refused, and only the five predefined entities
 *    and numeric character references are expanded, in one linear pass;
 *  - memory is bounded WHILE scanning, never after: elements and attributes
 *    per part, characters per text node, attribute, cell and shared string,
 *    and the shared-string table's entry count and total characters each
 *    have a ceiling, and the first one crossed refuses the file.
 *
 * It never logs and never persists; the caller hands the bytes in and gets
 * string rows back.
 */

export const MAX_ZIP_ENTRIES = 2_000;
/**
 * XML actually inflated and scanned for one workbook (workbook, relationships,
 * styles, shared strings, the sheet). The statement is at most ~211 non-empty
 * rows (200 + preamble + header) of at most 8,192 characters each — about
 * 1.7 M characters of cell text in the most extreme legal case, and well
 * under 500 KB of XML for a real bank export. 4 MB leaves room for markup,
 * styling and empty formatted rows while keeping one request's string
 * memory a small fraction of a Worker's 128 MB.
 */
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 4 * 1024 * 1024;
/**
 * Declared output across EVERY entry, read or not — a sanity bound on the
 * directory only; entries this reader never opens (images, themes, printer
 * settings) are never inflated, so this costs no memory.
 */
export const MAX_DECLARED_ARCHIVE_BYTES = 16 * 1024 * 1024;
/** The longest text one cell, shared string or text node may decode to. */
export const MAX_CELL_CHARS = 8_192;
/** Raw (still entity-encoded) characters in one text node or attribute. */
const MAX_RAW_TEXT_CHARS = 6 * MAX_CELL_CHARS;
const MAX_RAW_ATTRIBUTE_CHARS = 2_048;
const MAX_NAME_CHARS = 128;
const MAX_ATTRIBUTES_PER_ELEMENT = 64;
/** Start tags per XML part; 4 MB of `<a/>` would be a million. */
export const MAX_ELEMENTS_PER_PART = 300_000;
/** Shared strings: far more than any statement's distinct cell texts. */
export const MAX_SHARED_STRINGS = 50_000;
export const MAX_SHARED_STRING_CHARS = 2_000_000;
/** Excel's own grid. A reference past it is not a real sheet. */
const MAX_SHEET_ROWS = 1_048_576;
const MAX_SHEET_COLUMNS = 16_384;

export type XlsxFailure = 'invalid_xlsx' | 'too_many_rows' | 'unsupported_statement_format';

export class XlsxError extends Error {
  constructor(readonly code: XlsxFailure) {
    super(code);
    this.name = 'XlsxError';
  }
}

function invalid(): never {
  throw new XlsxError('invalid_xlsx');
}

/* ───────────────────────────────── ZIP ───────────────────────────────── */

interface ZipEntry {
  name: string;
  method: 0 | 8;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

interface ZipArchive {
  bytes: Uint8Array;
  /** Lower-cased part name → entry. OPC part names compare case-insensitively. */
  entries: Map<string, ZipEntry>;
  /** Where the central directory starts; no entry's data may run past it. */
  dataLimit: number;
  /** Output still allowed across every entry this request inflates. */
  remaining: number;
}

const u16 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number): number =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;

function readZip(bytes: Uint8Array): ZipArchive {
  if (bytes.length < 22 || u32(bytes, 0) !== SIG_LOCAL) invalid();
  // The end-of-central-directory record is the last 22 bytes plus its own
  // comment. Accept only a record whose comment ends exactly at end of file,
  // so trailing bytes cannot smuggle a second, different directory.
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 0xffff); offset -= 1) {
    if (u32(bytes, offset) === SIG_EOCD && offset + 22 + u16(bytes, offset + 20) === bytes.length) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) invalid();
  const diskNumber = u16(bytes, eocd + 4);
  const directoryDisk = u16(bytes, eocd + 6);
  const entriesOnDisk = u16(bytes, eocd + 8);
  const totalEntries = u16(bytes, eocd + 10);
  const directorySize = u32(bytes, eocd + 12);
  const directoryOffset = u32(bytes, eocd + 16);
  // ZIP64 marks itself with saturated fields and a locator right before EOCD.
  if (
    totalEntries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff ||
    (eocd >= 20 && u32(bytes, eocd - 20) === SIG_ZIP64_LOCATOR)
  ) invalid();
  if (diskNumber !== 0 || directoryDisk !== 0 || entriesOnDisk !== totalEntries) invalid();
  if (totalEntries === 0 || totalEntries > MAX_ZIP_ENTRIES) invalid();
  if (directoryOffset + directorySize > eocd) invalid();

  const names = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  const entries = new Map<string, ZipEntry>();
  let declaredTotal = 0;
  let p = directoryOffset;
  const end = directoryOffset + directorySize;
  for (let index = 0; index < totalEntries; index += 1) {
    if (p + 46 > end || u32(bytes, p) !== SIG_CENTRAL) invalid();
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const crc = u32(bytes, p + 16);
    const compressedSize = u32(bytes, p + 20);
    const uncompressedSize = u32(bytes, p + 24);
    const nameLength = u16(bytes, p + 28);
    const extraLength = u16(bytes, p + 30);
    const commentLength = u16(bytes, p + 32);
    const startDisk = u16(bytes, p + 34);
    const localOffset = u32(bytes, p + 42);
    const next = p + 46 + nameLength + extraLength + commentLength;
    if (next > end) invalid();
    // Bit 0: traditional encryption. Bit 6: strong encryption. Bit 13:
    // encrypted central directory. None is something to open here.
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0 || (flags & 0x2000) !== 0) invalid();
    if (method !== 0 && method !== 8) invalid();
    if (
      compressedSize === 0xffffffff || uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff || startDisk !== 0
    ) invalid();
    for (let q = p + 46 + nameLength; q + 4 <= p + 46 + nameLength + extraLength;) {
      const id = u16(bytes, q);
      const size = u16(bytes, q + 2);
      if (id === 0x0001) invalid(); // ZIP64 extended information
      q += 4 + size;
    }
    let name = '';
    try {
      name = names.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    } catch {
      invalid();
    }
    if (name.length === 0 || name.includes('\0')) invalid();
    const key = name.toLowerCase();
    if (entries.has(key)) invalid();
    declaredTotal += uncompressedSize;
    if (declaredTotal > MAX_DECLARED_ARCHIVE_BYTES) invalid();
    if (localOffset + 30 > directoryOffset) invalid();
    entries.set(key, { name, method: method as 0 | 8, crc, compressedSize, uncompressedSize, localOffset });
    p = next;
  }
  return { bytes, entries, dataLimit: directoryOffset, remaining: MAX_TOTAL_UNCOMPRESSED_BYTES };
}

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Inflate one raw-deflate stream into exactly `expected` bytes. Reading stops
 * the moment the output would exceed that, so a forged size cannot become a
 * bomb; a short, truncated or trailing-garbage stream is refused too.
 */
async function inflateRaw(data: Uint8Array<ArrayBuffer>, expected: number): Promise<Uint8Array> {
  const out = new Uint8Array(expected);
  let length = 0;
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const writing = (async () => {
    await writer.write(data);
    await writer.close();
  })();
  // Observed below; this only stops an early refusal from surfacing as an
  // unhandled rejection while the read side is being torn down.
  writing.catch(() => {});
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.byteLength > expected - length) throw new XlsxError('invalid_xlsx');
      out.set(value, length);
      length += value.byteLength;
    }
    await writing;
  } catch {
    await reader.cancel().catch(() => {});
    await writer.abort().catch(() => {});
    invalid();
  }
  if (length !== expected) invalid();
  return out;
}

async function readEntry(zip: ZipArchive, name: string): Promise<Uint8Array | null> {
  const entry = zip.entries.get(name.toLowerCase());
  if (!entry) return null;
  const { bytes } = zip;
  const at = entry.localOffset;
  if (u32(bytes, at) !== SIG_LOCAL) invalid();
  // The local header must agree with the directory about encryption and
  // method; its own sizes may be zero (data descriptor), so the directory's
  // are the ones used.
  if ((u16(bytes, at + 6) & 0x0001) !== 0 || u16(bytes, at + 8) !== entry.method) invalid();
  const start = at + 30 + u16(bytes, at + 26) + u16(bytes, at + 28);
  const end = start + entry.compressedSize;
  if (end > zip.dataLimit) invalid();
  if (entry.uncompressedSize > zip.remaining) invalid();
  zip.remaining -= entry.uncompressedSize;
  let data: Uint8Array;
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) invalid();
    data = bytes.slice(start, end);
  } else {
    data = await inflateRaw(bytes.slice(start, end), entry.uncompressedSize);
  }
  if (crc32(data) !== entry.crc) invalid();
  return data;
}

/* ───────────────────────────────── XML ───────────────────────────────── */

interface XmlHandler {
  open(name: string, attributes: Map<string, string>, selfClosing: boolean): void;
  close(name: string): void;
  text(value: string): void;
}

/** `x:sheetData` and `sheetData` are the same element; so are `r:id` and `id`. */
function localName(qualified: string): string {
  const colon = qualified.indexOf(':');
  return colon < 0 ? qualified : qualified.slice(colon + 1);
}

const PREDEFINED_ENTITIES: Record<string, string> = {
  lt: '<', gt: '>', amp: '&', quot: '"', apos: "'",
};

const ENTITY = /&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|lt|gt|amp|quot|apos);/g;
const STRAY_AMPERSAND = /&(?!(?:#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|lt|gt|amp|quot|apos);)/;

/**
 * Expand the five predefined entities and numeric references in ONE
 * `replace` pass — linear time and a single flat result string. (Building the
 * result by repeated concatenation made millions of tiny rope segments: a
 * 20 KB upload of `&amp;` × 4,000,000 exhausted the heap.) Callers bound the
 * input's length first. Anything else after `&` refuses the file.
 */
function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  if (STRAY_AMPERSAND.test(value)) invalid();
  return value.replace(ENTITY, (_match, body: string) => {
    if (body[0] !== '#') return PREDEFINED_ENTITIES[body];
    const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    if (!Number.isInteger(code) || code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) invalid();
    return String.fromCodePoint(code);
  });
}

/** A text node, bounded BEFORE it is decoded or handed on. */
function textNode(raw: string): string {
  if (raw.length > MAX_RAW_TEXT_CHARS) invalid();
  const decoded = decodeEntities(raw);
  if (decoded.length > MAX_CELL_CHARS) invalid();
  return decoded;
}

const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';

function scanXml(xml: string, handler: XmlHandler): void {
  const n = xml.length;
  let i = 0;
  let elements = 0;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      handler.text(textNode(xml.slice(i)));
      break;
    }
    if (lt > i) handler.text(textNode(xml.slice(i, lt)));
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end < 0) invalid();
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end < 0) invalid();
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) invalid();
      const cdata = xml.slice(lt + 9, end);
      if (cdata.length > MAX_CELL_CHARS) invalid();
      handler.text(cdata);
      i = end + 3;
      continue;
    }
    // <!DOCTYPE, <!ENTITY and anything else in the declaration family: a
    // spreadsheet part never needs one and entity expansion is the classic
    // XML bomb, so the whole file is refused.
    if (xml[lt + 1] === '!') invalid();
    if (xml[lt + 1] === '/') {
      const end = xml.indexOf('>', lt + 2);
      if (end < 0) invalid();
      const name = xml.slice(lt + 2, end).trim();
      if (!name || name.length > MAX_NAME_CHARS) invalid();
      handler.close(localName(name));
      i = end + 1;
      continue;
    }
    let j = lt + 1;
    while (j < n && !isSpace(xml[j]) && xml[j] !== '>' && xml[j] !== '/') j += 1;
    const name = xml.slice(lt + 1, j);
    if (!name || name.length > MAX_NAME_CHARS) invalid();
    elements += 1;
    if (elements > MAX_ELEMENTS_PER_PART) invalid();
    let attributeCount = 0;
    const attributes = new Map<string, string>();
    let selfClosing = false;
    for (;;) {
      while (j < n && isSpace(xml[j])) j += 1;
      if (j >= n) invalid();
      if (xml[j] === '>') {
        j += 1;
        break;
      }
      if (xml[j] === '/') {
        if (xml[j + 1] !== '>') invalid();
        selfClosing = true;
        j += 2;
        break;
      }
      const nameStart = j;
      while (j < n && !isSpace(xml[j]) && xml[j] !== '=' && xml[j] !== '>' && xml[j] !== '/') j += 1;
      const attribute = xml.slice(nameStart, j);
      while (j < n && isSpace(xml[j])) j += 1;
      if (!attribute || attribute.length > MAX_NAME_CHARS || xml[j] !== '=') invalid();
      attributeCount += 1;
      if (attributeCount > MAX_ATTRIBUTES_PER_ELEMENT) invalid();
      j += 1;
      while (j < n && isSpace(xml[j])) j += 1;
      const quote = xml[j];
      if (quote !== '"' && quote !== "'") invalid();
      const close = xml.indexOf(quote, j + 1);
      if (close < 0) invalid();
      if (close - j - 1 > MAX_RAW_ATTRIBUTE_CHARS) invalid();
      const value = xml.slice(j + 1, close);
      if (value.includes('<')) invalid();
      const key = localName(attribute);
      // Namespace declarations are not data; the first non-namespace
      // attribute of a local name wins.
      if (attribute !== 'xmlns' && !attribute.startsWith('xmlns:') && !attributes.has(key)) {
        attributes.set(key, decodeEntities(value));
      }
      j = close + 1;
    }
    handler.open(localName(name), attributes, selfClosing);
    if (selfClosing) handler.close(localName(name));
    i = j;
  }
}

function decodeXml(bytes: Uint8Array): string {
  try {
    // A UTF-8 BOM, when present, is dropped by the decoder.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return invalid();
  }
}

/* ─────────────────────────── Workbook structure ─────────────────────────── */

interface Relationship {
  type: string;
  target: string;
}

function parseRelationships(xml: string, baseDirectory: string): Map<string, Relationship> {
  const relationships = new Map<string, Relationship>();
  scanXml(xml, {
    open(name, attributes) {
      if (name !== 'Relationship') return;
      const id = attributes.get('Id');
      const type = attributes.get('Type');
      const target = attributes.get('Target');
      if (!id || !type || !target) return;
      if ((attributes.get('TargetMode') ?? '').toLowerCase() === 'external') return;
      relationships.set(id, { type, target: resolvePartName(baseDirectory, target) });
    },
    close() {},
    text() {},
  });
  return relationships;
}

/** A relationship target, resolved against its source part's folder. */
function resolvePartName(baseDirectory: string, target: string): string {
  const absolute = target.startsWith('/');
  const parts = (absolute ? target.slice(1) : `${baseDirectory}${target}`).split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  return resolved.join('/');
}

function directoryOf(partName: string): string {
  const slash = partName.lastIndexOf('/');
  return slash < 0 ? '' : partName.slice(0, slash + 1);
}

function relationshipsPartOf(partName: string): string {
  const slash = partName.lastIndexOf('/');
  return `${partName.slice(0, slash + 1)}_rels/${partName.slice(slash + 1)}.rels`;
}

const relationshipOfType = (relationships: Map<string, Relationship>, suffix: string): Relationship | undefined =>
  [...relationships.values()].find((relationship) => relationship.type.endsWith(suffix));

interface WorkbookSheet {
  relationshipId: string;
  hidden: boolean;
}

function parseWorkbook(xml: string): { date1904: boolean; sheets: WorkbookSheet[] } {
  let date1904 = false;
  const sheets: WorkbookSheet[] = [];
  scanXml(xml, {
    open(name, attributes) {
      if (name === 'workbookPr') {
        const value = (attributes.get('date1904') ?? '').toLowerCase();
        date1904 = value === '1' || value === 'true';
      } else if (name === 'sheet') {
        const relationshipId = attributes.get('id');
        if (!relationshipId) return;
        const state = attributes.get('state') ?? 'visible';
        sheets.push({ relationshipId, hidden: state === 'hidden' || state === 'veryHidden' });
      }
    },
    close() {},
    text() {},
  });
  return { date1904, sheets };
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  let totalChars = 0;
  let inItem = false;
  let inText = false;
  // Phonetic guides (<rPh>) carry a reading of the text, not more text.
  let phonetic = 0;
  let current = '';
  scanXml(xml, {
    open(name) {
      if (name === 'si') {
        inItem = true;
        current = '';
      } else if (name === 'rPh') phonetic += 1;
      else if (name === 't' && inItem && phonetic === 0) inText = true;
    },
    close(name) {
      if (name === 'si') {
        if (strings.length >= MAX_SHARED_STRINGS) invalid();
        totalChars += current.length;
        if (totalChars > MAX_SHARED_STRING_CHARS) invalid();
        strings.push(current);
        inItem = false;
      } else if (name === 'rPh') phonetic = Math.max(0, phonetic - 1);
      else if (name === 't') inText = false;
    },
    text(value) {
      if (!inText) return;
      if (current.length + value.length > MAX_CELL_CHARS) invalid();
      current += value;
    },
  });
  return strings;
}

/** Which cellXfs indexes carry a date (not a pure time) number format. */
function parseDateStyles(xml: string): boolean[] {
  const customFormats = new Map<number, string>();
  const styleFormats: number[] = [];
  let inCellXfs = 0;
  let xfDepth = 0;
  scanXml(xml, {
    open(name, attributes) {
      if (name === 'numFmt') {
        const id = Number(attributes.get('numFmtId'));
        const code = attributes.get('formatCode');
        if (Number.isInteger(id) && code !== undefined) customFormats.set(id, code);
      } else if (name === 'cellXfs') {
        inCellXfs += 1;
      } else if (name === 'xf' && inCellXfs > 0) {
        // Only direct xf children of cellXfs are cell styles; cellStyleXfs
        // holds the named-style masters a cell's `s` never indexes.
        if (xfDepth === 0) styleFormats.push(Number(attributes.get('numFmtId') ?? 0));
        xfDepth += 1;
      }
    },
    // scanXml closes a self-closing element itself, so open/close always pair.
    close(name) {
      if (name === 'cellXfs') inCellXfs = Math.max(0, inCellXfs - 1);
      else if (name === 'xf' && xfDepth > 0) xfDepth -= 1;
    },
    text() {},
  });
  return styleFormats.map((id) => {
    const code = customFormats.get(id);
    if (code !== undefined) return isDateFormatCode(code);
    return BUILT_IN_DATE_FORMATS.has(id);
  });
}

/**
 * ECMA-376 built-in formats that show a calendar date: 14–17 (m/d/yyyy,
 * d-mmm-yy, d-mmm, mmm-yy) and 22 (m/d/yyyy h:mm). 18–21 and 45–47 are
 * time-of-day/duration formats with no date in them, so those cells keep
 * their stored number. The locale-specific East Asian ids (27–36, 50–58)
 * are not assumed: a date number left as a number fails the statement's date
 * check and the row is refused — never misread.
 */
const BUILT_IN_DATE_FORMATS = new Set([14, 15, 16, 17, 22]);

/**
 * A custom number format shows a date when its first section uses a day or
 * year token, or a month token with no hour/second beside it (`mm` next to
 * `h` or `s` is minutes). Quoted text, escaped characters, fill/space
 * directives and [colour]/[$locale] brackets are not tokens.
 */
export function isDateFormatCode(code: string): boolean {
  let stripped = '';
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];
    if (c === '"') {
      const close = code.indexOf('"', i + 1);
      i = close < 0 ? code.length : close;
    } else if (c === '\\' || c === '_' || c === '*') {
      i += 1;
    } else if (c === '[') {
      const close = code.indexOf(']', i + 1);
      const inside = code.slice(i + 1, close < 0 ? code.length : close);
      // [h], [mm], [ss]: elapsed time, which is a time token.
      if (/^[hms]+$/i.test(inside)) stripped += 'h';
      i = close < 0 ? code.length : close;
    } else if (c === ';') {
      break;
    } else {
      stripped += c;
    }
  }
  const tokens = stripped.toLowerCase().replace(/am\/pm|a\/p/g, '');
  if (/[dy]/.test(tokens)) return true;
  return /m/.test(tokens) && !/[hs]/.test(tokens);
}

/** Days from the workbook's epoch to an ISO date, or null when not a real date. */
export function serialToIsoDate(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial)) return null;
  const day = Math.floor(serial);
  let ms: number;
  if (date1904) {
    if (day < 0) return null;
    ms = Date.UTC(1904, 0, 1) + day * 86_400_000;
  } else {
    // Serial 60 is Lotus's 29 February 1900, a day that never existed. Before
    // it the epoch is 31 Dec 1899; after it, 30 Dec 1899 absorbs the phantom.
    if (day < 1 || day === 60) return null;
    ms = Date.UTC(1899, 11, day < 60 ? 31 : 30) + day * 86_400_000;
  }
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) return null;
  return date.toISOString().slice(0, 10);
}

const NUMBER_TEXT = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d{1,4}))?$/;

/**
 * A stored number as plain decimal text, digit for digit. No float is
 * involved: "1234.50" stays "1234.50", "-0.75" stays "-0.75", and "1.5E+2"
 * becomes "150" by moving the point in the digit string. Text that is not a
 * number is returned unchanged, so the statement parser refuses it on its own
 * terms.
 */
export function plainDecimal(raw: string): string {
  const text = raw.trim();
  const match = NUMBER_TEXT.exec(text);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) return text;
  const sign = match[1] === '-' ? '-' : '';
  const integer = match[2];
  const fraction = match[3] ?? '';
  if (match[4] === undefined) {
    return `${sign}${integer || '0'}${match[3] !== undefined && fraction ? `.${fraction}` : ''}`;
  }
  const exponent = Number(match[4]);
  if (Math.abs(exponent) > 400) return text;
  const digits = integer + fraction;
  const point = integer.length + exponent;
  let whole: string;
  let decimals: string;
  if (point <= 0) {
    whole = '0';
    decimals = '0'.repeat(-point) + digits;
  } else if (point >= digits.length) {
    whole = digits + '0'.repeat(point - digits.length);
    decimals = '';
  } else {
    whole = digits.slice(0, point);
    decimals = digits.slice(point);
  }
  whole = whole.replace(/^0+(?=\d)/, '');
  decimals = decimals.replace(/0+$/, '');
  return `${sign}${whole}${decimals ? `.${decimals}` : ''}`;
}

function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

export interface XlsxRecordLimits {
  /** Non-empty rows beyond this are refused as too_many_rows. */
  maxRecords: number;
  /** Columns beyond this cannot hold a header the statement parser accepts. */
  maxColumns: number;
  /** Characters per row, the CSV reader's own record ceiling. */
  maxRecordChars: number;
}

interface CellDraft {
  column: number;
  type: string;
  style: number;
  value: string;
  inline: string;
}

function parseSheet(
  xml: string,
  sharedStrings: readonly string[] | null,
  dateStyles: readonly boolean[],
  date1904: boolean,
  limits: XlsxRecordLimits,
): string[][] {
  const rows: { cells: [number, string][] }[] = [];
  let widest = 0;
  let inSheetData = false;
  let rowNumber = 0;
  let previousColumn = -1;
  let rowCells: [number, string][] | null = null;
  let cell: CellDraft | null = null;
  let inValue = false;
  let inInline = false;
  let inInlineText = false;
  let phonetic = 0;

  const finishCell = (draft: CellDraft): void => {
    let value: string;
    switch (draft.type) {
      case 's': {
        if (draft.value.trim() === '') {
          value = '';
          break;
        }
        const index = Number(draft.value.trim());
        if (!sharedStrings || !Number.isInteger(index) || index < 0 || index >= sharedStrings.length) invalid();
        value = sharedStrings![index];
        break;
      }
      case 'inlineStr':
        value = draft.inline;
        break;
      case 'str':
      case 'e':
        value = draft.value;
        break;
      case 'b':
        value = draft.value.trim() === '1' ? 'TRUE' : draft.value.trim() === '0' ? 'FALSE' : draft.value;
        break;
      case 'd': {
        const iso = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(draft.value.trim());
        value = iso ? iso[1] : draft.value;
        break;
      }
      case 'n': {
        const raw = draft.value.trim();
        if (raw === '') {
          value = '';
          break;
        }
        const date = dateStyles[draft.style] === true && NUMBER_TEXT.test(raw)
          ? serialToIsoDate(Number(raw), date1904)
          : null;
        value = date ?? plainDecimal(raw);
        break;
      }
      default:
        return invalid();
    }
    value = value.trim();
    if (value === '' || !rowCells) return;
    rowCells.push([draft.column, value]);
  };

  scanXml(xml, {
    open(name, attributes) {
      if (name === 'sheetData') {
        inSheetData = true;
        return;
      }
      if (!inSheetData) return;
      if (name === 'row') {
        const stated = attributes.get('r');
        const next = stated === undefined ? rowNumber + 1 : Number(stated);
        if (!Number.isInteger(next) || next <= rowNumber || next > MAX_SHEET_ROWS) invalid();
        rowNumber = next;
        previousColumn = -1;
        rowCells = [];
        return;
      }
      if (name === 'c') {
        if (!rowCells) invalid();
        const reference = attributes.get('r');
        let column: number;
        if (reference === undefined) {
          column = previousColumn + 1;
        } else {
          const parsed = /^([A-Z]{1,3})([0-9]+)$/.exec(reference);
          if (!parsed || Number(parsed[2]) !== rowNumber) invalid();
          column = columnIndex(parsed![1]);
        }
        if (column <= previousColumn || column >= MAX_SHEET_COLUMNS) invalid();
        previousColumn = column;
        const style = Number(attributes.get('s') ?? 0);
        if (!Number.isInteger(style) || style < 0) invalid();
        cell = { column, type: attributes.get('t') ?? 'n', style, value: '', inline: '' };
        return;
      }
      if (!cell) return;
      if (name === 'v') inValue = true;
      else if (name === 'is') inInline = true;
      else if (name === 'rPh') phonetic += 1;
      else if (name === 't' && inInline && phonetic === 0) inInlineText = true;
    },
    close(name) {
      if (name === 'sheetData') {
        inSheetData = false;
        return;
      }
      if (!inSheetData) return;
      if (name === 'c' && cell) {
        finishCell(cell);
        cell = null;
        inValue = inInline = inInlineText = false;
        phonetic = 0;
      } else if (name === 'row' && rowCells) {
        if (rowCells.length > 0) {
          if (rows.length >= limits.maxRecords) throw new XlsxError('too_many_rows');
          let characters = 0;
          for (const [column, value] of rowCells) {
            widest = Math.max(widest, column + 1);
            characters += value.length;
          }
          if (characters > limits.maxRecordChars) invalid();
          rows.push({ cells: rowCells });
        }
        rowCells = null;
      } else if (name === 'v') inValue = false;
      else if (name === 'is') inInline = false;
      else if (name === 'rPh') phonetic = Math.max(0, phonetic - 1);
      else if (name === 't') inInlineText = false;
    },
    text(value) {
      if (!cell) return;
      if (inValue) {
        if (cell.value.length + value.length > MAX_CELL_CHARS) invalid();
        cell.value += value;
      } else if (inInlineText) {
        if (cell.inline.length + value.length > MAX_CELL_CHARS) invalid();
        cell.inline += value;
      }
    },
  });
  if (rowCells !== null || cell !== null) invalid();
  // A header the statement parser can accept is at most this wide, and a
  // CSV export of this sheet would be exactly `widest` columns on every line.
  if (widest > limits.maxColumns) throw new XlsxError('unsupported_statement_format');
  return rows.map(({ cells }) => {
    const record = new Array<string>(widest).fill('');
    for (const [column, value] of cells) record[column] = value;
    return record;
  });
}

/**
 * The first visible worksheet of an .xlsx as rectangular string rows: one
 * per non-empty sheet row, padded to the sheet's widest non-empty column,
 * each cell trimmed — the shape a CSV reader with `trim` and
 * `skip_empty_lines` produces from a CSV export of the same sheet.
 */
export async function xlsxSheetRecords(bytes: Uint8Array, limits: XlsxRecordLimits): Promise<string[][]> {
  const zip = readZip(bytes);
  const part = async (name: string): Promise<string | null> => {
    const data = await readEntry(zip, name);
    return data ? decodeXml(data) : null;
  };
  const rootRelationships = await part('_rels/.rels');
  const workbookPath = (rootRelationships
    ? relationshipOfType(parseRelationships(rootRelationships, ''), '/officeDocument')?.target
    : undefined) ?? 'xl/workbook.xml';
  const workbookXml = await part(workbookPath);
  if (workbookXml === null) invalid();
  const workbookRelationshipsXml = await part(relationshipsPartOf(workbookPath));
  if (workbookRelationshipsXml === null) invalid();
  const relationships = parseRelationships(workbookRelationshipsXml!, directoryOf(workbookPath));
  const workbook = parseWorkbook(workbookXml!);
  const sheet = workbook.sheets
    .filter((candidate) => !candidate.hidden)
    .map((candidate) => relationships.get(candidate.relationshipId))
    .find((relationship) => relationship?.type.endsWith('/worksheet'));
  if (!sheet) invalid();

  const sharedStringsPath = relationshipOfType(relationships, '/sharedStrings')?.target;
  const stylesPath = relationshipOfType(relationships, '/styles')?.target;
  const sharedStringsXml = sharedStringsPath ? await part(sharedStringsPath) : null;
  const stylesXml = stylesPath ? await part(stylesPath) : null;
  const sheetXml = await part(sheet!.target);
  if (sheetXml === null) invalid();
  return parseSheet(
    sheetXml!,
    sharedStringsXml === null ? null : parseSharedStrings(sharedStringsXml),
    stylesXml === null ? [] : parseDateStyles(stylesXml),
    workbook.date1904,
    limits,
  );
}
