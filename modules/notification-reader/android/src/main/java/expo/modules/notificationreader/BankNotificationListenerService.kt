package expo.modules.notificationreader

import android.app.Notification
import android.content.ComponentName
import android.content.Context
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
      // Banks do not all populate EXTRA_TEXT. Some OEM-rendered notifications
      // put the visible body in BIG_TEXT, TEXT_LINES or SUB_TEXT instead. Read
      // the same bounded textual surfaces Android itself renders so a visible
      // ADCB charge cannot be dropped merely because it chose another standard
      // Notification field.
      val textCandidates = mutableListOf<String>()
      extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.let(textCandidates::add)
      extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.let(textCandidates::add)
      extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
        ?.map { it.toString() }
        ?.filter { it.isNotBlank() }
        ?.let { textCandidates.add(it.joinToString("\n")) }
      extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()?.let(textCandidates::add)
      // ColorOS can expose several populated standard fields for the same
      // notification. ADCB's first non-blank field is not necessarily the
      // visible charge body. Prefer the bounded field that actually carries a
      // money amount; otherwise retain the old first-nonblank fallback.
      val nonBlankTextCandidates = textCandidates.filter { it.isNotBlank() }
      val text = nonBlankTextCandidates.firstOrNull { MONEY_RE.containsMatchIn(it) }
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
      if (!MONEY_RE.containsMatchIn("$title $text")) {
        recordAdmission("moneyRejected", adcb)
        return
      }
      recordAdmission("moneyPassed", adcb)
      // Unknown apps do not become trusted banks merely because their text
      // resembles one. Native intake still requires Google Play provenance;
      // unregistered candidates are carried as review-only source classes.
      if (TrustedBankNotificationPackages.sourceClass(this, sbn.packageName, body) == null) {
        recordAdmission("sourceRejected", adcb)
        return
      }
      recordAdmission("sourcePassed", adcb)

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
    } catch (_: Exception) {
      recordAdmission("exception", adcb)
      // Never crash the listener; a dropped notification is recoverable, a
      // dead listener is not.
    }
  }

  companion object {
    @Volatile private var connected: BankNotificationListenerService? = null
    private val diagnosticLock = Any()
    private val admissionCounts = mutableMapOf<String, Int>()
    private val adcbAdmissionCounts = mutableMapOf<String, Int>()

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

    // Arabic writes the currency on either side of the figure and spells it
    // out ("150.00 درهم"), so a bank app posting in Arabic passed none of the
    // prefix-only tests and every one of its notifications was dropped here,
    // before anything downstream could see it.
    val MONEY_RE = Regex(
      // Bank apps commonly concatenate the ISO currency and amount (for
      // example ADCB posts "AED181.00"). \s* already permits that; keep the
      // currency alternatives explicit so this remains only a cheap native
      // admission gate rather than a second transaction parser.
      "(?:AED|Dhs?|SAR|SR|QAR|KWD|BHD|OMR|EGP|INR|PKR|PHP|USD|EUR|GBP|CAD|AUD|JPY|CNY|CHF|TRY|GHS|د\\.إ|ر\\.س|درهم|ريال)\\s*[0-9]" +
        "|[0-9]\\s*(?:د\\.إ|ر\\.س|درهم|ريال)",
      RegexOption.IGNORE_CASE
    )
  }
}
