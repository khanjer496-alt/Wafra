const fs = require('node:fs');
const path = require('node:path');

const {
  buildManualParserResearchExport,
  buildParserResearchSubmission,
  parsePastedParserMessages,
  sanitizeParserTemplate,
  serializeManualParserResearchExport,
} = require('./build/parser-research.js');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const secret = 'CARREFOUR HYPERMARKET AL BARSHA';
const body = `AED 45.75 spent on card ending 3644 at ${secret} on 04/07/2026. Ref 90881723004.`;
const template = sanitizeParserTemplate(body, [secret, '90881723004', '3644']);
ok('every digit is replaced while finance grammar survives',
  !/\d/.test(template) && template.includes('AED ##.## spent on card ending [text]') &&
    template.includes('[text]'), template);
ok('merchant and reference literals never survive the template',
  !template.includes('CARREFOUR') && !template.includes('90881723004'), template);
ok('URLs, emails, IBANs and unknown names are structural placeholders',
  sanitizeParserTemplate('Paid AED 8.00 to Ahmed at https://secret.example; mail me@home.ae IBAN AE070331234567890123456')
    .match(/\[text\].*\[url\].*\[email\].*\[iban\]/) !== null);
const nameCollisionTemplate = sanitizeParserTemplate(
  'Transfer to Will completed. Payment to Bill completed. Transfer to Riyad completed. Transfer to Cash completed.',
);
ok('name-like grammar words in recipient positions are still removed',
  !/(?:Will|Bill|Riyad|Cash)/i.test(nameCollisionTemplate) &&
    (nameCollisionTemplate.match(/to \[text\]/g) ?? []).length === 4,
  nameCollisionTemplate);

const pasted = parsePastedParserMessages(
  'From: ENBD\nFirst message\nline two\n\n---\n\nSender: +971501234567\nSecond message',
);
ok('copied iOS messages accept optional sender lines and blank-block separation',
  pasted.length === 2 && pasted[0].sender === 'ENBD' &&
    pasted[0].body === 'First message\nline two' && pasted[1].body === 'Second message');

const submission = buildParserResearchSubmission([
  { sender: 'ENBD', body, receivedAtMs: 1_800_000_000_000 },
  {
    sender: 'ENBD',
    body: `AED 91.20 spent on card ending 7788 at ${secret} on 17/08/2026. Ref 11122233344.`,
    receivedAtMs: 1_800_000_001_000,
  },
  {
    sender: 'ENBD',
    body: `Movement of AED 23.45 sent successfully to ${secret}. Ref 55566677788.`,
    receivedAtMs: 1_800_000_001_500,
  },
  {
    sender: 'ENBD',
    body: `Movement of AED 67.89 sent successfully to ${secret}. Ref 99900011122.`,
    receivedAtMs: 1_800_000_001_700,
  },
  {
    sender: '+971501234567',
    body: 'Your OTP is 458213. Do not share this verification code.',
    receivedAtMs: 1_800_000_002_000,
  },
  {
    sender: '+971501234567',
    body: 'Dinner is at eight, see you there.',
    receivedAtMs: 1_800_000_003_000,
  },
], {
  version: '1.0.0', platform: 'android', language: 'en-AE', marketId: 'AE', currency: 'AED',
});
const serialized = JSON.stringify(submission.wire);
ok('repeated alerts collapse into one parser template with a count',
  submission.counts.financial === 4 && submission.counts.alreadyParsedExcluded === 2 &&
    submission.counts.attachedTemplates === 1 &&
    submission.wire.diagnostic.shapes[0].count === 2,
  JSON.stringify(submission.counts));
ok('OTP/security and unrelated messages are excluded before redaction',
  submission.counts.sensitiveExcluded === 1 && submission.counts.nonFinancialExcluded === 1,
  JSON.stringify(submission.counts));
ok('the wire contains no raw secret, amount, card, date, reference or timestamp',
  !serialized.includes('CARREFOUR') && !serialized.includes('45.75') &&
    !serialized.includes('3644') && !serialized.includes('04/07/2026') &&
    !serialized.includes('90881723004') && !serialized.includes('1800000000000'), serialized);
ok('the exact preview discloses redaction, retention and coding-AI review',
  submission.preview.includes('raw message bodies: not sent') &&
    submission.preview.includes('relay copy retained up to 14 days') &&
    submission.preview.includes('Anthropic Claude') &&
    submission.preview.includes('public draft PR'));
ok('only the dedicated report explicitly consents to named AI review',
  submission.wire.aiReviewConsent === true &&
    submission.wire.diagnostic.kind === 'parser-research' &&
    submission.wire.diagnostic.delivery.thirdPartyAi === true &&
    submission.wire.text === 'Sanitized parser research report.');

const manualExport = typeof buildManualParserResearchExport === 'function'
  ? buildManualParserResearchExport(submission)
  : null;
const manualJson = typeof serializeManualParserResearchExport === 'function' && manualExport
  ? serializeManualParserResearchExport(manualExport)
  : '';
ok('the manual export says Wafra uploaded nothing and the user chooses the destination',
  manualExport?.schema === 1 && manualExport?.kind === 'wafra-parser-report' &&
    manualExport?.delivery?.mode === 'manual' &&
    manualExport?.delivery?.uploadedByWafra === false &&
    manualExport?.delivery?.destinationChosenByUser === true,
  manualJson);
