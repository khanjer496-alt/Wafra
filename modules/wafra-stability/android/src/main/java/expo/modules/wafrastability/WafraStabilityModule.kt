package expo.modules.wafrastability

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WafraStabilityModule : Module() {
  private fun reasonName(reason: Int): String = when (reason) {
    ApplicationExitInfo.REASON_ANR -> "anr"
    ApplicationExitInfo.REASON_CRASH -> "crash"
    ApplicationExitInfo.REASON_CRASH_NATIVE -> "native-crash"
    ApplicationExitInfo.REASON_LOW_MEMORY -> "low-memory"
    ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "excessive-resource-usage"
    ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "dependency-died"
    ApplicationExitInfo.REASON_USER_REQUESTED -> "user-requested"
    ApplicationExitInfo.REASON_USER_STOPPED -> "user-stopped"
    ApplicationExitInfo.REASON_SIGNALED -> "signaled"
    ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "permission-change"
    ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "initialization-failure"
    ApplicationExitInfo.REASON_OTHER -> "other"
    else -> "unknown"
  }

  override fun definition() = ModuleDefinition {
    Name("WafraStability")

    AsyncFunction("getHistoricalExits") { requestedLimit: Int ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
        return@AsyncFunction emptyList<Map<String, Any>>()
      }
      val context = appContext.reactContext
        ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val limit = requestedLimit.coerceIn(1, 20)
      manager.getHistoricalProcessExitReasons(null, 0, limit).map { info ->
        // Deliberately omit description, process name and trace. They are not
        // needed to distinguish ANR/crash/low-memory classes and could contain
        // free-form OEM/app text. These fixed numeric fields are source-free.
        mapOf(
          "timestamp" to info.timestamp.toDouble(),
          "reason" to reasonName(info.reason),
          "importance" to info.importance,
          "status" to info.status,
          "pssBytes" to info.pss.toDouble(),
          "rssBytes" to info.rss.toDouble(),
        )
      }
    }
  }
}
