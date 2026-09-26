package expo.modules.wafraondeviceai

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.PowerManager
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.withTimeout

/**
 * Advisory platform language model for Android: Gemini Nano via the ML Kit
 * GenAI Prompt API (AICore, on device). Below API 26 the module reports
 * `unsupported-os` and never loads an ML Kit class.
 */
class WafraOnDeviceAIModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private val active = HashMap<String, Deferred<String>>()
  private var engineInstance: GeminiNanoEngine? = null

  private fun engine(): GeminiNanoEngine? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
    synchronized(this) {
      return engineInstance ?: GeminiNanoEngine().also { engineInstance = it }
    }
  }

  private fun availabilityMap(availability: NanoAvailability): Map<String, Any> = mapOf(
    "status" to availability.status,
    "provider" to PROVIDER,
    "canPrepare" to availability.canPrepare,
  )

  private fun unsupportedOs(): Map<String, Any> = mapOf("status" to "unsupported-os", "canPrepare" to false)

  private fun failure(code: String) = CodedException(code, code, null)

  override fun definition() = ModuleDefinition {
    Name("WafraOnDeviceAI")

    AsyncFunction("getAvailability") Coroutine { ->
      val engine = engine() ?: return@Coroutine unsupportedOs()
      availabilityMap(engine.availability())
    }

    AsyncFunction("prepare") Coroutine { ->
      val engine = engine() ?: return@Coroutine unsupportedOs()
      availabilityMap(engine.prepare(scope))
    }

    AsyncFunction("respond") Coroutine { requestId: String, task: String, instructions: String, prompt: String,
      schemaJson: String, maxTokens: Int, timeoutMs: Int ->
      val engine = engine() ?: throw failure("ERR_ON_DEVICE_AI_UNAVAILABLE")
      val schema = ClosedSchema.parse(schemaJson)
      if (schema == null || task !in ALLOWED_TASKS || requestId.isEmpty() ||
        requestId.length > 64 || prompt.isEmpty() || prompt.length > MAX_PROMPT_CHARACTERS ||
        instructions.length > MAX_PROMPT_CHARACTERS || maxTokens !in 16..1024 || timeoutMs !in 500..60_000) {
        throw failure("ERR_ON_DEVICE_AI_INVALID_REQUEST")
      }
      // Separate scope: cancelling a request never cancels the bridge call's
      // own coroutine, so the promise always settles with a fixed code.
      val work = synchronized(active) {
        if (active.isNotEmpty()) throw failure("ERR_ON_DEVICE_AI_BUSY")
        scope.async { engine.generate(instructions, prompt, schema, maxTokens) }.also { active[requestId] = it }
      }
      try {
        withTimeout(timeoutMs.toLong()) { work.await() }
      } catch (_: TimeoutCancellationException) {
        work.cancel()
        throw failure("ERR_ON_DEVICE_AI_TIMEOUT")
      } catch (error: CancellationException) {
        if (work.isCancelled) throw failure("ERR_ON_DEVICE_AI_CANCELLED")
        throw error
      } catch (error: OnDeviceAIFailure) {
        throw failure(error.code)
      } catch (_: Exception) {
        throw failure("ERR_ON_DEVICE_AI_GENERATION_FAILED")
      } finally {
        if (work.isActive) work.cancel()
        synchronized(active) { active.remove(requestId) }
      }
    }

    // Background model work is skipped in Battery Saver.
    AsyncFunction("getPowerState") Coroutine { ->
      mapOf("lowPowerMode" to lowPowerMode())
    }

    // "Wi-Fi only" downloads. Reads OS connectivity state; sends nothing.
    AsyncFunction("getNetworkType") Coroutine { ->
      networkType()
    }

    AsyncFunction("cancel") { requestId: String ->
      synchronized(active) { active[requestId] }?.cancel()
      Unit
    }

    OnDestroy {
      scope.cancel()
      engineInstance?.close()
    }
  }

  private fun context(): Context? = appContext.reactContext

  private fun lowPowerMode(): Boolean = try {
    (context()?.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isPowerSaveMode == true
  } catch (_: Exception) {
    false
  }

  /**
   * "wifi" for Wi-Fi or Ethernet that is not metered, "cellular" for
   * cellular or a metered network, "none" offline, "unknown" otherwise.
   */
  private fun networkType(): String = try {
    val manager = context()?.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    val network = manager?.activeNetwork
    val caps = if (network != null) manager?.getNetworkCapabilities(network) else null
    when {
      manager == null -> "unknown"
      network == null || caps == null -> "none"
      (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) &&
        caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) -> "wifi"
      caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
        !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) -> "cellular"
      else -> "unknown"
    }
  } catch (_: Exception) {
    "unknown"
  }

  private companion object {
    const val PROVIDER = "gemini-nano"
    const val MAX_PROMPT_CHARACTERS = 6_000
    /** `alert-read` pre-fills a Review item; its output is gated in JavaScript and never posts. */
    val ALLOWED_TASKS = setOf("ask-plan", "categorize", "alert-read")
  }
}
