package expo.modules.notificationreader

import android.content.Context
import android.os.SystemClock
import android.provider.Settings

/** Local time evidence, separate from SMS, bank records and Google Play purchases. */
internal object ComplimentaryClock {
  private const val PREFS = "wafra_complimentary_clock_v1"
  private const val MAX_MS = 900_000L
  private fun boot(context: Context) = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)

  fun remainingFor(expected: Long, issued: Long, anchored: Long, current: Long, budget: Long, boot: Int, currentBoot: Int): Long {
    if (expected <= 0 || issued != expected || anchored < 0 || current < anchored || budget !in 1..MAX_MS || boot < 0 || boot != currentBoot) return 0
    return (budget - (current - anchored)).coerceAtLeast(0)
  }

  fun anchor(context: Context, issued: Long, budget: Long): Boolean = try {
    val currentBoot = boot(context)
    issued > 0 && budget in 1..MAX_MS && currentBoot >= 0 &&
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putLong("issued", issued).putLong("elapsed", SystemClock.elapsedRealtime())
        .putLong("budget", budget).putInt("boot", currentBoot).commit()
  } catch (_: Exception) { false }

  fun remaining(context: Context, issued: Long): Long = try {
    val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    remainingFor(issued, p.getLong("issued", 0), p.getLong("elapsed", -1), SystemClock.elapsedRealtime(),
      p.getLong("budget", 0), p.getInt("boot", -1), boot(context))
  } catch (_: Exception) { 0 }

  fun clear(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit()
}
