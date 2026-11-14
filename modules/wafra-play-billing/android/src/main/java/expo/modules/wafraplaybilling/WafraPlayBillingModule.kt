package expo.modules.wafraplaybilling

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

class WafraPlayBillingModule : Module() {
  private fun newQueries(recoverAcknowledgements: Boolean) =
    SubscriptionQuery(AndroidSubscriptionClient.MainScheduler()) {
      val context = appContext.reactContext?.applicationContext ?: throw IllegalStateException()
      AndroidSubscriptionClient(context, recoverAcknowledgements)
    }

  private val queries by lazy { newQueries(false) }
  private val acknowledgements by lazy { newQueries(true) }

  private suspend fun query(queue: SubscriptionQuery): Map<String, Any?> =
    withContext(Dispatchers.Main.immediate) {
      suspendCancellableCoroutine { continuation ->
        val ticket = queue.query { result ->
          if (continuation.isActive) continuation.resume(result.toMap())
        }
        continuation.invokeOnCancellation { queue.cancel(ticket) }
      }
    }

  override fun definition() = ModuleDefinition {
    Name("WafraPlayBilling")
    AsyncFunction("querySubscriptions") Coroutine { -> query(queries) }
    // JS must grant and durably save the queried Pro entitlement before invoking this.
    // Purchase tokens are queried and acknowledged entirely on the native side.
    AsyncFunction("acknowledgeSubscriptions") Coroutine { -> query(acknowledgements) }
    OnDestroy { queries.destroy(); acknowledgements.destroy() }
  }
}
