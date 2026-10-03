package expo.modules.wafrawidgets

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale

/**
 * The widgets' drawn shapes: Today's seven bars and budget bar, and the
 * Spending share bar. Before Android 12 a RemoteViews layout cannot size a
 * view per value, so each shape is drawn into a bitmap.
 *
 * Every bitmap is a white alpha mask. The ImageView that shows it tints it
 * with a colour resource (android:tint), so the colours come from the
 * launcher's own light or dark resources when it inflates the layout, and
 * follow a night-mode change without a re-render. The geometry is plain
 * arithmetic, kept apart from the drawing so it can be checked off-device.
 */
internal object WidgetGraphics {
  const val WEEK_CHART_HEIGHT_DP = 24
  private const val WEEK_CHART_MIN_WIDTH_DP = 56
  private const val WEEK_CHART_MAX_WIDTH_DP = 112
  private const val WEEK_CHART_DEFAULT_WIDTH_DP = 64
  /** Room the week total takes beside the bars, plus the widget's padding. */
  private const val WEEK_CHART_RESERVED_DP = 32 + 80
  const val BAR_GAP_DP = 3f
  const val BAR_RADIUS_DP = 2f
  const val BASELINE_DP = 2f
  const val MIN_BAR_DP = 4f
  const val PROGRESS_HEIGHT_DP = 4
  const val SHARE_BAR_HEIGHT_DP = 26
  const val SHARE_GAP_DP = 3f
  const val SHARE_RADIUS_DP = 6f
  private const val DEFAULT_CONTENT_WIDTH_DP = 120

  /** Opacity of the share-bar segments: three named in falling strength, the rest quiet (as the preview). */
  val SEGMENT_ALPHAS = floatArrayOf(0.92f, 0.7f, 0.5f)
  const val SEGMENT_REST_ALPHA = 0.24f

  /** The bars' width in dp for a widget of `widgetWidthDp`; unknown widths take the default. */
  fun weekChartWidthDp(widgetWidthDp: Int): Int =
    if (widgetWidthDp <= 0) WEEK_CHART_DEFAULT_WIDTH_DP
    else (widgetWidthDp - WEEK_CHART_RESERVED_DP).coerceIn(WEEK_CHART_MIN_WIDTH_DP, WEEK_CHART_MAX_WIDTH_DP)

  /** The space inside the widget's 16dp padding. */
  fun contentWidthDp(widgetWidthDp: Int): Int =
    if (widgetWidthDp <= 0) DEFAULT_CONTENT_WIDTH_DP else maxOf(40, widgetWidthDp - 32)

  /**
   * Bar heights, oldest first, relative to the week's largest day. A day with
   * nothing, an unknown day and every day of a hidden snapshot is a thin
   * baseline: the bars never imply a figure the snapshot does not carry.
   */
  fun weekBarHeights(values: List<Long?>, hidden: Boolean, maxPx: Float, minBarPx: Float, baselinePx: Float): FloatArray {
    val days = List(7) { index -> if (hidden || values.size != 7) 0L else maxOf(0L, values[index] ?: 0L) }
    val peak = days.maxOrNull() ?: 0L
    return FloatArray(days.size) { index ->
      if (peak <= 0L || days[index] <= 0L) baselinePx
      else maxOf(minBarPx, days[index].toFloat() / peak.toFloat() * maxPx)
    }
  }

  /** Whether today's bar is a bar (drawn in the accent) rather than a baseline. */
  fun todayHasBar(values: List<Long?>, hidden: Boolean): Boolean =
    !hidden && values.size == 7 && (values[6] ?: 0L) > 0L

  /**
   * How much of the budgets is used: (limits - left) / limits in 0..1, as the
   * iOS Lock Screen gauge and the in-app preview read it. Null without
   * limits or when amounts are hidden.
   */
  fun budgetFraction(totalMinor: Long?, leftMinor: Long?, hidden: Boolean): Float? {
    if (hidden || totalMinor == null || leftMinor == null || totalMinor <= 0L) return null
    return ((totalMinor - leftMinor).toDouble() / totalMinor.toDouble()).coerceIn(0.0, 1.0).toFloat()
  }

  internal data class Segment(val start: Float, val end: Float, val alpha: Float)

