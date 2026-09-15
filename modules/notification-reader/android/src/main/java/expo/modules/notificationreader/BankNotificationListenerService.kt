package expo.modules.notificationreader

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Captures bank-app transaction notifications (banks are shifting from SMS to
 * push alerts). Only bounded notifications whose text contains a supported
 * money marker are retained as candidates. Entries go to a small, expiring
 * AndroidKeyStore-encrypted queue that the app acknowledges only after its
 * ledger/review write is durable.
 */
class BankNotificationListenerService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    capture(sbn)
  }

  /**
   * Sweep whatever is already in the shade the moment access is granted.
   *
   * Without this, turning the permission on captured nothing that had already
   * arrived — a charge from an hour ago was unreachable even though its
   * notification was still sitting there, and there is no other record of it
   * because the bank never sent an SMS. A user granted access specifically to
   * recover a transaction and got nothing back.
   *
   * Only what is still posted can be read; anything swiped away is gone for
   * good. This also runs after every reboot and whenever Android restarts the
   * service, which is exactly when re-reading is free — the dedupe on drain
   * already handles seeing the same notification twice.
   */
  override fun onListenerConnected() {
    connected = this
    sweepActiveNotifications()
  }

  override fun onListenerDisconnected() {
    if (connected === this) connected = null
  }

  private fun sweepActiveNotifications() {
    try {
      activeNotifications?.forEach { capture(it) }
    } catch (_: Exception) {
      // A listener that dies on connect never captures anything again.
    }
  }

  private fun capture(sbn: StatusBarNotification) {
    val adcb = sbn.packageName == "com.adcb.nexgen" || sbn.packageName == "com.adcb.bank"
    try {
      if (sbn.packageName == packageName) return
      if (!NotificationCapturePolicy.isEnabled(this)) return
      recordAdmission("active", adcb)
      val extras = sbn.notification.extras
      val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
      val trustedPackage = TrustedBankNotificationPackages.isTrusted(this, sbn.packageName)
      // Banks do not all populate EXTRA_TEXT. Some OEM-rendered notifications
      // put the visible body in BIG_TEXT, TEXT_LINES or SUB_TEXT instead. Read
      // the same bounded textual surfaces Android itself renders so a visible
      // ADCB charge cannot be dropped merely because it chose another standard
      // Notification field.
      val textCandidates = mutableListOf<String>()
      fun addText(value: Any?, depth: Int = 0) {
        if (value == null || depth > MAX_TEXT_NESTING || textCandidates.size >= MAX_TEXT_CANDIDATES) return
        when (value) {
          is CharSequence -> {
            val candidate = value.toString().trim()
            if (candidate.isNotEmpty() && candidate.length <= MAX_TEXT_CHARS &&
                !textCandidates.contains(candidate)) {
              textCandidates.add(candidate)
            }
          }
          is Bundle -> value.keySet().take(MAX_NESTED_KEYS).forEach { key ->
            addText(value.get(key), depth + 1)
          }
          is Array<*> -> value.take(MAX_NESTED_KEYS).forEach { addText(it, depth + 1) }
          is Iterable<*> -> value.take(MAX_NESTED_KEYS).forEach { addText(it, depth + 1) }
        }
      }

      // Public Notification fields first. These cover ordinary, BigTextStyle,
      // InboxStyle and MessagingStyle notifications across AOSP and most OEMs.
      addText(extras.getCharSequence(Notification.EXTRA_BIG_TEXT))
      addText(extras.getCharSequence(Notification.EXTRA_TEXT))
      addText(extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES))
      addText(extras.getCharSequence(Notification.EXTRA_SUB_TEXT))
      addText(extras.getCharSequence(Notification.EXTRA_INFO_TEXT))
      addText(extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT))
      addText(extras.getCharSequence(Notification.EXTRA_TITLE_BIG))
      addText(extras.get(Notification.EXTRA_MESSAGES))
      addText(extras.get(Notification.EXTRA_HISTORIC_MESSAGES))
      addText(sbn.notification.tickerText)

      // ColorOS/OxygenOS bank notifications can render the visible transaction
      // from a vendor text/message extra instead of EXTRA_TEXT/BIG_TEXT. For an
      // exact curated bank package we can safely inspect bounded textual extras
      // whose key itself says it is display text. Unknown Play apps do NOT get
      // this broader surface; they still need the ordinary money gate below.
      val standardCandidateCount = textCandidates.size
      if (trustedPackage) {
        extras.keySet()
          .asSequence()
          .filter { key -> looksLikeTextExtraKey(key) }
          .take(MAX_EXTRA_KEYS)
          .forEach { key -> addText(extras.get(key)) }
      }
      // ColorOS can expose several populated standard fields for the same
      // notification. ADCB's first non-blank field is not necessarily the
      // visible charge body. Prefer the bounded field that actually carries a
      // money amount; otherwise retain the old first-nonblank fallback.
      val nonBlankTextCandidates = textCandidates.filter { it.isNotBlank() }
      val moneyCandidate = nonBlankTextCandidates
        .filter { MONEY_RE.containsMatchIn(it) }
        .maxByOrNull { it.length }
      if (moneyCandidate != null && textCandidates.indexOf(moneyCandidate) >= standardCandidateCount) {
        recordAdmission("extendedMoneySurface", adcb)
      }
      val contextCandidate = nonBlankTextCandidates
        .filter { candidate ->
          candidate != moneyCandidate && !MONEY_RE.containsMatchIn(candidate) &&
            POSTING_CONTEXT_RE.containsMatchIn(candidate)
        }
        .maxByOrNull { it.length }
      val reconstructed = if (trustedPackage && moneyCandidate != null &&
          !POSTING_CONTEXT_RE.containsMatchIn(moneyCandidate) && contextCandidate != null) {
        listOf(contextCandidate, moneyCandidate).distinct().joinToString(" ")
      } else null
      if (reconstructed != null && reconstructed.length <= MAX_TEXT_CHARS) {
        recordAdmission("composedMoneySurface", adcb)
      }
      val composite = nonBlankTextCandidates.distinct().joinToString("\n")
      val text = reconstructed?.takeIf { it.length <= MAX_TEXT_CHARS }
        ?: moneyCandidate
        ?: composite.takeIf { trustedPackage && it.length <= MAX_TEXT_CHARS && it.isNotBlank() }
        ?: nonBlankTextCandidates.firstOrNull()
        ?: ""
      // A bank alert is short. Refuse pathological payloads rather than
      // truncating them into a different message or allowing another app to
      // fill the encrypted queue with multi-megabyte notifications.
      if (title.length > MAX_TITLE_CHARS || text.length > MAX_TEXT_CHARS) {
        recordAdmission("tooLong", adcb)
        return
      }
      // Security rejection considers every textual surface, not only the one
      // selected for parsing, so an OTP/security warning cannot be hidden in a
      // secondary Android notification field.
      val body = (listOf(title) + nonBlankTextCandidates).joinToString(" ").trim()
      if (body.isEmpty()) {
        recordAdmission("emptyBody", adcb)
        return
      }
      recordAdmission("body", adcb)
      if (SensitiveNotificationFilter.shouldReject(body)) {
        recordAdmission("securityRejected", adcb)
        return
      }
      recordAdmission("securityPassed", adcb)
      // Resolve package trust before applying the cheap money heuristic. Exact
      // curated bank packages already crossed Android's package-identity boundary
      // and the security filter above; their wording belongs to the real parser,
      // not this deliberately incomplete native regex. ADCB, for example, can
      // render a real charge in a standard Notification field whose currency
      // formatting does not match MONEY_RE. Dropping it here made the parser
      // impossible to improve because JS never saw the encrypted candidate.
      //
      // Unknown Google Play financial candidates remain review-only and still
      // require MONEY_RE. That keeps arbitrary apps from filling the bounded
      // encrypted queue merely by using financial vocabulary.
      val sourceClass = TrustedBankNotificationPackages.sourceClass(this, sbn.packageName, body)
      if (sourceClass == null) {
        recordAdmission("sourceRejected", adcb)
        return
      }
      recordAdmission("sourcePassed", adcb)
      if (sourceClass != TrustedBankNotificationPackages.SOURCE_TRUSTED_BANK &&
          !MONEY_RE.containsMatchIn("$title $text")) {
        recordAdmission("moneyRejected", adcb)
        return
      }
      if (sourceClass == TrustedBankNotificationPackages.SOURCE_TRUSTED_BANK &&
          !MONEY_RE.containsMatchIn("$title $text")) {
        recordAdmission("moneyHeuristicBypassed", adcb)
      }
      recordAdmission("moneyPassed", adcb)

      val blockReason = NotificationCaptureStore.admissionBlockReason(
        this, sbn.packageName, text, sbn.postTime,
      )
      if (blockReason != null) {
        recordAdmission(blockReason, adcb)
        return
      }
      recordAdmission("appendAttempted", adcb)

      NotificationCaptureStore.append(
        context = this,
        pkg = sbn.packageName,
        title = title,
        text = text,
        ts = sbn.postTime,
      )
      recordAdmission("appendSucceeded", adcb)
      // Source-free wake-up only. The encrypted queue remains the source of
      // truth, and a backgrounded/killed JS runtime simply catches up on resume.
      NotificationReaderModule.notifyQueueChanged()
      scheduleHeadlessCapture(sbn.postTime)
    } catch (_: Exception) {
      recordAdmission("exception", adcb)
      // Never crash the listener; a dropped notification is recoverable, a
      // dead listener is not.
    }
  }

  private fun scheduleHeadlessCapture(observedAt: Long) {
    // Android can temporarily mark a process as foreground-important while it
    // delivers this listener callback even when no Wafra Activity is visible.
    // Always issue the event wake; JS AppState is the authoritative UI check
    // and exits immediately when the mounted app already owns the live drain.
    try {
      startService(
        Intent()
          .setClassName(packageName, LIVE_CAPTURE_SERVICE)
          .putExtra("source", LIVE_CAPTURE_SOURCE)
          .putExtra("observedAt", observedAt),
      )
    } catch (_: Exception) {
      // The encrypted native row remains available for foreground recovery.
    }
  }

  companion object {
    @Volatile private var connected: BankNotificationListenerService? = null
    private val diagnosticLock = Any()
    private val admissionCounts = mutableMapOf<String, Int>()
    private val adcbAdmissionCounts = mutableMapOf<String, Int>()

    private const val LIVE_CAPTURE_SERVICE = "expo.modules.smsreader.LiveCaptureHeadlessService"
    private const val LIVE_CAPTURE_SOURCE = "push"

    private fun recordAdmission(stage: String, adcb: Boolean) = synchronized(diagnosticLock) {
      admissionCounts[stage] = (admissionCounts[stage] ?: 0) + 1
      if (adcb) adcbAdmissionCounts[stage] = (adcbAdmissionCounts[stage] ?: 0) + 1
    }

    fun resetAdmissionDiagnostics() = synchronized(diagnosticLock) {
      admissionCounts.clear()
      adcbAdmissionCounts.clear()
    }

    fun admissionDiagnostics(): Map<String, Any> = synchronized(diagnosticLock) {
      mapOf(
        "admissionCounts" to admissionCounts.toMap(),
        "adcbAdmissionCounts" to adcbAdmissionCounts.toMap(),
      )
    }

    /** A user returning from Settings may enable capture after the listener connected. */
    fun sweepConnected() { connected?.sweepActiveNotifications() }

    /**
     * Foreground recovery for OEMs that granted access but later killed the
     * listener process. If connected, recover shade alerts immediately. If not,
     * ask Android to bind the listener again; onListenerConnected() performs the
     * sweep as soon as the system completes that bind.
     */
    fun sweepOrRequestRebind(context: Context): Boolean {
      val listener = connected
      if (listener != null) {
        listener.sweepActiveNotifications()
        return true
      }
      try {
        requestRebind(ComponentName(context, BankNotificationListenerService::class.java))
      } catch (_: Exception) {
        // The next Android lifecycle callback or app foreground can retry.
      }
      return false
    }

    /** Whether Android has actually bound the listener process right now. */
    fun isConnected(): Boolean = connected != null

    /** Source-free visibility snapshot for Settings diagnostics. */
    fun visibilityDiagnostics(context: Context): Map<String, Any> {
      val listener = connected ?: return mapOf(
        "listenerConnected" to false,
        "activeNotificationCount" to 0,
        "trustedBankVisibleCount" to 0,
        "adcbVisible" to false,
        "adcbActiveCount" to 0,
      )
      val active = try { listener.activeNotifications?.toList() ?: emptyList() }
      catch (_: Exception) { emptyList() }
      return mapOf(
        "listenerConnected" to true,
        "activeNotificationCount" to active.size,
        "trustedBankVisibleCount" to active.count {
          TrustedBankNotificationPackages.isTrusted(context, it.packageName)
        },
        "adcbVisible" to active.any {
          it.packageName == "com.adcb.nexgen" || it.packageName == "com.adcb.bank"
        },
        "adcbActiveCount" to active.count {
          it.packageName == "com.adcb.nexgen" || it.packageName == "com.adcb.bank"
        },
      )
    }

    private const val MAX_TITLE_CHARS = 512
    private const val MAX_TEXT_CHARS = 4096
    private const val MAX_TEXT_CANDIDATES = 32
    private const val MAX_EXTRA_KEYS = 64
    private const val MAX_NESTED_KEYS = 16
    private const val MAX_TEXT_NESTING = 2

    private fun looksLikeTextExtraKey(key: String): Boolean {
      val normalized = key.lowercase()
      return normalized.contains("text") ||
        normalized.contains("message") ||
        normalized.contains("summary") ||
        normalized.contains("title") ||
        normalized.contains("content") ||
        normalized.contains("body") ||
        normalized.contains("info")
    }

    // Arabic writes the currency on either side of the figure and spells it
    // out ("150.00 درهم"), so a bank app posting in Arabic passed none of the
    // prefix-only tests and every one of its notifications was dropped here,
    // before anything downstream could see it.
    private val POSTING_CONTEXT_RE = Regex(
      "(?:\\b(?:credit|debit|covered|prepaid|charge)\\s*card\\b|" +
        "\\bcard\\b|\\b(?:purchase|used|spent|debited|credited|transferred|transfer|" +
        "withdraw(?:al)?|payment|paid|refund(?:ed)?|cashback)\\b)",
      RegexOption.IGNORE_CASE,
    )

    val MONEY_RE = Regex(
      // Bank apps commonly concatenate the ISO currency and amount (for
      // example ADCB posts AED181.00). \s* already permits that; keep the
      // currency alternatives explicit so this remains only a cheap native
      // admission gate rather than a second transaction parser.
      "(?:AED|Dhs?|SAR|SR|QAR|KWD|BHD|OMR|EGP|INR|PKR|PHP|USD|EUR|GBP|CAD|AUD|JPY|CNY|CHF|TRY|GHS|د\\.إ|ر\\.س|درهم|ريال)\\s*[0-9]" +
        "|[0-9]\\s*(?:د\\.إ|ر\\.س|درهم|ريال)",
      RegexOption.IGNORE_CASE
    )
  }
}
