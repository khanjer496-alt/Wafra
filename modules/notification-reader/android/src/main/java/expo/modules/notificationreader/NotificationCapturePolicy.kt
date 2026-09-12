package expo.modules.notificationreader

import android.content.Context

/** A durable, default-off local admission choice independent of Android access. */
internal object NotificationCapturePolicy {
  private const val PREFS = "wafra_notification_capture_policy_v1"
  private const val ENABLED = "enabled"
  private const val EXPIRES_AT = "expires_at_ms"

  fun isEnabled(context: Context): Boolean {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(ENABLED, false)) return false
    val expiresAt = prefs.getLong(EXPIRES_AT, 0L)
    return expiresAt > System.currentTimeMillis()
  }

  @Synchronized
  fun setEnabled(context: Context, enabled: Boolean, expiresAtMs: Long): Boolean {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val admitted = enabled && expiresAtMs > System.currentTimeMillis()
    val nextExpiry = if (admitted) expiresAtMs else 0L
    val changed = prefs.getBoolean(ENABLED, false) != admitted ||
      prefs.getLong(EXPIRES_AT, 0L) != nextExpiry
    if (changed && !prefs.edit()
        .putBoolean(ENABLED, admitted)
        .putLong(EXPIRES_AT, nextExpiry)
        .commit()) {
      throw IllegalStateException("Notification capture choice could not be saved")
    }
    if (!enabled) NotificationCaptureStore.clear(context)
    else if (!admitted) NotificationCaptureStore.clear(context)
    return changed
  }
}
