package expo.modules.notificationreader

import android.content.Context
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray

class NotificationReaderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NotificationReader")

    /** Whether the user has granted notification access to this app. */
    Function("isEnabled") {
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
      val prefs = context.getSharedPreferences(
        BankNotificationListenerService.PREFS,
        Context.MODE_PRIVATE
      )
      val arr = JSONArray(prefs.getString(BankNotificationListenerService.KEY, "[]"))
      val out = mutableListOf<Map<String, Any>>()
      for (i in 0 until arr.length()) {
        val o = arr.getJSONObject(i)
        val ts = o.optLong("ts")
        if (ts >= sinceMs.toLong()) {
          out.add(
            mapOf(
              "pkg" to o.optString("pkg"),
              "title" to o.optString("title"),
              "text" to o.optString("text"),
              "ts" to ts.toDouble()
            )
          )
        }
      }
      out
    }
  }
}
