package expo.modules.notificationreader

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.ComponentName
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicInteger

class NotificationReaderModule : Module() {
  private fun hasSystemAccess(context: Context): Boolean {
    val enabled = Settings.Secure.getString(
      context.contentResolver,
      "enabled_notification_listeners"
    ) ?: ""
    return enabled.split(':').any { value ->
      ComponentName.unflattenFromString(value)?.let { component ->
        component.packageName == context.packageName &&
          component.className == BankNotificationListenerService::class.java.name
      } == true
    }
  }

  override fun definition() = ModuleDefinition {
    Name("NotificationReader")
    Events("onQueueChanged")

    // Upgrade cleanup cannot depend on Notification access still being
    // enabled or on the user starting a scan. Loading the app/module removes
    // the former plaintext preference before any JS interaction.
    OnCreate {
      val context = appContext.reactContext
        ?: throw IllegalStateException("Notification reader context is unavailable")
      NotificationCaptureStore.purgeLegacyPlaintext(context)
      activeModule = this@NotificationReaderModule
    }

    OnDestroy {
      if (activeModule === this@NotificationReaderModule) activeModule = null
    }

    /** Whether this Android build includes bank-notification capture. */
    Function("isAvailable") {
      TrustedBankNotificationPackages.CAPTURE_ENABLED
    }

    /** Whether the user has granted notification access to this app. */
    Function("isEnabled") {
      if (!TrustedBankNotificationPackages.CAPTURE_ENABLED) return@Function false
      val context = appContext.reactContext ?: return@Function false
      if (!NotificationCapturePolicy.isEnabled(context)) return@Function false
      hasSystemAccess(context)
    }

    /** Source-free entitlement/admission lease for SMS headless capture too. */
    Function("isAdmissionActive") {
      if (!TrustedBankNotificationPackages.CAPTURE_ENABLED) return@Function false
      val context = appContext.reactContext ?: return@Function false
      NotificationCapturePolicy.isLeaseActive(context)
    }

    /** The OS grant, even while Wafra's saved tracking choice is off. */
    Function("hasSystemAccess") {
      val context = appContext.reactContext ?: return@Function false
      hasSystemAccess(context)
    }

    /** The app's hydrated tracking/entitlement choice, separate from OS access. */
    AsyncFunction("setCaptureEnabled") { enabled: Boolean, expiresAtMs: Double ->
      if (!TrustedBankNotificationPackages.CAPTURE_ENABLED) return@AsyncFunction false
      val context = appContext.reactContext ?: return@AsyncFunction false
      val wasEnabled = NotificationCapturePolicy.isEnabled(context)
      val expiresAt = if (expiresAtMs.isFinite() && expiresAtMs > 0.0) expiresAtMs.toLong() else 0L
      NotificationCapturePolicy.setEnabled(context, enabled, expiresAt)
      val nowEnabled = NotificationCapturePolicy.isEnabled(context)
      // Refreshing the bounded entitlement lease changes expiresAt on every
      // foreground. That is not a new capture grant and must not rescan the
      // entire Android notification shade. Sweep only on a real off -> on
      // transition; explicit recovery has its own operation below.
      if (!wasEnabled && nowEnabled) BankNotificationListenerService.sweepConnected()
      true
    }

    /**
     * Current builds separate the shared entitlement lease from the push-source
     * choice. This lets SMS-only remain authorized while the NotificationListener
     * itself is fully disabled and its encrypted queue is cleared.
     */
    AsyncFunction("setSourceConfiguration") { notificationEnabled: Boolean, expiresAtMs: Double ->
      if (!TrustedBankNotificationPackages.CAPTURE_ENABLED) return@AsyncFunction false
      val context = appContext.reactContext ?: return@AsyncFunction false
      val wasEnabled = NotificationCapturePolicy.isEnabled(context)
      val expiresAt = if (expiresAtMs.isFinite() && expiresAtMs > 0.0) expiresAtMs.toLong() else 0L
      NotificationCapturePolicy.setConfiguration(context, notificationEnabled, expiresAt)
      val nowEnabled = NotificationCapturePolicy.isEnabled(context)
      if (!wasEnabled && nowEnabled) BankNotificationListenerService.sweepConnected()
      true
    }

    /**
     * Cheap foreground self-heal. Do nothing while Android's listener is
     * already connected; if an OEM killed it despite the permission still
     * being granted, request a rebind. onListenerConnected() owns the recovery
     * sweep, so normal app resumes never walk the notification shade.
     */
    AsyncFunction("ensureListenerConnected") {
      if (!TrustedBankNotificationPackages.CAPTURE_ENABLED) return@AsyncFunction false
      val context = appContext.reactContext ?: return@AsyncFunction false
      if (!NotificationCapturePolicy.isEnabled(context) || !hasSystemAccess(context)) {
        return@AsyncFunction false
      }
      if (!BankNotificationListenerService.isConnected()) {
        BankNotificationListenerService.sweepOrRequestRebind(context)
      }
      true
    }

    /** Opens the system Notification access screen for the user to enable it. */
    Function("openSettings") {
      if (!TrustedBankNotificationPackages.CAPTURE_ENABLED) return@Function false
      val context = appContext.reactContext ?: return@Function false
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }

    /** Source-free diagnostics for OEM/listener troubleshooting. */
    AsyncFunction("getDiagnostics") {
      val context = appContext.reactContext ?: return@AsyncFunction mapOf(
        "available" to false,
        "systemAccess" to false,
        "admissionActive" to false,
        "listenerConnected" to false,
        "activeNotificationCount" to 0,
        "trustedBankVisibleCount" to 0,
        "adcbVisible" to false,
        "adcbActiveCount" to 0,
        "queuedCandidateCount" to 0,
        "queuedVisibleMatchCount" to 0,
        "admissionCounts" to emptyMap<String, Int>(),
        "adcbAdmissionCounts" to emptyMap<String, Int>(),
      )
      val available = TrustedBankNotificationPackages.CAPTURE_ENABLED
      val systemAccess = available && hasSystemAccess(context)
      val admissionActive = available && NotificationCapturePolicy.isEnabled(context)
      BankNotificationListenerService.resetAdmissionDiagnostics()
      val visibility = BankNotificationListenerService.visibilityDiagnostics(context)
      val admission = BankNotificationListenerService.admissionDiagnostics()
      val queued = if (admissionActive) {
        try { NotificationCaptureStore.read(context, 0L).size } catch (_: Exception) { -1 }
      } else 0
      val queuedVisibleMatches = if (admissionActive && systemAccess) {
        BankNotificationListenerService.queuedVisibleMatchCount()
      } else 0
      mapOf(
        "available" to available,
        "systemAccess" to systemAccess,
        "admissionActive" to admissionActive,
        "listenerConnected" to (visibility["listenerConnected"] ?: false),
        "activeNotificationCount" to (visibility["activeNotificationCount"] ?: 0),
        "trustedBankVisibleCount" to (visibility["trustedBankVisibleCount"] ?: 0),
        "adcbVisible" to (visibility["adcbVisible"] ?: false),
        "adcbActiveCount" to (visibility["adcbActiveCount"] ?: 0),
        "queuedCandidateCount" to queued,
        "queuedVisibleMatchCount" to queuedVisibleMatches,
        "admissionCounts" to (admission["admissionCounts"] ?: emptyMap<String, Int>()),
        "adcbAdmissionCounts" to (admission["adcbAdmissionCounts"] ?: emptyMap<String, Int>()),
      )
    }

    /**
     * Explicit, potentially expensive recovery pass over notifications that
     * are still visible in the Android shade. Normal queue drains never call
     * this: the listener captures new rows incrementally as they arrive.
     */
    AsyncFunction("sweepVisible") {
      if (!TrustedBankNotificationPackages.CAPTURE_ENABLED) return@AsyncFunction false
      val context = appContext.reactContext ?: return@AsyncFunction false
      if (!NotificationCapturePolicy.isEnabled(context) || !hasSystemAccess(context)) {
        return@AsyncFunction false
      }
      val sweptImmediately = BankNotificationListenerService.sweepOrRequestRebind(context)
      if (!sweptImmediately) {
        for (attempt in 0 until 10) {
          if (BankNotificationListenerService.isConnected()) {
            BankNotificationListenerService.sweepConnected()
            return@AsyncFunction true
          }
          Thread.sleep(50)
        }
        return@AsyncFunction false
      }
      true
    }

    /**
     * Post Wafra's own confirmation after JS has durably imported a bank-app
     * notification. The arguments are Wafra-generated copy only; raw bank text
     * never crosses into this display API.
     */
    Function("postImportNotice") { title: String, body: String ->
      val context = appContext.reactContext ?: return@Function false
      val cleanTitle = title.trim().take(MAX_NOTICE_TITLE_CHARS)
      val cleanBody = body.trim().take(MAX_NOTICE_BODY_CHARS)
      if (cleanTitle.isEmpty()) return@Function false
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        ?: return@Function false
      if (!manager.areNotificationsEnabled()) return@Function false

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
          manager.getNotificationChannel(IMPORT_NOTICE_CHANNEL_ID) == null) {
        manager.createNotificationChannel(
          NotificationChannel(
            IMPORT_NOTICE_CHANNEL_ID,
            context.getString(R.string.wafra_bank_import_channel),
            NotificationManager.IMPORTANCE_HIGH,
          ).apply {
            description = context.getString(R.string.wafra_bank_import_channel_description)
            enableVibration(true)
          },
        )
      }

      val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?.apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP }
      val pending = open?.let {
        PendingIntent.getActivity(
          context,
          0,
          it,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
      }
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(context, IMPORT_NOTICE_CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(context)
      }
      builder
        .setSmallIcon(context.applicationInfo.icon)
        .setContentTitle(cleanTitle)
        .setContentText(cleanBody)
        .setCategory(Notification.CATEGORY_STATUS)
        .setAutoCancel(true)
        .setOnlyAlertOnce(true)
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        @Suppress("DEPRECATION")
        builder.setPriority(Notification.PRIORITY_HIGH)
        builder.setDefaults(Notification.DEFAULT_SOUND or Notification.DEFAULT_VIBRATE)
      }
      if (pending != null) builder.setContentIntent(pending)
      manager.notify(IMPORT_NOTICE_TAG, noticeIds.incrementAndGet(), builder.build())
      true
    }

    /** Captured money-related notifications with ts >= sinceMs, oldest first. */
    AsyncFunction("getCaptured") { sinceMs: Double ->
      if (!TrustedBankNotificationPackages.CAPTURE_ENABLED) return@AsyncFunction emptyList<Map<String, Any>>()
      val context = appContext.reactContext
        ?: return@AsyncFunction emptyList<Map<String, Any>>()
      if (!NotificationCapturePolicy.isEnabled(context) || !hasSystemAccess(context)) {
        return@AsyncFunction emptyList<Map<String, Any>>()
      }
      // Ordinary drains read the encrypted queue exactly once. Re-extracting
      // currently visible notifications here used to decrypt the same queue
      // repeatedly (identity scan + one scan per visible match + final read),
      // which produced multi-second foreground stalls on some AndroidKeyStore
      // implementations even when JS ultimately had zero new rows to parse.
      // Listener connect and explicit sweepVisible() retain the recovery path
      // for visible notifications without putting it on every resume/read.
      NotificationCaptureStore.read(context, sinceMs.toLong()).mapNotNull { row ->
        val sourceClass = TrustedBankNotificationPackages.sourceClass(
          context,
          row.pkg,
          "${row.title} ${row.text}".trim(),
        ) ?: return@mapNotNull null
        mapOf(
          "id" to row.id,
          "pkg" to row.pkg,
          "appLabel" to TrustedBankNotificationPackages.applicationLabel(context, row.pkg),
          "title" to row.title,
          "text" to row.text,
          "ts" to row.ts.toDouble(),
          "sourceClass" to sourceClass,
        )
      }
    }

    /** Delete only rows whose JS-side import/review write is now durable. */
    AsyncFunction("ackCaptured") { ids: List<String> ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      NotificationCaptureStore.acknowledge(context, ids.toSet())
      true
    }

    /** Destructive erase path; failure is surfaced rather than claimed away. */
    AsyncFunction("clearCaptured") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      NotificationCaptureStore.clear(context)
      true
    }
  }

  companion object {
    @Volatile private var activeModule: NotificationReaderModule? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val noticeIds = AtomicInteger(7_000)
    private const val IMPORT_NOTICE_CHANNEL_ID = "wafra-live-bank-transactions-v2"
    private const val IMPORT_NOTICE_TAG = "wafra-bank-import"
    private const val MAX_NOTICE_TITLE_CHARS = 160
    private const val MAX_NOTICE_BODY_CHARS = 320

    /** Called by the listener only after the encrypted queue really changed. */
    internal fun notifyQueueChanged() {
      val module = activeModule ?: return
      mainHandler.post {
        if (activeModule !== module) return@post
        try {
          module.sendEvent("onQueueChanged", emptyMap<String, Any>())
        } catch (_: Exception) {
          // Foreground resume remains the durable catch-up path.
        }
      }
    }
  }
}
