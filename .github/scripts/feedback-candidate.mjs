/** A bounded, data-only handoff. No patches, paths, symlinks, hooks or code from
 * the candidate are executed by this module. Every consumer validates anew.
 */
import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoVerbatim } from './feedback-no-verbatim.mjs';
import { validateFeedbackItem } from './feedback-input.mjs';

const MAX_FILE = 1_048_576;
const MAX_PAYLOAD = 4_194_304;
const reject = () => { throw new Error('Invalid feedback candidate.'); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const testPath = value => /^(?:scripts\/test\/[a-z0-9-]+\.test\.js|server\/test\/[a-z0-9-]+\.test\.cjs)$/.test(value);
const sourcePath = value => /^(?:src|server\/src)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.tsx?$/.test(value);
function regularFile(root, relative) {
  let current = root;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    let info;
    try { info = lstatSync(current); } catch { reject(); }
    if (info.isSymbolicLink() || (index === parts.length - 1 ? !info.isFile() : !info.isDirectory())) reject();
    if (index === parts.length - 1 && info.size > MAX_FILE) reject();
  }
  return current;
}
function readText(file) {
  const buffer = readFileSync(file);
  const content = buffer.toString('utf8');
  if (content.includes('\0') || !Buffer.from(content).equals(buffer)) reject();
  return content;
}
export function validateManifest(value, { root, baseSha, feedbackId }) {
  if (!exact(value, ['schema', 'baseSha', 'feedbackId', 'summary', 'files']) || value.schema !== 1 ||
      !/^[a-f0-9]{40}$/.test(baseSha ?? '') || value.baseSha !== baseSha ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(feedbackId ?? '') ||
      value.feedbackId !== feedbackId || typeof value.summary !== 'string' ||
      !value.summary.trim() || Buffer.byteLength(value.summary) > 8_192 || value.summary.includes('\0') ||
      !Array.isArray(value.files) || value.files.length < 2 || value.files.length > 20 ||
      Buffer.byteLength(JSON.stringify(value)) > MAX_PAYLOAD) reject();
  const seen = new Set();
  for (const file of value.files) {
    if (!exact(file, ['path', 'content']) || typeof file.path !== 'string' ||
        (!sourcePath(file.path) && !testPath(file.path)) || seen.has(file.path) ||
        typeof file.content !== 'string' || Buffer.byteLength(file.content) > MAX_FILE ||
        file.content.includes('\0') || Buffer.from(file.content).toString('utf8') !== file.content) reject();
    seen.add(file.path);
    const original = readText(regularFile(root, file.path));
    if (original === file.content) reject();
  }
  if (!value.files.some(file => testPath(file.path)) || !value.files.some(file => sourcePath(file.path))) reject();
  return value;
}
export function readManifest(file, options) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_PAYLOAD) reject();
  let value;
  try { value = JSON.parse(readText(file)); } catch { reject(); }
  return validateManifest(value, options);
}
export function manifestDigest(value) {
  // Canonicalizing after exact validation binds validation to what publication
  // consumes, regardless of JSON whitespace or object-key order in artifacts.
  return import('node:crypto').then(({ createHash }) => createHash('sha256').update(JSON.stringify({
    schema: value.schema, baseSha: value.baseSha, feedbackId: value.feedbackId, summary: value.summary,
    files: value.files.map(file => ({ path: file.path, content: file.content })),
  })).digest('hex'));
}
export function collectCandidate({ root, candidateRoot, summaryPath, baseSha, feedbackId }) {
  // Git is used only in the untouched host checkout, with no candidate cwd,
  // git config, hooks, environment files, or executable accepted from Docker.
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const files = [];
  for (const relative of tracked) {
    const originalPath = path.join(root, relative);
    const candidatePath = path.join(candidateRoot, relative);
    const original = readFileSync(originalPath);
    let info;
    try { info = lstatSync(candidatePath); } catch { reject(); }
    if (!info.isFile() || info.isSymbolicLink() || info.size > Math.max(original.length, MAX_FILE)) reject();
    if (original.equals(readFileSync(candidatePath))) continue;
    if (!sourcePath(relative) && !testPath(relative)) reject();
    files.push({ path: relative, content: readText(regularFile(candidateRoot, relative)) });
  }
  const summaryInfo = lstatSync(summaryPath);
  if (!summaryInfo.isFile() || summaryInfo.isSymbolicLink() || summaryInfo.size > 8_192) reject();
  return validateManifest({ schema: 1, baseSha, feedbackId, summary: readText(summaryPath), files }, { root, baseSha, feedbackId });
}
export function applyCandidate(value, { root, targetRoot, baseSha, feedbackId, testsOnly = false }) {
  validateManifest(value, { root, baseSha, feedbackId });
  for (const file of value.files) {
    if (testsOnly && !testPath(file.path)) continue;
    // Target is a fresh baseline export made by trusted workflow steps.
    writeFileSync(regularFile(targetRoot, file.path), file.content);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [command, input, destination] = process.argv.slice(2);
    const options = { root: process.cwd(), baseSha: process.env.GITHUB_SHA, feedbackId: process.env.FEEDBACK_ID };
    if (command === 'collect') {
      const item = await validateFeedbackItem(JSON.parse(readFileSync(process.env.FEEDBACK_ITEM, 'utf8')), options.feedbackId);
      const value = collectCandidate({ ...options, candidateRoot: input, summaryPath: process.env.FEEDBACK_SUMMARY });
      assertNoVerbatim(item, [value.summary, ...value.files.map(file => file.content)].join('\n'));
      writeFileSync(destination, JSON.stringify(value), { mode: 0o600 });
    } else if (command === 'apply' || command === 'tests') {
      applyCandidate(readManifest(input, options), { ...options, targetRoot: destination, testsOnly: command === 'tests' });
    } else if (command === 'digest') {
      const digest = await manifestDigest(readManifest(input, options));
      if (!process.env.GITHUB_OUTPUT) reject();
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.GITHUB_OUTPUT, `digest=${digest}\n`);
    } else reject();
  } catch {
    console.error('::error::Feedback candidate failed the path, payload, or diagnostic copy gate. Contents withheld.');
    process.exitCode = 1;
  }
}
