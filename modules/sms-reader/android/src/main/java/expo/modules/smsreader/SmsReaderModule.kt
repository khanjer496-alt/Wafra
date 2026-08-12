package expo.modules.smsreader

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Telephony
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.exception.CodedException

private class SmsInboxAccessException(
  message: String,
  cause: Throwable? = null
) : CodedException("ERR_SMS_INBOX_ACCESS", message, cause)

/**
 * Reads SMS from the device inbox. The app must hold the READ_SMS runtime
 * permission before calling getInboxSms. Missing/restricted access is an
 * error, not an empty inbox: JavaScript must never advance a scan watermark
 * or tell the user they are up to date when Android refused the query.
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
      if (!clearStaleCorpusFiles(context)) {
        throw IllegalStateException("A stale SMS corpus file could not be erased")
      }
    }

    AsyncFunction("getInboxSms") { sinceMs: Double, untilMs: Double, max: Int ->
      val context = appContext.reactContext
        ?: throw SmsInboxAccessException("SMS reader context is unavailable")
      if (context.checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
        throw SmsInboxAccessException("SMS inbox permission is unavailable")
      }
      val messages = mutableListOf<Map<String, Any>>()
      try {
        val cursor = context.contentResolver.query(
          Telephony.Sms.Inbox.CONTENT_URI,
          arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
          "${Telephony.Sms.DATE} >= ? AND ${Telephony.Sms.DATE} < ?",
          arrayOf(sinceMs.toLong().toString(), untilMs.toLong().toString()),
          "${Telephony.Sms.DATE} DESC"
        ) ?: throw SmsInboxAccessException("SMS inbox query returned no cursor")
        cursor.use {
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
      } catch (error: SecurityException) {
        // Some Android/OEM restricted-access layers can deny the provider
        // even after the runtime permission reports granted. Preserve that
        // distinction so the UI can send the user back to App settings.
        throw SmsInboxAccessException("SMS inbox access is restricted", error)
      }
      messages
    }

    /**
     * Temporary, internal-build-only raw inbox reader used to build a parser
     * corpus from the owner's own phone. Unlike getInboxSms this deliberately
     * does not apply SensitiveMessageFilter: the explicit export must preserve
     * the exact source text that the parser saw.
     *
     * Pagination is (date, _id), not date alone. Android can assign the same
     * millisecond to multiple messages; a timestamp-only cursor can silently
     * skip rows at a page boundary and cannot honestly call the result "all".
     */
    Function("isCorpusExportEnabled") {
      BuildConfig.WAFRA_SMS_CORPUS_EXPORT
    }

    AsyncFunction("getInboxCorpusPage") {
        beforeDateMs: Double,
        beforeId: Double,
        max: Int ->
      if (!BuildConfig.WAFRA_SMS_CORPUS_EXPORT) {
        throw IllegalStateException("SMS corpus export is disabled in this build")
      }
      val context = appContext.reactContext
        ?: throw IllegalStateException("SMS reader context is unavailable")
      val messages = mutableListOf<Map<String, Any>>()
      val pageSize = max.coerceIn(1, 1_000)
      try {
        val cursor = context.contentResolver.query(
          Telephony.Sms.Inbox.CONTENT_URI,
          arrayOf(
            Telephony.Sms._ID,
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE
          ),
          "(${Telephony.Sms.DATE} < ?) OR " +
            "(${Telephony.Sms.DATE} = ? AND ${Telephony.Sms._ID} < ?)",
          arrayOf(
            beforeDateMs.toLong().toString(),
            beforeDateMs.toLong().toString(),
            beforeId.toLong().toString()
          ),
          "${Telephony.Sms.DATE} DESC, ${Telephony.Sms._ID} DESC"
        ) ?: throw IllegalStateException("SMS inbox query returned no cursor")
        cursor.use {
          val idIdx = it.getColumnIndex(Telephony.Sms._ID)
          val addressIdx = it.getColumnIndex(Telephony.Sms.ADDRESS)
          val bodyIdx = it.getColumnIndex(Telephony.Sms.BODY)
          val dateIdx = it.getColumnIndex(Telephony.Sms.DATE)
          while (it.moveToNext() && messages.size < pageSize) {
            messages.add(
              mapOf(
                "id" to it.getLong(idIdx).toDouble(),
                "address" to (it.getString(addressIdx) ?: ""),
                "body" to (it.getString(bodyIdx) ?: ""),
                "date" to it.getLong(dateIdx).toDouble()
              )
            )
          }
        }
      } catch (error: SecurityException) {
        // An empty page means "the export is complete" to JavaScript. If
        // permission disappears during pagination, propagate the failure so
        // the app never shares a partial file while claiming it contains all
        // received messages.
        throw IllegalStateException("SMS permission became unavailable", error)
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

  /**
   * The share target needs the cache file after shareAsync starts, so it is
   * not deleted immediately. Instead every later process/module start removes
   * any previous export, including when an ordinary production update replaces
   * this temporary build.
   */
  private fun clearStaleCorpusFiles(context: Context): Boolean =
    context.cacheDir.listFiles()
      ?.filter { it.isFile && it.name.startsWith("wafra-sms-corpus-") }
      ?.all { it.delete() } ?: true
}
