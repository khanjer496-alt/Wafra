package expo.modules.notificationreader

import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NotificationReaderModule : Module() {
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

    /** Hidden until package-specific notification templates pass rollout gates. */
    Function("isAvailable") {
      TrustedBankNotificationPackages.CAPTURE_ENABLED
    }

    /** Whether the user has granted notification access to this app. */
    Function("isEnabled") {
      if (!TrustedBankNotificationPackages.CAPTURE_ENABLED) return@Function false
      val context = appContext.reactContext ?: return@Function false
      val enabled = Settings.Secure.getString(
        context.contentResolver,
        "enabled_notification_listeners"
      ) ?: ""
      enabled.contains(context.packageName)
    }

    /** Opens the system Notification access screen for the user to enable it. */
    Function("openSettings") {
      val context = appContext.reactContext
      if (context != null) {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
      }
      true
    }

    /** Captured money-related notifications with ts >= sinceMs, oldest first. */
    AsyncFunction("getCaptured") { sinceMs: Double ->
      val context = appContext.reactContext
        ?: return@AsyncFunction emptyList<Map<String, Any>>()
      NotificationCaptureStore.read(context, sinceMs.toLong()).map { row ->
        mapOf(
          "id" to row.id,
          "pkg" to row.pkg,
          "title" to row.title,
          "text" to row.text,
          "ts" to row.ts.toDouble(),
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
