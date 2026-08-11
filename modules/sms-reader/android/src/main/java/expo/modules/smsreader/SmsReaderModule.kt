package expo.modules.smsreader

import android.content.Context
import android.provider.Telephony
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

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

    // Older releases buffered full delivery bodies in ordinary preferences.
    // The receiver no longer writes them; purge that archive on every module
    // load even when SMS permission is off and the user never starts a scan.
    OnCreate {
      val context = appContext.reactContext
        ?: throw IllegalStateException("SMS reader context is unavailable")
      if (!clearLegacyDeliveryBuffer(context)) {
        throw IllegalStateException("Legacy SMS delivery buffer could not be erased")
      }
    }

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
            val body = it.getString(bodyIdx) ?: ""
            if (SensitiveMessageFilter.shouldReject(body)) continue
            messages.add(
              mapOf(
                "address" to (it.getString(addressIdx) ?: ""),
                "body" to body,
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

    /** Compatibility seam for builds that carried the old delivery buffer. */
    AsyncFunction("getReceived") { _: Double ->
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any>>()
      if (!clearLegacyDeliveryBuffer(context)) {
        throw IllegalStateException("Legacy SMS delivery buffer could not be erased")
      }
      emptyList<Map<String, Any>>()
    }

    /** Used by every erase surface; safe and idempotent. */
    AsyncFunction("clearCaptured") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      clearLegacyDeliveryBuffer(context) && InstantAlert.clear(context)
    }

    /**
     * Turn the delivery-time banner on or off.
     *
     * It has to live in SharedPreferences rather than in the app's own state,
     * because the receiver that reads it runs with no JavaScript engine and
     * cannot see AsyncStorage. JS owns the setting; this is how it reaches
     * the only code that can act on it.
     */
    Function("setInstantAlerts") { enabled: Boolean ->
      val context = appContext.reactContext ?: return@Function false
      InstantAlert.setEnabled(context, enabled)
      true
    }

    Function("getInstantAlerts") {
      val context = appContext.reactContext ?: return@Function false
      InstantAlert.isEnabled(context)
    }
  }

  private fun clearLegacyDeliveryBuffer(context: Context): Boolean =
    context.getSharedPreferences(SmsDeliveryReceiver.PREFS, Context.MODE_PRIVATE)
      .edit().clear().commit()
}
