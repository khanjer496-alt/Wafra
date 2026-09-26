// Compile-only stand-ins for the android.content / android.net symbols this
// module reads; see ExpoModulesCoreStub.kt. Never packaged.
package android.content

abstract class Context {
  abstract fun getSystemService(name: String): Any?
  companion object {
    const val POWER_SERVICE: String = "power"
    const val CONNECTIVITY_SERVICE: String = "connectivity"
  }
}
