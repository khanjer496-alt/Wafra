package expo.modules.notificationreader

import java.text.Normalizer
import java.util.Locale

/**
 * What makes two bank-app notifications the SAME posting, independent of the
 * bytes each copy happened to carry.
 *
 * The first re-post guard hashed the raw `pkg\0title\0text`. That is only as
 * stable as the listener's surface selection, and the selection is not
 * stable: the listener prefers BIG_TEXT, then TEXT, then the longest
 * money-bearing field among SUB_TEXT/INFO_TEXT/TITLE_BIG/ticker and (for a
 * curated bank) vendor extras, or a composed "context + money" body. One
 * issuer posting the same alert through a different builder — FCM's own
 * display notification vs the bank app's in-process one, a group re-post, a
 * ColorOS vendor surface — reaches append() with a different title or a
 * differently chosen, differently spaced text, even though the shade shows
 * the same words. An ADCB alert re-posted three times reached the ledger
 * twice that way.
 *
 * So the identity is built from the facts every copy must share, read from a
 * whitespace/case/format-normalized union of title and text:
 *
 *   core  = package + every explicit transaction clock WITH SECONDS + the
 *           first money token (the charge) + every masked card/account digit
 *           group + reversal/decline markers
 *   extra = the remaining money tokens (typically the available balance or
 *           limit), which a truncated copy may lack
 *
 * Two copies are one posting when their cores are equal and their extras are
 * equal or one of them has none. Two genuine charges keep different
 * identities: a second charge carries a different second on its clock, and a
 * same-second repeat carries a different balance. No clock with seconds, no
 * identity at all — exactly as before; minute precision cannot separate a
 * terminal double-tap from a redelivery.
 *
 * Pure Kotlin with no Android types, so kotlin-regex.test.js compiles and
 * runs it off-device.
 */
object NotificationRepostIdentity {
  data class Identity(val core: String, val extra: String)

  /**
   * An explicit transaction clock, at SECOND precision.
   *
   * Separator, component width and year width are all cosmetic — ADCB alone
   * sends both `11/09/2026 23:53:12` and `11-02-2025 09:03:37`, and a
   * slash-only pattern silently skipped the guard for half its own corpus.
   * So the date shape follows sms-parser's DATETIME_RE: `[/.-]`, one or two
   * digit day and month, two or four digit year.
   *
   * THE SECONDS ARE NOT COSMETIC and deliberately diverge from that parser.
   * DATETIME_RE only has to READ a transaction's date, where minutes are
   * plenty. This gate decides whether to DISCARD money, and the terminal
   * double-tap — one card, one merchant, one amount, twice inside a minute —
   * is a real duplicate charge the user must see. At minute precision both
   * alerts carry identical text and the second would be dropped as a repost.
   * Seconds are what separate a redelivery of one alert from two real ones.
   *
   * kotlin-regex.test.js pins this source byte-for-byte against the JS copies
   * (auto-import.ts CARRIER_DUPLICATE_DATETIME_RE, dedupe.ts
   * CAPTURE_EVENT_CLOCK_RE).
   */
  val TRANSACTION_DATETIME_RE =
    Regex("""\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\s+\d{1,2}:\d{2}:\d{2}\b""")

  private val FORMAT_CHARS = Regex("""\p{Cf}+""")
  private val SPACES = Regex("""[\s\p{Z}]+""")
  private val CLOCK_PARTS = Regex("""\d+""")
  private val MONEY_BEFORE_RE = Regex(
    """(?<![\p{L}\p{N}])(aed|dhs?|sar|sr|qar|kwd|bhd|omr|egp|inr|pkr|php|usd|eur|gbp|cad|aud|jpy|cny|chf|try|ghs|د\.إ|ر\.س|درهم|ريال)\s*([0-9][0-9,]*(?:\.[0-9]+)?)""",
  )
  private val MONEY_AFTER_RE = Regex("""(?<![0-9.,])([0-9][0-9,]*(?:\.[0-9]+)?)\s*(د\.إ|ر\.س|درهم|ريال)""")
  private val MASKED_DIGITS_RE = Regex("""(?<![\p{L}\p{N}])(?:[x*•#]{2,}|\.{3,})\s?(\d{3,6})(?![0-9])""")
  private val ENDING_DIGITS_RE = Regex("""\bending\s+(?:in\s+|with\s+)?(?:no\.?\s*)?(\d{3,6})(?![0-9])""")
  private val REVERSAL_RE = Regex("""\b(?:revers\w*|refund\w*|chargeback)\b|استرداد|استرجاع|عكس""")
  private val DECLINE_RE = Regex("""\b(?:declin\w*|reject\w*|unsuccessful|fail\w*|cancel\w*)\b|مرفوض|رفض|فشل|إلغاء|الغاء""")

