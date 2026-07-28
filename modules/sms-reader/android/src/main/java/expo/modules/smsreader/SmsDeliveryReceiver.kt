package expo.modules.smsreader

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import org.json.JSONArray
import org.json.JSONObject

/**
 * Captures bank alerts at delivery time, before anything else touches them.
 *
 * The inbox query in SmsReaderModule already finds these messages, but only
 * once the app is next opened and only if the message was persisted to the
 * SMS provider. Catching the broadcast means a transaction is recorded the
 * moment it lands, which is what makes same-second alerts possible.
 *
 * Only messages naming a currency amount are kept — everything else is
 * dropped here and never stored, so personal correspondence is not retained
 * even for a moment. Kept entries go to a small ring buffer in
 * SharedPreferences that the app drains during its normal import scan, the
 * same shape the notification listener uses.
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
      val ts = parts[0].timestampMillis
      if (body.isEmpty() || !MONEY_RE.containsMatchIn(body)) return

      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val arr = JSONArray(prefs.getString(KEY, "[]"))
      // Carriers re-deliver on occasion; an identical body from the same
      // sender back-to-back is the same alert, not a second charge.
      if (arr.length() > 0) {
        val last = arr.getJSONObject(arr.length() - 1)
        if (last.optString("body") == body && last.optString("address") == address) return
      }
      arr.put(
        JSONObject()
          .put("address", address)
          .put("body", body)
          .put("date", ts)
      )
      val trimmed = if (arr.length() > MAX) {
        JSONArray().also { out ->
          for (i in arr.length() - MAX until arr.length()) out.put(arr.get(i))
        }
      } else arr
      prefs.edit().putString(KEY, trimmed.toString()).apply()

      // Capture first, announce second. The buffer is what the ledger is
      // built from and it must never be at the mercy of the banner; if
      // InstantAlert throws, the message is already safely stored.
      InstantAlert.post(context, address, body)
    } catch (_: Exception) {
      // Never crash on a delivery broadcast. A dropped alert is recovered by
      // the next inbox scan; a crash loop on every incoming SMS is not.
    }
  }

  companion object {
    const val PREFS = "wafra_sms_capture"
    const val KEY = "received"
    const val MAX = 500
    // Must stay in step with the same-named pattern in
    // BankNotificationListenerService: both decide, before anything else can,
    // whether a message is about money at all. This one was left behind when
    // Arabic was added, so an Arabic bank SMS was dropped at delivery — the
    // parser had learned to read it and never got the chance.
    val MONEY_RE = Regex(
      "(?:AED|Dhs?|SAR|SR|QAR|KWD|BHD|OMR|EGP|INR|PKR|USD|EUR|GBP|د\\.إ|ر\\.س|درهم|ريال)\\s*[0-9]" +
        "|[0-9]\\s*(?:د\\.إ|ر\\.س|درهم|ريال)",
      RegexOption.IGNORE_CASE
    )
  }
}
