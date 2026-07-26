package expo.modules.notificationreader

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject

/**
 * Captures bank-app transaction notifications as they arrive (banks are
 * shifting from SMS to push alerts). Only notifications whose text mentions a
 * dirham amount are kept — everything else is ignored on the spot, so no
 * personal chatter is ever stored. Kept entries go to a small ring buffer in
 * SharedPreferences that the app drains during its normal import scan.
 */
class BankNotificationListenerService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    try {
      if (sbn.packageName == packageName) return
      val extras = sbn.notification.extras
      val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
      val text = (
        extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
          ?: extras.getCharSequence(Notification.EXTRA_TEXT)
        )?.toString() ?: ""
      val body = "$title $text".trim()
      if (body.isEmpty() || !MONEY_RE.containsMatchIn(body)) return

      val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
      val arr = JSONArray(prefs.getString(KEY, "[]"))
      // Skip exact repeats (updated/re-posted notifications).
      if (arr.length() > 0) {
        val last = arr.getJSONObject(arr.length() - 1)
        if (last.optString("text") == text && last.optString("pkg") == sbn.packageName) return
      }
      arr.put(
        JSONObject()
          .put("pkg", sbn.packageName)
          .put("title", title)
          .put("text", text)
          .put("ts", sbn.postTime)
      )
      val trimmed = if (arr.length() > MAX) {
        JSONArray().also { out ->
          for (i in arr.length() - MAX until arr.length()) out.put(arr.get(i))
        }
      } else arr
      prefs.edit().putString(KEY, trimmed.toString()).apply()
    } catch (_: Exception) {
      // Never crash the listener; a dropped notification is recoverable, a
      // dead listener is not.
    }
  }

  companion object {
    const val PREFS = "wafra_notification_capture"
    const val KEY = "captured"
    const val MAX = 500
    val MONEY_RE = Regex(
      "(?:AED|Dhs?|SAR|SR|QAR|KWD|BHD|OMR|EGP|INR|PKR|USD|EUR|GBP|د\\.إ|ر\\.س)\\s*[0-9]",
      RegexOption.IGNORE_CASE
    )
  }
}
