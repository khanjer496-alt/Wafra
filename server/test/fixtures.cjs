// Synthetic statement files for the server suites, built byte by byte so no
// fixture is an opaque binary in the repository: an .xlsx is a ZIP written
// here (stored or deflated entries — node:zlib is a test-only dependency),
// and an encrypted PDF uses the PDF 1.1 Standard security handler (RC4,
// revision 2), implemented below in a few lines.
const zlib = require('node:zlib');
const { createHash } = require('node:crypto');

/* ──────────────────────────────── ZIP ──────────────────────────────── */

function u16(value) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value);
  return b;
}
function u32(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value >>> 0);
  return b;
}

/**
 * entries: [{ name, data, method?: 0 | 8, flags?, declaredSize?, extra?,
 * zip64? }]. `declaredSize` lies about the uncompressed size (bomb tests);
 * `zip64` writes saturated sizes plus a ZIP64 extra field.
 */
function buildZip(entries, { trailing = Buffer.alloc(0) } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '', 'utf8');
    const method = entry.method ?? 8;
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = zlib.crc32(data);
    const flags = (entry.flags ?? 0) | 0x0800;
    const size = entry.zip64 ? 0xffffffff : entry.declaredSize ?? data.length;
    const csize = entry.zip64 ? 0xffffffff : body.length;
    const extra = entry.zip64
      ? Buffer.concat([u16(0x0001), u16(16), u32(data.length), u32(0), u32(body.length), u32(0)])
      : entry.extra ?? Buffer.alloc(0);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0x21),
      u32(crc), u32(csize), u32(size), u16(name.length), u16(extra.length), name, extra, body,
    ]);
    centrals.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(flags), u16(method), u16(0), u16(0x21),
      u32(crc), u32(csize), u32(size), u16(name.length), u16(extra.length), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name, extra,
    ]));
    locals.push(local);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(directory.length), u32(offset), u16(0),
  ]);
  return new Uint8Array(Buffer.concat([...locals, directory, end, trailing]));
}

/* ──────────────────────────────── XLSX ──────────────────────────────── */

