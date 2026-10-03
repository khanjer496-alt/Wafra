package expo.modules.wafrawidgets

import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.text.NumberFormat
import java.util.Locale

internal data class WidgetBill(
  val logoId: String?,
  val title: String,
  val amountMinor: Long?,
  val estimated: Boolean,
  val dueISO: String,
)

internal data class WidgetSpendingCategory(val label: String, val amountMinor: Long?)

/**
 * This month as the Spending tab shows it (src/lib/widget-snapshot.ts,
 * WidgetSpending). Optional in version 1: older snapshots carry none.
 */
internal data class WidgetSpending(
  /** YYYY-MM. */
  val monthKey: String,
  val totalMinor: Long?,
  /** Largest first, at most six. */
  val categories: List<WidgetSpendingCategory>,
  val otherMinor: Long?,
) {
  val month: Int get() = monthKey.substring(5, 7).toInt()
}

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
  /** Sum of the month's budget limits; null without budgets, when hidden, or in older snapshots. */
  val budgetTotalMinor: Long? = null,
  /** Budgets already past their limit. */
  val budgetsOver: Int = 0,
  /** Null in snapshots written before the Spending widget existed. */
  val spending: WidgetSpending? = null,
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

  fun weekTotalMinor(): Long? {
    if (hidden || last7Minor.size != 7) return null
    var total = 0L
    for (value in last7Minor) {
      if (value == null) return null
      total = try { Math.addExact(total, value) } catch (_: ArithmeticException) { return null }
      if (total !in -9_007_199_254_740_991L..9_007_199_254_740_991L) return null
    }
    return total
  }

  companion object {
    val LOGO_IDS = setOf("amazon", "netflix", "spotify", "youtube", "apple", "google", "claude", "github", "notion", "discord", "telegram", "dropbox", "osn", "anghami", "audible", "shahid", "chatgpt", "crunchyroll", "disney", "deezer", "playstation", "xbox", "zoom", "du", "etisalat", "dewa", "sewa", "careem", "talabat", "deliveroo", "noon", "uber", "vercel")
    const val DASH = "—"
    const val MAX_AGE_MS = 36L * 60L * 60L * 1000L
    private const val FUTURE_SKEW_MS = 60L * 60L * 1000L
    private val ISO_DATE = Regex("^\\d{4}-\\d{2}-\\d{2}$")
    private val MONTH_KEY = Regex("^\\d{4}-(0[1-9]|1[0-2])$")
    private const val MAX_SPENDING_CATEGORIES = 6
    private const val MAX_LABEL_LENGTH = 60
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
        // A missing privacy flag falls back to the more private reading, as on iOS.
        val hidden = root.optBoolean("hidden", true)

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
                logoId = item.optString("logoId", "").takeIf { it in LOGO_IDS },
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
          budgetTotalMinor = integerOrNull(root, "budgetTotalMinor"),
          budgetsOver = (integerOrNull(root, "budgetsOver") ?: 0L).coerceIn(0L, 9_999L).toInt(),
          spending = parseSpending(root.optJSONObject("spending")),
        )
      } catch (error: Exception) {
        null
      }
    }

    /** A malformed month is no month: the Spending widget then asks to open Wafra. */
    internal fun parseSpending(source: JSONObject?): WidgetSpending? {
      if (source == null) return null
      val monthKey = source.optString("monthKey", "")
      if (!MONTH_KEY.matches(monthKey)) return null
      val categories = ArrayList<WidgetSpendingCategory>()
      val list = source.optJSONArray("categories")
      if (list != null) {
        for (i in 0 until list.length()) {
          if (categories.size == MAX_SPENDING_CATEGORIES) break
          val item = list.optJSONObject(i) ?: continue
          val label = item.optString("label", "").trim().take(MAX_LABEL_LENGTH)
          if (label.isEmpty()) continue
          categories.add(WidgetSpendingCategory(label, integerOrNull(item, "amountMinor")))
        }
      }
      return WidgetSpending(
        monthKey = monthKey,
        totalMinor = integerOrNull(source, "totalMinor"),
        categories = categories,
        otherMinor = integerOrNull(source, "otherMinor"),
      )
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
