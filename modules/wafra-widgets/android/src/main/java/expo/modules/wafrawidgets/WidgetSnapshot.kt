package expo.modules.wafrawidgets

import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.text.NumberFormat
import java.util.Locale

internal data class WidgetBill(
  val title: String,
  val amountMinor: Long?,
  val estimated: Boolean,
  val dueISO: String,
)

/**
 * The summary written by src/lib/widget-snapshot.ts (version 1). It is the only
 * data the widgets read. Anything malformed parses to null (empty state) or to
 * a null amount (shown as a dash), never to a guessed figure.
 */
internal data class WidgetSnapshot(
  val generatedAt: Long,
  val language: String,
  val todayISO: String,
  val currency: String,
  val exponent: Int,
  val hidden: Boolean,
  val todayMinor: Long?,
  val todayCount: Int,
  val last7Minor: List<Long?>,
  val leftInBudgetsMinor: Long?,
  val bills: List<WidgetBill>,
) {
  /** Fresh means generated within the last 36 hours and not from the future. */
  fun isFresh(nowMs: Long): Boolean =
    generatedAt > 0 && nowMs - generatedAt <= MAX_AGE_MS && generatedAt - nowMs <= FUTURE_SKEW_MS

  fun expiresAt(): Long = generatedAt + MAX_AGE_MS

  /** "USD 1,234.56" with Latin digits; a dash when amounts are hidden or unknown. */
  fun formatMinor(minor: Long?): String {
    if (hidden || minor == null) return DASH
    val format = NumberFormat.getNumberInstance(Locale.US)
    format.minimumFractionDigits = exponent
    format.maximumFractionDigits = exponent
    format.isGroupingUsed = true
    return "$currency ${format.format(BigDecimal.valueOf(minor, exponent))}"
  }

  companion object {
    const val DASH = "—"
    const val MAX_AGE_MS = 36L * 60L * 60L * 1000L
    private const val FUTURE_SKEW_MS = 60L * 60L * 1000L
    private val ISO_DATE = Regex("^\\d{4}-\\d{2}-\\d{2}$")
    private val CURRENCY = Regex("^[A-Z]{3}$")

    fun parse(json: String?): WidgetSnapshot? {
      if (json.isNullOrBlank()) return null
      return try {
        val root = JSONObject(json)
        if (integerOrNull(root, "version") != 1L) return null
        val exponent = integerOrNull(root, "exponent")?.toInt() ?: return null
        if (exponent !in 0..4) return null
        val currency = root.optString("currency", "")
        if (!CURRENCY.matches(currency)) return null
        val todayISO = root.optString("todayISO", "")
        if (!ISO_DATE.matches(todayISO)) return null
        val generatedAt = integerOrNull(root, "generatedAt") ?: return null
        val hidden = root.optBoolean("hidden", false)

        val last7 = ArrayList<Long?>()
        val week = root.optJSONArray("last7Minor")
        if (week != null) {
          for (i in 0 until week.length()) last7.add(integerOrNull(week, i))
        }

        val bills = ArrayList<WidgetBill>()
        val list = root.optJSONArray("bills")
        if (list != null) {
          for (i in 0 until list.length()) {
            val item = list.optJSONObject(i) ?: continue
            val dueISO = item.optString("dueISO", "")
            if (!ISO_DATE.matches(dueISO)) continue
            bills.add(
              WidgetBill(
                title = item.optString("title", "").trim(),
                amountMinor = integerOrNull(item, "amountMinor"),
                estimated = item.optBoolean("estimated", false),
                dueISO = dueISO,
              )
            )
          }
        }

        WidgetSnapshot(
          generatedAt = generatedAt,
          language = if (root.optString("language", "en") == "ar") "ar" else "en",
          todayISO = todayISO,
          currency = currency,
          exponent = exponent,
          hidden = hidden,
          todayMinor = integerOrNull(root, "todayMinor"),
          todayCount = (integerOrNull(root, "todayCount") ?: 0L).coerceIn(0L, 9_999L).toInt(),
          last7Minor = last7,
          leftInBudgetsMinor = integerOrNull(root, "leftInBudgetsMinor"),
          bills = bills,
        )
      } catch (error: Exception) {
        null
      }
    }

    private fun integerOrNull(source: JSONObject, key: String): Long? =
      if (!source.has(key) || source.isNull(key)) null else integral(source.opt(key))

    private fun integerOrNull(source: JSONArray, index: Int): Long? =
      if (source.isNull(index)) null else integral(source.opt(index))

    /** Minor units must be whole numbers; anything else is treated as unknown. */
    private fun integral(value: Any?): Long? = when (value) {
      is Int -> value.toLong()
      is Long -> value
      is Double -> if (!value.isNaN() && !value.isInfinite() && value == Math.floor(value) &&
        Math.abs(value) < 9.0E15) value.toLong() else null
      else -> null
    }
  }
}
