'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ensureKotlinc, compilerEnv } = require('../kotlin-compiler.cjs');

// Compile the production Kotlin source classifier and credential predicate.
// Android stand-ins supply installer/permission metadata only; no JS regex mirror.
const root = path.resolve(__dirname, '../../..');
const sources = path.join(root, 'modules/notification-reader/android/src/main/java/expo/modules/notificationreader');
const financial = [
  ['de debit', 'Kartenbelastung: EUR 12,34 wurde von Ihrem Konto abgebucht.'],
  ['de credit', 'Gutschrift EUR 54,32 wurde Ihrem Konto gutgeschrieben.'],
  ['de uppercase', 'ÜBERWEISUNG EUR 14,25 ERFOLGREICH.'],
  ['fr debit', 'Paiement par carte débité de EUR 12,34 chez TEST SHOP.'],
  ['fr credit', 'Virement reçu de EUR 54,32 sur votre compte.'],
  ['fr ascii', 'Paiement debite EUR 14,25 sur votre compte.'],
  ['es debit', 'Compra con tarjeta por EUR 12,34 realizada.'],
  ['es credit', 'Abono de EUR 54,32 en su cuenta.'],
  ['es uppercase', 'TRANSFERENCIA EUR 14,25 REALIZADA.'],
  ['it debit', 'Pagamento con carta di EUR 12,34 effettuato.'],
  ['it credit', 'Accredito di EUR 54,32 sul conto.'],
  ['it debit compound', 'Addebitato EUR 14,25 sul conto.'],
  ['nl debit', 'Betaling EUR 12,34 afgeschreven van uw rekening.'],
  ['nl credit', 'EUR 54,32 bijgeschreven op uw rekening.'],
  ['nl uppercase', 'KAARTBETALING EUR 14,25 VOLTOOID.'],
  ['de existing posted cue', 'EUR 12,34 bezahlt.'],
  ['fr existing posted cue', 'EUR 12,34 effectué.'],
  ['es existing posted cue', 'EUR 12,34 pagado.'],
  ['it existing posted cue', 'EUR 12,34 pagato.'],
  ['nl existing posted cue', 'EUR 12,34 betaald.'],
  ['mixed words', 'Paiement EUR 12,34 debited from account.'],
  ['arabic retained', 'شراء بمبلغ EUR 12,34 من حسابك.'],
  ['english retained', 'Card purchase of EUR 12.34 completed.'],
  ['security advisory only', 'Paiement par carte EUR 12,34 terminé. Ne partagez jamais votre code de sécurité.'],
  ['de completed confirmation', 'Zahlung EUR 12,34 bestätigt. Referenz 876543.'],
  ['fr completed confirmation', 'Paiement EUR 12,34 confirmé. Référence 876543.'],
  ['es completed confirmation', 'Pago de EUR 12,34 confirmado. Referencia 876543.'],
  ['it completed confirmation', 'Pagamento EUR 12,34 confermato. Riferimento 876543.'],
  ['nl completed confirmation', 'Betaling EUR 12,34 bevestigd. Referentie 876543.'],
  ['grouped space reference', 'Paiement par carte EUR 12,34 terminé. Référence 123 456.'],
  ['grouped hyphen reference', 'Paiement par carte EUR 12,34 terminé. Référence 12-34-56.'],
  ['grouped reference plus security advice', 'Paiement par carte EUR 12,34 terminé. Référence 123 456. Ne partagez jamais votre code de sécurité.'],
];
const credentials = [
  ['nonadjacent OTP', 'Your OTP for the transaction of AED 500.00 is 448122.'],
  ['nonadjacent OTP grouped money', 'Your OTP for the transaction of AED 5,000.00 is 448122.'],
  ['nonadjacent OTP reference ID', 'Your OTP for transaction reference TX123456 is 448122.'],
  ['nonadjacent security code reference ID', 'Your security code for payment reference ABCD1234 is 448122.'],
  ['nonadjacent OTP numeric ref', 'Your OTP for transaction ref 789012 is 448122.'],
  ['English grouped', 'Verification code: 123 456 for AED 25.00 purchase.'],
  ['English Unicode', 'OTP ١٢٣٤٥٦ for AED 25.00 purchase.'],
  ['English fullwidth', 'Your OTP is １２３４５６ for USD 25.00 purchase.'],
  ['de after', 'Ihr Bestätigungscode lautet 123456 für die Zahlung EUR 12,34.'],
  ['de before', '123456 ist Ihr Sicherheitscode für EUR 12,34.'],
  ['de verification', 'Verifizierungscode: 123456. Kartenbelastung EUR 12,34.'],
  ['de tan', 'Ihre TAN ist 123456 für die Überweisung EUR 12,34.'],
  ['de action', 'Bestätigen Sie diese Zahlung von EUR 12,34.'],
  ['fr after', 'Votre code de vérification est 123456 pour un paiement EUR 12,34.'],
  ['fr before', '123456 est votre code de sécurité pour EUR 12,34.'],
  ['fr apostrophe', 'Code d’authentification : 123456. Paiement EUR 12,34.'],
  ['fr action', 'Confirmez ce paiement de EUR 12,34.'],
  ['es after', 'Su código de verificación es 123456 para el pago EUR 12,34.'],
  ['es before', '123456 es tu código de seguridad para EUR 12,34.'],
  ['es login', 'Código de acceso: 123456. Pago EUR 12,34.'],
  ['es action', 'Confirma este pago de EUR 12,34.'],
  ['it after', 'Il codice di verifica è 123456 per il pagamento EUR 12,34.'],
  ['it before', '123456 è il tuo codice di sicurezza per EUR 12,34.'],
  ['it otp', 'Codice monouso: 123456. Pagamento EUR 12,34.'],
  ['it action', 'Conferma questo pagamento di EUR 12,34.'],
  ['nl after', 'Uw verificatiecode is 123456 voor betaling EUR 12,34.'],
  ['nl before', '123456 is uw beveiligingscode voor EUR 12,34.'],
  ['nl login', 'Inlogcode: 123456. Betaling EUR 12,34.'],
  ['nl action', 'Bevestig deze betaling van EUR 12,34.'],
  ['english retained', 'Your OTP is 123456 for a purchase of EUR 12.34.'],
  ['arabic after', 'رمز التحقق: ١٢٣٤٥٦ لشراء بقيمة EUR 12,34.'],
  ['arabic before', '١٢٣٤٥٦ رمز التأكيد لشراء بقيمة EUR 12,34.'],
  ['hindi after', 'सत्यापन कोड: १२३४५६ भुगतान EUR 12,34.'],
  ['hindi before', '१२३४५६ आपका सत्यापन कोड है भुगतान EUR 12,34.'],
  ['unicode digits', 'Code de sécurité : １２３４５６ pour EUR 12,34.'],
  ['bidi hidden code', 'Code de sécurité : \u200f١٢٣٤٥٦ pour EUR 12,34.'],
  ['fr grouped after', 'Code de sécurité : 123 456. Paiement par carte EUR 12,34.'],
  ['fr grouped before', '123 456 est votre code de sécurité pour le paiement EUR 12,34.'],
  ['fr hyphen grouped after', 'Votre code de sécurité : 12-34-56. Paiement par carte EUR 12,34.'],
  ['fr hyphen grouped before', '12-34-56 est votre code de sécurité pour le paiement EUR 12,34.'],
  ['fr unicode grouped after', 'Code de sécurité : ١٢٣ ٤٥٦. Paiement par carte EUR 12,34.'],
  ['fr unicode grouped before', '१२३-४५६ est votre code de sécurité pour le paiement EUR 12,34.'],
];
const contextStubs = {
  'Context.kt': `package android.content
open class Context {
  var packageManager = android.content.pm.PackageManager()
  var smsPermission = android.content.pm.PackageManager.PERMISSION_GRANTED
  var defaultSms: String? = null
  fun checkSelfPermission(permission: String): Int = smsPermission
}
`,
  'PackageManager.kt': `package android.content.pm
class ApplicationInfo
class InstallSourceInfo(val installingPackageName: String?)
class PackageManager {
  var installer: String? = "com.android.vending"
  var failInstaller = false
  fun getInstallSourceInfo(pkg: String): InstallSourceInfo { if(failInstaller) throw IllegalStateException("unavailable"); return InstallSourceInfo(installer) }
  fun getInstallerPackageName(pkg: String): String? { if(failInstaller) throw IllegalStateException("unavailable"); return installer }
  fun getApplicationInfo(pkg: String, flags: Int) = ApplicationInfo()
  fun getApplicationLabel(info: ApplicationInfo): CharSequence = "Test app"
  companion object { const val PERMISSION_GRANTED = 0 }
}
`,
  'Manifest.kt': `package android
object Manifest { object permission { const val READ_SMS = "android.permission.READ_SMS" } }
`,
  'Build.kt': `package android.os
object Build { object VERSION { var SDK_INT = 35 }; object VERSION_CODES { const val R = 30 } }
`,
  'Telephony.kt': `package android.provider
object Telephony { object Sms { fun getDefaultSmsPackage(context: android.content.Context): String? = context.defaultSms } }
`,
  'BuildConfig.kt': `package expo.modules.notificationreader
object BuildConfig { const val WAFRA_ANDROID_NOTIFICATION_CAPTURE_ENABLED = true }
`,
};
const quote = text => JSON.stringify(text).replace(/\$/g, '\\$');
const kotlin = `package expo.modules.notificationreader
import android.content.Context
import expo.modules.smsreader.SensitiveMessageFilter
fun main() {
  var checks = 0
  var failures = 0
  fun expect(label: String, actual: Any?, expected: Any?) {
    checks++
    if(actual != expected) { failures++; println("FAIL " + label) }
  }
  val context = Context()
  val unknown = "com.example.notificationproducer"
${financial.map(([name, body]) => `  expect(${quote(name + ': source')}, TrustedBankNotificationPackages.sourceClass(context, unknown, ${quote(body)}), "financial-candidate")
  expect(${quote(name + ': not trusted')}, TrustedBankNotificationPackages.isTrusted(context, unknown), false)
  expect(${quote(name + ': no credential')}, SensitiveNotificationFilter.shouldReject(${quote(body)}), false)
  expect(${quote(name + ': chat')}, TrustedBankNotificationPackages.sourceClass(context, "com.whatsapp", ${quote(body)}), null)`).join('\n')}
${credentials.map(([name, body]) => `  expect(${quote(name)}, SensitiveNotificationFilter.shouldReject(${quote(body)}), true)
  expect(${quote(name + ": SMS")}, SensitiveMessageFilter.shouldReject(${quote(body)}), true)`).join('\n')}
  expect("completed SMS with OTP advice", SensitiveMessageFilter.shouldReject("Card ending 1234 was used for JOD 15.251. Never share your OTP."), false)
  expect("SMS receipt reference is not a code", SensitiveMessageFilter.shouldReject("Transfer USD 25.00 completed. Ref 123456. Never share your OTP."), false)
  expect("SMS advice cannot cross into reference", SensitiveMessageFilter.shouldReject("Card ending 1234 was used for JOD 15.251. Never share your OTP for any transaction. Your reference is 123456."), false)
  expect("notification advice cannot cross into reference", SensitiveNotificationFilter.shouldReject("Transfer USD 25.00 completed. Never share your verification code for payments. Transaction reference is 123456."), false)
  expect("SMS advice cannot consume comma/reference clause", SensitiveMessageFilter.shouldReject("Card ending 1234 was used for USD 25.00. Never share your OTP for transactions, your reference is 123456."), false)
  expect("money without financial context", TrustedBankNotificationPackages.sourceClass(context, unknown, "EUR 12,34"), null)
  expect("ordinary promotion", TrustedBankNotificationPackages.sourceClass(context, unknown, "Rabatt EUR 12,34 auf Schuhe"), null)
  expect("French promotion", TrustedBankNotificationPackages.sourceClass(context, unknown, "Offre spéciale EUR 12,34 sur les chaussures"), null)
  expect("unrelated word substring", TrustedBankNotificationPackages.sourceClass(context, unknown, "Apartheid EUR 12,34"), null)
  context.packageManager.installer = null
  expect("unknown nonplay", TrustedBankNotificationPackages.sourceClass(context, unknown, "Paiement EUR 12,34"), null)
  expect("curated restored bank", TrustedBankNotificationPackages.sourceClass(context, "com.adcb.nexgen", "Paiement EUR 12,34"), "trusted-bank")
  context.packageManager.failInstaller = true
  expect("installer check fail closed", TrustedBankNotificationPackages.sourceClass(context, unknown, "Paiement EUR 12,34"), null)
  context.packageManager.failInstaller = false
  context.packageManager.installer = "com.android.vending"
  expect("readable sms avoids duplicate", TrustedBankNotificationPackages.sourceClass(context, "com.google.android.apps.messaging", "Paiement EUR 12,34"), null)
  context.smsPermission = 1
  expect("unreadable sms review only", TrustedBankNotificationPackages.sourceClass(context, "com.google.android.apps.messaging", "Paiement EUR 12,34"), "messaging-review")
  expect("unreadable chat excluded", TrustedBankNotificationPackages.sourceClass(context, "org.telegram.messenger", "Paiement EUR 12,34"), null)
  context.packageManager.installer = null
  context.defaultSms = "com.example.smsrole"
  expect("default sms role review only", TrustedBankNotificationPackages.sourceClass(context, "com.example.smsrole", "Zahlung EUR 12,34"), "messaging-review")
  android.os.Build.VERSION.SDK_INT = 29
  expect("legacy unknown nonplay", TrustedBankNotificationPackages.sourceClass(context, unknown, "Zahlung EUR 12,34"), null)
  context.packageManager.installer = "com.android.vending"
  expect("legacy unknown play candidate", TrustedBankNotificationPackages.sourceClass(context, unknown, "Zahlung EUR 12,34"), "financial-candidate")
  println("CHECKS " + checks + " FAILURES " + failures)
  check(failures == 0) { "Native admission assertions failed" }
}
`;

