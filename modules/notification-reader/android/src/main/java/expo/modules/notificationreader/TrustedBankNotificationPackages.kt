package expo.modules.notificationreader

import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Build

/**
 * Exact package identities from current official Google Play listings plus
 * launch-tested legacy bank packages. Package name alone is not identity: a
 * sideload can claim an absent name, so capture also requires Google Play to
 * be the recorded installer. Unknown/sideloaded apps fail closed.
 *
 * Keep this map byte-for-byte aligned with
 * src/lib/trusted-bank-notification-packages.ts; contracts.test.js enforces it.
 */
object TrustedBankNotificationPackages {
  // Ordinary Android builds expose the listener. Exact Play-installed package
  // identity and the user's Notification access remain mandatory.
  val CAPTURE_ENABLED = BuildConfig.WAFRA_ANDROID_NOTIFICATION_CAPTURE_ENABLED

  const val SOURCE_TRUSTED_BANK = "trusted-bank"
  const val SOURCE_PLAY_FINANCE = "play-finance"
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
    markets.containsKey(packageName) && playInstalled(context, packageName)

  /**
   * Notification access is device-wide. Rank sources locally before queueing:
   * exact known banks are strongest; Play Finance apps are eligible for the
   * universal parser; other Play apps must also carry clear financial context
   * and are review-only until the user confirms that package in Wafra.
   */
  fun sourceClass(context: Context, packageName: String, body: String): String? {
    if (!playInstalled(context, packageName)) return null
    if (markets.containsKey(packageName)) return SOURCE_TRUSTED_BANK

    val financeCategory = try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.packageManager.getApplicationInfo(packageName, 0).category == ApplicationInfo.CATEGORY_FINANCE
      } else false
    } catch (_: Exception) {
      false
    }
    if (financeCategory) return SOURCE_PLAY_FINANCE
    return if (FINANCIAL_CONTEXT_RE.containsMatchIn(body)) SOURCE_FINANCIAL_CANDIDATE else null
  }
}
