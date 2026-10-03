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

  /**
   * The single history entry that describes the posting, or null.
   *
   * InboxStyle lines and MessagingStyle messages are a running history: an
   * app that updates one notification re-posts every older alert alongside
   * the new one, so choosing the longest entry re-captured an old charge.
   *
   * - Messages with a real timestamp: the newest one. If several share the
   *   newest timestamp, only one of them that carries an amount.
   * - Otherwise nothing says which entry is newest (InboxStyle order is the
   *   app's choice, not Android's), so do not guess: an entry is used only
   *   when it is the ONLY one that carries an amount.
   */
  fun newest(lines: List<String>, messages: List<Message>, carriesAmount: (String) -> Boolean): String? {
    val timed = messages.filter { it.time > 0L }
    if (timed.isNotEmpty()) {
      val latest = timed.maxOf { it.time }
      val candidates = timed.filter { it.time == latest }.map { it.text }.distinct()
      return candidates.singleOrNull() ?: candidates.filter(carriesAmount).singleOrNull()
    }
    return (lines + messages.map { it.text }).distinct().filter(carriesAmount).singleOrNull()
  }

  /**
   * A group summary only restates its children, each captured on its own —
   * but only while a child is actually visible. An app that posts a summary
   * alone, or whose child was already dismissed, would otherwise lose the
   * alert entirely.
   */
  fun summaryHasVisibleChild(summaryKey: String, groupKey: String?, active: List<Member>): Boolean =
    groupKey != null && active.any { it.key != summaryKey && it.groupKey == groupKey && !it.isSummary }
}
