// Compile-only stand-ins; see ExpoModulesCoreStub.kt.
package expo.modules.kotlin.functions

class AsyncFunctionBuilder(val name: String) {
  inline fun <reified R> SuspendBody(crossinline block: suspend () -> R): Any = Unit
  inline fun <reified R, reified P0, reified P1, reified P2, reified P3, reified P4, reified P5, reified P6> SuspendBody(
    crossinline block: suspend (P0, P1, P2, P3, P4, P5, P6) -> R,
  ): Any = Unit
}

inline infix fun <reified R> AsyncFunctionBuilder.Coroutine(crossinline block: suspend () -> R) = SuspendBody(block)
inline infix fun <reified R, reified P0, reified P1, reified P2, reified P3, reified P4, reified P5, reified P6> AsyncFunctionBuilder.Coroutine(
  crossinline block: suspend (P0, P1, P2, P3, P4, P5, P6) -> R,
) = SuspendBody(block)
