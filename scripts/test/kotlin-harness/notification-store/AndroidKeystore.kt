// Off-device stand-in for android.security.keystore, just enough for NotificationCaptureStore to
// compile and run under kotlin-regex.test.js (when kotlinc is available).
// Test-only; never packaged. See NotificationCaptureStoreCheck.kt.
package android.security.keystore
object KeyProperties {
  const val KEY_ALGORITHM_AES = "AES"
  const val PURPOSE_ENCRYPT = 1
  const val PURPOSE_DECRYPT = 2
  const val BLOCK_MODE_GCM = "GCM"
  const val ENCRYPTION_PADDING_NONE = "NoPadding"
}
class KeyGenParameterSpec(val alias: String) : java.security.spec.AlgorithmParameterSpec {
  class Builder(val alias: String, purposes: Int) {
    fun setBlockModes(vararg m: String) = this
    fun setEncryptionPaddings(vararg m: String) = this
    fun setKeySize(n: Int) = this
    fun build() = KeyGenParameterSpec(alias)
  }
}
