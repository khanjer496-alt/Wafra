package expo.modules.notificationreader

import android.content.Context
import android.content.Intent
import android.content.ComponentName
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

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

    // Upgrade cleanup cannot depend on Notification access still being
    // enabled or on the user starting a scan. Loading the app/module removes
    // the former plaintext preference before any JS interaction.
    OnCreate {
      val context = appContext.reactContext
        ?: throw IllegalStateException("Notification reader context is unavailable")
      NotificationCaptureStore.purgeLegacyPlaintext(context)
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

    /** The OS grant, even while Wafra's saved tracking choice is off. */
    Function("hasSystemAccess") {
      val context = appContext.reactContext ?: return@Function false
      hasSystemAccess(context)
    }

    /** The app's hydrated tracking/entitlement choice, separate from OS access. */
    AsyncFunction("setCaptureEnabled") { enabled: Boolean, expiresAtMs: Double ->
      if (!TrustedBankNotificationPackages.CAPTURE_ENABLED) return@AsyncFunction false
      val context = appContext.reactContext ?: return@AsyncFunction false
      val expiresAt = if (expiresAtMs.isFinite() && expiresAtMs > 0.0) expiresAtMs.toLong() else 0L
      val changed = NotificationCapturePolicy.setEnabled(context, enabled, expiresAt)
      if (enabled && changed) BankNotificationListenerService.sweepConnected()
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

    /** Captured money-related notifications with ts >= sinceMs, oldest first. */
    AsyncFunction("getCaptured") { sinceMs: Double ->
      if (!TrustedBankNotificationPackages.CAPTURE_ENABLED) return@AsyncFunction emptyList<Map<String, Any>>()
      val context = appContext.reactContext
        ?: return@AsyncFunction emptyList<Map<String, Any>>()
      if (!NotificationCapturePolicy.isEnabled(context) || !hasSystemAccess(context)) {
        return@AsyncFunction emptyList<Map<String, Any>>()
      }
      // Re-sweep notifications that are still visible in the shade on every
      // drain. This recovers an alert if Android delivered it while the JS
      // bridge was starting, after an OEM restarted the listener, or before a
      // corrected admission rule reached the current build. append() is
      // idempotent for the same package/text/postTime tuple.
      BankNotificationListenerService.sweepOrRequestRebind(context)
      NotificationCaptureStore.read(context, sinceMs.toLong()).mapNotNull { row ->
        val sourceClass = TrustedBankNotificationPackages.sourceClass(
          context,
          row.pkg,
          "${row.title} ${row.text}".trim(),
        ) ?: return@mapNotNull null
        mapOf(
          "id" to row.id,
          "pkg" to row.pkg,
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
}
