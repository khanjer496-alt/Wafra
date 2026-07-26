package expo.modules.smsreader

import android.content.Context
import android.provider.Telephony
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray

/**
 * Reads SMS from the device inbox. The app must hold the READ_SMS runtime
 * permission before calling getInboxSms; the query returns an empty list
 * if the permission is missing rather than crashing.
 *
 * Paged: pass untilMs from a previous page's oldest timestamp to walk the
 * full inbox history in batches without loading everything at once.
 */
class SmsReaderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SmsReader")

    AsyncFunction("getInboxSms") { sinceMs: Double, untilMs: Double, max: Int ->
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val messages = mutableListOf<Map<String, Any>>()
      try {
        val cursor = context.contentResolver.query(
          Telephony.Sms.Inbox.CONTENT_URI,
          arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
          "${Telephony.Sms.DATE} >= ? AND ${Telephony.Sms.DATE} < ?",
          arrayOf(sinceMs.toLong().toString(), untilMs.toLong().toString()),
          "${Telephony.Sms.DATE} DESC"
        )
        cursor?.use {
          val addressIdx = it.getColumnIndex(Telephony.Sms.ADDRESS)
          val bodyIdx = it.getColumnIndex(Telephony.Sms.BODY)
          val dateIdx = it.getColumnIndex(Telephony.Sms.DATE)
          while (it.moveToNext() && messages.size < max) {
            messages.add(
              mapOf(
                "address" to (it.getString(addressIdx) ?: ""),
                "body" to (it.getString(bodyIdx) ?: ""),
                "date" to it.getLong(dateIdx).toDouble()
              )
            )
          }
        }
      } catch (_: SecurityException) {
        // Permission not granted — return what we have (empty).
      }
      messages
    }

    /**
     * Alerts captured by SmsDeliveryReceiver at delivery time, oldest first.
     * Entries older than sinceMs are dropped rather than returned, so the
     * buffer does not grow across scans.
     */
    AsyncFunction("getReceived") { sinceMs: Double ->
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val messages = mutableListOf<Map<String, Any>>()
      try {
        val prefs = context.getSharedPreferences(
          SmsDeliveryReceiver.PREFS,
          Context.MODE_PRIVATE
        )
        val arr = JSONArray(prefs.getString(SmsDeliveryReceiver.KEY, "[]"))
        val keep = JSONArray()
        val since = sinceMs.toLong()
        for (i in 0 until arr.length()) {
          val entry = arr.optJSONObject(i) ?: continue
          val date = entry.optLong("date")
          if (date < since) continue
          keep.put(entry)
          messages.add(
            mapOf(
              "address" to entry.optString("address"),
              "body" to entry.optString("body"),
              "date" to date.toDouble()
            )
          )
        }
        if (keep.length() != arr.length()) {
          prefs.edit().putString(SmsDeliveryReceiver.KEY, keep.toString()).apply()
        }
      } catch (_: Exception) {
        // A malformed buffer must not break the scan; the inbox query still runs.
      }
      messages.sortedBy { it["date"] as Double }
    }
  }
}
