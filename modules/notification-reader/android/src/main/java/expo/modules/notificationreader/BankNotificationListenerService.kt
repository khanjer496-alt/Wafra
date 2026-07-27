package expo.modules.notificationreader

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject

/**
 * Captures bank-app transaction notifications (banks are shifting from SMS to
 * push alerts). Only notifications whose text mentions a dirham amount are
 * kept — everything else is ignored on the spot, so no personal chatter is
 * ever stored. Kept entries go to a small ring buffer in SharedPreferences
 * that the app drains during its normal import scan.
 */
class BankNotificationListenerService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    capture(sbn)
  }

  /**
   * Sweep whatever is already in the shade the moment access is granted.
   *
   * Without this, turning the permission on captured nothing that had already
   * arrived — a charge from an hour ago was unreachable even though its
   * notification was still sitting there, and there is no other record of it
   * because the bank never sent an SMS. A user granted access specifically to
   * recover a transaction and got nothing back.
   *
   * Only what is still posted can be read; anything swiped away is gone for
   * good. This also runs after every reboot and whenever Android restarts the
   * service, which is exactly when re-reading is free — the dedupe on drain
   * already handles seeing the same notification twice.
   */
  override fun onListenerConnected() {
    try {
      activeNotifications?.forEach { capture(it) }
    } catch (_: Exception) {
      // A listener that dies on connect never captures anything again.
    }
  }

  private fun capture(sbn: StatusBarNotification) {
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
      // Skip exact repeats. Checked across the whole buffer rather than only
      // against the last entry, because the connect-time sweep re-reads
      // notifications this service already saw when they were posted.
      for (i in 0 until arr.length()) {
        val e = arr.optJSONObject(i) ?: continue
        if (e.optString("text") == text &&
          e.optString("pkg") == sbn.packageName &&
          e.optLong("ts") == sbn.postTime
        ) {
          return
        }
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
