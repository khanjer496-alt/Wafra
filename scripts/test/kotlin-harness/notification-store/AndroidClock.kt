package android.os

// Manually advanced by JVM tests; independent of the wall clock.
object SystemClock {
  var now = 1000L
  fun elapsedRealtime(): Long = now
}
