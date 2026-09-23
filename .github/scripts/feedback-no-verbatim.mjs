/** Best-effort copy gate. This detects matching text, not paraphrase/encoding or
 * arbitrary malicious exfiltration. Run from the untouched trusted checkout,
 * before artifact upload and again before any GitHub publication.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const normalize = value => value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
export function assertNoVerbatim(item, publishedText) {
  const published = normalize(publishedText);
  const sources = [item.text];
  // The AI path uses a fixed 33-character report label. Its actual input is
  // these diagnostic templates, including templates shorter than 60 chars.
  for (const shape of item.diagnostic?.shapes ?? []) sources.push(shape.template);
  if (typeof item.diagnostic?.cardDiagnostic === 'string') sources.push(item.diagnostic.cardDiagnostic);
  for (const source of sources) {
    if (typeof source !== 'string') continue;
    const normalized = normalize(source);
    // One-word grammar snippets are not identifying. Otherwise require the
    // full short template or any 60-character run of a longer template.
    if (normalized.length < 16) continue;
    const window = Math.min(60, normalized.length);
    for (let offset = 0; offset + window <= normalized.length; offset++) {
      if (published.includes(normalized.slice(offset, offset + window))) {
        // Never log the matching span, even on failure.
        throw new Error('Copied feedback content detected in the candidate or summary; publication refused.');
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [itemPath, summaryPath, contentPath] = process.argv.slice(2);
    if (!itemPath || !summaryPath || !contentPath) throw new Error('Missing scanner input.');
    const item = JSON.parse(readFileSync(itemPath, 'utf8'));
    const summary = readFileSync(summaryPath, 'utf8');
    if (!summary.trim()) throw new Error('Missing candidate summary.');
    assertNoVerbatim(item, `${summary}\n${readFileSync(contentPath, 'utf8')}`);
    console.log('No matching feedback text detected in the candidate.');
  } catch (error) {
    console.error(`::error::${error.message === 'Copied feedback content detected in the candidate or summary; publication refused.' ? error.message : 'Feedback copy scan failed; publication refused.'}`);
    process.exitCode = 1;
  }
}
