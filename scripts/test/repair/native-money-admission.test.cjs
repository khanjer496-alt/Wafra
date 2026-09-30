'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { patternSource } = require('../kotlin-source');
const { parseSms } = require('../build/sms-parser');

// The first two are existing parser regressions, previously tested only after
// the native admission boundary. The remainder are explicit synthetic probes.
const cases = [
  ['Arabic digits', 'شراء بمبلغ ١٥٠٫٧٥ درهم لدى صيدلية النهدي بالبطاقة المنتهية ١٢٣٤', true],
  ['bidi mark', 'Purchase of AED ‏150.00 at CARREFOUR with card ending 1234.', true],
  ['nonbreaking space', 'Purchase of AED\u00a0150.00 at CARREFOUR with card ending 1234.', true],
  ['Persian digits', 'Purchase of AED۱۵۰.۰۰ at CARREFOUR with card ending 1234.', true],
  ['ordinary amount', 'Purchase of AED150.00 at CARREFOUR with card ending 1234.', true],
  ['credential', 'Your OTP is 458213 for a purchase of AED\u200f150.00.', false],
  ['no money', 'Your card is ready for collection.', false],
  ['currency without number', 'Your AED account is ready.', false],
];

test('parser-supported Unicode bank alerts reach the native money gate while credentials stay excluded', () => {
  for (const [label, body] of cases.slice(0, 2)) assert.ok(parseSms(body), label);
  const javac = ['javac', '/opt/homebrew/opt/openjdk/bin/javac', '/usr/local/opt/openjdk/bin/javac']
    .find(command => { try { execFileSync(command, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } });
  assert.ok(javac, 'A JDK is required to verify the changed Android admission patterns');
  const java = javac === 'javac' ? 'java' : path.join(path.dirname(javac), 'java');
  const quote = text => JSON.stringify(text);
  const gates = [
    ['SmsDeliveryReceiver', 'SensitiveMessageFilter'],
    ['BankNotificationListenerService', 'SensitiveNotificationFilter'],
  ];
  const checks = gates.flatMap(([gate, credential]) => cases.map(([label, body, expected]) =>
    `if ((Pattern.compile(${quote(patternSource(gate, 'MONEY_RE'))}, Pattern.CASE_INSENSITIVE).matcher(${quote(body)}).find() &&
      !Pattern.compile(${quote(patternSource(credential, 'CREDENTIAL_RE'))}, Pattern.CASE_INSENSITIVE).matcher(${quote(body)}).find()) != ${expected})
      throw new AssertionError(${quote(`${gate}: ${label}`)});`));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-admission-'));
  try {
    fs.writeFileSync(path.join(dir, 'AdmissionCheck.java'),
      `import java.util.regex.Pattern; public class AdmissionCheck { public static void main(String[] args) { ${checks.join('\n')} } }`);
    execFileSync(javac, ['-encoding', 'UTF-8', 'AdmissionCheck.java'], { cwd: dir, stdio: 'pipe' });
    execFileSync(java, ['-Dfile.encoding=UTF-8', 'AdmissionCheck'], { cwd: dir, stdio: 'pipe' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
