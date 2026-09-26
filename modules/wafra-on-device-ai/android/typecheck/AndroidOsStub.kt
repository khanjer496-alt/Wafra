// Compile-only stand-in for android.os.Build; see ExpoModulesCoreStub.kt.
package android.os

object Build {
  object VERSION {
    @JvmField val SDK_INT: Int = 0
  }
  object VERSION_CODES {
    const val O: Int = 26
  }
}

class PowerManager {
  val isPowerSaveMode: Boolean = false
}
