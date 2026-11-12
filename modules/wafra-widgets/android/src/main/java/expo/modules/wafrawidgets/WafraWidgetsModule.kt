package expo.modules.wafrawidgets

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.os.Build
import android.content.Context
import android.view.WindowManager
import org.json.JSONObject
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS bridge for the home-screen widgets. The app hands over the summary built
 * by src/lib/widget-snapshot.ts; widgets read nothing else. Failures are
 * swallowed: widgets are presentation and must never affect the app.
 */
class WafraWidgetsModule : Module() {
  private fun privacyPrefs() = appContext.reactContext?.getSharedPreferences("wafra_app_privacy", Context.MODE_PRIVATE)

  private fun applySecureWindow() {
    val activity = appContext.currentActivity ?: return
    val enabled = privacyPrefs()?.getBoolean("enabled", false) == true
    activity.runOnUiThread {
      if (enabled) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
  }

  private fun acceptsSnapshot(json: String): Boolean {
    val prefs = privacyPrefs() ?: return false
    return !prefs.getBoolean("enabled", false) || !prefs.getBoolean("hideAmounts", true) ||
      JSONObject(json).optBoolean("hidden", false)
  }

  override fun definition() = ModuleDefinition {
    Name("WafraWidgets")

    OnCreate { applySecureWindow() }
    OnActivityEntersForeground { applySecureWindow() }

    AsyncFunction("setAppPrivacy") { enabled: Boolean, hideAmounts: Boolean ->
      privacyPrefs()?.edit()?.putBoolean("enabled", enabled)?.putBoolean("hideAmounts", hideAmounts)?.apply()
      applySecureWindow()
      if (enabled && hideAmounts) {
        val context = appContext.reactContext
        if (context != null) WafraWidgets.purgeUnredactedSnapshot(context)
      }
    }.runOnQueue(Queues.MAIN)

    Function("setSnapshot") { json: String ->
      val context = appContext.reactContext ?: return@Function false
      try {
        val accepted = acceptsSnapshot(json)
        WafraWidgets.store(context, if (accepted) json else null)
        accepted
      } catch (error: Exception) {
        false
      }
    }

    Function("clearSnapshot") {
      val context = appContext.reactContext ?: return@Function false
      try {
        WafraWidgets.store(context, null)
        true
      } catch (error: Exception) {
        false
      }
    }

    // Whether the launcher can show its own "add widget" dialog (API 26+).
    Function("canPinWidgets") {
      val context = appContext.reactContext ?: return@Function false
      try {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
          AppWidgetManager.getInstance(context)?.isRequestPinAppWidgetSupported == true
      } catch (error: Exception) {
        false
      }
    }

    // Asks the launcher to pin one widget. True only means the launcher took
    // the request; the person still chooses whether and where to place it.
    AsyncFunction("pinWidget") { kind: String ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      val provider = when (kind) {
        "today" -> TodayWidgetProvider::class.java
        "upcoming" -> UpcomingWidgetProvider::class.java
        "spending" -> SpendingWidgetProvider::class.java
        else -> return@AsyncFunction false
      }
      try {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@AsyncFunction false
        val manager = AppWidgetManager.getInstance(context) ?: return@AsyncFunction false
        if (!manager.isRequestPinAppWidgetSupported) return@AsyncFunction false
        manager.requestPinAppWidget(ComponentName(context, provider), null, null)
      } catch (error: Exception) {
        false
      }
    }
  }
}
