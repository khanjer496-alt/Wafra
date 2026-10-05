package expo.modules.wafrawidgets

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.Drawable
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
 *
 * The coins (Today's stack, Spending's coin row, the logos on Coming up's
 * date strip) are the exception: gold and the categories' own colours are
 * the same in light and dark, so those bitmaps are drawn in colour. Where a
 * coin needs the band's colour (the gap between overlapping coins) it is cut
 * out of the bitmap instead, so the band shows through. Anything in the
 * band's text or tile tone is still a white mask the layout tints. The coin
 * arithmetic mirrors src/lib/widget-coins.ts and iOS's WafraCoinMath.
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

  // Coins: arithmetic.

  /** Mirrors CoinColors in src/constants/theme.ts; the only coin colours here. */
  val COIN_FACE = 0xFFEDC85E.toInt()
  val COIN_SIDE = 0xFFB98F2E.toInt()
  val COIN_RIM = 0xFF5E4610.toInt()
  val COIN_SHINE = 0xFFFFF4CF.toInt()
  val COIN_SHADOW = 0xFF000000.toInt()

  /** Today's stack: one coin per payment today, at most six (Home's TODAY_COINS). */
  const val TODAY_COINS = 6
  const val TODAY_COIN_WIDTH_DP = 22f
  /** Spending's coin row: share-bar.tsx scaled to the widget's 26dp bar. */
  const val COIN_ROW_HEIGHT_DP = 26
  const val COIN_ROW_FACE_DP = 10f
  const val COIN_ROW_MIN_DP = 16f
  const val COIN_ROW_OVERLAP_DP = 5f
  /** Coming up's strip: the next 30 days, the next payment lifted. */
  const val STRIP_DAYS = 30
  const val STRIP_TILE_DP = 20f
  const val STRIP_LIFT_DP = 6f
  const val STRIP_HEIGHT_DP = 30

  fun todayCoins(count: Int): Int = count.coerceIn(0, TODAY_COINS)

  /** A flat coin seen from a little above (coin-disc.tsx discGeometry), in dp. */
  fun discFaceDp(widthDp: Float): Float = Math.round(widthDp * 0.36f).toFloat()
  fun discEdgeDp(widthDp: Float): Float = maxOf(3, Math.round(widthDp * 0.13f)).toFloat()

  internal data class SpendingCoin(val color: Int, val value: Long?)

  /**
   * Spending's coins: each named category in its own colour, then one coin
   * for the rest. Null keeps the share bar (a snapshot without colours).
   * Hidden or unknown amounts give one equal coin per named category and no
   * rest coin, so no coin's size or presence hints at an amount.
   */
  fun spendingCoins(spending: WidgetSpending, hidden: Boolean): List<SpendingCoin>? {
    if (spending.categories.isEmpty()) return null
    val colors = spending.categories.map { it.color ?: return null }
    val amounts = spending.categories.map { it.amountMinor } + spending.otherMinor
    var known = !hidden && amounts.all { it != null && it >= 0L }
    var sum = 0L
    if (known) {
      for (amount in amounts) {
        val next = try { Math.addExact(sum, amount ?: 0L) } catch (_: ArithmeticException) { null }
        if (next == null) {
          known = false
          break
        }
        sum = next
      }
    }
    if (!known || sum <= 0L) return colors.map { SpendingCoin(it, null) }
    val coins = ArrayList<SpendingCoin>()
    spending.categories.forEachIndexed { index, category ->
      if ((category.amountMinor ?: 0L) > 0L) coins.add(SpendingCoin(colors[index], category.amountMinor))
    }
    val rest = spending.otherMinor ?: 0L
    if (rest > 0L) coins.add(SpendingCoin(spending.otherColor ?: return null, rest))
    return if (coins.isEmpty()) null else coins
  }

  /**
   * Coin widths across `availablePx`: flex-grow by value with a minimum, each
   * coin overlapping the one before by `overlapPx` (share-bar.tsx). Any
   * unknown value makes every coin equal.
   */
  fun coinWidths(values: List<Long?>, availablePx: Float, minPx: Float, overlapPx: Float): FloatArray {
    val count = values.size
    if (count == 0) return FloatArray(0)
    val span = maxOf(0f, availablePx + overlapPx * (count - 1))
    if (values.any { it == null || it <= 0L }) return FloatArray(count) { maxOf(minPx, span / count) }
    val weights = values.map { (it ?: 0L).toDouble() }
    val fixed = BooleanArray(count)
    // Each pass fixes at least one coin at the minimum or returns.
    for (pass in 0..count) {
      val free = span - minPx * fixed.count { it }
      var weight = 0.0
      for (index in 0 until count) if (!fixed[index]) weight += weights[index]
      var changed = false
      for (index in 0 until count) {
        if (!fixed[index] && (weight <= 0.0 || free * weights[index] / weight < minPx)) {
          fixed[index] = true
          changed = true
        }
      }
      if (!changed) return FloatArray(count) { if (fixed[it]) minPx else (free * weights[it] / weight).toFloat() }
      if (fixed.all { it }) break
    }
    return FloatArray(count) { minPx }
  }

  /** Each coin's left edge; from the reading start, mirrored for right to left. */
  fun coinOffsets(widths: FloatArray, availablePx: Float, overlapPx: Float, rtl: Boolean): FloatArray {
    var x = 0f
    return FloatArray(widths.size) { index ->
      val at = if (rtl) availablePx - x - widths[index] else x
      x += widths[index] - overlapPx
      at
    }
  }

  /** Where a pin sits along the strip, as a share of its width (pin-timeline.tsx). */
  fun pinPosition(dayOffset: Int, days: Int = STRIP_DAYS): Float =
    3f + 94f * dayOffset.coerceIn(0, days).toFloat() / maxOf(1, days).toFloat()

  /**
   * Tile centres from the reading start, soonest first: on their dates, nudged
   * apart so no tile covers another by more than a third, inside the strip.
   */
  fun stripCenters(dayOffsets: List<Int>, widthPx: Float, tilePx: Float, days: Int = STRIP_DAYS): FloatArray {
    val gap = tilePx * 0.7f
    val half = tilePx / 2f
    val centers = FloatArray(dayOffsets.size) { (widthPx * pinPosition(dayOffsets[it], days) / 100f).coerceIn(half, maxOf(half, widthPx - half)) }
    for (index in 1 until centers.size) centers[index] = maxOf(centers[index], centers[index - 1] + gap)
    val last = centers.size - 1
    if (last >= 0 && centers[last] > widthPx - half) {
      centers[last] = widthPx - half
      for (index in last - 1 downTo 0) centers[index] = minOf(centers[index], centers[index + 1] - gap)
    }
    for (index in centers.indices) centers[index] = maxOf(half, centers[index])
    return centers
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

  // Coins: drawing. In colour (gold and category colours read the same in
  // light and dark); the band shows through where a coin is cut out.

  private fun fill(color: Int, alpha: Float = 1f) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    this.color = color
    this.alpha = (alpha.coerceIn(0f, 1f) * 255f).toInt()
    style = Paint.Style.FILL
  }

  private fun outline(color: Int, width: Float, alpha: Float = 1f) = fill(color, alpha).apply {
    style = Paint.Style.STROKE
    strokeWidth = width
  }

  /** Erases to transparent, so the band behind the bitmap shows. */
  private fun cut(width: Float = 0f) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
    style = if (width > 0f) Paint.Style.STROKE else Paint.Style.FILL
    strokeWidth = width
  }

  private fun inset(rect: RectF, by: Float) = RectF(rect.left + by, rect.top + by, rect.right - by, rect.bottom - by)

  /** One flat coin at (left, top): the edge, then the face with its ring and shine (coin-disc.tsx). */
  private fun disc(canvas: Canvas, left: Float, top: Float, width: Float, face: Float, edge: Float, density: Float) {
    val line = density
    val lower = RectF(left, top + edge, left + width, top + edge + face)
    canvas.drawOval(lower, fill(COIN_SIDE))
    canvas.drawOval(inset(lower, line / 2f), outline(COIN_RIM, line))
    canvas.drawRect(left, top + face / 2f, left + width, top + face / 2f + edge, fill(COIN_SIDE))
    canvas.drawRect(left, top + face / 2f, left + line, top + face / 2f + edge, fill(COIN_RIM))
    canvas.drawRect(left + width - line, top + face / 2f, left + width, top + face / 2f + edge, fill(COIN_RIM))
    val upper = RectF(left, top, left + width, top + face)
    canvas.drawOval(upper, fill(COIN_FACE))
    canvas.drawOval(inset(upper, line / 2f), outline(COIN_RIM, line))
    val ring = RectF(left + width * 0.15f, top + face * 0.15f, left + width * 0.85f, top + face * 0.85f)
    canvas.drawOval(inset(ring, line / 2f), outline(COIN_SIDE, line, 0.55f))
    val shine = RectF(left + width * 0.2f, top + face * 0.18f, left + width * 0.48f, top + face * 0.18f + maxOf(line, face * 0.22f))
    canvas.drawRoundRect(shine, shine.height() / 2f, shine.height() / 2f, fill(COIN_SHINE, 0.45f))
  }

  /** Height in px of Today's stack, always room for six coins so the row never jumps. */
  fun coinStackHeightPx(density: Float): Int {
    val face = discFaceDp(TODAY_COIN_WIDTH_DP)
    val edge = discEdgeDp(TODAY_COIN_WIDTH_DP)
    val shadow = maxOf(2, Math.round(face * 0.22f))
    return Math.round((face + edge + (TODAY_COINS - 1) * edge + shadow) * density)
  }

  /**
   * Today's coins, one per payment today (at most six), bottom up over a
   * soft contact shadow, as Home's Today stack draws them.
   */
  fun coinStack(count: Int, density: Float): Bitmap {
    val width = TODAY_COIN_WIDTH_DP * density
    val face = discFaceDp(TODAY_COIN_WIDTH_DP) * density
    val edge = discEdgeDp(TODAY_COIN_WIDTH_DP) * density
    val shadow = maxOf(2, Math.round(discFaceDp(TODAY_COIN_WIDTH_DP) * 0.22f)) * density
    val heightPx = coinStackHeightPx(density)
    val (bitmap, canvas) = canvasOf(Math.round(width), heightPx)
    val bottom = heightPx.toFloat()
    canvas.drawOval(RectF(width * 0.04f, bottom - face * 0.7f, width * 0.96f, bottom), fill(COIN_SHADOW, 0.18f))
    for (index in 0 until todayCoins(count)) {
      disc(canvas, 0f, bottom - shadow - face - edge - index * edge, width, face, edge, density)
    }
    return bitmap
  }

  /**
   * Spending's coin row: coins lying on their side, each in its category's
   * colour, the face toward the reading start (share-bar.tsx). Each coin's
   * outline is cut out, so overlapping coins stay apart on the band.
   */
  fun coinRow(coins: List<SpendingCoin>, widthPx: Int, heightPx: Int, density: Float, rtl: Boolean): Bitmap {
    val (bitmap, canvas) = canvasOf(widthPx, heightPx)
    val face = COIN_ROW_FACE_DP * density
    val overlap = COIN_ROW_OVERLAP_DP * density
    val widths = coinWidths(coins.map { it.value }, widthPx.toFloat(), COIN_ROW_MIN_DP * density, overlap)
    val offsets = coinOffsets(widths, widthPx.toFloat(), overlap, rtl)
    val height = heightPx.toFloat()
    val line = 1.5f * density
    for (index in coins.indices) {
      val left = offsets[index]
      val right = left + widths[index]
      val color = coins[index].color
      val endCap = if (rtl) RectF(left, 0f, left + face, height) else RectF(right - face, 0f, right, height)
      val faceCap = if (rtl) RectF(right - face, 0f, right, height) else RectF(left, 0f, left + face, height)
      canvas.drawOval(endCap, fill(color))
      canvas.drawOval(inset(endCap, line / 2f), cut(line))
      val body = RectF(left + face / 2f, 0f, right - face / 2f, height)
      if (body.width() > 0f) {
        canvas.drawRect(body, fill(color))
        canvas.drawRect(body.left, 0f, body.right, line, cut())
        canvas.drawRect(body.left, height - line, body.right, height, cut())
        // A soft highlight along the top: a rounded coin, not a bar.
        val sheenStart = if (rtl) left + face / 2f + 2f * density else left + face
        val sheenEnd = if (rtl) right - face else right - face / 2f - 2f * density
        if (sheenEnd > sheenStart) {
          val sheen = RectF(sheenStart, height * 0.17f, sheenEnd, height * 0.17f + 2.5f * density)
          canvas.drawRoundRect(sheen, sheen.height() / 2f, sheen.height() / 2f, fill(Color.WHITE, 0.32f))
        }
      }
      canvas.drawOval(faceCap, fill(color))
      // The face turns a little from the light.
      canvas.drawOval(faceCap, fill(COIN_SHADOW, 0.22f))
      canvas.drawOval(inset(faceCap, line / 2f), cut(line))
    }
    return bitmap
  }

  /** One bill on Coming up's strip: its centre and what its tile carries. */
  internal class StripPin(
    val center: Float,
    val logo: Bitmap?,
    val monoLogo: Bitmap?,
    val initial: String?,
    val glyph: Drawable?,
  )

  /** The strip's three layers: tiles (tile tone), marks (text tone), logos (their own colours). */
  internal class StripLayers(val tiles: Bitmap, val marks: Bitmap, val logos: Bitmap)

  /**
   * Coming up's date strip: a baseline with marks at 0, 10, 20 and 30 days,
   * each listed bill's tile on its date, the soonest lifted over a soft
   * shadow. `pins` are soonest first with centres already mirrored for right
   * to left. Each pin, latest first, clears its tile in the layers above, so
   * the lifted one is whole on top.
   */
  fun billStrip(pins: List<StripPin>, widthPx: Int, density: Float, rtl: Boolean): StripLayers {
    val heightPx = Math.round(STRIP_HEIGHT_DP * density)
    val (tiles, tileCanvas) = canvasOf(widthPx, heightPx)
    val (marks, markCanvas) = canvasOf(widthPx, heightPx)
    val (logos, logoCanvas) = canvasOf(widthPx, heightPx)
    val tile = STRIP_TILE_DP * density
    val lift = STRIP_LIFT_DP * density
    val lineY = tile + lift + density
    val line = 1.5f * density
    val width = widthPx.toFloat()
    markCanvas.drawRect(0f, lineY, width, lineY + line, paint(0.35f))
    for ((index, day) in intArrayOf(0, 10, 20, 30).withIndex()) {
      val at = width * pinPosition(day) / 100f
      val x = if (rtl) width - at else at
      val tick = (if (index == 0) 6f else 4f) * density
      markCanvas.drawRect(x - line / 2f, lineY - tick + line, x + line / 2f, lineY + line, paint(0.35f))
    }
    pins.firstOrNull()?.let { first ->
      markCanvas.drawOval(RectF(first.center - tile * 0.4f, lineY - density, first.center + tile * 0.4f, lineY + 2f * density),
        paint(0.18f))
    }
    val radius = tile * 8f / 28f
    val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      textAlign = Paint.Align.CENTER
      textSize = tile / 2f
      typeface = Typeface.DEFAULT_BOLD
    }
    val bitmapPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    for (index in pins.indices.reversed()) {
      val pin = pins[index]
      val top = if (index == 0) 0f else lift
      val rect = RectF(pin.center - tile / 2f, top, pin.center + tile / 2f, top + tile)
      // A gap around the tile keeps overlapping tiles apart.
      tileCanvas.drawRoundRect(RectF(rect.left - line, rect.top - line, rect.right + line, rect.bottom + line),
        radius + line, radius + line, cut())
      tileCanvas.drawRoundRect(rect, radius, radius, paint())
      markCanvas.drawRoundRect(rect, radius, radius, cut())
      logoCanvas.drawRoundRect(rect, radius, radius, cut())
      val logoRect = inset(rect, tile * 3f / 28f)
      when {
        pin.logo != null -> logoCanvas.drawBitmap(pin.logo, null, logoRect, bitmapPaint)
        pin.monoLogo != null -> markCanvas.drawBitmap(pin.monoLogo, null, logoRect, bitmapPaint)
        pin.initial != null -> {
          val baseline = rect.centerY() - (text.ascent() + text.descent()) / 2f
          markCanvas.drawText(pin.initial, rect.centerX(), baseline, text)
        }
        pin.glyph != null -> {
          val glyph = inset(rect, tile * 0.27f)
          pin.glyph.setBounds(Math.round(glyph.left), Math.round(glyph.top), Math.round(glyph.right), Math.round(glyph.bottom))
          pin.glyph.setTint(Color.WHITE)
          pin.glyph.draw(markCanvas)
        }
      }
    }
    return StripLayers(tiles, marks, logos)
  }
}
