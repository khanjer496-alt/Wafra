/**
 * Compose the agent's prompt from a fetched feedback item.
 *
 * A separate file rather than a `node -e` inside the workflow for one boring
 * reason and one real one. The boring one: a prompt has lines starting at
 * column 0, and a YAML block scalar ends the moment a line is less indented
 * than the block — so the whole thing would have to be re-indented and then
 * un-indented at runtime. The real one: this text is the actual instruction an
 * agent acts on against this repository, and it should be reviewable as prose
 * in a diff, not as an escaped string inside a shell inside YAML.
 *
 *   node .github/scripts/feedback-prompt.mjs <item.json> <out.md> <workDir>
 *
 * Reads the item from disk and writes the prompt to disk. It never prints the
 * report: Actions logs are as public as the repository.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { validateFeedbackItem } from './feedback-input.mjs';

const [itemPath, outPath, workDir] = process.argv.slice(2);
if (!itemPath || !outPath || !workDir) {
  console.error('usage: feedback-prompt.mjs <item.json> <out.md> <workDir>');
  process.exit(1);
}

let item;
try {
  item = JSON.parse(readFileSync(itemPath, 'utf8'));
  await validateFeedbackItem(item, process.env.FEEDBACK_ID);
} catch {
  console.error('::error::invalid feedback identity, redaction schema, or AI consent');
  process.exit(1);
}
if (typeof item.text !== 'string' || !item.text.trim()) {
  console.error('::error::the relay returned a feedback item with no text');
  process.exit(1);
}

// Defence in depth: repository_dispatch is not the only trigger. A maintainer
// can start the workflow manually, so the final component that constructs
// model input must independently require the user's explicit disclosure and
// consent. Ordinary feedback sends false; only the dedicated, previewed parser
// research report can reach the coding agent.
if (item.aiReviewConsent !== true || item.diagnostic?.delivery?.thirdPartyAi !== true) {
  console.error('::error::this feedback item did not authorize third-party AI review');
  process.exit(1);
}

// Bounded even though the relay already bounds it, because this file is the
// last thing between a payload and a model context. The exact relay validator
// above checks its byte limit; never truncate a validated diagnostic mid-JSON.
const diagnostic = item.diagnostic
  ? JSON.stringify(item.diagnostic, null, 2)
  : '(none sent)';
const parserResearch = item.diagnostic?.kind === 'parser-research';
const researchInstructions = parserResearch
  ? `\nThis is a parser-research batch, not user prose. Each template is already\n` +
    `redacted: # marks a digit position, while [text] marks a masked\n` +
    `recipient/merchant span or a word outside the financial grammar,\n` +
    `and an aliased sender is intentionally not recoverable. Start with the most\n` +
    `frequent \`needs-parser-work\` template. Replace placeholders with invented\n` +
    `values when writing the synthetic reproduction; never try to infer the\n` +
    `original merchant, person, sender or number.\n`
  : '';

writeFileSync(
  outPath,
  `You are fixing a bug reported from inside the Wafra app. Work in this checkout.

## The report

- Platform: ${item.platform}
- App version: ${item.appVersion}
- Locale: ${item.locale ?? 'unknown'}
- Relay feedback id: ${item.id}

<report>
${item.text}
</report>

Redacted diagnostic the client attached:

\`\`\`json
${diagnostic}
\`\`\`
${researchInstructions}

## What you must do, in this order

1. **Read before you write.** Start with AGENTS.md. This repository parses bank
   SMS for Gulf banks: the parser is \`src/lib/sms-parser.ts\`, the market packs
   are \`src/lib/markets.ts\`, and the ledger logic is under \`src/lib/\`. The
   test corpus is \`scripts/test/*.test.js\` — parser.test.js, import-plan.test.js,
   db.test.js, contracts.test.js and the rest. That corpus is the real one, not
   a sample, and it is where a report like this is reproduced.

2. **Reproduce it against that corpus first.** Add a test that FAILS for the
   reason described in the report, in whichever existing suite already covers
   that area. Do not create a new suite file. Run it and confirm it is red
   before you change any source.

   This is not advice. The workflow that invoked you applies your test change
   alone to a clean tree and requires the suite to fail, then applies your whole
   change and requires it to pass. A fix with no reproduction cannot get through.

3. **Then fix it.** The smallest change that makes the new test pass without
   breaking another. \`npm test\` must be green when you are done. Do NOT run
   \`npm run test:e2e\`.

4. **Do not copy the diagnostic.** This input contains a fixed report label
   and validated, redacted parser-research templates. Digits and free text are
   masked; do not infer the original values. Your test must use a SYNTHETIC
   message that reproduces the wording pattern with invented amounts, merchants,
   and last four digits, in the style the existing corpus already uses.
   Do not quote the report label or diagnostic templates in tests, source, or
   your summary. The workflow scans changed files and your summary for copied
   report or diagnostic text and refuses publication when it detects a match.

5. **Write ${workDir}/SUMMARY.md.** Three short sections, in your own words,
   quoting nothing from the report or diagnostic:
   - **What was wrong** — the defect, described from the code.
   - **The reproduction** — which test you added and what it asserts.
   - **The fix** — what you changed, and why that is the right place for it.

   If you could not fix it, say that plainly in SUMMARY.md and explain what you
   found. An honest dead end is worth more than a plausible wrong change.

6. **Stay within the parser repair scope.** Modify existing source files under
   src/ or server/src/ and existing scripts/test/*.test.js or
   server/test/*.test.cjs files. New files, deletions, dependency files,
   workflows, tooling, test runners, and native modules cannot be published
   through this workflow. A fix requiring them needs human follow-up.

   This is an exported disposable checkout without a Git directory. There is
   no other repository writer and no branch or remote to manage. Do not try to
   create a Git repository, bypass the sandbox, or change its permissions.

Do not commit, push, or open a pull request. The workflow does that part.

## What you can and cannot do here

You may edit files, and you may run shell commands — \`npm test\` is expected of
you above. Limit source edits to the paths listed above. Write the summary in ${workDir}.

If some action is refused, that is a real boundary and not a hint to work
around it: say so in ${workDir}/SUMMARY.md and finish what you can. But note
that SUMMARY.md itself is the one thing this run cannot proceed without, so
write it FIRST, as soon as you know what you are going to say, and update it as
you go. A run that ends with a perfect fix and no summary is thrown away whole.
`,
);

// Metadata only — never the body.
console.log(
  `prompt written · platform=${item.platform} appVersion=${item.appVersion} ` +
    `locale=${item.locale ?? 'unknown'} reportChars=${item.text.length}`,
);
