package expo.modules.smsreader

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * A bounded execution lease for the already-hydrated JS history coordinator.
 * No SMS, ledger, keys or cursor are stored here. Never starts after boot or
 * process death: the encrypted ledger owns the resumable checkpoint.
 */
class SmsHistoryImportService : HeadlessJsTaskService() {
  private var session: String? = null
  private val timeout = Runnable { session?.let { stop(this, it) } }

  override fun onCreate() {
    super.onCreate()
    // The base service releases its wake lock even when startup is refused.
    // Own it for this service lifetime, including stale notification actions.
    acquireWakeLockNow(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val id = intent?.getStringExtra(SESSION)
    if (intent?.action == STOP) {
      if (id != null && id == session) stop(this, id)
      else if (session == null) stopSelfResult(startId)
      return START_NOT_STICKY
    }
    if (id == null || id != requestedSession) {
      if (session == null) stopSelfResult(startId)
      return START_NOT_STICKY
    }
    // The JS runner coalesces callers; do not create another headless task.
    if (id == session && activeSession == id) return START_NOT_STICKY
    session = id
    try {
      val manager = getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        manager.createNotificationChannel(NotificationChannel(
          CHANNEL, getString(R.string.wafra_history_channel), NotificationManager.IMPORTANCE_LOW
        ))
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification(id), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(NOTIFICATION_ID, notification(id))
      }
      activeSession = id
      // Native backstop also applies if React cannot initialize its task timer.
      handler.postDelayed(timeout, MAX_RUN_MS)
      super.onStartCommand(intent, flags, startId)
      resolveStart(id, true)
    } catch (_: Exception) {
      // Restrictions are a foreground-only fallback, never a false success.
      resolveStart(id, false)
      stop(this, id)
    }
    // HeadlessJsTaskService defaults to REDELIVER; replaying this intent could
    // create a second ledger owner before hydration/consent. Deliberately not sticky.
    return START_NOT_STICKY
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val id = intent?.getStringExtra(SESSION) ?: return null
    return HeadlessJsTaskConfig(
      "WafraHistoryImport", Arguments.createMap().apply { putString("sessionId", id) },
      MAX_RUN_MS, true
    )
  }

  // Android 15's dataSync time limit must release the foreground service promptly.
  override fun onTimeout(startId: Int, fgsType: Int) {
    session?.let { stop(this, it) }
  }

  override fun onDestroy() {
    handler.removeCallbacks(timeout)
    val id = session
    if (id != null && requestedSession == id) {
      activeSession = null
      requestedSession = null
      resolveStart(id, false)
    }
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun notification(id: String): Notification {
    val openIntent = packageManager.getLaunchIntentForPackage(packageName)
    val open = openIntent?.let { PendingIntent.getActivity(
      this, 713, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    ) }
    val pause = PendingIntent.getService(this, 714,
      Intent(this, SmsHistoryImportService::class.java).setAction(STOP).putExtra(SESSION, id),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    @Suppress("DEPRECATION")
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL)
      else Notification.Builder(this)
    return builder
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle(getString(R.string.wafra_history_title))
      .setContentText(getString(R.string.wafra_history_body))
      .setContentIntent(open)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setVisibility(Notification.VISIBILITY_PRIVATE)
      .setCategory(Notification.CATEGORY_PROGRESS)
      .setProgress(0, 0, true)
      .addAction(Notification.Action.Builder(null, getString(R.string.wafra_history_pause), pause).build())
      .build()
  }

  companion object {
    private const val CHANNEL = "wafra_history_import"
    private const val NOTIFICATION_ID = 713
    private const val SESSION = "sessionId"
    private const val STOP = "expo.modules.smsreader.PAUSE_HISTORY"
    private const val MAX_RUN_MS = 20 * 60 * 1000L
    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var activeSession: String? = null
    private var requestedSession: String? = null
    private var pendingStart: Pair<String, (Boolean) -> Unit>? = null

    fun isRunning(id: String): Boolean = activeSession == id

    /** Must be called from the main thread after foreground/READ_SMS checks. */
    fun start(context: Context, id: String, complete: (Boolean) -> Unit) {
      if (!id.matches(Regex("[A-Za-z0-9_-]{1,80}")) || requestedSession != null) {
        complete(false)
        return
      }
      requestedSession = id
      pendingStart = id to complete
      try {
        val intent = Intent(context, SmsHistoryImportService::class.java).putExtra(SESSION, id)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
        else context.startService(intent)
      } catch (_: Exception) {
        requestedSession = null
        resolveStart(id, false)
        return
      }
      handler.postDelayed({
        if (pendingStart?.first == id) {
          resolveStart(id, false)
          stop(context, id)
        }
      }, 5_000L)
    }

    private fun resolveStart(id: String, success: Boolean) {
      val callback = pendingStart?.takeIf { it.first == id }?.second ?: return
      pendingStart = null
      callback(success)
    }

    fun stop(context: Context, id: String) {
      if (requestedSession != id && activeSession != id) return
      activeSession = null
      requestedSession = null
      resolveStart(id, false)
      context.stopService(Intent(context, SmsHistoryImportService::class.java))
    }
  }
}
