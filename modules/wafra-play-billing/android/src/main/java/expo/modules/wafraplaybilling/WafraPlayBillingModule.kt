package expo.modules.wafraplaybilling

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

class WafraPlayBillingModule : Module() {
  private val queries by lazy {
    SubscriptionQuery(AndroidSubscriptionClient.MainScheduler()) {
      val context = appContext.reactContext?.applicationContext ?: throw IllegalStateException()
      AndroidSubscriptionClient(context)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("WafraPlayBilling")
    AsyncFunction("querySubscriptions") Coroutine { ->
      withContext(Dispatchers.Main.immediate) {
        suspendCancellableCoroutine<Map<String, Any?>> { continuation ->
          val ticket = queries.query { result ->
            if (continuation.isActive) continuation.resume(result.toMap())
          }
          continuation.invokeOnCancellation { queries.cancel(ticket) }
        }
      }
    }
    OnDestroy { queries.destroy() }
  }
}
