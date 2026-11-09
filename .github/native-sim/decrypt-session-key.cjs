'use strict';

const fs = require('node:fs');
const { openHandoff, writePrivateToken } = require('./session-key.cjs');

// Arguments are paths and public run metadata, never a password or access key.
try {
  const [privateFile, encryptedFile, output, session, runId, runAttempt, sourceSha] = process.argv.slice(2);
  if (process.argv.length !== 9) throw new Error('Expected private-key path, artifact path, output path, session, run ID, attempt and source SHA');
  const stat = fs.lstatSync(privateFile);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.uid !== process.getuid()) {
    throw new Error('Private key must be an owner-only regular file owned by this user');
  }
  const artifact = fs.lstatSync(encryptedFile);
  if (!artifact.isFile() || artifact.isSymbolicLink() || artifact.size > 16384) throw new Error('Invalid handoff artifact');
  let envelope;
  try { envelope = JSON.parse(fs.readFileSync(encryptedFile, 'utf8')); }
  catch { throw new Error('Invalid encrypted handoff JSON'); }
  const token = openHandoff(envelope,
    fs.readFileSync(privateFile), { session, runId, runAttempt, sourceSha });
  writePrivateToken(output, token);
  console.log('Session key saved to owner-only file; value not displayed');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
