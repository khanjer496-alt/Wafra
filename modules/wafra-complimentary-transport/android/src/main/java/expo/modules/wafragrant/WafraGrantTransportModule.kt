package expo.modules.wafragrant

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class WafraGrantTransportModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WafraGrantTransport")
    AsyncFunction("verify") Coroutine { code: String ->
      withContext(Dispatchers.IO) { GrantTransport.verify(code) }
    }
  }
}
