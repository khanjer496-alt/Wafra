// Compile-only stand-ins for the expo-modules-core Kotlin DSL and the two
// Android framework symbols this module uses. Signatures mirror
// node_modules/expo-modules-core/android (SDK 55). Used by typecheck.sh only;
// never packaged (this directory is outside src/main).
package expo.modules.kotlin.modules

class ModuleDefinitionData

class AppContext {
  val reactContext: android.content.Context? = null
}

abstract class Module {
  val appContext: AppContext = AppContext()
  abstract fun definition(): ModuleDefinitionData
}

class ModuleDefinitionBuilder {
  fun Name(name: String) {}
  fun AsyncFunction(name: String) = expo.modules.kotlin.functions.AsyncFunctionBuilder(name)
  inline fun <reified R, reified P0> AsyncFunction(name: String, crossinline body: (p0: P0) -> R): Any = Unit
  inline fun OnDestroy(crossinline body: () -> Unit) {}
}

inline fun Module.ModuleDefinition(crossinline block: ModuleDefinitionBuilder.() -> Unit): ModuleDefinitionData =
  ModuleDefinitionData()
