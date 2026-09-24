package expo.modules.notificationreader

/**
 * Which part of a notification describes the posting that triggered it.
 *
 * Pure Kotlin with no Android dependency, so it can be compiled and exercised
 * off-device (kotlin-regex.test.js). BankNotificationListenerService turns the
 * Android extras into these plain values.
 */
object NotificationTextSurfaces {
  data class Message(val time: Long, val text: String)

  /** One active notification, reduced to what group handling needs. */
  data class Member(val key: String, val groupKey: String?, val isSummary: Boolean)

  /** What a notification's running history says about the posting that triggered it. */
  sealed class History {
    /** No history, or no entry that could be the posting carries an amount. */
    object Silent : History() {
      override fun toString() = "Silent"
    }

    /** The one entry that describes this posting. */
    data class Newest(val text: String) : History()

    /**
     * Two or more entries carry an amount and nothing says which one is this
     * posting. The caller must not drop the notification on this verdict.
     */
    object Ambiguous : History() {
      override fun toString() = "Ambiguous"
    }
  }

  /**
   * InboxStyle lines and MessagingStyle messages are a running history: an
   * app that updates one notification re-posts every older alert alongside
   * the new one, so choosing the longest entry re-captured an old charge.
   *
   * - Messages with a real timestamp: the newest one. If several share the
   *   newest timestamp, the one of them that carries an amount; two or more
   *   that do are Ambiguous.
   * - Otherwise nothing says which entry is newest (InboxStyle order is the
   *   app's choice, not Android's), so do not guess: an entry is the posting
   *   only when it is the ONLY one that carries an amount; two or more that
   *   do are Ambiguous.
   */
  fun history(lines: List<String>, messages: List<Message>, carriesAmount: (String) -> Boolean): History {
    val timed = messages.filter { it.time > 0L }
    val candidates = if (timed.isNotEmpty()) {
      val latest = timed.maxOf { it.time }
      val newest = timed.filter { it.time == latest }.map { it.text }.distinct()
      newest.singleOrNull()?.let { return History.Newest(it) }
      newest.filter(carriesAmount)
    } else {
      (lines + messages.map { it.text }).distinct().filter(carriesAmount)
    }
    return when (candidates.size) {
      0 -> History.Silent
      1 -> History.Newest(candidates.single())
      else -> History.Ambiguous
    }
  }

  /** The single history entry that describes the posting, or null when [history] is not Newest. */
  fun newest(lines: List<String>, messages: List<Message>, carriesAmount: (String) -> Boolean): String? =
    (history(lines, messages, carriesAmount) as? History.Newest)?.text

  /**
   * A group summary only restates its children, each captured on its own —
   * but only while a child is actually visible. An app that posts a summary
   * alone, or whose child was already dismissed, would otherwise lose the
   * alert entirely.
   */
  fun summaryHasVisibleChild(summaryKey: String, groupKey: String?, active: List<Member>): Boolean =
    groupKey != null && active.any { it.key != summaryKey && it.groupKey == groupKey && !it.isSummary }
}
