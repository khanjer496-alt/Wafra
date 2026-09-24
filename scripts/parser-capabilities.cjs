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
    '## Country conventions',
    '',
    'The user\'s country (any ISO 3166-1 country, defaulting from the device Region and changeable in onboarding and Settings) is separate from the parser market pack. Only AE and SA have launch-tested packs with bank registries; every other country uses the neutral pack and the worldwide parser. Choosing a country never adds institution coverage.',
    '',
    '- Unverified formats (every country and message format other than the UAE/Saudi launch grammar and certified templates) are added automatically only when one best-effort policy proves a single completed movement: posted wording with no pending, hold, request, decline, reversal, OTP, promotion, statement, bill or scheduled language; one principal amount; a direction that matches the payment type; an explicit currency, or a shared symbol (`$`, `¥`, `Rs`) that matches the user\'s own country; no future date; and, for foreign money, a dated rate already on the device. Each such entry is marked “Auto-added — check” so it can be confirmed, corrected or undone, and an undone reading is not added again. Everything else waits in Review. The setting “Auto-add alerts from unverified bank formats” (on by default) returns every unverified format to review-first. This is not verified coverage of any bank outside AE and SA. Live capture on iOS stays review-only for unverified formats; Android SMS, Android bank-app notifications and the iOS Messages History import use the policy.',
    '',
    '- Numeric dates: an ambiguous date such as 03/04/2026 is read month-first for the United States, its territories and the Philippines, year-first countries are left undecided, Canada and countries whose banks print local-calendar dates are left undecided, and every other country reads day-first. An unknown country (`ZZ`) refuses ambiguous dates rather than guessing. A file\'s own evidence (a field above 12) always wins over the country.',
    '- Statements (PDF, CSV, forwarded email): amounts are parsed in decimal-comma form (`1.234,56`, `1 234,56` in a CSV cell or with a no-break space in a PDF) only when the file\'s own figures prove that convention and none contradicts it; apostrophe grouping (`1\'234.56`) is read in decimal-point files. Named-month dates are read in English, French, German, Spanish, Portuguese, Italian, Dutch, Turkish, Indonesian and Arabic. Column headers are still recognised in English and Arabic only.',
    '- Forwarded statement emails are read in the ledger currency recorded when the forwarding address was created; an address created by an older build keeps the launch AED/SAR reading.',
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
