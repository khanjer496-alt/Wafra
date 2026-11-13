#!/usr/bin/env node
'use strict';
// Reads the build-flag markers back out of a packaged Android artifact.
//
// src/lib/founder-pro.ts and src/lib/sms-corpus-export.ts export one marker
// string per flag. Expo inlines the EXPO_PUBLIC_* value and Metro's release
// constant folding keeps exactly one of "=on" / "=off", so the compiled
// bundle (Hermes bytecode keeps ASCII string literals verbatim) records how
// it was built, independent of what the workflow environment claimed.
//
//   node scripts/android-build-flags.cjs report <file.apk|file.aab|bundle>
//   node scripts/android-build-flags.cjs verify-production <file.apk|file.aab|bundle>
//
// verify-production exits 1 unless every marker is present and "=off".
// A marker that is missing, or present in both states (constant folding did
// not run, e.g. a development bundle), also fails: the check fails closed.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const FLAGS = ['founder-unlock', 'auto-founder-pro', 'sms-corpus-export'];
const BUNDLE_ENTRIES = { '.aab': 'base/assets/index.android.bundle', '.apk': 'assets/index.android.bundle' };

function readBundle(file) {
  const entry = Object.entries(BUNDLE_ENTRIES).find(([ext]) => file.endsWith(ext))?.[1];
  if (!entry) return fs.readFileSync(file);
  const out = spawnSync('unzip', ['-p', file, entry], { maxBuffer: 512 * 1024 * 1024 });
  if (out.status !== 0 || out.stdout.length === 0) {
    throw new Error(`${file} has no ${entry}`);
  }
  return out.stdout;
}

function report(buffer) {
  const text = buffer.toString('latin1');
  return Object.fromEntries(FLAGS.map((flag) => {
    const on = text.includes(`wafra-build-flag:${flag}=on`);
    const off = text.includes(`wafra-build-flag:${flag}=off`);
    return [flag, on && off ? 'both' : on ? 'on' : off ? 'off' : 'missing'];
  }));
}

function main(argv) {
  const [command, file] = argv;
  if (!['report', 'verify-production'].includes(command) || !file) {
    console.error('usage: android-build-flags.cjs report|verify-production <file.apk|file.aab|bundle>');
    return 2;
  }
  const flags = report(readBundle(file));
  console.log(JSON.stringify(flags));
  if (command === 'report') return 0;
  const bad = Object.entries(flags).filter(([, state]) => state !== 'off');
  for (const [flag, state] of bad) {
    console.error(`::error::${file}: build flag ${flag} is "${state}"; a production artifact must compile it "off".`);
  }
  return bad.length === 0 ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { FLAGS, report, readBundle, main };
