const CLAIM_EVIDENCE = new Set(['public-redacted', 'repository-redacted']);

const languageSignal = (body) => body
  .replace(/\b(?:AED|SAR|USD|INR)\b/gi, ' ')
  .replace(/\bSome (?:merchant|restaurant)\b/gi, ' ')
  .replace(/\b(?:X{2,}[A-Z0-9]*|[A-Z0-9]*X{2,})\b/gi, ' ');

const languageOf = (body) => {
  const signal = languageSignal(body);
  const arabic = /\p{Script=Arabic}/u.test(signal);
  const latin = /[A-Za-z]/u.test(signal);
  if (arabic && latin) return 'Arabic + English';
  if (arabic) return 'Arabic';
  return 'English';
};

const familyOf = (fixture) => {
  const kind = fixture.expect?.kind ?? 'transaction';
  if (kind !== 'transaction') return kind;
  return fixture.expect?.type === 'income' ? 'income transaction' : 'expense transaction';
};

function buildCapabilityRows(fixtures) {
  const groups = new Map();
  for (const fixture of fixtures) {
    if (!CLAIM_EVIDENCE.has(fixture.evidence)) continue;
    const key = `${fixture.market}\u0000${fixture.bank}`;
    const group = groups.get(key) ?? {
      market: fixture.market,
      institution: fixture.bank,
      languages: new Set(),
      eventFamilies: new Set(),
      evidence: new Set(),
      formatCount: 0,
    };
    group.languages.add(languageOf(fixture.body));
    group.eventFamilies.add(familyOf(fixture));
    group.evidence.add(fixture.evidence);
    group.formatCount += 1;
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      languages: [...group.languages].sort(),
      eventFamilies: [...group.eventFamilies].sort(),
      evidence: [...group.evidence].sort(),
    }))
    .sort((a, b) => a.market.localeCompare(b.market) || a.institution.localeCompare(b.institution));
}

const evidenceLabel = (values) => values.map((value) =>
  value === 'public-redacted' ? 'public redacted' : 'repository redacted').join(', ');

function renderCapabilityMarkdown(rows) {
  const lines = [
    '# Bank-alert parser capability evidence',
    '',
    'Manual tracking is available regardless of country or ledger currency. Automatic bank-alert import is not worldwide bank coverage: it varies by country, institution, alert language, and exact message format.',
    '',
    'This matrix reports only public-redacted or repository-redacted acceptance fixtures that are exercised by the automated parser suite. Synthetic and reconstructed grammar probes are excluded. A row means the listed format specimens pass; it does not claim every alert from that institution works. There is deliberately no single parser coverage percentage.',
    '',
    '| Market | Institution | Alert language evidence | Event-family evidence | Passing redacted formats | Evidence source |',
    '| --- | --- | --- | --- | ---: | --- |',
  ];
  for (const row of rows) {
    lines.push(`| ${row.market} | ${row.institution} | ${row.languages.join(', ')} | ${row.eventFamilies.join(', ')} | ${row.formatCount} | ${evidenceLabel(row.evidence)} |`);
  }
  lines.push(
    '',
    '## How new evidence enters the matrix',
    '',
    'Wafra’s parser-sample screen prepares a local, redacted JSON file. Wafra uploads nothing; the user chooses Save/Share and can attach that file to a Codex task. A new format is added only with a failing positive test, a conservative parser change, and a paired non-posting or adversarial negative. After the reviewed fixture lands, regenerate this document with `npm run report:parser-capabilities`.',
    '',
    '_Generated from `scripts/test/fixtures/uae-bank-formats.js` and `scripts/test/fixtures/saudi-bank-formats.js`._',
    '',
  );
  return lines.join('\n');
}

module.exports = { buildCapabilityRows, renderCapabilityMarkdown };
