package expo.modules.wafrawidgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle

/** "Today" widget (2x2). Rendering lives in [WafraWidgets]. */
class TodayWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    WafraWidgets.refreshAll(context)
  }

  /** Resized: re-render so the layout follows the new height. */
  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: Bundle?,
  ) {
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
