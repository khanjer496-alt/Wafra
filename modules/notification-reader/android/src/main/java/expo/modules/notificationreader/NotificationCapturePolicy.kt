package expo.modules.notificationreader

import android.content.Context

/** A durable, default-off local admission choice independent of Android access. */
internal object NotificationCapturePolicy {
  private const val PREFS = "wafra_notification_capture_policy_v1"
  // `ENABLED` is the bounded entitlement lease shared by SMS and push. Keep
  // the legacy key so installed users preserve their existing lease.
  private const val ENABLED = "enabled"
  private const val EXPIRES_AT = "expires_at_ms"
  private const val NOTIFICATION_SOURCE_ENABLED = "notification_source_enabled"

  fun isLeaseActive(context: Context): Boolean {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(ENABLED, false)) return false
    val expiresAt = prefs.getLong(EXPIRES_AT, 0L)
    return expiresAt > System.currentTimeMillis()
  }

  /** Notification source choice layered on the shared entitlement lease. */
  fun isEnabled(context: Context): Boolean {
    if (!isLeaseActive(context)) return false
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    // Before source-specific settings existed, an active lease meant push was
    // enabled. Preserve that behavior for upgraded ledgers/native preferences.
    return if (prefs.contains(NOTIFICATION_SOURCE_ENABLED)) {
      prefs.getBoolean(NOTIFICATION_SOURCE_ENABLED, false)
    } else {
      true
    }
  }

  fun expiresAt(context: Context): Long =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(EXPIRES_AT, 0L)

  @Synchronized
  fun setEnabled(context: Context, enabled: Boolean, expiresAtMs: Long): Boolean {
    return setConfiguration(context, enabled, if (enabled) expiresAtMs else 0L)
  }

  /**
   * Persist the shared entitlement lease and push-source choice independently.
   * SMS-only keeps a live lease with `notificationEnabled=false`; the listener
   * then admits nothing while killed-process SMS capture remains authorized.
   */
  @Synchronized
  fun setConfiguration(context: Context, notificationEnabled: Boolean, expiresAtMs: Long): Boolean {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val leaseActive = expiresAtMs > System.currentTimeMillis()
    val pushActive = leaseActive && notificationEnabled
    val nextExpiry = if (leaseActive) expiresAtMs else 0L
    val previousPush = isEnabled(context)
    val changed = prefs.getBoolean(ENABLED, false) != leaseActive ||
      prefs.getLong(EXPIRES_AT, 0L) != nextExpiry ||
      !prefs.contains(NOTIFICATION_SOURCE_ENABLED) ||
      prefs.getBoolean(NOTIFICATION_SOURCE_ENABLED, false) != pushActive
    if (changed && !prefs.edit()
        .putBoolean(ENABLED, leaseActive)
        .putLong(EXPIRES_AT, nextExpiry)
        .putBoolean(NOTIFICATION_SOURCE_ENABLED, pushActive)
        .commit()) {
      throw IllegalStateException("Notification capture choice could not be saved")
    }
    if (previousPush && !pushActive) NotificationCaptureStore.clear(context)
    else if (!leaseActive) NotificationCaptureStore.clear(context)
    return changed
  }
}
