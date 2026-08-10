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

const [itemPath, outPath, workDir] = process.argv.slice(2);
if (!itemPath || !outPath || !workDir) {
  console.error('usage: feedback-prompt.mjs <item.json> <out.md> <workDir>');
  process.exit(1);
}

const item = JSON.parse(readFileSync(itemPath, 'utf8'));
if (typeof item.text !== 'string' || !item.text.trim()) {
  console.error('::error::the relay returned a feedback item with no text');
  process.exit(1);
}

// Defence in depth: repository_dispatch is not the only trigger. A maintainer
// can start the workflow manually, so the final component that constructs
// model input must independently require the user's explicit disclosure and
// consent. Current app builds send false and therefore can never reach Claude.
if (item.aiReviewConsent !== true || item.diagnostic?.delivery?.thirdPartyAi !== true) {
  console.error('::error::this feedback item did not authorize third-party AI review');
  process.exit(1);
}

// Bounded even though the relay already bounds it, because this file is the
// last thing between a payload and a model context, and 8 KiB of aggregates is
// already more diagnostic than any real bug needs.
const diagnostic = item.diagnostic
  ? JSON.stringify(item.diagnostic, null, 2).slice(0, 8_000)
  : '(none sent)';

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

4. **Never quote the user.** The report above may be a real bank message with a
   real card number in it. Your test must use a SYNTHETIC message that
   reproduces the SHAPE of the problem — same wording pattern, invented amount,
   invented merchant, invented last four — in the style the existing corpus
   already uses. The workflow scans your diff for verbatim runs from the report
   and fails the run when it finds one, so copying does not merely look bad; it
   stops the pull request from existing.

5. **Write ${workDir}/SUMMARY.md.** Three short sections, in your own words,
   quoting nothing from the report:
   - **What was wrong** — the defect, described from the code.
   - **The reproduction** — which test you added and what it asserts.
   - **The fix** — what you changed, and why that is the right place for it.

   If you could not fix it, say that plainly in SUMMARY.md and explain what you
   found. An honest dead end is worth more than a plausible wrong change.

6. **Ignore the coordination protocol.** AGENTS.md will tell you to claim paths
   with \`scripts/coord.mjs\` before editing them. That exists for the human's
   local checkout, where two agents share one working copy. You are alone in a
   throwaway CI clone that is deleted when this job ends, so there is nobody to
   collide with and nothing to claim. Edit directly. Everything else in
   AGENTS.md still applies.

Do not commit, push, or open a pull request. The workflow does that part.

## What you can and cannot do here

You may edit files, and you may run shell commands — \`npm test\` is expected of
you above. You may write anywhere in this checkout and in ${workDir}.

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
