package expo.modules.smsreader

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/**
 * Screens bank alerts at delivery time for the optional instant banner.
 *
 * The inbox query in SmsReaderModule already finds these messages, but only
 * once the app is next opened. This receiver deliberately keeps no second raw
 * message archive: the system inbox is the source of truth for ledger import.
 *
 * Only messages naming a currency amount are kept — everything else is
 * dropped here and never passed to the banner reader.
 */
class SmsDeliveryReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    try {
      if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
      val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
      if (parts.isEmpty()) return

      // A long alert arrives as several PDUs; the body only makes sense joined.
      val address = parts[0].originatingAddress ?: ""
      val body = parts.joinToString("") { it.messageBody ?: "" }.trim()
      if (body.isEmpty() || SensitiveMessageFilter.shouldReject(body) ||
        !MONEY_RE.containsMatchIn(body)) return
      InstantAlert.post(context, address, body)
    } catch (_: Exception) {
      // Never crash on a delivery broadcast. A dropped alert is recovered by
      // the next inbox scan; a crash loop on every incoming SMS is not.
    }
  }

  companion object {
    const val PREFS = "wafra_sms_capture"
    const val KEY = "received"
    // Must stay in step with the same-named pattern in
    // BankNotificationListenerService: both decide, before anything else can,
    // whether a message is about money at all. This one was left behind when
    // Arabic was added, so an Arabic bank SMS was dropped at delivery — the
    // parser had learned to read it and never got the chance.
    val MONEY_RE = Regex(
      "(?:AED|Dhs?|SAR|SR|QAR|KWD|BHD|OMR|EGP|INR|PKR|PHP|USD|EUR|GBP|CAD|AUD|JPY|CNY|CHF|TRY|GHS|د\\.إ|ر\\.س|درهم|ريال)\\s*[0-9]" +
        "|[0-9]\\s*(?:د\\.إ|ر\\.س|درهم|ريال)",
      RegexOption.IGNORE_CASE
    )
  }
}
