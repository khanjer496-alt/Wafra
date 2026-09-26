package expo.modules.wafrawidgets

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.content.res.Resources
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import java.text.DateFormatSymbols
import java.util.Calendar
import java.util.GregorianCalendar
import java.util.Locale

/**
 * Stores the snapshot and renders both widgets from it. Nothing here reads the
 * ledger, messages or any other app data: the snapshot JSON is the only input.
 */
internal object WafraWidgets {
  private const val TAG = "WafraWidgets"
  private const val PREFS = "wafra_widget_snapshot"
  private const val KEY = "json"
  const val ACTION_REFRESH = "expo.modules.wafrawidgets.action.REFRESH"

  private val REFRESH_ACTIONS = setOf(
    ACTION_REFRESH,
    Intent.ACTION_TIME_CHANGED,
    Intent.ACTION_TIMEZONE_CHANGED,
    Intent.ACTION_LOCALE_CHANGED,
  )

  private val BILL_ROWS = intArrayOf(R.id.wafra_bill_row_1, R.id.wafra_bill_row_2, R.id.wafra_bill_row_3)
  private val BILL_TITLES = intArrayOf(R.id.wafra_bill_title_1, R.id.wafra_bill_title_2, R.id.wafra_bill_title_3)
  private val BILL_DATES = intArrayOf(R.id.wafra_bill_date_1, R.id.wafra_bill_date_2, R.id.wafra_bill_date_3)
  private val BILL_AMOUNTS = intArrayOf(R.id.wafra_bill_amount_1, R.id.wafra_bill_amount_2, R.id.wafra_bill_amount_3)

  fun isRefreshAction(action: String?): Boolean = action != null && action in REFRESH_ACTIONS

  fun store(context: Context, json: String?) {
    val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (json == null) {
      prefs.edit().remove(KEY).apply()
    } else {
      prefs.edit().putString(KEY, json).apply()
    }
    refreshAll(context)
  }

  /** Re-renders every placed instance of both widgets. Never throws. */
  fun refreshAll(context: Context) {
    try {
      val app = context.applicationContext ?: context
      val manager = AppWidgetManager.getInstance(app) ?: return
      val todayIds = manager.getAppWidgetIds(ComponentName(app, TodayWidgetProvider::class.java)) ?: IntArray(0)
      val upcomingIds = manager.getAppWidgetIds(ComponentName(app, UpcomingWidgetProvider::class.java)) ?: IntArray(0)
      if (todayIds.isEmpty() && upcomingIds.isEmpty()) return

      val snapshot = WidgetSnapshot.parse(
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
      )
      val now = System.currentTimeMillis()
      val todayISO = isoDate(Calendar.getInstance())
      if (todayIds.isNotEmpty()) manager.updateAppWidget(todayIds, renderToday(app, snapshot, now, todayISO))
      if (upcomingIds.isNotEmpty()) manager.updateAppWidget(upcomingIds, renderUpcoming(app, snapshot, now, todayISO))
      scheduleNextRefresh(app, snapshot, now)
    } catch (error: Exception) {
      Log.w(TAG, "Widget refresh failed", error)
    }
  }

