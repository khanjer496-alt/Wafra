package expo.modules.smsreader

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * The banner the user sees the second a bank SMS lands.
 *
 * This runs inside a broadcast receiver, where there is no JavaScript engine
 * and therefore no access to the real parser. It reads the message with a
 * handful of deliberately blunt patterns instead.
 *
 * That is only acceptable because of one rule, which the rest of this file
 * exists to keep: NOTHING HERE IS EVER STORED. The row that reaches the
 * ledger is always the TypeScript parser's, produced later from the same
 * message. This is a preview, so being approximate costs at worst a cosmetic
 * difference in a banner that is gone in ten seconds.
 *
 * What is NOT acceptable is announcing something that never happened. A
 * promo, an OTP, a declined card, a statement reminder — each names an amount
 * and none of them is a charge. So the bar for posting is high and the
 * failure is deliberately one-sided: unless the message plainly states that
 * money MOVED, post nothing. The app still imports it on the next scan, so a
 * skipped banner costs the user nothing. A banner saying they just spent
 * AED 20,918 when they did not costs their trust in every banner after it.
 *
 * Framework notification APIs only, no androidx: this module is a library
 * inside someone else's app, and pinning a support-library version here is a
 * good way to break the host build.
 */
object InstantAlert {
  const val CHANNEL_ID = "instant-transactions"
  const val PREFS = "wafra_alert_prefs"
  const val KEY_ENABLED = "instant_alerts"

  /** Off unless the user turns it on — this is an interruption, not a default. */
  fun isEnabled(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false)

  fun setEnabled(context: Context, enabled: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit().putBoolean(KEY_ENABLED, enabled).apply()
  }

  /**
   * Post a banner for this message, or do nothing if it is not plainly a
   * completed transaction. Never throws.
   */
  fun post(context: Context, sender: String, body: String) {
    try {
      if (!isEnabled(context)) return
      val manager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
      if (!manager.areNotificationsEnabled()) return

      val read = read(body) ?: return
      ensureChannel(context, manager)

      // The second line names the bank and the card: the two facts that tell
      // the user WHICH card just moved, which is the whole reason to look.
      val account = listOfNotNull(
        bankName(sender),
        read.last4?.let { context.getString(R.string.wafra_alert_card, it) },
      ).joinToString(" ").ifEmpty { context.getString(R.string.wafra_alert_fallback) }

      val title = when {
        read.merchant != null && read.credit ->
          context.getString(R.string.wafra_alert_title_credit_named, read.amount, read.merchant)
        read.merchant != null ->
          context.getString(R.string.wafra_alert_title_named, read.amount, read.merchant)
        read.credit -> context.getString(R.string.wafra_alert_title_credit, read.amount)
        else -> context.getString(R.string.wafra_alert_title, read.amount)
      }

      val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?.apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP }
      val pending = open?.let {
        PendingIntent.getActivity(
          context, 0, it,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
      }

      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(context, CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(context)
      }
      builder
        .setSmallIcon(context.applicationInfo.icon)
        .setContentTitle(title)
        .setContentText(account)
        .setCategory(Notification.CATEGORY_STATUS)
        .setAutoCancel(true)
        .setOnlyAlertOnce(true)
      if (pending != null) builder.setContentIntent(pending)

      // One id per message text: two different charges in the same minute get
      // two banners, while a carrier re-delivering the identical alert lands
      // on the one already there instead of stacking a duplicate.
      manager.notify(TAG, body.hashCode(), builder.build())
    } catch (_: Exception) {
      // A banner is never worth crashing the SMS pipeline for.
    }
  }

  private const val TAG = "wafra-instant"

