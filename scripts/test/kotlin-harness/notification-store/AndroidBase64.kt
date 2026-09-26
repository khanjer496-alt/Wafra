// Off-device stand-in for android.util.Base64, just enough for NotificationCaptureStore to
// compile and run under kotlin-regex.test.js (when kotlinc is available).
// Test-only; never packaged. See NotificationCaptureStoreCheck.kt.
package android.util
object Base64 {
  const val NO_WRAP = 2
  const val URL_SAFE = 8
  fun encodeToString(b: ByteArray, flags: Int): String =
    if (flags and URL_SAFE != 0) java.util.Base64.getUrlEncoder().encodeToString(b) else java.util.Base64.getEncoder().encodeToString(b)
  fun decode(s: String, flags: Int): ByteArray = java.util.Base64.getDecoder().decode(s)
}
