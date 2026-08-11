package expo.modules.notificationreader

import android.app.Notification
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
    try {
      activeNotifications?.forEach { capture(it) }
    } catch (_: Exception) {
      // A listener that dies on connect never captures anything again.
    }
  }

  private fun capture(sbn: StatusBarNotification) {
    try {
      if (sbn.packageName == packageName) return
      // Notification access is device-wide. Exact package identity is the
      // security boundary that keeps chats, shops and an app imitating a bank
      // alert out of both the encrypted queue and the launch parser.
      if (!TrustedBankNotificationPackages.isTrusted(this, sbn.packageName)) return
      val extras = sbn.notification.extras
      val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
      val text = (
        extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
          ?: extras.getCharSequence(Notification.EXTRA_TEXT)
        )?.toString() ?: ""
      // A bank alert is short. Refuse pathological payloads rather than
      // truncating them into a different message or allowing another app to
      // fill the encrypted queue with multi-megabyte notifications.
      if (title.length > MAX_TITLE_CHARS || text.length > MAX_TEXT_CHARS) return
      val body = "$title $text".trim()
      if (body.isEmpty() || SensitiveNotificationFilter.shouldReject(body) ||
        !MONEY_RE.containsMatchIn(body)) return

      NotificationCaptureStore.append(
        context = this,
        pkg = sbn.packageName,
        title = title,
        text = text,
        ts = sbn.postTime,
      )
    } catch (_: Exception) {
      // Never crash the listener; a dropped notification is recoverable, a
      // dead listener is not.
    }
  }

  companion object {
    private const val MAX_TITLE_CHARS = 512
    private const val MAX_TEXT_CHARS = 4096

    // Arabic writes the currency on either side of the figure and spells it
    // out ("150.00 درهم"), so a bank app posting in Arabic passed none of the
    // prefix-only tests and every one of its notifications was dropped here,
    // before anything downstream could see it.
    val MONEY_RE = Regex(
      "(?:AED|Dhs?|SAR|SR|QAR|KWD|BHD|OMR|EGP|INR|PKR|PHP|USD|EUR|GBP|CAD|AUD|JPY|CNY|CHF|TRY|GHS|د\\.إ|ر\\.س|درهم|ريال)\\s*[0-9]" +
        "|[0-9]\\s*(?:د\\.إ|ر\\.س|درهم|ريال)",
      RegexOption.IGNORE_CASE
    )
  }
}
