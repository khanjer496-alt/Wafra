// Reading regex patterns back out of the Kotlin they ship in.
//
// Two suites need this and a third copy of it would be one copy too many:
// instant-alert.test.js runs the patterns against the corpus using
// JavaScript's engine, and kotlin-regex.test.js compiles the same strings on
// a real JVM, which is the engine the app actually uses.

const fs = require('fs');
const path = require('path');

const MODULES = path.join(__dirname, '../../modules');

const FILES = {
  InstantAlert: path.join(
    MODULES,
    'sms-reader/android/src/main/java/expo/modules/smsreader/InstantAlert.kt',
  ),
  SmsDeliveryReceiver: path.join(
    MODULES,
    'sms-reader/android/src/main/java/expo/modules/smsreader/SmsDeliveryReceiver.kt',
  ),
  SmsReaderModule: path.join(
    MODULES,
    'sms-reader/android/src/main/java/expo/modules/smsreader/SmsReaderModule.kt',
  ),
  BankNotificationListenerService: path.join(
    MODULES,
    'notification-reader/android/src/main/java/expo/modules/notificationreader/BankNotificationListenerService.kt',
  ),
};

function read(file) {
  const p = FILES[file];
  if (!p) throw new Error(`unknown Kotlin file ${file}`);
  return fs.readFileSync(p, 'utf8');
}

/** Every "..." literal in a declaration, concatenated the way Kotlin does. */
function literals(text) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out.join('');
}

/**
 * Substitute $NAME references, LONGEST NAME FIRST.
 *
 * Doing it shortest-first turns "$CUR_AR" into "<value of CUR>_AR" — a
 * pattern that is not the one Kotlin compiles, and which happened to be
 * broken in precisely the way the real one was written to avoid. A suite
 * went red against a pattern the app never runs.
 */
function interpolate(text, vars) {
  let out = text;
  for (const key of Object.keys(vars).sort((a, b) => b.length - a.length)) {
    out = out.split(`$${key}`).join(vars[key]);
  }
  return out;
}

/**
 * A `const val` string, with any $NAME references already expanded.
 *
 * Stops at the next declaration rather than the next newline: these values are
 * long enough to wrap, and a newline-anchored scan read only the first
 * fragment — which, once the Arabic currency words were added, was empty.
 */
function constant(file, name, vars = {}) {
  const src = read(file);
  const m = src.match(
    new RegExp(`const val ${name} =([\\s\\S]*?)(?:\\n\\s*\\n|private |val )`),
  );
  if (!m) throw new Error(`${name} not found in ${file}.kt`);
  return interpolate(literals(m[1]), vars);
}

/**
 * The pattern string of a `Regex(...)` declaration, as Kotlin would build it:
 * one level of backslash escaping undone, $NAME references expanded.
 *
 * Anchored on the trailing RegexOption, not on a closing paren: the patterns
 * contain parens of their own, and a lazy scan to the next ")" silently
 * swallowed the declaration after it.
 */
function patternSource(file, name, vars = {}) {
  const src = read(file);
  const decl = src.match(
    new RegExp(`val ${name} = Regex\\(([\\s\\S]*?),\\s*RegexOption\\.IGNORE_CASE`),
  )?.[1];
  if (!decl) throw new Error(`${name} not found in ${file}.kt`);
  return interpolate(literals(decl).replace(/\\\\/g, '\\'), vars);
}

module.exports = { FILES, read, literals, interpolate, constant, patternSource };