ok('the manual export keeps the useful redacted templates and aggregate counts',
  manualExport?.counts === submission.counts &&
    manualExport?.templates === submission.wire.diagnostic.shapes &&
    manualExport?.redaction === submission.wire.diagnostic.redaction &&
    manualExport?.build?.version === '1.0.0' && manualExport?.build?.marketId === 'AE',
  manualJson);
ok('the manual export carries no automatic-delivery or raw-message residue',
  manualJson.length > 0 && !manualJson.includes(secret) && !manualJson.includes('45.75') &&
    !manualJson.includes('3644') && !manualJson.includes('04/07/2026') &&
    !manualJson.includes('90881723004') && !manualJson.includes('1800000000000') &&
    !/aiReviewConsent|thirdPartyAi|Anthropic|GitHub|relay|retention/i.test(manualJson),
  manualJson);

const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'src/lib/parser-research-source.ts'), 'utf8');
const transport = fs.readFileSync(path.join(root, 'src/lib/feedback-transport.ts'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'src/app/settings.tsx'), 'utf8');
const screen = fs.readFileSync(path.join(root, 'src/app/parser-research.tsx'), 'utf8');
const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
const workflow = fs.readFileSync(
  path.join(root, '.github/workflows/feedback-agent.yml'),
  'utf8',
);
ok('plaintext inbox collection has no file, persistence or network surface',
  /collectSmsCorpus/.test(source) &&
    !/(FileSystem|Sharing|AsyncStorage|SecureStore|fetch\s*\(|XMLHttpRequest|https?:)/.test(source));
ok('the parser-research transport posts only the already-built wire object',
  /submitParserResearchFeedback[\s\S]{0,4000}JSON\.stringify\(wire\)/.test(transport) &&
    !/submitParserResearchFeedback[\s\S]{0,4000}(deviceId|pushToken|installationId)/.test(transport));
ok('the old full-inbox raw share control is no longer exposed in Settings',
  !/isSmsCorpusExportAvailable|shareSmsCorpus|smsCorpusExportTitle/.test(settings));
ok('the tester previews and exports the exact local JSON file instead of sending it',
    /serializeManualParserResearchExport/.test(screen) &&
    /shareTextFile\('wafra-parser-report\.json',\s*manualJson/.test(screen) &&
    /mimeType:\s*'application\/json'/.test(screen) &&
    /parserResearchExport/.test(screen) && /previewScroll/.test(screen) &&
    /maxHeight: 180/.test(screen) &&
    !/submitParserResearchFeedback|setConfirming\(true\)|<ConfirmSheet/.test(screen));
ok('raw pasted text is cleared as soon as the redacted report exists',
  /setPasted\(''\)/.test(screen) && !/setState\([^)]*messages/.test(screen));
ok('an empty paste gives a visible answer and focuses the input instead of a dead button',
  /parserResearchPasteRequired/.test(screen) && /pasteInputRef\.current\?\.focus\(\)/.test(screen) &&
    /AccessibilityInfo\.announceForAccessibility/.test(screen) &&
    /accessibilityLiveRegion="polite"/.test(screen) &&
    /const canPrepare = !blocked && !preparing/.test(screen));
const prepareSource = screen.slice(screen.indexOf('const prepare = async'));
ok('preparing a real report dismisses the keyboard before work starts',
  prepareSource.indexOf('Keyboard.dismiss()') >= 0 &&
    prepareSource.indexOf('Keyboard.dismiss()') < prepareSource.indexOf('setPreparing(true)') &&
    /paddingBottom: Spacing\.six \+ 96/.test(screen));
ok('Private Mode blocks both collection and preparation',
  /const blocked = state\.privateMode/.test(screen) &&
    /const canPrepare = !blocked/.test(screen));
ok('Private Mode is rechecked before export and clears a stale report',
  /if \(!submission \|\| state\.privateMode \|\| !enabled\)/.test(screen) &&
    /if \(!blocked\) return;[\s\S]{0,160}setSubmission\(null\)/.test(screen) &&
    /disabled=\{exporting \|\| blocked\}/.test(screen));
ok('a production deep link cannot bypass the internal-build gate',
  /const enabled = isParserResearchBuild\(\)/.test(screen) &&
    /const blocked = state\.privateMode \|\| !enabled/.test(screen) &&
    /\{enabled && !automaticInbox/.test(screen));
const jobEnv = workflow.slice(workflow.indexOf('    env:'), workflow.indexOf('    steps:'));
ok('the coding-agent job does not inherit relay or GitHub credentials',
  !/FEEDBACK_READ_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|GH_TOKEN/.test(jobEnv) &&
    /persist-credentials: false/.test(workflow) &&
    /- name: Run the agent[\s\S]{0,400}CLAUDE_CODE_OAUTH_TOKEN/.test(workflow) &&
    /- name: Open a draft pull request[\s\S]{0,220}GH_TOKEN/.test(workflow));
ok('research is internal/test only and production is compiled closed',
  eas.build.preview.env.EXPO_PUBLIC_WAFRA_PARSER_RESEARCH === '1' &&
    eas.build['corpus-preview'].env.EXPO_PUBLIC_WAFRA_PARSER_RESEARCH === '1' &&
    eas.build['capture-beta'].env.EXPO_PUBLIC_WAFRA_PARSER_RESEARCH === '1' &&
    eas.build.production.env.EXPO_PUBLIC_WAFRA_PARSER_RESEARCH === '0');

console.log(`\nparser-research: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
