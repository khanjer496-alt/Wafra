// The Kotlin patterns, on the engine that actually runs them.
//
// instant-alert.test.js takes these same strings and compiles them with
// JavaScript's regex engine. The app compiles them with Java's. Those are two
// different engines, and nothing was checking that a pattern valid in one is
// valid in the other — or even that it compiles at all, since no test builds
// the Android module and a Kotlin syntax error only surfaces ~18 minutes into
// a release build.
//
// Java is stricter in ways that matter here. Its lookbehind must be bounded;
// its \b is defined over [a-zA-Z0-9_] exactly as JavaScript's is, which is the
// trap the Arabic work kept hitting; and \p{L} means different things
// depending on flags. So the patterns are read out of the Kotlin source,
// compiled by javac, and run against the same cases.
//
// Skipped, loudly, when there is no JDK on the machine.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { constant, patternSource } = require('./kotlin-source');

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail));
  }
}

function haveJdk() {
  try {
    execFileSync('javac', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!haveJdk()) {
  console.log('— no JDK on this machine; Kotlin patterns not checked on the JVM');
  console.log('\n0 passed, 0 failed');
  process.exit(0);
}

/* ── the patterns, read out of the Kotlin ────────────────────────────── */

const CUR_AR = constant('InstantAlert', 'CUR_AR');
const CUR = constant('InstantAlert', 'CUR', { CUR_AR });
const vars = { CUR, CUR_AR };

const PATTERNS = [
  ['AMOUNT_RE', patternSource('InstantAlert', 'AMOUNT_RE', vars)],
  ['LAST4_RE', patternSource('InstantAlert', 'LAST4_RE', vars)],
  ['MERCHANT_RE', patternSource('InstantAlert', 'MERCHANT_RE', vars)],
  ['DEBIT_RE', patternSource('InstantAlert', 'DEBIT_RE', vars)],
  ['CREDIT_RE', patternSource('InstantAlert', 'CREDIT_RE', vars)],
  ['REFUSE_RE', patternSource('InstantAlert', 'REFUSE_RE', vars)],
  ['BANK_WORD_RE', patternSource('InstantAlert', 'BANK_WORD_RE', vars)],
  ['MONEY_RE', patternSource('BankNotificationListenerService', 'MONEY_RE')],
  ['SMS_MONEY_RE', patternSource('SmsDeliveryReceiver', 'MONEY_RE')],
  ['FINANCIAL_BRAND_RE', patternSource('SmsReaderModule', 'FINANCIAL_BRAND_RE')],
  ['SENSITIVE_AUTH_RE', patternSource('SmsReaderModule', 'SENSITIVE_AUTH_RE')],
];

// Two gates decide whether a message is about money at all — one for SMS at
// delivery, one for bank-app notifications. They are separate files and had
// silently drifted: Arabic was added to one and not the other, so an Arabic
// bank SMS was discarded before the parser that had just learned to read it
// ever saw it.
{
  const a = PATTERNS.find(([n]) => n === 'MONEY_RE')[1];
  const b = PATTERNS.find(([n]) => n === 'SMS_MONEY_RE')[1];
  ok('both money gates accept the same currencies', a === b, { notification: a, sms: b });
}

/**
 * The amount cases. Group 1/2 is "AED 150.00", group 3/4 the Arabic order.
 *
 * "ending 001 SR" is the one that matters: allowing a Latin code after digits
 * made a card number read as the charge, and it has to stay wrong on the JVM
 * too, not just in the JavaScript restatement of it.
 */
const AMOUNT_CASES = [
  ['تم خصم مبلغ 150.00 درهم من حسابك', '150.00'],
  ['عملية شراء بمبلغ AED 250.00 لدى نون', '250.00'],
  ['Purchase of AED 10.00 with Card ending 001 SR at CARREFOUR', '10.00'],
  ['Purchase of AED 120.00 at CARREFOUR', '120.00'],
  ['Using your card for GHS 120.00 at SHOP. Avl Limit AED 5,000.00', '120.00'],
];

// Diagnostic export is intentionally fail-closed. A known bank name in a
// personal message body is never enough, and a sender label that merely
// contains a bank token is not a trusted bank sender either.
const SENDER_CASES = [
  ['FAB', true],
  ['EmiratesNBD', true],
  ['AE-ADCB', true],
  ['Wio-Alerts', true],
  ['ADCBAlert', true],
  ['FABAlert', true],
  ['MashreqAlert', true],
  ['RAKBANKUAE', true],
  ['ADIBAlerts', true],
  ['Liv.', true],
  ['+971501234567', false],
  ['971501234567', false],
  ['My FAB friend', false],
  ['ADCB scam support', false],
  ['ADCBSupport', false],
];

const SECRET_CASES = [
  ['Your OTP for AED 1 is 123456', true],
  ['Use authorization code 1234 for AED 1', true],
  ['Your card PIN is 1234. Amount AED 1', true],
  ['Never share your CVV. Purchase AED 1', false],
  ['Purchase AED 120 at Noon. Never share your OTP, PIN or CVV.', false],
  ['Password reset requested after AED 1 purchase', true],
  ['رمز التحقق ١٢٣٤ لعملية AED 1', true],
  ['Purchase of AED 12.00 at Carrefour was approved', false],
  ['If you did not authorize this AED 12 purchase, call us', false],
];

/* ── hand it to javac ────────────────────────────────────────────────── */

function javaString(s) {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

const src = `import java.util.regex.*;
public class WafraRegexCheck {
  public static void main(String[] a) {
    int bad = 0;
    Pattern amount = null;
    Pattern sender = null;
    Pattern secret = null;
${PATTERNS.map(
  ([name, body]) => `    try {
      Pattern p = Pattern.compile(${javaString(body)}, Pattern.CASE_INSENSITIVE);
      if ("AMOUNT_RE".equals(${javaString(name)})) amount = p;
      if ("FINANCIAL_BRAND_RE".equals(${javaString(name)})) sender = p;
      if ("SENSITIVE_AUTH_RE".equals(${javaString(name)})) secret = p;
      System.out.println("COMPILES ${name}");
    } catch (Exception e) { bad++; System.out.println("BROKEN ${name} " + e.getMessage()); }`,
).join('\n')}
${AMOUNT_CASES.map(
  ([body, want]) => `    {
      Matcher m = amount.matcher(${javaString(body)});
      String got = "(none)";
      if (m.find()) got = m.group(2) != null ? m.group(2) : m.group(3);
      if (!${javaString(want)}.equals(got)) { bad++; System.out.println("WRONG " + got + " want ${want}"); }
      else System.out.println("AMOUNT ok ${want}");
    }`,
).join('\n')}
${SENDER_CASES.map(
  ([value, want]) => `    {
      boolean got = sender.matcher(${javaString(value)}.trim()).matches();
      if (got != ${want}) { bad++; System.out.println("SENDER wrong " + got + " want ${want}: ${value}"); }
      else System.out.println("SENDER ok ${want}: ${value}");
    }`,
).join('\n')}
${SECRET_CASES.map(
  ([value, want]) => `    {
      boolean got = secret.matcher(${javaString(value)}).find();
      if (got != ${want}) { bad++; System.out.println("SECRET wrong " + got + " want ${want}: ${value}"); }
      else System.out.println("SECRET ok ${want}: ${value}");
    }`,
).join('\n')}
    System.exit(bad == 0 ? 0 : 1);
  }
}
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-kt-'));
fs.writeFileSync(path.join(dir, 'WafraRegexCheck.java'), src, 'utf8');

let out = '';
let compiled = false;
try {
  execFileSync('javac', ['-encoding', 'UTF-8', 'WafraRegexCheck.java'], { cwd: dir, stdio: 'pipe' });
  compiled = true;
  out = execFileSync('java', ['-Dfile.encoding=UTF-8', 'WafraRegexCheck'], {
    cwd: dir,
    encoding: 'utf8',
  });
} catch (e) {
  out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
}

ok('the generated check compiles', compiled, out.slice(0, 400));

for (const [name] of PATTERNS) {
  ok(`${name} compiles as a Java regex`, out.includes(`COMPILES ${name}`),
    out.split('\n').find((l) => l.startsWith(`BROKEN ${name}`)));
}

for (const [, want] of AMOUNT_CASES) {
  ok(`Java reads the amount as ${want}`, out.includes(`AMOUNT ok ${want}`),
    out.split('\n').filter((l) => l.startsWith('WRONG')));
}

for (const [value, want] of SENDER_CASES) {
  ok(`bank sender gate reads ${JSON.stringify(value)} as ${want}`, out.includes(`SENDER ok ${want}: ${value}`),
    out.split('\n').filter((l) => l.startsWith('SENDER wrong')));
}

for (const [value, want] of SECRET_CASES) {
  ok(`secret gate reads ${JSON.stringify(value)} as ${want}`, out.includes(`SECRET ok ${want}: ${value}`),
    out.split('\n').filter((l) => l.startsWith('SECRET wrong')));
}

fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
