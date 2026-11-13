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
// Never emit a line that names credential material, even after redaction.
const DROP = /BEGIN [A-Z ]*PRIVATE KEY|\bauthorization\s*:|\bbearer\s+\S|\b(?:EXPO_TOKEN|ASC_KEY_P8|ASC_PRIVATE_KEY|EXPO_ASC_API_KEY_P8)\s*=/i;

function clean(line) {
  return line.replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

function redactor(secrets) {
  const values = [...new Set(secrets.filter(v => typeof v === 'string' && v.trim().length >= 6).map(v => v.trim()))]
    .sort((a, b) => b.length - a.length);
  return line => {
    let out = line;
    for (const value of values) out = out.split(value).join('[redacted]');
    return out
      .replace(/[A-Za-z0-9+/_=-]{32,}/g, '[redacted-long-token]')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
  };
}

function summarize(sources, exitCode, secrets = []) {
  const redact = redactor(secrets);
  const entries = [];
  const seen = new Set();
  let firstPhase = null;
  let truncated = false;
  for (const { name, text } of sources) {
    let phase = null;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = clean(lines[i]);
      const marker = line.match(PHASE);
      if (marker) phase = marker[1];
      if (!ERROR_LINE.test(line) || DROP.test(line)) continue;
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
  const secrets = ['EXPO_TOKEN', 'EXPO_ASC_KEY_ID', 'EXPO_ASC_ISSUER_ID', 'ASC_KEY_ID', 'ASC_ISSUER_ID']
    .map(name => process.env[name]);
  for (const keyPath of [process.env.EXPO_ASC_API_KEY_PATH, process.env.ASC_PRIVATE_KEY_PATH]) {
    try { if (keyPath) secrets.push(...fs.readFileSync(keyPath, 'utf8').split(/\r?\n/)); } catch { /* key already removed */ }
  }
  process.stdout.write(summarize(collect(process.argv.slice(2), fs, path), exitCode, secrets));
}
