'use strict';

// A capped, plain-text report of why a local EAS iOS archive failed, for CI
// readers that refuse raw logs. It keeps only error lines and the EAS phase
// they occurred in, strips terminal control bytes, and redacts the job's
// secret values and anything shaped like a credential. It is evidence only:
// the build's real exit code is preserved by the caller.

const MAX_ENTRIES = 120;
const MAX_LINE = 400;
const MAX_FILE_BYTES = 64 * 1024 * 1024;

const ERROR_LINE = new RegExp([
  String.raw`\berror:`, String.raw`\[!\]`, '❌', String.raw`\bfatal error\b`,
  String.raw`\*\* (?:ARCHIVE|BUILD|EXPORT) FAILED \*\*`, String.raw`\bCommand \w+ failed\b`,
  String.raw`\bCode ?Sign(?:ing)? Error\b`, String.raw`\bNo (?:profiles?|signing certificate)\b`,
  String.raw`\bProvisioning profile\b.*\b(?:doesn't|does not|expired|invalid|not found)\b`,
  String.raw`^\s*Error:`, String.raw`\bnpm ERR!`, String.raw`\bBuild failed\b`,
  String.raw`\bUnknown error\b`, String.raw`\bnon-zero exit code\b`,
].join('|'), 'i');
// An EAS build phase marker, e.g. "[INSTALL_PODS] Installing pods".
const PHASE = /^\s*\[([A-Z][A-Z0-9_]{2,})\]/;
// The repository is public, so the artifact is too: fail closed. Never emit a
// line that names credential material at all, even after redaction. This
// covers fastlane's import_certificate command line, which carries the p12
// password from EAS (not from this job's env, so it can't be matched by value).
const DROP = /BEGIN [A-Z ]*PRIVATE KEY|\bauthorization\s*:|\bbearer\s+\S|password|passphrase|passwd|\bsecret|private[_-]?key|import_certificate|certificate_password|\bsecurity\s+(?:import|unlock-keychain|create-keychain)\b|\s-[pP]\s+\S|\b(?:EXPO_TOKEN|GH_TOKEN|GITHUB_TOKEN|ASC_KEY_P8|ASC_PRIVATE_KEY|EXPO_ASC_API_KEY_P8)\b/i;
// Credential-named assignments that survive DROP (e.g. "token=…", "api_key: …").
const NAMED_VALUE = /\b([\w.-]*(?:token|api[_-]?key|access[_-]?key|auth)[\w.-]*\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi;
// The signing identity carries the developer's legal name.
const SIGNING_IDENTITY = /\b(Apple (?:Distribution|Development)|iPhone (?:Distribution|Developer)|iOS (?:Distribution|Development)|Developer ID (?:Application|Installer)):\s*[^(\n]+\(/g;
// A team named in quotes ("…team \"Jane Q Developer (Individual)\"") is the same legal name.
const QUOTED_TEAM = /\b(team\s+)(["'])[^"'\n]+\2/gi;
// Code-name shape (CamelCase words, an optional leading acronym such as "RCT",
// at most 2 digits): ExpoModulesCore2Info, RCTBridgeModule, React2Core. Random
// tokens almost never fit it, so only these are spared by the shape rules below.
function identifierShaped(part) {
  if (!part) return true;
  if ((part.match(/[0-9]/g) || []).length > 2) return false;
  return /^(?:[A-Z]{2,4}(?=[A-Z][a-z]))?(?:[A-Z]?[a-z]{2,}|[0-9])+$/.test(part);
}

function clean(line) {
  return line.replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

function redactor(secrets) {
  const values = [...new Set(secrets.filter(v => typeof v === 'string' && v.trim().length >= 4).map(v => v.trim()))]
    .sort((a, b) => b.length - a.length);
  // Every 8-character window of every known secret: a run containing one is a
  // fragment of that secret (e.g. a truncated token or one piece of a key line).
  const windows = new Set();
  for (const value of values) for (let i = 0; i + 8 <= value.length; i++) windows.add(value.slice(i, i + 8));
  const fragment = run => { for (let i = 0; i + 8 <= run.length; i++) if (windows.has(run.slice(i, i + 8))) return true; return false; };
  return line => {
    let out = line;
    for (const value of values) out = out.split(value).join('[redacted]');
    return out
      .replace(/[A-Za-z0-9+/=_-]{8,}/g, run => fragment(run) ? '[redacted]' : run)
      .replace(NAMED_VALUE, '$1[redacted]')
      .replace(SIGNING_IDENTITY, '$1: [identity] (')
      .replace(QUOTED_TEAM, '$1$2[team]$2')
      // Unknown base64 blobs that "/" would otherwise split into short pieces:
      // 24+ chars, not starting with "/" (absolute paths do), mixing digits with
      // upper and lower case, unless every "/" segment is code-name shaped
      // (Pods/Headers/Public/React2Core).
      .replace(/(^|[^A-Za-z0-9+/=])([A-Za-z0-9+=][A-Za-z0-9+/=]{23,})/g, (m, pre, run) => {
        if (!run.includes('/') || !/[0-9]/.test(run) || !/[a-z]/.test(run) || !/[A-Z]/.test(run)) return m;
        return run.split('/').every(identifierShaped) ? m : `${pre}[redacted-blob]`;
      })
      // Unknown token-shaped runs: 20+ characters mixing letters and digits.
      // "/" and "." split runs so file paths and target names stay readable;
      // known secrets (including base64 key lines) are already caught above.
      // Code names (every "-"/"_" part identifier-shaped) are spared.
      .replace(/[A-Za-z0-9+_=-]{20,}/g, run =>
        /[0-9]/.test(run) && /[A-Za-z]/.test(run) && !run.split(/[-_]/).every(identifierShaped) ? '[redacted-token]' : run)
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
  };
}

function summarize(sources, exitCode, secrets = []) {
  const redact = redactor(secrets);
  const entries = [];
  const seen = new Set();
  let firstPhase = null;
  let truncated = false;
  let withheld = 0;
  for (const { name, text } of sources) {
    let phase = null;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = clean(lines[i]);
      const marker = line.match(PHASE);
      if (marker) phase = marker[1];
      if (!ERROR_LINE.test(line)) continue;
      if (DROP.test(line)) { withheld++; continue; }
      const body = redact(line.trim()).slice(0, MAX_LINE);
      const key = `${phase}|${body}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (entries.length === MAX_ENTRIES) { truncated = true; break; }
      if (firstPhase === null) firstPhase = phase || 'unknown';
      entries.push(`${phase || '-'} | ${name}:${i + 1} | ${body}`);
    }
    if (truncated) break;
  }
  const header = [
    `exit code: ${exitCode}`,
    `phase of first error: ${firstPhase || 'none found'}`,
    `sources: ${sources.map(s => `${s.name} (${s.text.split(/\r?\n/).length} lines)`).join(', ') || 'none'}`,
    `error lines: ${entries.length}${truncated ? ` (capped at ${MAX_ENTRIES})` : ''}`,
    `error lines withheld because they name credential material: ${withheld}`,
    '',
  ];
  return header.concat(entries).join('\n') + '\n';
}

function collect(paths, fs, path) {
  const sources = [];
  const visit = (p, depth) => {
    let stat;
    try { stat = fs.statSync(p); } catch { return; }
    if (stat.isDirectory()) {
      if (depth > 8) return;
      for (const child of fs.readdirSync(p).sort()) {
        if (child === 'node_modules' || child === 'Pods' || child === '.git') continue;
        visit(path.join(p, child), depth + 1);
      }
    } else if (stat.isFile() && (depth === 0 || /\.log$/.test(p)) && stat.size <= MAX_FILE_BYTES) {
      sources.push({ name: path.basename(p), text: fs.readFileSync(p, 'utf8') });
    }
  };
  for (const p of paths) visit(p, 0);
  return sources;
}

module.exports = { summarize, collect };
if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  const exitCode = Number(process.env.BUILD_EXIT);
  if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) throw new Error('BUILD_EXIT is required');
  const secrets = ['EXPO_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'EXPO_ASC_KEY_ID', 'EXPO_ASC_ISSUER_ID', 'ASC_KEY_ID', 'ASC_ISSUER_ID']
    .map(name => process.env[name]);
  for (const keyPath of [process.env.EXPO_ASC_API_KEY_PATH, process.env.ASC_PRIVATE_KEY_PATH]) {
    try { if (keyPath) secrets.push(...fs.readFileSync(keyPath, 'utf8').split(/\r?\n/)); } catch { /* key already removed */ }
  }
  process.stdout.write(summarize(collect(process.argv.slice(2), fs, path), exitCode, secrets));
}
