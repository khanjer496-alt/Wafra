'use strict';
// Compile production Java against the real Billing 8 API and exercise real Purchase
// objects. Only public test dependencies enter a private temporary directory.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { ensureKotlinc, compilerEnv } = require('./kotlin-compiler.cjs');
const { fetchBytesWithRetry, resolveDependency, TOTAL_BUDGET_MS } = require('./download-with-retry.cjs');

// Pinned SHA-256 and two mirrors per file. CI's cache key is derived from these hashes (ci.yml).
const dependencies = require('./wafra-play-billing-deps.json');
const filesIn = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? filesIn(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);

async function main() {
  const root = path.resolve(__dirname, '../..');
  const source = path.join(root, 'modules/wafra-play-billing/android/src');
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), 'Library/Android/sdk');
  const androidJar = process.env.WAFRA_PLAY_BILLING_ANDROID_JAR || path.join(androidHome, 'platforms/android-36/android.jar');
  if (!fs.existsSync(androidJar)) throw Error('Android 36 API jar required; set WAFRA_PLAY_BILLING_ANDROID_JAR.');
  const javaHome = process.env.WAFRA_PLAY_BILLING_JAVA_HOME || process.env.JAVA_HOME ||
    (fs.existsSync('/opt/homebrew/opt/openjdk@17/bin/java') ? '/opt/homebrew/opt/openjdk@17' : null);
  const executable = name => javaHome ? path.join(javaHome, 'bin', name) : name;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-play-billing-native-'));
  try {
    // One at a time: four parallel requests to Maven Central from a shared runner are what gets rate-limited.
    // WAFRA_PLAY_BILLING_TEST_LIBS is a cache directory (see resolveDependency): verified jars are used from it and
    // verified downloads are written back, so CI can cache them. One retry budget covers every download of the run.
    const libs = process.env.WAFRA_PLAY_BILLING_TEST_LIBS;
    if (libs) fs.mkdirSync(libs, { recursive: true });
    const deadlineAt = Date.now() + TOTAL_BUDGET_MS;
    const fetchBytes = ({ urls, name }) => fetchBytesWithRetry({ urls, name, deadlineAt, log: (line) => console.error(line) });
    for (const { name, urls, sha256 } of dependencies) {
      const bytes = await resolveDependency({ name, urls, sha256, cacheDir: libs, fetchBytes, log: (line) => console.error(line) });
      fs.writeFileSync(path.join(temp, name), bytes, { mode: 0o600 });
    }
    fs.writeFileSync(path.join(temp, 'billing.jar'), execFileSync('unzip', ['-p', path.join(temp, 'billing-8.0.0.aar'), 'classes.jar'], { maxBuffer: 2_000_000 }));
    const classes = path.join(temp, 'classes'); fs.mkdirSync(classes);
    // Real org.json must precede the android.jar's non-runnable JVM stubs.
    const classpath = ['json-20250517.jar', 'billing.jar', 'junit-4.13.2.jar', 'hamcrest-core-1.3.jar']
      .map(file => path.join(temp, file)).concat(androidJar).join(path.delimiter);
    const sources = filesIn(source).filter(file => file.endsWith('.java'));
    execFileSync(executable('javac'), ['-Xlint:none', '-cp', classpath, '-d', classes, ...sources], { stdio: 'pipe', timeout: 30_000 });
    const output = execFileSync(executable('java'), ['-cp', [classes, classpath].join(path.delimiter), 'org.junit.runner.JUnitCore',
      'expo.modules.wafraplaybilling.SubscriptionQueryTest', 'expo.modules.wafraplaybilling.PurchaseProjectionTest'],
    { encoding: 'utf8', timeout: 30_000 });
    process.stdout.write(output);

    const compiler = await ensureKotlinc();
    const kotlinLib = path.resolve(path.dirname(compiler), '../lib');
    const stubs = path.join(temp, 'ExpoModuleStub.kt');
    fs.writeFileSync(stubs, `package expo.modules.kotlin.modules
class AppContext { val reactContext: android.content.Context? = null }
open class Module { val appContext = AppContext(); open fun definition(): Any = Unit }
class Definition {
  fun Name(name: String) {}
  fun AsyncFunction(name: String): expo.modules.kotlin.functions.AsyncFunctionBuilder = expo.modules.kotlin.functions.AsyncFunctionBuilder()
  fun OnDestroy(body: () -> Unit) {}
}
fun ModuleDefinition(body: Definition.() -> Unit): Any = Definition().apply(body)
`);
    const functions = path.join(temp, 'ExpoCoroutineStub.kt');
    // Keep the competing overloads from the installed, lockfile-pinned Expo
    // implementation. A zero-argument-only stub incorrectly accepted an
    // implicit-arity lambda that the real Android release compiler rejected.
    const expoBuilder = fs.readFileSync(path.join(root,
      'node_modules/expo-modules-core/android/src/main/java/expo/modules/kotlin/functions/AsyncFunctionBuilder.kt'), 'utf8');
    const overloads = [
      'inline infix fun <reified R> AsyncFunctionBuilder.Coroutine(crossinline block: suspend () -> R) = SuspendBody(block)',
      'inline infix fun <reified R, reified P0> AsyncFunctionBuilder.Coroutine(crossinline block: suspend (P0) -> R) = SuspendBody(block)',
    ];
    if (overloads.some(overload => !expoBuilder.split(/\r?\n/).includes(overload))) {
      throw Error('Expo Coroutine overload contract changed; review the native bridge ABI test.');
    }
    fs.writeFileSync(functions, `package expo.modules.kotlin.functions
open class BaseAsyncFunctionComponent
class SuspendFunctionComponent : BaseAsyncFunctionComponent()
class AsyncFunctionBuilder {
  inline fun <reified R> SuspendBody(crossinline block: suspend () -> R): BaseAsyncFunctionComponent = SuspendFunctionComponent()
  inline fun <reified R, reified P0> SuspendBody(crossinline block: suspend (P0) -> R): SuspendFunctionComponent = SuspendFunctionComponent()
}
${overloads.join('\n')}
`);
    // This checks the Kotlin bridge's Java/SAM/cancellation types. It does not
    // substitute for an integrated Expo/Gradle build or device verification.
    execFileSync(compiler, [stubs, functions, ...filesIn(path.join(source, 'main/java')).filter(file => file.endsWith('.kt')),
      '-classpath', [classes, androidJar, path.join(kotlinLib, 'kotlinx-coroutines-core-jvm.jar')].join(path.delimiter),
      '-d', path.join(temp, 'bridge.jar')], { env: compilerEnv(), stdio: 'pipe', timeout: 60_000 });
    console.log('Kotlin bridge Java/SAM/cancellation types compiled with Expo ABI stubs; integrated Gradle/device proof remains separate.');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); if (error.stdout) process.stderr.write(error.stdout); if (error.stderr) process.stderr.write(error.stderr); process.exitCode = 1; });
