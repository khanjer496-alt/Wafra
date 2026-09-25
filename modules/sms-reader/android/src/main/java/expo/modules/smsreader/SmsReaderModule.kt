package expo.modules.smsreader

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.provider.Telephony
import android.os.Handler
import android.os.Looper
import com.facebook.react.common.LifecycleState
import com.facebook.react.bridge.ReactContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.exception.CodedException
import kotlin.math.max
import kotlin.math.min

private class SmsInboxAccessException(
  message: String,
  cause: Throwable? = null
) : CodedException("ERR_SMS_INBOX_ACCESS", message, cause)

private data class NativeInboxRow(
  val id: Long,
  val address: String,
  val body: String,
  val date: Long,
)

/**
 * Reads SMS from the device inbox. The app must hold the READ_SMS runtime
 * permission before calling getInboxSms. Missing/restricted access is an
 * error, not an empty inbox: JavaScript must never advance a scan watermark
 * or tell the user they are up to date when Android refused the query.
 *
 * Paged by (date, _id), because Android may assign the same millisecond to
 * several messages. A date-only cursor can skip a row at a page boundary.
 *
 * Every provider query carries LIMIT. A 30k-row inbox on a OnePlus 13 opened
 * an unbounded cursor for a 50- or 1,000-row page and stalled the JS thread
 * for seconds while the bridge converted the result.
 */
class SmsReaderModule : Module() {
  private var inboxObserver: ContentObserver? = null
  private var observedContext: Context? = null

  private fun stopInboxObservation() {
    inboxObserver?.let { observer ->
      try { observedContext?.contentResolver?.unregisterContentObserver(observer) } catch (_: Exception) { }
    }
    inboxObserver = null
    observedContext = null
  }

  private fun queryInboxSlice(
    context: Context,
    sinceMs: Long?,
    beforeDateMs: Long,
    beforeId: Long,
    limit: Int,
    missingCursor: () -> Nothing,
  ): List<NativeInboxRow> {
    val selection: String
    val args: Array<String>
    if (sinceMs == null) {
      selection = "(${Telephony.Sms.DATE} < ?) OR " +
        "(${Telephony.Sms.DATE} = ? AND ${Telephony.Sms._ID} < ?)"
      args = arrayOf(
        beforeDateMs.toString(),
        beforeDateMs.toString(),
        beforeId.toString(),
      )
    } else {
      selection = "${Telephony.Sms.DATE} >= ? AND (" +
        "${Telephony.Sms.DATE} < ? OR (" +
        "${Telephony.Sms.DATE} = ? AND ${Telephony.Sms._ID} < ?))"
      args = arrayOf(
        sinceMs.toString(),
        beforeDateMs.toString(),
        beforeDateMs.toString(),
        beforeId.toString(),
      )
    }
    val cursor = context.contentResolver.query(
      Telephony.Sms.Inbox.CONTENT_URI,
      arrayOf(
        Telephony.Sms._ID,
        Telephony.Sms.ADDRESS,
        Telephony.Sms.BODY,
        Telephony.Sms.DATE
      ),
      selection,
      args,
      "${Telephony.Sms.DATE} DESC, ${Telephony.Sms._ID} DESC LIMIT $limit"
    ) ?: missingCursor()
    val rows = mutableListOf<NativeInboxRow>()
    cursor.use {
      val idIdx = it.getColumnIndex(Telephony.Sms._ID)
      val addressIdx = it.getColumnIndex(Telephony.Sms.ADDRESS)
      val bodyIdx = it.getColumnIndex(Telephony.Sms.BODY)
      val dateIdx = it.getColumnIndex(Telephony.Sms.DATE)
      while (it.moveToNext()) {
        rows.add(
          NativeInboxRow(
            id = it.getLong(idIdx),
            address = it.getString(addressIdx) ?: "",
            body = it.getString(bodyIdx) ?: "",
            date = it.getLong(dateIdx),
          )
        )
      }
    }
    return rows
  }

  /**
   * Fill one JS page from LIMIT-bounded provider slices. OTP/security bodies
   * are dropped in-process; extra fetch rows keep that filter from looking like
   * the end of the inbox.
   */
  private fun collectInboxPage(
    context: Context,
    sinceMs: Long?,
    beforeDateMs: Long,
    beforeId: Long,
    pageSize: Int,
    rejectSensitive: Boolean,
    missingCursor: () -> Nothing,
  ): List<Map<String, Any>> {
    val messages = mutableListOf<Map<String, Any>>()
    var cursorDate = beforeDateMs
    var cursorId = beforeId
    while (messages.size < pageSize) {
      val remaining = pageSize - messages.size
      val fetch = min(2_000, remaining + 32)
      val rows = queryInboxSlice(context, sinceMs, cursorDate, cursorId, fetch, missingCursor)
      if (rows.isEmpty()) break
      for (row in rows) {
        cursorDate = row.date
        cursorId = row.id
        val body = row.body
        if (rejectSensitive && SensitiveMessageFilter.shouldReject(body)) continue
        messages.add(
          mapOf(
            "id" to row.id.toDouble(),
            "address" to row.address,
            "body" to body,
            "date" to row.date.toDouble()
          )
        )
        if (messages.size >= pageSize) break
      }
      if (rows.size < fetch) break
    }
    return messages
  }

