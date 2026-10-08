// One hostile workbook per run, read under whatever heap the parent gave this
// process (statement-files.test.cjs spawns it with --max-old-space-size=96).
// Prints the refusal code, or `ok`; an out-of-memory crash exits non-zero,
// which is exactly what the parent is looking for.
const { buildZip } = require('./fixtures.cjs');
const { xlsxSheetRecords } = require('../.test-build/xlsx-records.cjs');

const kind = process.argv[2];
const rels = '<Relationships><Relationship Id="rId1" Type="http://x/officeDocument" Target="xl/workbook.xml"/></Relationships>';
const workbook = '<workbook xmlns:r="r"><sheets><sheet name="a" r:id="rId1"/></sheets></workbook>';
const workbookRels = '<Relationships><Relationship Id="rId1" Type="http://x/worksheet" Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId2" Type="http://x/sharedStrings" Target="sharedStrings.xml"/></Relationships>';
const sheetOf = (body) => `<worksheet><sheetData>${body}</sheetData></worksheet>`;
const oneSharedCell = sheetOf('<row r="1"><c r="A1" t="s"><v>0</v></c></row>');
const sst = (body) => `<sst>${body}</sst>`;

const cases = {
  // The reviewer's probes: tiny uploads that used to exhaust the heap.
  'entities-4m': () => [sheetOf(`<row r="1"><c r="A1" t="inlineStr"><is><t>${'&amp;'.repeat(4_000_000)}</t></is></c></row>`)],
  'entity-attribute-4m': () => [sheetOf(`<row r="1" x="${'&amp;'.repeat(4_000_000)}"></row>`)],
  'digits-19m': () => [sheetOf(`<row r="1"><c r="A1"><v>${'1'.repeat(19_000_000)}</v></c></row>`)],
  'empty-shared-strings-4m': () => [oneSharedCell, sst('<si/>'.repeat(4_000_000))],
  'entity-shared-strings': () => [oneSharedCell, sst(`<si><t>${'&lt;'.repeat(1000)}</t></si>`.repeat(4800))],
  // The same shapes kept UNDER the 4 MB inflate budget, so each in-scan
  // ceiling is what refuses them.
  'entities-in-budget': () => [sheetOf(`<row r="1"><c r="A1" t="inlineStr"><is><t>${'&amp;'.repeat(700_000)}</t></is></c></row>`)],
  'attribute-in-budget': () => [sheetOf(`<row r="1" x="${'a'.repeat(3_000_000)}"></row>`)],
  'empty-shared-strings-in-budget': () => [oneSharedCell, sst('<si/>'.repeat(600_000))],
  'shared-string-count': () => [oneSharedCell, sst('<si><t>a</t></si>'.repeat(60_000))],
  'shared-string-chars': () => [oneSharedCell, sst(`<si><t>${'a'.repeat(8000)}</t></si>`.repeat(300))],
  'rich-runs': () => [oneSharedCell, sst(`<si>${'<r><t>a</t></r>'.repeat(200_000)}</si>`)],
  'long-cell': () => [sheetOf(`<row r="1"><c r="A1" t="inlineStr"><is><t>${'a'.repeat(9000)}</t></is></c></row>`)],
  'many-attributes': () => [sheetOf(`<row r="1" ${Array.from({ length: 65 }, (_, i) => `a${i}="1"`).join(' ')}></row>`)],
  'empty-rows': () => [sheetOf('<row/>'.repeat(400_000))],
};

const parts = cases[kind]();
const entries = [
  { name: '_rels/.rels', data: rels },
  { name: 'xl/workbook.xml', data: workbook },
  { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
  { name: 'xl/worksheets/sheet1.xml', data: parts[0] },
  ...(parts[1] ? [{ name: 'xl/sharedStrings.xml', data: parts[1] }] : []),
];
xlsxSheetRecords(buildZip(entries), { maxRecords: 211, maxColumns: 64, maxRecordChars: 8192 })
  .then(() => console.log('ok'), (error) => console.log(error.code ?? error.message));