  /**
   * Share-bar segments across `widthPx`: each category in order, then the
   * rest together. Unknown or hidden amounts draw one quiet full-width
   * segment, never shares. Right to left for Arabic.
   */
  fun shareSegments(amounts: List<Long?>, named: Int, hidden: Boolean, widthPx: Float, gapPx: Float, rtl: Boolean): List<Segment> {
    val known = !hidden && amounts.isNotEmpty() && amounts.all { it != null && it >= 0L }
    val sum = if (known) amounts.sumOf { it ?: 0L } else 0L
    if (!known || sum <= 0L) return listOf(Segment(0f, widthPx, SEGMENT_REST_ALPHA))
    val parts = amounts.withIndex().filter { (it.value ?: 0L) > 0L }
    val available = widthPx - gapPx * (parts.size - 1)
    val out = ArrayList<Segment>()
    var x = 0f
    for ((position, part) in parts.withIndex()) {
      val width = if (position == parts.size - 1) widthPx - x
      else maxOf(1f, available * (part.value ?: 0L).toFloat() / sum.toFloat())
      val alpha = if (part.index < named) SEGMENT_ALPHAS.getOrElse(part.index) { SEGMENT_REST_ALPHA } else SEGMENT_REST_ALPHA
      val end = minOf(widthPx, x + width)
      out.add(if (rtl) Segment(widthPx - end, widthPx - x, alpha) else Segment(x, end, alpha))
      x = end + gapPx
      if (x >= widthPx) break
    }
    return out
  }

  /** "1,836": whole major units, half up, as the preview and Home's week columns print them. */
  fun wholeNumber(minor: Long, exponent: Int): String {
    val whole = BigDecimal.valueOf(minor).movePointLeft(exponent).abs().setScale(0, RoundingMode.HALF_UP)
    val text = NumberFormat.getIntegerInstance(Locale.US).apply { isGroupingUsed = true }.format(whole)
    return if (minor < 0 && whole.signum() > 0) "-$text" else text
  }

  // Drawing. Each returns an ARGB_8888 white mask the layout tints.

  private fun canvasOf(widthPx: Int, heightPx: Int): Pair<Bitmap, Canvas> {
    val bitmap = Bitmap.createBitmap(maxOf(1, widthPx), maxOf(1, heightPx), Bitmap.Config.ARGB_8888)
    return bitmap to Canvas(bitmap)
  }

  private fun paint(alpha: Float = 1f) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.WHITE
    this.alpha = (alpha.coerceIn(0f, 1f) * 255f).toInt()
  }

  /**
   * The week as two masks: the six earlier days (and a quiet today) for the
   * mark tone, and today's bar alone for the accent.
   */
  fun weekBars(heights: FloatArray, todayBar: Boolean, widthPx: Int, heightPx: Int, density: Float, rtl: Boolean): Pair<Bitmap, Bitmap> {
    val (others, otherCanvas) = canvasOf(widthPx, heightPx)
    val (today, todayCanvas) = canvasOf(widthPx, heightPx)
    val gap = BAR_GAP_DP * density
    val radius = BAR_RADIUS_DP * density
    val count = heights.size
    val barWidth = (widthPx - gap * (count - 1)) / count
    val brush = paint()
    for (index in 0 until count) {
      val slot = if (rtl) count - 1 - index else index
      val left = slot * (barWidth + gap)
      val height = minOf(heights[index], heightPx.toFloat())
      val rect = RectF(left, heightPx - height, left + barWidth, heightPx.toFloat())
      val target = if (index == count - 1 && todayBar) todayCanvas else otherCanvas
      target.drawRoundRect(rect, radius, radius, brush)
    }
    return others to today
  }

  /** The used part of the budget bar, from the reading start. */
  fun progressFill(fraction: Float, widthPx: Int, heightPx: Int, rtl: Boolean): Bitmap {
    val (bitmap, canvas) = canvasOf(widthPx, heightPx)
    val filled = fraction.coerceIn(0f, 1f) * widthPx
    if (filled > 0f) {
      val radius = heightPx / 2f
      val rect = if (rtl) RectF(widthPx - filled, 0f, widthPx.toFloat(), heightPx.toFloat())
      else RectF(0f, 0f, filled, heightPx.toFloat())
      canvas.drawRoundRect(rect, radius, radius, paint())
    }
    return bitmap
  }

  fun shareBar(segments: List<Segment>, widthPx: Int, heightPx: Int, density: Float): Bitmap {
    val (bitmap, canvas) = canvasOf(widthPx, heightPx)
    val radius = SHARE_RADIUS_DP * density
    for (segment in segments) {
      if (segment.end - segment.start < 0.5f) continue
      val r = minOf(radius, (segment.end - segment.start) / 2f)
      canvas.drawRoundRect(RectF(segment.start, 0f, segment.end, heightPx.toFloat()), r, r, paint(segment.alpha))
    }
    return bitmap
  }
}
