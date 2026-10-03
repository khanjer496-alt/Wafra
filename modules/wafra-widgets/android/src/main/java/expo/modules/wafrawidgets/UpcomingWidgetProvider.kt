package expo.modules.wafrawidgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle

/** "Coming up" widget (4x2). Rendering lives in [WafraWidgets]. */
class UpcomingWidgetProvider : AppWidgetProvider() {
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
