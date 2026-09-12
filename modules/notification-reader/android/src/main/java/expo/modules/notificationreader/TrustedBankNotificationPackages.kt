package expo.modules.notificationreader

import android.content.Context
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

  fun isTrusted(context: Context, packageName: String): Boolean {
    if (!CAPTURE_ENABLED) return false
    if (!markets.containsKey(packageName)) return false
    val installer = try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        context.packageManager.getInstallSourceInfo(packageName).installingPackageName
      } else {
        @Suppress("DEPRECATION")
        context.packageManager.getInstallerPackageName(packageName)
      }
    } catch (_: Exception) {
      null
    }
    return installer == "com.android.vending"
  }
}
