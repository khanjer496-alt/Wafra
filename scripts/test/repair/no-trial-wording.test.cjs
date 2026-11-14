'use strict';

// Wafra's first 3 days are "free automatic capture", not a trial or a free
// period. Only automatic capture stops being free afterwards; manual entry and
// imports stay free, and the storefront has no trial offer. This scans every
// string a person can see in src (TS/TSX string and template literals, JSX
// text, and the setup-video JSON) and fails if trial or free-period wording
// comes back in English or Arabic. Identifiers, import paths, testIDs and
// comments are not user-facing and are not scanned.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '../../..');
const src = path.join(root, 'src');

const BANNED = [
  /\bfree[\s-]+period\b/i,
  /\bfree[\s-]+trials?\b/i,
  /\btrial(?:s| period| ends?| ended)?\b/i,
  /الفترة المجانية|فترة مجانية/,
  /التجربة المجانية|تجربة مجانية/,
  /الفترة التجريبية|فترة تجريبية|فترة التجربة|انتهت التجربة/,
  // Pronoun-suffixed forms ("your free trial", "your free period"). Requiring
  // مجاني after the noun keeps "خصّص تجربتك" ("make it yours") allowed.
  /تجرب(?:ة|ت)\S*\s+(?:ال)?مجاني/,
  /فتر(?:ة|ت)\S*\s+(?:ال)?مجاني/,
];

// Published legal docs follow the same rule for the free-period phrases. A bare
// "trial" stays allowed there because the Terms must say the free capture "is
// not a store trial or introductory offer".
const DOC_BANNED = BANNED.filter((re) => !/trial\(\?:s\|/.test(re.source));
const PUBLISHED_DOCS = ['docs/terms-of-use.md', 'docs/privacy-policy.md'];

// Attributes and call sites whose strings never reach the screen.
const NON_UI_ATTRIBUTES = new Set(['testID', 'nativeID', 'key', 'id']);

function files(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.generated\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

function isNonUi(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'require') return true;
  if (ts.isLiteralTypeNode(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  let attr = parent;
  if (ts.isJsxExpression(attr)) attr = attr.parent;
  if (attr && ts.isJsxAttribute(attr) && NON_UI_ATTRIBUTES.has(attr.name.getText())) return true;
  return false;
}

function userStrings(file) {
  const text = fs.readFileSync(file, 'utf8');
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const found = [];
  const visit = (node) => {
    let value = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) value = node.text;
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) value = node.text;
    else if (ts.isJsxText(node)) value = node.getText();
    if (value !== null && !isNonUi(node)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
      found.push({ value, where: `${path.relative(root, file)}:${line + 1}` });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function jsonStrings(file) {
  const found = [];
  const walk = (value, at) => {
    if (typeof value === 'string') found.push({ value, where: `${path.relative(root, file)} ${at}` });
    else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${at}[${i}]`));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, `${at}.${k}`);
  };
  walk(JSON.parse(fs.readFileSync(file, 'utf8')), '$');
  return found;
}

function offenders(strings) {
  return strings.filter(({ value }) => BANNED.some((re) => re.test(value)))
    .map(({ value, where }) => `${where}: ${value.slice(0, 120)}`);
}

test('no user-facing copy calls the first 3 days a trial or a free period (EN and AR)', () => {
  const strings = files(src).flatMap(userStrings);
  for (const json of ['src/lib/ios-setup-video-content.json']) strings.push(...jsonStrings(path.join(root, json)));
  assert.ok(strings.length > 1000, `scanner found only ${strings.length} strings; it is not reading src`);
  assert.deepEqual(offenders(strings), []);
});

test('the published Terms and Privacy Policy never call the first 3 days a free trial or free period', () => {
  const hits = [];
  for (const doc of PUBLISHED_DOCS) {
    fs.readFileSync(path.join(root, doc), 'utf8').split('\n').forEach((line, i) => {
      if (DOC_BANNED.some((re) => re.test(line)) || /\btrial[- ]day\b/i.test(line)) hits.push(`${doc}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.equal(DOC_BANNED.length, BANNED.length - 1, 'only the bare "trial" rule is relaxed for docs');
  assert.deepEqual(hits, []);
});

test('the scanner catches the wording it bans, and ignores non-UI strings', () => {
  const samples = [
    'Start the 3-day free period', 'Your free trial ends soon', 'Trial ended', 'Wafra Pro · trial',
    'ابدأ الفترة المجانية', 'انتهت التجربة', 'وفرة برو · فترة تجريبية', 'التجربة المجانية مفعّلة',
    'انتهت تجربتك المجانية في التطبيق', 'بقيت فترتك المجانية يومين',
  ];
  for (const value of samples) assert.equal(offenders([{ value, where: 'sample' }]).length, 1, value);
  for (const value of ['Free automatic capture', 'الالتقاط التلقائي المجاني', 'Load demo data', 'تحميل بيانات تجريبية', 'عرض تجربة البداية', 'خصّص تجربتك']) {
    assert.equal(offenders([{ value, where: 'sample' }]).length, 0, value);
  }
  const tmp = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wafra-trial-')), 'sample.tsx');
  fs.writeFileSync(tmp, "import x from './trial-thing';\nconst a = { trialEnd: 'ok' };\nexport const V = () => <View testID=\"onboarding-trial-timeline\"><Text>Free trial</Text></View>;\n");
  try {
    assert.deepEqual(offenders(userStrings(tmp)).map((line) => line.replace(/^.*?: /, '')), ['Free trial']);
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
});
