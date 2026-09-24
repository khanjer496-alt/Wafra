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
const { constant, patternSource, rawPatternSource } = require('./kotlin-source');

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
  ['PURCHASE_PREFIX_RE', patternSource('InstantAlert', 'PURCHASE_PREFIX_RE', vars)],
  ['PROMO_FOOTER_RE', patternSource('InstantAlert', 'PROMO_FOOTER_RE', vars)],
  ['UNSAFE_TRANSACTION_RE', patternSource('InstantAlert', 'UNSAFE_TRANSACTION_RE', vars)],
  ['PAYMENT_MERCHANT_RE', patternSource('InstantAlert', 'PAYMENT_MERCHANT_RE', vars)],
  ['MONEY_RE', patternSource('BankNotificationListenerService', 'MONEY_RE')],
  ['SMS_MONEY_RE', patternSource('SmsDeliveryReceiver', 'MONEY_RE')],
  ['SMS_CREDENTIAL_RE', patternSource('SensitiveMessageFilter', 'CREDENTIAL_RE')],
  ['NOTIFICATION_CREDENTIAL_RE', patternSource('SensitiveNotificationFilter', 'CREDENTIAL_RE')],
  ['CLOCK_RE', rawPatternSource('NotificationCaptureStore', 'TRANSACTION_DATETIME_RE')],
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