  /** NFKC, ASCII digits, no invisible format characters, single spaces, lower case. */
  fun normalize(value: String): String {
    val folded = Normalizer.normalize(value, Normalizer.Form.NFKC)
    val digits = StringBuilder(folded.length)
    for (ch in folded) {
      digits.append(
        when (ch) {
          in '٠'..'٩' -> '0' + (ch - '٠')
          in '۰'..'۹' -> '0' + (ch - '۰')
          '٫' -> '.'
          '٬' -> ','
          else -> ch
        },
      )
    }
    return digits.toString()
      .replace(FORMAT_CHARS, "")
      .replace(SPACES, " ")
      .trim()
      .lowercase(Locale.ROOT)
  }

  /** `25/09/2026 17:38:39`, `25-9-26 17:38:39` → `25/9/2026 17:38:39`. */
  private fun canonicalClock(value: String): String {
    val parts = CLOCK_PARTS.findAll(value).map { it.value.toInt() }.toList()
    val year = if (parts[2] < 100) parts[2] + 2000 else parts[2]
    return "${parts[0]}/${parts[1]}/$year ${parts[3]}:${parts[4]}:${parts[5]}"
  }

  private fun canonicalNumber(value: String): String {
    var number = value.replace(",", "")
    if (number.contains('.')) number = number.trimEnd('0').trimEnd('.')
    number = number.trimStart('0')
    return if (number.isEmpty() || number.startsWith('.')) "0$number" else number
  }

  private fun canonicalCurrency(value: String): String = when (value) {
    "dh", "dhs", "د.إ", "درهم" -> "aed"
    "sr", "ر.س" -> "sar"
    else -> value
  }

  /** Money tokens in reading order, as `currency:number`. */
  private fun moneyTokens(surface: String): List<String> {
    val found = mutableListOf<Pair<Int, String>>()
    MONEY_BEFORE_RE.findAll(surface).forEach { m ->
      found.add(m.range.first to "${canonicalCurrency(m.groupValues[1])}:${canonicalNumber(m.groupValues[2])}")
    }
    MONEY_AFTER_RE.findAll(surface).forEach { m ->
      found.add(m.range.first to "${canonicalCurrency(m.groupValues[2])}:${canonicalNumber(m.groupValues[1])}")
    }
    return found.sortedBy { it.first }.map { it.second }
  }

  /** The identity of a posting, or null when it states no clock with seconds. */
  fun of(pkg: String, title: String, text: String): Identity? {
    val body = normalize(text)
    val surface = normalize("$title\n$text")
    val clocks = TRANSACTION_DATETIME_RE.findAll(surface).map { canonicalClock(it.value) }.toSortedSet()
    if (clocks.isEmpty()) return null
    val money = moneyTokens(surface)
    if (money.isEmpty()) {
      // No readable amount: fall back to the normalized words themselves,
      // which is still at least as strict as the old byte-exact identity.
      return Identity(listOf("v2-text", pkg, normalize(title), body).joinToString("\u0000"), "")
    }
    val charge = money.first()
    val others = money.drop(1).filter { it != charge }.toSortedSet()
    val cards = (MASKED_DIGITS_RE.findAll(surface).map { it.groupValues[1] } +
      ENDING_DIGITS_RE.findAll(surface).map { it.groupValues[1] }).toSortedSet()
    val markers = buildString {
      if (REVERSAL_RE.containsMatchIn(body)) append('r')
      if (DECLINE_RE.containsMatchIn(body)) append('d')
    }
    return Identity(
      listOf("v2", pkg, clocks.joinToString(","), charge, cards.joinToString(","), markers).joinToString("\u0000"),
      others.joinToString(","),
    )
  }

  /**
   * Whether two receipts describe one posting: the same core, and the same
   * remaining money unless one copy carried none. Empty [extraA]/[extraB]
   * means "none"; the values may be digests of the extras, compared as-is.
   */
  fun samePosting(coreA: String, extraA: String, coreB: String, extraB: String): Boolean =
    coreA == coreB && (extraA.isEmpty() || extraB.isEmpty() || extraA == extraB)
}
