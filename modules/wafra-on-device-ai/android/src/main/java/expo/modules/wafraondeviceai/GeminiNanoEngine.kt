package expo.modules.wafraondeviceai

import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.GenAiException
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerativeModel
import com.google.mlkit.genai.prompt.TextPart
import com.google.mlkit.genai.prompt.generateContentRequest
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.takeWhile
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

internal data class NanoAvailability(val status: String, val canPrepare: Boolean)

/** Thrown with a fixed code; never carries prompt or model text. */
internal class OnDeviceAIFailure(val code: String) : Exception(code)

/**
 * Gemini Nano through the ML Kit GenAI Prompt API. Inference runs in Android
 * AICore on the phone. Only constructed on API 26+ (the library's minSdk):
 * this class is the only place that references ML Kit types.
 */
internal class GeminiNanoEngine {
  private val model: GenerativeModel by lazy { Generation.getClient() }

  suspend fun availability(): NanoAvailability = try {
    when (model.checkStatus()) {
      FeatureStatus.AVAILABLE -> NanoAvailability("available", false)
      FeatureStatus.DOWNLOADABLE -> NanoAvailability("model-not-ready", true)
      FeatureStatus.DOWNLOADING -> NanoAvailability("model-not-ready", false)
      // UNAVAILABLE: unsupported device, or AICore has not yet fetched a
      // configuration that supports it.
      else -> NanoAvailability("device-not-eligible", false)
    }
  } catch (error: GenAiException) {
    NanoAvailability(statusFor(error.errorCode), false)
  } catch (_: Exception) {
    NanoAvailability("unavailable", false)
  }

  /**
   * Asks AICore to download Gemini Nano. Only ever called from an explicit
   * user action; Wafra never starts this download on its own. The download
   * can take minutes (or wait for Wi-Fi), so it keeps running in [scope] and
   * this returns once AICore reports its first status or after 10 seconds;
   * Ask's focus/app-return refresh reports the final status.
   */
  suspend fun prepare(scope: CoroutineScope): NanoAvailability {
    if (availability().canPrepare) {
      val firstStatus = CompletableDeferred<Unit>()
      scope.launch {
        try {
          model.download()
            .takeWhile { status ->
              firstStatus.complete(Unit)
              status !is DownloadStatus.DownloadCompleted && status !is DownloadStatus.DownloadFailed
            }
            .collect { }
        } catch (_: Exception) {
          // The status below and the next refresh report the outcome.
        } finally {
          firstStatus.complete(Unit)
        }
      }
      withTimeoutOrNull(10_000) { firstStatus.await() }
    }
    return availability()
  }

  suspend fun generate(instructions: String, prompt: String, schema: ClosedSchema, maxTokens: Int): String {
    // beta2 has no separate system instruction; one bounded text part carries
    // the instructions, the closed output contract and the user content.
    val text = instructions + "\n\n" + schema.promptDescription() + "\n" + prompt
    val response = try {
      model.generateContent(
        generateContentRequest(TextPart(text)) {
          temperature = 0f
          topK = 1
          candidateCount = 1
          maxOutputTokens = maxTokens
        },
      )
    } catch (error: GenAiException) {
      throw OnDeviceAIFailure(failureFor(error.errorCode))
    }
    return response.candidates.firstOrNull()?.text
      ?: throw OnDeviceAIFailure("ERR_ON_DEVICE_AI_GENERATION_FAILED")
  }

  fun close() {
    try {
      model.close()
    } catch (_: Exception) {
    }
  }

  private fun statusFor(code: Int): String = when (code) {
    GenAiException.ErrorCode.AICORE_INCOMPATIBLE -> "device-not-eligible"
    GenAiException.ErrorCode.NEEDS_SYSTEM_UPDATE -> "unsupported-os"
    GenAiException.ErrorCode.NOT_AVAILABLE -> "model-not-ready"
    else -> "unavailable"
  }

  private fun failureFor(code: Int): String = when (code) {
    GenAiException.ErrorCode.BUSY, GenAiException.ErrorCode.PER_APP_BATTERY_USE_QUOTA_EXCEEDED,
    GenAiException.ErrorCode.BACKGROUND_USE_BLOCKED -> "ERR_ON_DEVICE_AI_BUSY"
    GenAiException.ErrorCode.REQUEST_TOO_LARGE -> "ERR_ON_DEVICE_AI_TOO_LARGE"
    GenAiException.ErrorCode.CANCELLED -> "ERR_ON_DEVICE_AI_CANCELLED"
    GenAiException.ErrorCode.NOT_AVAILABLE,
    GenAiException.ErrorCode.AICORE_INCOMPATIBLE, GenAiException.ErrorCode.NEEDS_SYSTEM_UPDATE -> "ERR_ON_DEVICE_AI_UNAVAILABLE"
    else -> "ERR_ON_DEVICE_AI_GENERATION_FAILED"
  }
}
