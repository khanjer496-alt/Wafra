package expo.modules.wafrawidgets

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
  }
}
