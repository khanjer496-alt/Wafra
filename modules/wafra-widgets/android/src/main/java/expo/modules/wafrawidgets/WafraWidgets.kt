package expo.modules.wafrawidgets

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.content.res.Resources
import android.os.Build
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.RelativeSizeSpan
import android.util.Log
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import java.text.DateFormatSymbols
import java.util.Calendar
import java.util.GregorianCalendar
import java.util.Locale
import java.util.TimeZone

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
  private val BILL_TILES = intArrayOf(R.id.wafra_bill_tile_1, R.id.wafra_bill_tile_2, R.id.wafra_bill_tile_3)
  private val BILL_GLYPHS = intArrayOf(R.id.wafra_bill_glyph_1, R.id.wafra_bill_glyph_2, R.id.wafra_bill_glyph_3)
  private val BILL_LOGOS = intArrayOf(R.id.wafra_bill_logo_1, R.id.wafra_bill_logo_2, R.id.wafra_bill_logo_3)
  private val BILL_MONO_LOGOS = intArrayOf(R.id.wafra_bill_logo_mono_1, R.id.wafra_bill_logo_mono_2, R.id.wafra_bill_logo_mono_3)
  private val LOGO_DRAWABLES = mapOf(
    "amazon" to R.drawable.wafra_logo_amazon,
    "netflix" to R.drawable.wafra_logo_netflix,
    "spotify" to R.drawable.wafra_logo_spotify,
    "youtube" to R.drawable.wafra_logo_youtube,
    "apple" to R.drawable.wafra_logo_apple,
    "google" to R.drawable.wafra_logo_google,
    "claude" to R.drawable.wafra_logo_claude,
    "github" to R.drawable.wafra_logo_github,
    "notion" to R.drawable.wafra_logo_notion,
    "discord" to R.drawable.wafra_logo_discord,
    "telegram" to R.drawable.wafra_logo_telegram,
    "dropbox" to R.drawable.wafra_logo_dropbox,
    "osn" to R.drawable.wafra_logo_osn,
    "anghami" to R.drawable.wafra_logo_anghami,
    "audible" to R.drawable.wafra_logo_audible,
    "shahid" to R.drawable.wafra_logo_shahid,
    "chatgpt" to R.drawable.wafra_logo_chatgpt,
    "crunchyroll" to R.drawable.wafra_logo_crunchyroll,
    "disney" to R.drawable.wafra_logo_disney,
    "deezer" to R.drawable.wafra_logo_deezer,
    "playstation" to R.drawable.wafra_logo_playstation,
    "xbox" to R.drawable.wafra_logo_xbox,
    "zoom" to R.drawable.wafra_logo_zoom,
    "du" to R.drawable.wafra_logo_du,
    "etisalat" to R.drawable.wafra_logo_etisalat,
    "dewa" to R.drawable.wafra_logo_dewa,
    "sewa" to R.drawable.wafra_logo_sewa,
    "careem" to R.drawable.wafra_logo_careem,
    "talabat" to R.drawable.wafra_logo_talabat,
    "deliveroo" to R.drawable.wafra_logo_deliveroo,
    "noon" to R.drawable.wafra_logo_noon,
    "uber" to R.drawable.wafra_logo_uber,
    "vercel" to R.drawable.wafra_logo_vercel,
  )
  private val MONOCHROME_LOGOS = setOf("apple", "github", "notion", "uber", "vercel")
  private const val DAY_MS = 24L * 60L * 60L * 1000L

  /**
   * Height breakpoints in dp. Today needs [TODAY_FULL_MIN_HEIGHT_DP] for the
   * seven-day total above the figure; below it the total is left out and the
   * budget words keep to one line. Coming up shows three bills from
   * [UPCOMING_THREE_ROWS_MIN_HEIGHT_DP], two from
   * [UPCOMING_TWO_ROWS_MIN_HEIGHT_DP], otherwise one, so a short widget drops
   * rows instead of clipping them.
   */
  internal const val TODAY_FULL_MIN_HEIGHT_DP = 152
  internal const val UPCOMING_TWO_ROWS_MIN_HEIGHT_DP = 130
  internal const val UPCOMING_THREE_ROWS_MIN_HEIGHT_DP = 170
  private val TODAY_BREAKPOINTS = intArrayOf(1, TODAY_FULL_MIN_HEIGHT_DP)
  private val UPCOMING_BREAKPOINTS = intArrayOf(1, UPCOMING_TWO_ROWS_MIN_HEIGHT_DP, UPCOMING_THREE_ROWS_MIN_HEIGHT_DP)

  /** Today keeps its seven-day total only from [TODAY_FULL_MIN_HEIGHT_DP] up. */
  internal fun todayIsCompact(heightDp: Int): Boolean = heightDp < TODAY_FULL_MIN_HEIGHT_DP

  /** How many bills Coming up lists at a given height. */
  internal fun upcomingRowsFor(heightDp: Int): Int = when {
    heightDp >= UPCOMING_THREE_ROWS_MIN_HEIGHT_DP -> 3
    heightDp >= UPCOMING_TWO_ROWS_MIN_HEIGHT_DP -> 2
    else -> 1
  }

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
      for (id in todayIds) {
        manager.updateAppWidget(id, sized(manager, id, TODAY_BREAKPOINTS) { height ->
          renderToday(app, snapshot, now, todayISO, todayIsCompact(height))
        })
      }
      for (id in upcomingIds) {
        manager.updateAppWidget(id, sized(manager, id, UPCOMING_BREAKPOINTS) { height ->
          renderUpcoming(app, snapshot, now, todayISO, upcomingRowsFor(height))
        })
      }
      scheduleNextRefresh(app, snapshot, now)
    } catch (error: Exception) {
      Log.w(TAG, "Widget refresh failed", error)
    }
  }

  /**
   * One layout per height breakpoint. Android 12+ picks among them itself for
   * every size the widget takes (portrait and landscape), so a resize needs no
   * round trip. Older versions report the widget's smallest height in its
   * options; an unknown height keeps the full layout.
   */
  private fun sized(
    manager: AppWidgetManager,
    appWidgetId: Int,
    breakpoints: IntArray,
    render: (Int) -> RemoteViews,
  ): RemoteViews {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val layouts = LinkedHashMap<SizeF, RemoteViews>()
      for (height in breakpoints) layouts[SizeF(1f, height.toFloat())] = render(height)
      return RemoteViews(layouts)
    }
    val height = manager.getAppWidgetOptions(appWidgetId)?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) ?: 0
    return render(if (height > 0) height else Int.MAX_VALUE)
  }

  private fun renderToday(
    context: Context,
    snapshot: WidgetSnapshot?,
    now: Long,
    todayISO: String,
    compact: Boolean,
  ): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.wafra_widget_today)
    attachLaunch(context, views)
    applyLanguageDirection(context, views, snapshot?.language)
    val res = resourcesFor(context, snapshot?.language)
    views.setTextViewText(R.id.wafra_today_label, res.getString(R.string.wafra_widget_today))

    // A snapshot from an earlier day would present yesterday's spending as today's.
    val usable = snapshot != null && snapshot.isFresh(now) && snapshot.todayISO == todayISO
    if (snapshot == null || !usable) {
      views.setViewVisibility(R.id.wafra_today_week, View.GONE)
      views.setViewVisibility(R.id.wafra_today_content, View.GONE)
      views.setViewVisibility(R.id.wafra_today_empty, View.VISIBLE)
      views.setTextViewText(R.id.wafra_today_empty, res.getString(R.string.wafra_widget_open_to_update))
      return views
    }
    views.setViewVisibility(R.id.wafra_today_empty, View.GONE)
    views.setViewVisibility(R.id.wafra_today_content, View.VISIBLE)

    val amount = snapshot.formatMinor(snapshot.todayMinor)
    views.setTextViewText(R.id.wafra_today_amount, bandFigure(context, amount, snapshot))
    views.setContentDescription(
      R.id.wafra_today_amount,
      if (amount == WidgetSnapshot.DASH) res.getString(R.string.wafra_widget_amount_hidden) else amount,
    )

    views.setViewVisibility(R.id.wafra_today_week, if (compact) View.GONE else View.VISIBLE)
    views.setTextViewText(R.id.wafra_today_week_label, res.getString(R.string.wafra_widget_last_7_total))
    val weekAmount = snapshot.formatMinor(snapshot.weekTotalMinor())
    views.setTextViewText(R.id.wafra_today_week_amount, isolate(weekAmount, snapshot.language))
    views.setContentDescription(R.id.wafra_today_week_amount,
      if (weekAmount == WidgetSnapshot.DASH) res.getString(R.string.wafra_widget_amount_hidden) else weekAmount)

    // One line under the figure: what is left in (or over) budgets when they
    // are set, otherwise today's payment count. As on iOS the amount is its
    // own view, so it never breaks across lines; the words give way instead.
    val left = snapshot.leftInBudgetsMinor
    if (left != null && !snapshot.hidden) {
      views.setViewVisibility(R.id.wafra_today_count, View.GONE)
      views.setViewVisibility(R.id.wafra_today_budget, View.VISIBLE)
      val line = budgetLine(res.getString(budgetLineTemplate(left)))
      val wordLines = if (compact) 1 else 2
      for ((view, words) in listOf(R.id.wafra_today_budget_lead to line.lead, R.id.wafra_today_budget_trail to line.trail)) {
        views.setViewVisibility(view, if (words.isEmpty()) View.GONE else View.VISIBLE)
        views.setTextViewText(view, words)
        views.setInt(view, "setMaxLines", wordLines)
      }
      views.setTextViewText(
        R.id.wafra_today_budget_amount,
        isolate(snapshot.formatMinor(Math.abs(left)), snapshot.language),
      )
    } else {
      views.setViewVisibility(R.id.wafra_today_budget, View.GONE)
      views.setViewVisibility(R.id.wafra_today_count, View.VISIBLE)
      views.setTextViewText(R.id.wafra_today_count, paymentsText(res, snapshot.todayCount))
    }
    return views
  }

  /** "%1$s over budgets" when spending is past the budgets, else "%1$s left in budgets". */
  internal fun budgetLineTemplate(leftMinor: Long): Int =
    if (leftMinor < 0) R.string.wafra_widget_over_budgets else R.string.wafra_widget_left_in_budgets

  internal data class BudgetLine(val lead: String, val trail: String)

  /**
   * Splits a budget template at its amount: "%1$s left in budgets" has the
   * words after the amount, the Arabic "المتبقي في الميزانيات %1$s" before it.
   */
  internal fun budgetLine(template: String): BudgetLine {
    val at = template.indexOf(AMOUNT_PLACEHOLDER)
    if (at < 0) return BudgetLine(template.trim(), "")
    return BudgetLine(template.substring(0, at).trim(), template.substring(at + AMOUNT_PLACEHOLDER.length).trim())
  }

  private const val AMOUNT_PLACEHOLDER = "%1\$s"

  /**
   * The band figure: "AED 24.00" with the currency code set smaller and dimmed,
   * as on the app's band figures. Kept in reading order inside Arabic text.
   */
  private fun bandFigure(context: Context, amount: String, snapshot: WidgetSnapshot): CharSequence {
    if (amount == WidgetSnapshot.DASH || !amount.startsWith(snapshot.currency)) return amount
    val text = isolate(amount, snapshot.language)
    val start = text.indexOf(snapshot.currency)
    val end = start + snapshot.currency.length
    val figure = SpannableString(text)
    figure.setSpan(RelativeSizeSpan(0.62f), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    figure.setSpan(
      ForegroundColorSpan(context.getColor(R.color.wafra_widget_today_secondary)),
      start,
      end,
      Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
    )
    return figure
  }

  /** Keeps "USD 15.49" in reading order inside right-to-left text. */
  private fun isolate(text: String, language: String): String =
    if (language == "ar" && text != WidgetSnapshot.DASH) "\u200E$text\u200E" else text

  private fun renderUpcoming(
    context: Context,
    snapshot: WidgetSnapshot?,
    now: Long,
    todayISO: String,
    maxRows: Int,
  ): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.wafra_widget_upcoming)
    attachLaunch(context, views)
    applyLanguageDirection(context, views, snapshot?.language)
    val res = resourcesFor(context, snapshot?.language)
    views.setTextViewText(R.id.wafra_upcoming_label, res.getString(R.string.wafra_widget_upcoming))

    // ISO dates compare correctly as strings; drop anything already past.
    val bills = if (snapshot != null && snapshot.isFresh(now)) {
      snapshot.bills.filter { it.dueISO >= todayISO }.take(maxRows.coerceIn(1, BILL_ROWS.size))
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
      // JSON can select only a compiled resource; never a URI or arbitrary path.
      val logo = LOGO_DRAWABLES[bill.logoId]
      val initial = initialOf(bill.title)
      // Single-ink marks go in a view tinted by a colour resource, so they
      // follow the launcher's light or dark mode; multicolour brands keep
      // their bundled pixels.
      val mono = logo != null && bill.logoId in MONOCHROME_LOGOS
      views.setViewVisibility(BILL_LOGOS[i], if (logo != null && !mono) View.VISIBLE else View.GONE)
      views.setViewVisibility(BILL_MONO_LOGOS[i], if (mono) View.VISIBLE else View.GONE)
      if (logo != null) {
        views.setImageViewResource(if (mono) BILL_MONO_LOGOS[i] else BILL_LOGOS[i], logo)
        views.setViewVisibility(BILL_TILES[i], View.GONE)
        views.setViewVisibility(BILL_GLYPHS[i], View.GONE)
      } else if (initial != null) {
        views.setTextViewText(BILL_TILES[i], initial)
        views.setViewVisibility(BILL_TILES[i], View.VISIBLE)
        views.setViewVisibility(BILL_GLYPHS[i], View.GONE)
      } else {
        views.setTextViewText(BILL_TILES[i], "")
        views.setViewVisibility(BILL_TILES[i], View.GONE)
        views.setViewVisibility(BILL_GLYPHS[i], View.VISIBLE)
      }
      views.setTextViewText(BILL_DATES[i], dueWord(res, bill.dueISO, todayISO, locale))
      val formatted = snapshot.formatMinor(bill.amountMinor)
      val amount = if (bill.estimated && formatted != WidgetSnapshot.DASH) "≈ $formatted" else formatted
      // "≈ AED 380.00" stays in reading order inside Arabic.
      views.setTextViewText(BILL_AMOUNTS[i], isolate(amount, snapshot.language))
      views.setContentDescription(
        BILL_AMOUNTS[i],
        if (formatted == WidgetSnapshot.DASH) res.getString(R.string.wafra_widget_amount_hidden) else amount,
      )
    }
    return views
  }

  /** Follow Wafra's chosen language even when the launcher uses another one. */
  private fun applyLanguageDirection(context: Context, views: RemoteViews, language: String?) {
    val direction = when (language) {
      "ar" -> View.LAYOUT_DIRECTION_RTL
      "en" -> View.LAYOUT_DIRECTION_LTR
      else -> context.resources.configuration.layoutDirection
    }
    views.setInt(R.id.wafra_widget_root, "setLayoutDirection", direction)
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

  /**
   * First letter of a title, upper-cased, for its tile; null when it has none.
   * The Arabic article is skipped ("الكهرباء" -> "ك"), as on iOS and in the
   * app's preview.
   */
  internal fun initialOf(title: String): String? {
    var index = 0
    while (index < title.length) {
      val codePoint = title.codePointAt(index)
      if (Character.isLetter(codePoint)) {
        var letter = codePoint
        val after = index + ARABIC_ARTICLE.length
        if (title.startsWith(ARABIC_ARTICLE, index) && after < title.length) {
          val next = title.codePointAt(after)
          if (Character.isLetter(next)) letter = next
        }
        return String(Character.toChars(letter)).uppercase(Locale.ROOT)
      }
      index += Character.charCount(codePoint)
    }
    return null
  }

  private const val ARABIC_ARTICLE = "\u0627\u0644"


  /**
   * "Today", "Tomorrow", the weekday within the coming week ("Monday"), or
   * "Mon 5 Oct" further out, so a weekday never means next week's.
   */
  internal fun dueWord(res: Resources, dueISO: String, todayISO: String, locale: Locale): String {
    val due = parseDay(dueISO) ?: return dueISO
    val today = parseDay(todayISO) ?: return shortDate(dueISO, locale)
    return when ((due.timeInMillis - today.timeInMillis) / DAY_MS) {
      0L -> res.getString(R.string.wafra_widget_today)
      1L -> res.getString(R.string.wafra_widget_tomorrow)
      in 2L..6L -> DateFormatSymbols.getInstance(locale).weekdays[due.get(Calendar.DAY_OF_WEEK)]
      else -> shortDate(dueISO, locale)
    }
  }

  /** A valid YYYY-MM-DD at UTC midnight (so day differences are exact), or null. */
  private fun parseDay(iso: String): Calendar? {
    if (iso.length != 10) return null
    val year = iso.substring(0, 4).toIntOrNull() ?: return null
    val month = iso.substring(5, 7).toIntOrNull() ?: return null
    val day = iso.substring(8, 10).toIntOrNull() ?: return null
    if (month !in 1..12 || day !in 1..31) return null
    val calendar = GregorianCalendar(TimeZone.getTimeZone("UTC"))
    calendar.clear()
    calendar.set(year, month - 1, day)
    if (calendar.get(Calendar.DAY_OF_MONTH) != day || calendar.get(Calendar.MONTH) != month - 1) return null
    return calendar
  }

  /** "Mon 28 Sep" / "الاثنين 28 سبتمبر", always with Latin digits like the app. */
  private fun shortDate(iso: String, locale: Locale): String {
    val calendar = parseDay(iso) ?: return iso
    val symbols = DateFormatSymbols.getInstance(locale)
    val weekday = symbols.shortWeekdays[calendar.get(Calendar.DAY_OF_WEEK)]
    val monthName = symbols.shortMonths[calendar.get(Calendar.MONTH)]
    return "$weekday ${calendar.get(Calendar.DAY_OF_MONTH)} $monthName"
  }

  private fun isoDate(calendar: Calendar): String = String.format(
    Locale.US,
    "%04d-%02d-%02d",
    calendar.get(Calendar.YEAR),
    calendar.get(Calendar.MONTH) + 1,
    calendar.get(Calendar.DAY_OF_MONTH),
  )

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