test('European financial context and credential rejection execute in the production Kotlin classes', async () => {
  const compiler = await ensureKotlinc();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-european-admission-'));
  try {
    for (const [name, text] of Object.entries(contextStubs)) fs.writeFileSync(path.join(dir, name), text);
    fs.writeFileSync(path.join(dir, 'AdmissionCheck.kt'), kotlin);
    execFileSync(compiler, [
      path.join(sources, 'TrustedBankNotificationPackages.kt'),
      path.join(sources, 'SensitiveNotificationFilter.kt'),
      path.join(root, 'modules/sms-reader/android/src/main/java/expo/modules/smsreader/SensitiveMessageFilter.kt'),
      ...Object.keys(contextStubs).map(file => path.join(dir, file)),
      path.join(dir, 'AdmissionCheck.kt'), '-include-runtime', '-d', path.join(dir, 'check.jar'),
    ], { cwd: dir, env: compilerEnv(), stdio: 'pipe', timeout: 60000 });
    let output;
    try {
      output = execFileSync(process.env.JAVA || 'java', ['-Dfile.encoding=UTF-8', '-jar', path.join(dir, 'check.jar')],
        { cwd: dir, stdio: 'pipe', encoding: 'utf8', timeout: 10000 });
    } catch (error) {
      assert.fail(String(error.stdout || error.stderr || error.message).trim());
    }
    assert.match(output, /CHECKS \d+ FAILURES 0/);
    console.log(output.trim());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