  private fun ensureChannel(context: Context, manager: NotificationManager) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    // DEFAULT, silent: these arrive several times a day. A heads-up banner
    // with a sound for every coffee is how an app gets muted wholesale — and
    // a user who mutes Wafra loses the payment reminders along with it.
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        context.getString(R.string.wafra_alert_channel),
        NotificationManager.IMPORTANCE_DEFAULT,
      ).apply {
        description = context.getString(R.string.wafra_alert_channel_description)
        enableVibration(false)
        setSound(null, null)
      },
    )
  }

  private data class Read(
    val amount: String,
    val credit: Boolean,
    val merchant: String?,
    val last4: String?,
  )

  /** Null when the message is not plainly a completed transaction. */
  private fun read(body: String): Read? {
    if (REFUSE_RE.containsMatchIn(body)) return null

    // The message must say money MOVED, in the past tense. Note what is
    // absent from these: "payment", "due", "outstanding", "balance". Those
    // appear in statement reminders, which name a large amount and charge
    // nothing — and they also appear as footers on genuine purchases, so
    // refusing on them would drop the real alerts too. Requiring a completed
    // verb handles both cases without a second list to keep in step.
    val credit = CREDIT_RE.containsMatchIn(body)
    if (!credit && !DEBIT_RE.containsMatchIn(body)) return null

    val amount = AMOUNT_RE.find(body) ?: return null
    val figure = amount.groupValues[2]
    // A redacted figure is not a figure. "AED ····1985.47" is a masked
    // balance; announcing it would quote a number that does not exist.
    if (figure.any { it == '·' || it == '*' || it == 'X' || it == 'x' }) return null
    if (!figure.any { it.isDigit() }) return null

    return Read(
      amount = "${amount.groupValues[1].uppercase()} $figure",
      credit = credit,
      merchant = merchant(body),
      last4 = LAST4_RE.find(body)?.groupValues?.get(1),
    )
  }

  /**
   * The merchant, only when the message states it with a preposition followed
   * by a clean run of name characters. No cleanup, no vocabulary, no
   * guessing: anything less obvious than "at CARREFOUR" is left out and the
   * banner falls back to the amount alone, which is still useful.
   */
  private fun merchant(body: String): String? {
    val name = MERCHANT_RE.find(body)?.groupValues?.get(1)
      ?.trim()?.trimEnd(',', '.', '-', ' ') ?: return null
    if (name.length < 3 || name.length > 28) return null
    if (!name.any { it.isLetter() }) return null
    // "at your account", "to the card ending" — a preposition followed by a
    // banking word is grammar, not a shop.
    val firstWord = name.substringBefore(' ')
    if (BANK_WORD_RE.matches(firstWord)) return null
    return name
  }

  /** The sender id banks use is already their name: "ADCB", "FAB", "HSBC". */
  private fun bankName(sender: String): String? {
    val trimmed = sender.trim()
    if (trimmed.isEmpty()) return null
    // A numeric sender is a short code, not a name — nothing worth showing.
    if (trimmed.all { it.isDigit() || it == '+' || it == '-' || it == ' ' }) return null
    return trimmed.take(16)
  }

  private const val CUR = "AED|Dhs?|SAR|SR|QAR|KWD|BHD|OMR|EGP|INR|PKR|USD|EUR|GBP"

  private val AMOUNT_RE = Regex("\\b($CUR)\\s*([\\d,.·*Xx]+)", RegexOption.IGNORE_CASE)

  private val LAST4_RE = Regex(
    "(?:card|a/?c|acct?|account)\\D{0,24}?(\\d{4})\\b",
    RegexOption.IGNORE_CASE,
  )

  private val MERCHANT_RE = Regex(
    "\\b(?:at|to|from)\\s+([A-Za-z0-9][A-Za-z0-9 &'./-]{2,27})",
    RegexOption.IGNORE_CASE,
  )

  private val DEBIT_RE = Regex(
    "purchase|was used|has been used|\\bdebited\\b|\\bspent\\b|withdraw(?:n|al)?|" +
      "\\bdeducted\\b|\\bcharged to\\b",
    RegexOption.IGNORE_CASE,
  )

  private val CREDIT_RE = Regex(
    "\\bcredited\\b|\\brefunded\\b|\\bdeposited\\b|\\bsalary\\b",
    RegexOption.IGNORE_CASE,
  )

  /**
   * Amounts that named no movement. Each of these has a matching refusal in
   * the TypeScript parser; this is the short, high-confidence subset, because
   * a wrong banner is worse than a missing one.
   *
   * Deliberately NOT here: "statement", "due", "outstanding", "balance". UAE
   * banks append those to genuine purchase alerts as a footer ("... Avl Bal
   * AED 9235.93. July statement due on 27/07/2026"), so refusing on them
   * would silence the real charges. The completed-verb requirement above is
   * what keeps statement reminders out.
   */
  private val REFUSE_RE = Regex(
    "\\botp\\b|one[- ]time (?:password|pin)|do not share|verification code|" +
      "declin|unsuccessful|insufficient|could not be (?:processed|completed)|has failed|" +
      "\\breversed\\b|pre[- ]?auth|blocked|" +
      "cashback|voucher|promo|discount|t&cs?\\b|terms apply|shop now|hurry|limited time|" +
      "congratulations|you (?:could|can) win|opt-?out|bit\\.ly|wa\\.me|tinyurl|" +
      "will be (?:charged|deducted)|instal?ments?\\b|convert now|\\bper transaction\\b|" +
      "\\bis charged at\\b|\\bare charged at\\b|rate our service",
    RegexOption.IGNORE_CASE,
  )

  private val BANK_WORD_RE = Regex(
    "^(?:a/?c|acc(?:t|ount)?|card|your|the|our|ref(?:erence)?|txn|transaction|iban|" +
      "you|us|customer|balance|available|avl|this|that|it)$",
    RegexOption.IGNORE_CASE,
  )
}
