/**
 * Refuse to publish anything copied verbatim out of a feedback report.
 *
 *   node .github/scripts/feedback-no-verbatim.mjs <item.json> <summary.md>
 *
 * WHY THIS IS A GATE AND NOT A LINT. This app reads bank SMS. A feedback report
 * is prose a user typed into a text box, and the most useful thing they can put
 * in it is the alert that parsed wrong — which means their bank, their card's
 * last four digits and an amount they spent. The relay keeps that behind a
 * token for fourteen days and then deletes it. A pull request keeps it in the
 * open, forever, on something anyone can fork, and no later deletion undoes a
 * fork or a mirror. So the asymmetry is total: a false positive here costs one
 * re-run, and a false negative cannot be taken back.
 *
 * The test is a sixty-character sliding window over the report, whitespace
 * normalised, against the staged diff and the agent's summary together. Sixty
 * is chosen so that shared vocabulary cannot trip it — "Purchase of AED 40.00
 * with Debit Card ending" is 52 characters and appears in the corpus already —
 * while a pasted alert, which is 120 characters and up, cannot slip under it.
 *
 * When it fails, DO NOT WEAKEN IT. Read the item by hand with the read token,
 * decide whether the quoted span is genuinely sensitive, and either re-run the
 * agent or make the change yourself. The offset is reported; the span itself
 * never is, because this program's own output is a public Actions log.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const WINDOW = 60;

const [itemPath, summaryPath] = process.argv.slice(2);
if (!itemPath || !summaryPath) {
  console.error('usage: feedback-no-verbatim.mjs <item.json> <summary.md>');
  process.exit(1);
}

const item = JSON.parse(readFileSync(itemPath, 'utf8'));
const summary = existsSync(summaryPath) ? readFileSync(summaryPath, 'utf8') : '';

if (!summary.trim()) {
  console.error(
    '::error::the agent wrote no SUMMARY.md, so there is nothing to put in the pull request body ' +
      'that is not the user\'s own words. Refusing to open a pull request.',
  );
  process.exit(1);
}

// Staged, so newly added files count. `git add -A` runs immediately before.
const diff = execSync('git diff --cached', { encoding: 'utf8', maxBuffer: 256 << 20 });

const normalize = (value) => value.replace(/\s+/g, ' ');
const published = normalize(`${diff}\n${summary}`);
const report = normalize(item.text);

for (let i = 0; i + WINDOW <= report.length; i++) {
  if (published.includes(report.slice(i, i + WINDOW))) {
    console.error(
      `::error::the diff or the summary reproduces the feedback report verbatim ` +
        `(${WINDOW}+ characters, from offset ${i} of ${report.length}). ` +
        `A pull request is public and permanent; the report is not. Refusing to open one. ` +
        `Read the item by hand and decide — see .github/scripts/feedback-no-verbatim.mjs.`,
    );
    process.exit(1);
  }
}

console.log(
  `no verbatim ${WINDOW}-character run from the report appears in the change or the summary.`,
);
