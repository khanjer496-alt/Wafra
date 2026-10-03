package expo.modules.notificationreader

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Telephony

/**
 * Exact package identities from current official bank listings plus
 * launch-tested legacy bank packages. Known bank ids may come from Play, an OEM
 * store or an Android restore/clone. Unknown apps still require Google Play as
 * installer plus financial context before they can enter the encrypted queue.
 * JS parses every candidate. Curated package ids remain strongest; previously
 * unseen Play-installed apps may also auto-import when their installed app
 * identity is independently bank/finance-like and the real parser produces a
 * confident posted transaction. Ambiguous app identity remains review-only.
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
  /** An SMS app's notification while Wafra cannot read SMS itself: Review only. */
  const val SOURCE_MESSAGING_REVIEW = "messaging-review"

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

  /**
   * Messaging apps are never a bank's own notification channel, whatever
   * their text says, and never a financial candidate.
   *
   * The default SMS app re-announces every bank SMS the SMS path already
   * captures, so while Wafra can read SMS a Messages notification is only a
   * second copy — and approving it in Review taught Wafra to trust the
   * Messages app itself, and with it anyone who can text the user. When the
   * user has NOT granted READ_SMS, though, that notification is their only
   * route to their bank's SMS. Then, and only for SMS apps, it is admitted as
   * SOURCE_MESSAGING_REVIEW: JS sends it to Review only and attaches no
   * package identity Review could learn. Chat apps carry money-looking text
   * from anyone and are never admitted.
   *
   * Keep both lists aligned with SMS_APP_PACKAGES and CHAT_APP_PACKAGES in
   * src/lib/auto-import.ts, which applies the same rule to queued rows;
   * android-review-capture.test.js compares them.
   */
  val smsAppPackages: Set<String> = setOf(
    "com.google.android.apps.messaging",
    "com.samsung.android.messaging",
    "com.android.mms",
    "com.android.messaging",
    "com.oneplus.mms",
    "com.microsoft.android.smsorganizer",
    "com.truecaller",
  )

  val chatAppPackages: Set<String> = setOf(
    "com.whatsapp",
    "com.whatsapp.w4b",
    "org.telegram.messenger",
    "org.thoughtcrime.securesms",
    "com.facebook.orca",
    "com.viber.voip",
    "jp.naver.line.android",
    "com.tencent.mm",
    "com.imo.android.imoim",
    "com.botim.im",
  )

  private fun defaultSmsPackage(context: Context): String? = try {
    Telephony.Sms.getDefaultSmsPackage(context)
  } catch (_: Exception) {
    null
  }

  /** The default SMS app or a known SMS app. */
  private fun isSmsApp(context: Context, packageName: String): Boolean =
    smsAppPackages.contains(packageName) || defaultSmsPackage(context) == packageName

  /** The default SMS app, a known SMS app or a known chat app. */
  fun isMessagingApp(context: Context, packageName: String): Boolean =
    chatAppPackages.contains(packageName) || isSmsApp(context, packageName)

  /**
   * Whether Wafra can read the SMS inbox itself. A failed check counts as
   * readable: the cost is a missed Review card for one notification, never a
   * duplicate of an SMS the inbox path already captures.
   */
  private fun smsReadable(context: Context): Boolean = try {
    context.checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED
  } catch (_: Exception) {
    true
  }

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

  /**
   * The user-visible label Android itself shows for this installed package.
   * This is package metadata, not notification text. It gives JS a second
   * identity surface for previously unseen banks without persisting any raw
   * financial content or making a network request to Play.
   */
  fun applicationLabel(context: Context, packageName: String): String = try {
    val info = context.packageManager.getApplicationInfo(packageName, 0)
    context.packageManager.getApplicationLabel(info).toString().trim()
      .take(MAX_APPLICATION_LABEL_CHARS)
  } catch (_: Exception) {
    ""
  }

  fun isTrusted(context: Context, packageName: String): Boolean =
    CAPTURE_ENABLED && markets.containsKey(packageName)

  /**
   * Notification access is device-wide. Rank sources locally before queueing:
   * exact known banks are strongest. Any other Google Play-installed app must
   * carry clear financial context. Android does not expose the Google Play "Finance"
   * store category through ApplicationInfo, so never infer trust from an app
   * category that the platform cannot actually provide.
   */
  fun sourceClass(context: Context, packageName: String, body: String): String? {
    // Exact curated bank package ids are accepted regardless of installer.
    // Android restores, OEM stores and phone-clone migrations can legitimately
    // leave installingPackageName null/non-Play even for the real bank app.
    // A second APK cannot coexist under the same package id, so requiring the
    // installer here made real ADCB/ENBD notifications silently disappear on
    // otherwise healthy phones. Unknown packages still require Play provenance;
    // this native classification alone never authorizes a ledger import.
    if (isTrusted(context, packageName)) return SOURCE_TRUSTED_BANK
    // Messaging apps before the Play gate: a preinstalled Messages app has no
    // Play installer, and the default-SMS role is itself the identity check.
    if (isMessagingApp(context, packageName)) {
      return if (isSmsApp(context, packageName) && !smsReadable(context) &&
          FINANCIAL_CONTEXT_RE.containsMatchIn(body)) SOURCE_MESSAGING_REVIEW else null
    }
    if (!playInstalled(context, packageName)) return null
    return if (FINANCIAL_CONTEXT_RE.containsMatchIn(body)) SOURCE_FINANCIAL_CANDIDATE else null
  }

  /**
   * Classification of a row already in the encrypted queue. A messaging-app
   * row always reaches JS as SOURCE_MESSAGING_REVIEW so JS can acknowledge
   * it (SMS readable, or a chat app) or send it to Review; returning null
   * would strand it in the queue until retention expires.
   */
  fun queuedSourceClass(context: Context, packageName: String, body: String): String? {
    if (isTrusted(context, packageName)) return SOURCE_TRUSTED_BANK
    if (isMessagingApp(context, packageName)) return SOURCE_MESSAGING_REVIEW
    return sourceClass(context, packageName, body)
  }

  private const val MAX_APPLICATION_LABEL_CHARS = 120
}