  override fun definition() = ModuleDefinition {
    Name("SmsReader")
    Events("onInboxChanged")

    // Only a wake-up hint crosses this event. The ordinary permission-gated
    // inbox reader remains the single source of parsed/committed transactions.
    OnStartObserving {
      stopInboxObservation()
      val context = appContext.reactContext
      if (context != null && context.checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
          override fun onChange(selfChange: Boolean) {
            sendEvent("onInboxChanged", emptyMap<String, Any>())
          }
        }
        try {
          context.contentResolver.registerContentObserver(Telephony.Sms.CONTENT_URI, true, observer)
          observedContext = context
          inboxObserver = observer
        } catch (_: SecurityException) { stopInboxObservation() }
      }
    }
    OnStopObserving { stopInboxObservation() }
    OnDestroy { stopInboxObservation() }

    AsyncFunction("startHistoryImport") { id: String, promise: Promise ->
      Handler(Looper.getMainLooper()).post {
        val context = appContext.reactContext as? ReactContext
        if (context == null || context.lifecycleState != LifecycleState.RESUMED ||
          context.checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
          promise.resolve(false)
        } else {
          SmsHistoryImportService.start(context, id) { promise.resolve(it) }
        }
      }
    }
    Function("isHistoryImportRunning") { id: String -> SmsHistoryImportService.isRunning(id) }
    AsyncFunction("stopHistoryImport") { id: String, promise: Promise ->
      Handler(Looper.getMainLooper()).post {
        appContext.reactContext?.let { SmsHistoryImportService.stop(it, id) }
        promise.resolve()
      }
    }

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

    AsyncFunction("getInboxSms") {
        sinceMs: Double,
        beforeDateMs: Double,
        beforeId: Double,
        max: Int ->
      val context = appContext.reactContext
        ?: throw SmsInboxAccessException("SMS reader context is unavailable")
      if (context.checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
        throw SmsInboxAccessException("SMS inbox permission is unavailable")
      }
      // Routine scans request 1,000. The resumable first-history importer may
      // request up to 2,000 so it can halve full-ledger durability checkpoints
      // while still retaining a durable cursor after every bounded page.
      val pageSize = max.coerceIn(1, 2_000)
      try {
        collectInboxPage(
          context,
          sinceMs.toLong(),
          beforeDateMs.toLong(),
          beforeId.toLong(),
          pageSize,
          true,
        ) { throw SmsInboxAccessException("SMS inbox query returned no cursor") }
      } catch (error: SecurityException) {
        // Some Android/OEM restricted-access layers can deny the provider
        // even after the runtime permission reports granted. Preserve that
        // distinction so the UI can send the user back to App settings.
        throw SmsInboxAccessException("SMS inbox access is restricted", error)
      }
    }

    /**
     * How many inbox rows are dated at or after max(sinceMs, atOrAfterMs), so
     * a watched full read can show a real percentage instead of a guess.
     *
     * Read-only and body-free: the projection is the row id alone, nothing is
     * written, and only the number leaves native code. Answers -1 without the
     * runtime permission or when the provider (or an OEM restriction layer)
     * refuses; the UI then keeps its indeterminate indicator.
     */
    AsyncFunction("getInboxCount") { sinceMs: Double, atOrAfterMs: Double ->
      val context = appContext.reactContext ?: return@AsyncFunction -1
      if (context.checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
        return@AsyncFunction -1
      }
      val floor = max(sinceMs.toLong(), atOrAfterMs.toLong())
      try {
        context.contentResolver.query(
          Telephony.Sms.Inbox.CONTENT_URI,
          arrayOf(Telephony.Sms._ID),
          "${Telephony.Sms.DATE} >= ?",
          arrayOf(floor.toString()),
          null
        )?.use { it.count } ?: -1
      } catch (_: Exception) {
        -1
      }
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
      val pageSize = max.coerceIn(1, 1_000)
      try {
        collectInboxPage(
          context,
          null,
          beforeDateMs.toLong(),
          beforeId.toLong(),
          pageSize,
          false,
        ) { throw IllegalStateException("SMS inbox query returned no cursor") }
      } catch (error: SecurityException) {
        // An empty page means "the export is complete" to JavaScript. If
        // permission disappears during pagination, propagate the failure so
        // the app never shares a partial file while claiming it contains all
        // received messages.
        throw IllegalStateException("SMS permission became unavailable", error)
      }
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