{
  const sms = PATTERNS.find(([n]) => n === 'SMS_CREDENTIAL_RE')[1];
  const notification = PATTERNS.find(([n]) => n === 'NOTIFICATION_CREDENTIAL_RE')[1];
  ok('SMS and notification credential gates are identical', sms === notification);
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

/**
 * The repost gate's clock, on the engine Android actually runs.
 *
 * This pattern decides whether a bank alert may be DISCARDED as a
 * redelivery, so both directions are load-bearing and neither is a
 * formatting preference:
 *
 *   accepted — every second-precision shape the corpus really contains.
 *     ADCB alone sends two of them, and a slash-only pattern skipped the
 *     guard for its own dash-separated alerts.
 *   refused — minute precision. Two genuine charges at one terminal inside
 *     one minute carry identical text, and suppressing the second would
 *     delete a real charge. Seconds are the discriminator.
 */
const CLOCK_CASES = [
  // Verbatim shapes from the corpus (parser.test.js:816 is the ADCB dash one).
  ['AED300.00 debited from Acc/Cr.Card XXX7720 for Salik on 11-02-2025 09:03:37 through ADCB Mobile App.', true],
  ['Purchase of AED 110.00 at TABBY with Credit Card 2518 on 11/09/2026 23:53:12.', true],
  ['Purchase of AED 110.00 at TABBY on 03/07/26 05:53:12.', true],
  ['Purchase of AED 110.00 at TABBY on 11.09.2026 17:10:20.', true],
  ['Purchase of AED 110.00 at TABBY on 1/9/2026 7:10:20.', true],
  // Minute precision is refused ON PURPOSE — see above.
  ['Purchase of AED 110.00 at TABBY on 03/07/26 05:53.', false],
  ['Purchase of AED 110.00 at TABBY on 11/09/2026 17:10.', false],
  // No clause resembling a clock at all.
  ['Purchase of AED 110.00 at TABBY with Credit Card 2518.', false],
];

const CREDENTIAL_CASES = [
  ['Use 458213 to authenticate your purchase of AED 500.00 at NOON.', true],
  ['Enter 458213 to confirm the payment of SAR 250.00.', true],
  ['Your OTP is 458213 for an AED 80.00 transaction.', true],
  ['Approve this payment of AED 42.00 to SAMPLE RESTAURANT in the app.', true],
  ['Your credit card transaction is approved. Your Credit Card has been used for AED 42.00 at SAMPLE RESTAURANT.', false],
  ['AED 89.50 spent at CARREFOUR. Do not share your OTP with anyone.', false],
  ['Purchase of AED 89.50 at CARREFOUR authenticated via 3D Secure.', false],
  ['Purchase of AED 89.50 at CARREFOUR with Debit Card ending 1234.', false],
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
    Pattern credential = null;
    Pattern clock = null;
${PATTERNS.map(
  ([name, body]) => `    try {
      Pattern p = Pattern.compile(${javaString(body)}, Pattern.CASE_INSENSITIVE);
      if ("AMOUNT_RE".equals(${javaString(name)})) amount = p;
      if ("SMS_CREDENTIAL_RE".equals(${javaString(name)})) credential = p;
      if ("CLOCK_RE".equals(${javaString(name)})) clock = p;
      System.out.println("COMPILES ${name}");
    } catch (Exception e) { bad++; System.out.println("BROKEN ${name} " + e.getMessage()); }`,
).join('\n')}
${CLOCK_CASES.map(
  ([body, want], index) => `    {
      boolean got = clock.matcher(${javaString(body)}).find();
      if (got != ${want}) { bad++; System.out.println("CLOCK wrong ${index} " + got); }
      else System.out.println("CLOCK ok ${index}");
    }`,
).join('\n')}
${CREDENTIAL_CASES.map(
  ([body, want], index) => `    {
      boolean got = credential.matcher(${javaString(body)}).find();
      if (got != ${want}) { bad++; System.out.println("CREDENTIAL wrong ${index} " + got); }
      else System.out.println("CREDENTIAL ok ${index}");
    }`,
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

for (let index = 0; index < CLOCK_CASES.length; index++) {
  const [body, want] = CLOCK_CASES[index];
  ok(`Java repost clock ${want ? 'accepts' : 'refuses'}: ${body.slice(-28)}`,
    out.includes(`CLOCK ok ${index}`),
    out.split('\n').filter((line) => line.startsWith(`CLOCK wrong ${index} `)));
}

// The SMS carrier-duplicate fold (auto-import.ts) decides whether to DISCARD
// an identical SMS on the same clock the notification re-post guard uses. If
// the two drifted, one channel would fold a same-minute double charge the
// other keeps. Same source, same flags, same verdict on every clock case.
{
  const kotlin = PATTERNS.find(([n]) => n === 'CLOCK_RE')[1];
  const { CARRIER_DUPLICATE_DATETIME_RE } = require('./build/auto-import.js');
  ok('SMS carrier-duplicate clock is byte-identical to the notification re-post clock',
    CARRIER_DUPLICATE_DATETIME_RE.source === kotlin && CARRIER_DUPLICATE_DATETIME_RE.flags === '',
    { kotlin, js: CARRIER_DUPLICATE_DATETIME_RE.source, flags: CARRIER_DUPLICATE_DATETIME_RE.flags });
  const disagreements = CLOCK_CASES.filter(([body, want]) =>
    CARRIER_DUPLICATE_DATETIME_RE.test(body) !== want);
  ok('SMS carrier-duplicate clock gives the JVM verdict on every clock case',
    disagreements.length === 0, disagreements);
}

for (let index = 0; index < CREDENTIAL_CASES.length; index++) {
  ok(`Java credential gate handles case ${index + 1}`,
    out.includes(`CREDENTIAL ok ${index}`),
    out.split('\n').filter((line) => line.startsWith('CREDENTIAL wrong')));
}

fs.rmSync(dir, { recursive: true, force: true });

/* ── the pure notification policies, compiled by kotlinc when present ── */
//
// NotificationTextSurfaces is deliberately free of Android types so its
// DECISIONS — which conversation entry is the posting — run here as real
// Kotlin, not as a restatement. kotlinc is not part of the usual toolchain, so
// this section is skipped (loudly) without it; set KOTLINC to its path.
function findKotlinc() {
  for (const candidate of [process.env.KOTLINC, 'kotlinc'].filter(Boolean)) {
    try {
      execFileSync(candidate, ['-version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // try the next
    }
  }
  return null;
}
const kotlinc = findKotlinc();
if (!kotlinc) {
  console.log('— no kotlinc (set KOTLINC); pure notification policies not executed as Kotlin');
} else {
  const kdir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-ktc-'));
  const cases = [
    // [expression, expected printed value]
    // History entries: the newest by its own timestamp; without one, never
    // guess — only a single amount-bearing entry is used.
    [`NotificationTextSurfaces.newest(listOf("old AED 900.00", "new AED 5.00"), emptyList(), amt)`, 'null'],
    [`NotificationTextSurfaces.newest(listOf("Your statement is ready", "new AED 5.00"), emptyList(), amt)`, 'new AED 5.00'],
    [`NotificationTextSurfaces.newest(listOf("line AED 1.00"), listOf(NotificationTextSurfaces.Message(200L, "newest AED 5.00"), NotificationTextSurfaces.Message(100L, "older and much longer AED 900.00")), amt)`, 'newest AED 5.00'],
    [`NotificationTextSurfaces.newest(emptyList(), listOf(NotificationTextSurfaces.Message(100L, "first AED 1.00"), NotificationTextSurfaces.Message(100L, "second AED 2.00")), amt)`, 'null'],
    [`NotificationTextSurfaces.newest(emptyList(), listOf(NotificationTextSurfaces.Message(100L, "hello"), NotificationTextSurfaces.Message(100L, "second AED 2.00")), amt)`, 'second AED 2.00'],
    [`NotificationTextSurfaces.newest(emptyList(), listOf(NotificationTextSurfaces.Message(0L, "a AED 1.00"), NotificationTextSurfaces.Message(0L, "b AED 2.00")), amt)`, 'null'],
    [`NotificationTextSurfaces.newest(emptyList(), emptyList(), amt)`, 'null'],
    // A group summary is redundant only while one of its children is visible.
    [`NotificationTextSurfaces.summaryHasVisibleChild("s", "g", listOf(NotificationTextSurfaces.Member("s", "g", true), NotificationTextSurfaces.Member("c", "g", false)))`, 'true'],
    [`NotificationTextSurfaces.summaryHasVisibleChild("s", "g", listOf(NotificationTextSurfaces.Member("s", "g", true)))`, 'false'],
    [`NotificationTextSurfaces.summaryHasVisibleChild("s", "g", listOf(NotificationTextSurfaces.Member("s", "g", true), NotificationTextSurfaces.Member("c", "other", false), NotificationTextSurfaces.Member("t", "g", true)))`, 'false'],
    [`NotificationTextSurfaces.summaryHasVisibleChild("s", null, listOf(NotificationTextSurfaces.Member("c", null, false)))`, 'false'],
  ];
  fs.writeFileSync(path.join(kdir, 'Check.kt'), `package expo.modules.notificationreader
fun main() {
  val amt: (String) -> Boolean = { it.contains("AED") }
${cases.map(([expr], index) => `  println("CASE ${index} " + (${expr}).toString())`).join('\n')}
}
`, 'utf8');
  let kout = '';
  let kcompiled = false;
  try {
    execFileSync(kotlinc, [
      path.join(__dirname, '../../modules/notification-reader/android/src/main/java/expo/modules/notificationreader/NotificationTextSurfaces.kt'),
      path.join(kdir, 'Check.kt'),
      '-include-runtime', '-d', path.join(kdir, 'check.jar'),
    ], { cwd: kdir, stdio: 'pipe' });
    kcompiled = true;
    kout = execFileSync('java', ['-Dfile.encoding=UTF-8', '-cp', path.join(kdir, 'check.jar'),
      'expo.modules.notificationreader.CheckKt'], { cwd: kdir, encoding: 'utf8' });
  } catch (e) {
    kout = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  ok('the pure notification policies compile as Kotlin', kcompiled, kout.slice(0, 400));
  cases.forEach(([expr, want], index) => {
    const line = kout.split('\n').find((l) => l.startsWith(`CASE ${index} `));
    ok(`Kotlin: ${expr.slice(0, 70)} → ${want}`, line === `CASE ${index} ${want}`, line);
  });
  fs.rmSync(kdir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
