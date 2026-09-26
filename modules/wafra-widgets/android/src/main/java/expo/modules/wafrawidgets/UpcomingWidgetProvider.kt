package expo.modules.wafrawidgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent

/** "Coming up" widget (4x2). Rendering lives in [WafraWidgets]. */
class UpcomingWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    WafraWidgets.refreshAll(context)
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (WafraWidgets.isRefreshAction(intent.action)) {
      WafraWidgets.refreshAll(context)
    } else {
      super.onReceive(context, intent)
    }
  }
}
