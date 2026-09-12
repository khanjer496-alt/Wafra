package expo.modules.notificationreader

import android.content.Context
import android.os.Build

/**
 * Exact package identities from current official bank listings plus
 * launch-tested legacy bank packages. Known bank ids may come from Play, an OEM
 * store or an Android restore/clone. Unknown apps still require Google Play as
 * installer and remain review-only until explicitly learned locally.
 *
 * Keep this map byte-for-byte aligned with
 * src/lib/trusted-bank-notification-packages.ts; contracts.test.js enforces it.
 */
object TrustedBankNotificationPackages {
  // Ordinary Android builds expose the listener. Exact Play-installed package
  // identity and the user's Notification access remain mandatory.
  val CAPTURE_ENABLED = BuildConfig.WAFRA_ANDROID_NOTIFICATION_CAPTURE_ENABLED

  const val SOURCE_TRUSTED_BANK = "trusted-bank"
  const val SOURCE_FINANCIAL_CANDIDATE = "financial-candidate"

  private val FINANCIAL_CONTEXT_RE = Regex(
    "\\b(?:debit(?:ed)?|credit(?:ed)?|purchase|payment|transaction|transfer|spent|withdraw(?:al|n)?|refund|card|account|balance|statement|merchant|pos|atm|iban|swift)\\b" +
      "|بطاق[هة]|حساب|رصيد|معامل[هة]|عملي[هة]|شراء|دفع|تحويل|سحب|استرداد",
    RegexOption.IGNORE_CASE,
  )

  val markets: Map<String, String> = mapOf(
    "com.emiratesnbd.android" to "AE",
    "com.adcb.nexgen" to "AE",
    "com.adcb.bank" to "AE",
    "com.fab.personalbanking" to "AE",
    "com.vipera.ts.starter.MashreqAE" to "AE",
    "io.wio.retail" to "AE",
    "ae.wio.personal" to "AE",
    "ae.hsbc.hsbcuae" to "AE",
    "com.alrajhiretailapp" to "SA",
    "com.BankAlBilad" to "SA",
    "com.bankalbilad.NewRMB" to "SA",
    "com.riyadbank.digitalmobile" to "SA",
    "com.AamalTech.alinmaBank" to "SA",
    "net.bnpparibas.mescomptes" to "FR",
    "com.barclays.android.barclaysmobilebanking" to "GB",
    "com.hdfcbank.android.now" to "IN",
  )

  private fun installer(context: Context, packageName: String): String? = try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        context.packageManager.getInstallSourceInfo(packageName).installingPackageName
      } else {
        @Suppress("DEPRECATION")
        context.packageManager.getInstallerPackageName(packageName)
      }
    } catch (_: Exception) {
      null
    }

  private fun playInstalled(context: Context, packageName: String): Boolean =
    CAPTURE_ENABLED && installer(context, packageName) == "com.android.vending"

  fun isTrusted(context: Context, packageName: String): Boolean =
    CAPTURE_ENABLED && markets.containsKey(packageName)

  /**
   * Notification access is device-wide. Rank sources locally before queueing:
   * exact known banks are strongest. Any other Google Play-installed app must
   * carry clear financial context and is review-only until the user confirms
   * that package in Wafra. Android does not expose the Google Play "Finance"
   * store category through ApplicationInfo, so never infer trust from an app
   * category that the platform cannot actually provide.
   */
  fun sourceClass(context: Context, packageName: String, body: String): String? {
    // Exact curated bank package ids are accepted regardless of installer.
    // Android restores, OEM stores and phone-clone migrations can legitimately
    // leave installingPackageName null/non-Play even for the real bank app.
    // A second APK cannot coexist under the same package id, so requiring the
    // installer here made real ADCB/ENBD notifications silently disappear on
    // otherwise healthy phones. Unknown packages still require Play provenance
    // and remain review-only.
    if (isTrusted(context, packageName)) return SOURCE_TRUSTED_BANK
    if (!playInstalled(context, packageName)) return null
    return if (FINANCIAL_CONTEXT_RE.containsMatchIn(body)) SOURCE_FINANCIAL_CANDIDATE else null
  }
}