const escapeXml = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLES = {
  general: 0,
  /** Built-in 14: m/d/yyyy. */
  date: 1,
  /** Custom 164: dd/mm/yyyy. */
  customDate: 2,
  /** Built-in 4: #,##0.00 — money, not a date. */
  money: 3,
  /** Built-in 20: h:mm — a time, not a date. */
  time: 4,
  /** Custom 165: a currency format whose quoted text contains d, m and y. */
  quotedMoney: 5,
  /** Custom 166: dd/mm/yyyy hh:mm. */
  dateTime: 6,
};

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00 &quot;dmy&quot;"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy\\ hh:mm"/></numFmts>
<cellStyleXfs count="2"><xf numFmtId="14"/><xf numFmtId="14"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0"/>
<xf numFmtId="14" fontId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" applyNumberFormat="1"><alignment horizontal="left"/></xf>
<xf numFmtId="4" fontId="0" applyNumberFormat="1"/>
<xf numFmtId="20" fontId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>`;

function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/**
 * rows: arrays of cells, each null (absent) or one of
 *   { s: 'text' }            shared string
 *   { inline: 'text' }       inline string (rich runs when an array)
 *   { n: '123.45', style }   number, raw stored text
 *   { b: true }              boolean
 * or a plain string (shared string). A row may be { r, cells } to place it.
 */
function buildXlsx(rows, {
  method = 8, date1904 = false, sheetName = 'Statement', hiddenFirst = false, extraEntries = [],
} = {}) {
  const shared = [];
  const sharedIndex = new Map();
  const share = (text) => {
    if (!sharedIndex.has(text)) {
      sharedIndex.set(text, shared.length);
      shared.push(text);
    }
    return sharedIndex.get(text);
  };
  let nextRow = 1;
  const rowXml = rows.map((row) => {
    const r = row && !Array.isArray(row) ? row.r : nextRow;
    const cells = Array.isArray(row) ? row : row.cells;
    nextRow = r + 1;
    const cellXml = cells.map((cell, column) => {
      if (cell === null || cell === undefined) return '';
      const ref = `${columnName(column)}${r}`;
      if (typeof cell === 'string') return `<c r="${ref}" t="s"><v>${share(cell)}</v></c>`;
      if (cell.s !== undefined) return `<c r="${ref}" t="s"><v>${share(cell.s)}</v></c>`;
      if (cell.inline !== undefined) {
        const runs = Array.isArray(cell.inline)
          ? cell.inline.map((run) => `<r><t xml:space="preserve">${escapeXml(run)}</t></r>`).join('')
          : `<t>${escapeXml(cell.inline)}</t>`;
        return `<c r="${ref}" t="inlineStr"><is>${runs}</is></c>`;
      }
      if (cell.b !== undefined) return `<c r="${ref}" t="b"><v>${cell.b ? 1 : 0}</v></c>`;
      if (cell.n !== undefined) {
        const style = cell.style === undefined ? '' : ` s="${STYLES[cell.style]}"`;
        return `<c r="${ref}"${style}><v>${cell.n}</v></c>`;
      }
      throw new Error('bad test cell');
    }).join('');
    return `<row r="${r}">${cellXml}</row>`;
  }).join('');
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1"/><sheetData>${rowXml}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
  const sharedXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${
  shared.map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`).join('')}</sst>`;
  const hiddenSheet = hiddenFirst
    ? '<sheet name="Hidden" sheetId="9" state="hidden" r:id="rId9"/>'
    : '';
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr${date1904 ? ' date1904="1"' : ''}/><sheets>${hiddenSheet}<sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId4"/></sheets></workbook>`;
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="/xl/styles.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/hidden.xml"/></Relationships>`;
  const otherSheet = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>not this sheet</t></is></c></row></sheetData></worksheet>';
  const entries = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: '_rels/.rels', data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', data: relsXml },
    { name: 'xl/sharedStrings.xml', data: sharedXml },
    { name: 'xl/styles.xml', data: STYLES_XML },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
    { name: 'xl/worksheets/sheet2.xml', data: otherSheet },
    ...(hiddenFirst ? [{ name: 'xl/worksheets/hidden.xml', data: otherSheet }] : []),
    ...extraEntries,
  ].map((entry, index) => ({
    method: typeof method === 'function' ? method(entry, index) : method,
    ...entry,
  }));
  return buildZip(entries);
}

/* ──────────────────────────────── PDF ──────────────────────────────── */

const PASSWORD_PAD = Buffer.from(
  '28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');

function rc4(key, data) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest();
const padPassword = (bytes) => Buffer.concat([bytes, PASSWORD_PAD]).subarray(0, 32);

/**
 * A one-page text PDF holding `lines`. With `userPassword` (a Buffer of the
 * password's bytes, as the writer encoded them) it is encrypted with the
 * Standard security handler, V1/R2, 40-bit RC4 — what PDF writers still emit
 * for "compatible" protection. With `encrypt` (a raw dictionary string) it
 * names that handler instead, unencrypted, for the unsupported cases.
 */
function textPdf(lines, { userPassword, encrypt } = {}) {
  const escape = (line) => line.replace(/([()\\])/g, '\\$1');
  const stream = lines.length === 0 ? '' : `BT /F1 12 Tf 50 750 Td ${
    lines.map((line, i) => `${i ? '0 -20 Td ' : ''}(${escape(line)}) Tj `).join('')
  }ET`;
  const id = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  let key = null;
  let encryptDict = encrypt ?? null;
  if (userPassword) {
    const o = rc4(md5(padPassword(Buffer.from('owner-only-password'))).subarray(0, 5), padPassword(userPassword));
    const p = u32(0xfffffffc);
    key = md5(padPassword(userPassword), o, p, id).subarray(0, 5);
    const u = rc4(key, PASSWORD_PAD);
    encryptDict = `<< /Filter /Standard /V 1 /R 2 /O <${o.toString('hex')}> /U <${u.toString('hex')}> /P -4 >>`;
  }
  let streamBytes = Buffer.from(stream, 'binary');
  if (key) {
    const objectKey = md5(key, Buffer.from([5, 0, 0, 0, 0])).subarray(0, 10);
    streamBytes = rc4(objectKey, streamBytes);
  }
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    Buffer.concat([Buffer.from(`<< /Length ${streamBytes.length} >>\nstream\n`), streamBytes, Buffer.from('\nendstream')]),
    ...(encryptDict ? [Buffer.from(encryptDict)] : []),
  ];
  const chunks = [Buffer.from('%PDF-1.4\n')];
  let length = chunks[0].length;
  const offsets = [];
  objects.forEach((object, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
    chunks.push(chunk);
    length += chunk.length;
  });
  const xref = length;
  let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) tail += `${String(offset).padStart(10, '0')} 00000 n \n`;
  const encryptRef = encryptDict ? `/Encrypt ${objects.length} 0 R /ID [<${id.toString('hex')}><${id.toString('hex')}>] ` : '';
  tail += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encryptRef}>>\nstartxref\n${xref}\n%%EOF\n`;
  chunks.push(Buffer.from(tail));
  return new Uint8Array(Buffer.concat(chunks));
}

module.exports = { buildZip, buildXlsx, textPdf, columnName, STYLES };
