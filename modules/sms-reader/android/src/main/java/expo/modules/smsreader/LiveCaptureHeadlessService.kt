package expo.modules.smsreader

import android.content.Context
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Short, event-driven execution lease for one live bank-alert capture.
 *
 * There is deliberately no timer, periodic job, WorkManager loop or foreground
 * service here. Android starts this only after SMS_RECEIVED or an admitted
 * bank-app NotificationListener event. JavaScript then processes a bounded
 * queue/window, durably saves it, and exits.
 */
class LiveCaptureHeadlessService : HeadlessJsTaskService() {
  override fun onCreate() {
    super.onCreate()
    // Keep the CPU awake only for this short service lifetime. The JS task has
    // its own strict timeout and the source remains recoverable if startup fails.
    acquireWakeLockNow(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val source = intent?.getStringExtra(SOURCE)
    if (source != SOURCE_SMS && source != SOURCE_PUSH) {
      stopSelfResult(startId)
      return START_NOT_STICKY
    }
    return try {
      super.onStartCommand(intent, flags, startId)
      START_NOT_STICKY
    } catch (_: Exception) {
      // SMS remains in the inbox and push remains in the encrypted queue. A
      // foreground open therefore recovers from any OEM background restriction.
      stopSelfResult(startId)
      START_NOT_STICKY
    }
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val source = intent?.getStringExtra(SOURCE) ?: return null
    if (source != SOURCE_SMS && source != SOURCE_PUSH) return null
    val observedAt = intent.getLongExtra(OBSERVED_AT, 0L)
    return HeadlessJsTaskConfig(
      TASK,
      Arguments.createMap().apply {
        putString("source", source)
        putDouble("observedAt", observedAt.toDouble())
      },
      MAX_RUN_MS,
      true,
    )
  }

  companion object {
    const val TASK = "WafraLiveCapture"
    const val SOURCE_SMS = "sms"
    const val SOURCE_PUSH = "push"
    private const val SOURCE = "source"
    private const val OBSERVED_AT = "observedAt"
    private const val MAX_RUN_MS = 20_000L

    fun schedule(context: Context, source: String, observedAt: Long) {
      if (source != SOURCE_SMS && source != SOURCE_PUSH) return
      try {
        context.startService(
          Intent(context, LiveCaptureHeadlessService::class.java)
            .putExtra(SOURCE, source)
            .putExtra(OBSERVED_AT, observedAt),
        )
      } catch (_: Exception) {
        // Background-start restrictions are recoverable from the durable source.
      }
    }
  }
}
