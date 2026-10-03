package expo.modules.wafrawidgets

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS bridge for the home-screen widgets. The app hands over the summary built
 * by src/lib/widget-snapshot.ts; widgets read nothing else. Failures are
 * swallowed: widgets are presentation and must never affect the app.
 */
class WafraWidgetsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WafraWidgets")

    Function("setSnapshot") { json: String ->
      val context = appContext.reactContext ?: return@Function false
      try {
        WafraWidgets.store(context, json)
        true
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