  private fun renderToday(context: Context, snapshot: WidgetSnapshot?, now: Long, todayISO: String): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.wafra_widget_today)
    attachLaunch(context, views)
    val res = resourcesFor(context, snapshot?.language)
    views.setTextViewText(R.id.wafra_today_label, res.getString(R.string.wafra_widget_today))

    // A snapshot from an earlier day would present yesterday's spending as today's.
    val usable = snapshot != null && snapshot.isFresh(now) && snapshot.todayISO == todayISO
    if (snapshot == null || !usable) {
      views.setViewVisibility(R.id.wafra_today_content, View.GONE)
      views.setViewVisibility(R.id.wafra_today_empty, View.VISIBLE)
      views.setTextViewText(R.id.wafra_today_empty, res.getString(R.string.wafra_widget_open_to_update))
      return views
    }
    views.setViewVisibility(R.id.wafra_today_empty, View.GONE)
    views.setViewVisibility(R.id.wafra_today_content, View.VISIBLE)

    val amount = snapshot.formatMinor(snapshot.todayMinor)
    views.setTextViewText(R.id.wafra_today_amount, amount)
    views.setContentDescription(
      R.id.wafra_today_amount,
      if (amount == WidgetSnapshot.DASH) res.getString(R.string.wafra_widget_amount_hidden) else amount,
    )
    views.setTextViewText(R.id.wafra_today_count, paymentsText(res, snapshot.todayCount))

    if (snapshot.last7Minor.size == 7) {
      views.setViewVisibility(R.id.wafra_today_bars, View.VISIBLE)
      views.setImageViewBitmap(R.id.wafra_today_bars, barsBitmap(context, snapshot.last7Minor, snapshot.hidden))
      views.setContentDescription(R.id.wafra_today_bars, res.getString(R.string.wafra_widget_last_7_days))
    } else {
      views.setViewVisibility(R.id.wafra_today_bars, View.INVISIBLE)
    }

    val left = snapshot.leftInBudgetsMinor
    if (left != null && !snapshot.hidden) {
      views.setViewVisibility(R.id.wafra_today_budget, View.VISIBLE)
      views.setTextViewText(
        R.id.wafra_today_budget,
        res.getString(R.string.wafra_widget_left_in_budgets, snapshot.formatMinor(left)),
      )
    } else {
      views.setViewVisibility(R.id.wafra_today_budget, View.GONE)
    }
    return views
  }

  private fun renderUpcoming(context: Context, snapshot: WidgetSnapshot?, now: Long, todayISO: String): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.wafra_widget_upcoming)
    attachLaunch(context, views)
    val res = resourcesFor(context, snapshot?.language)
    views.setTextViewText(R.id.wafra_upcoming_label, res.getString(R.string.wafra_widget_upcoming))

    // ISO dates compare correctly as strings; drop anything already past.
    val bills = if (snapshot != null && snapshot.isFresh(now)) {
      snapshot.bills.filter { it.dueISO >= todayISO }.take(BILL_ROWS.size)
    } else {
      null
    }
    for (i in BILL_ROWS.indices) views.setViewVisibility(BILL_ROWS[i], View.GONE)

    if (snapshot == null || bills == null || bills.isEmpty()) {
      views.setViewVisibility(R.id.wafra_upcoming_empty, View.VISIBLE)
      views.setTextViewText(
        R.id.wafra_upcoming_empty,
        res.getString(if (bills == null) R.string.wafra_widget_open_to_update else R.string.wafra_widget_no_bills),
      )
      return views
    }
    views.setViewVisibility(R.id.wafra_upcoming_empty, View.GONE)

    val locale = if (snapshot.language == "ar") Locale.forLanguageTag("ar") else Locale.US
    for ((i, bill) in bills.withIndex()) {
      views.setViewVisibility(BILL_ROWS[i], View.VISIBLE)
      views.setTextViewText(BILL_TITLES[i], bill.title.ifEmpty { WidgetSnapshot.DASH })
      views.setTextViewText(BILL_DATES[i], shortDate(bill.dueISO, locale))
      val formatted = snapshot.formatMinor(bill.amountMinor)
      val amount = if (bill.estimated && formatted != WidgetSnapshot.DASH) "≈ $formatted" else formatted
      views.setTextViewText(BILL_AMOUNTS[i], amount)
      views.setContentDescription(
        BILL_AMOUNTS[i],
        if (formatted == WidgetSnapshot.DASH) res.getString(R.string.wafra_widget_amount_hidden) else amount,
      )
    }
    return views
  }

  private fun attachLaunch(context: Context, views: RemoteViews) {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    val pending = PendingIntent.getActivity(
      context,
      0,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    views.setOnClickPendingIntent(R.id.wafra_widget_root, pending)
  }

  /** Widget strings follow the app language from the snapshot, not the phone's. */
  private fun resourcesFor(context: Context, language: String?): Resources {
    if (language == null) return context.resources
    val config = Configuration(context.resources.configuration)
    config.setLocale(Locale.forLanguageTag(language))
    return context.createConfigurationContext(config).resources
  }

  private fun paymentsText(res: Resources, count: Int): String {
    if (count == 0) return res.getString(R.string.wafra_widget_no_payments)
    val template = res.getQuantityString(R.plurals.wafra_widget_payments, count)
    return String.format(Locale.US, template, count)
  }

  /** "Mon 28 Sep" / "الاثنين 28 سبتمبر", always with Latin digits like the app. */
  private fun shortDate(iso: String, locale: Locale): String {
    val year = iso.substring(0, 4).toIntOrNull() ?: return iso
    val month = iso.substring(5, 7).toIntOrNull() ?: return iso
    val day = iso.substring(8, 10).toIntOrNull() ?: return iso
    if (month !in 1..12 || day !in 1..31) return iso
    val calendar = GregorianCalendar(year, month - 1, day)
    if (calendar.get(Calendar.DAY_OF_MONTH) != day) return iso
    val symbols = DateFormatSymbols.getInstance(locale)
    val weekday = symbols.shortWeekdays[calendar.get(Calendar.DAY_OF_WEEK)]
    val monthName = symbols.shortMonths[month - 1]
    return "$weekday $day $monthName"
  }

  private fun isoDate(calendar: Calendar): String = String.format(
    Locale.US,
    "%04d-%02d-%02d",
    calendar.get(Calendar.YEAR),
    calendar.get(Calendar.MONTH) + 1,
    calendar.get(Calendar.DAY_OF_MONTH),
  )

  /**
   * Seven bars, oldest first, today in the accent colour. Heights are relative
   * to the week's largest day; hidden or unknown days draw as a flat stub, so
   * the chart never implies a figure the snapshot does not carry.
   */
  private fun barsBitmap(context: Context, values: List<Long?>, hidden: Boolean): Bitmap {
    val density = context.resources.displayMetrics.density
    val width = Math.max(1, Math.round(160f * density))
    val height = Math.max(1, Math.round(40f * density))
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val track = context.getColor(R.color.wafra_widget_track)
    val accent = context.getColor(R.color.wafra_widget_accent)
    val rtl = context.resources.configuration.layoutDirection == View.LAYOUT_DIRECTION_RTL

    val amounts = values.map { if (hidden) 0L else Math.max(0L, it ?: 0L) }
    val max = amounts.maxOrNull() ?: 0L
    val count = amounts.size
    val gap = 6f * density
    val barWidth = (width - gap * (count - 1)) / count
    val radius = Math.min(barWidth / 2f, 3f * density)
    val minHeight = 3f * density

    for (i in 0 until count) {
      val share = if (max > 0L) amounts[i].toDouble() / max.toDouble() else 0.0
      val barHeight = Math.max(minHeight, (height * share).toFloat())
      val slot = if (rtl) count - 1 - i else i
      val left = slot * (barWidth + gap)
      paint.color = if (i == count - 1) accent else track
      canvas.drawRoundRect(RectF(left, height - barHeight, left + barWidth, height.toFloat()), radius, radius, paint)
    }
    return bitmap
  }

  /**
   * Re-render at the next local midnight (so "Today" never carries yesterday's
   * figure) or when the snapshot turns stale, whichever comes first. Inexact
   * alarm: no exact-alarm permission needed; the widget rechecks on every render.
   */
  private fun scheduleNextRefresh(context: Context, snapshot: WidgetSnapshot?, now: Long) {
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    val midnight = Calendar.getInstance().apply {
      add(Calendar.DAY_OF_YEAR, 1)
      set(Calendar.HOUR_OF_DAY, 0)
      set(Calendar.MINUTE, 0)
      set(Calendar.SECOND, 30)
      set(Calendar.MILLISECOND, 0)
    }.timeInMillis
    var next = midnight
    if (snapshot != null) {
      val expiry = snapshot.expiresAt() + 30_000L
      if (expiry in (now + 1)..midnight) next = expiry
    }
    val intent = Intent(context, TodayWidgetProvider::class.java).setAction(ACTION_REFRESH)
    val pending = PendingIntent.getBroadcast(
      context,
      1,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    alarms.set(AlarmManager.RTC, next, pending)
  }
}
