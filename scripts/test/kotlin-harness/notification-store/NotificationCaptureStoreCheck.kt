// The REAL NotificationCaptureStore, executed off-device against the stubs in
// this directory (kotlin-regex.test.js compiles it when kotlinc is present).
//
// An owner's ADCB app posted one charge three times; a byte-exact content
// digest let a copy whose title/text surface differed reach the ledger twice.
// These cases drive append()/admissionBlockReason() through that sequence
// and through the genuine-charge cases that must never be suppressed. The
// ADCB text is owner-consented and already masked.
package expo.modules.notificationreader

import android.content.Context
import java.security.Security

private var bad = 0

private fun check(name: String, got: Any?, want: Any?) {
  if (got == want) println("ok   $name") else { bad++; println("FAIL $name -> $got (want $want)") }
}

private fun enabledContext(): Context {
  val context = Context()
  context.getSharedPreferences("wafra_notification_capture_policy_v1", 0).edit()
    .putBoolean("enabled", true)
    .putLong("expires_at_ms", System.currentTimeMillis() + 86_400_000L)
    .putBoolean("notification_source_enabled", true)
    .commit()
  return context
}

fun main() {
  Security.addProvider(harness.MemoryKeyStoreProvider())
  val pkg = "com.adcb.nexgen"
  val alert = "Credit Card XX2518 was used for AED290.00 on 25/09/2026 17:38:39 at SOUTHERN FRIED CHICK, Sharjah-AE. Available limit AED58823.09"
  val t0 = System.currentTimeMillis() - 600_000L
  run {
    val c = enabledContext()
    check("copy 1 is appended", NotificationCaptureStore.append(c, pkg, "ADCBAlert", alert, t0), "appended")
    NotificationCaptureStore.acknowledge(c, NotificationCaptureStore.read(c, 0L).map { it.id }.toSet())
    check("a sweep re-reading acknowledged copy 1", NotificationCaptureStore.append(c, pkg, "ADCBAlert", alert, t0), "acknowledged")
    val spaced = alert.replace(" was used", "\n was  used").replace("AED290.00", "AED 290.00") + " "
    check("copy 2 (title ADCB, other whitespace) is diagnosed as a repost",
      NotificationCaptureStore.admissionBlockReason(c, pkg, "ADCB", spaced, t0 + 160_000), "repost")
    check("copy 2 (title ADCB, other whitespace) is a repost",
      NotificationCaptureStore.append(c, pkg, "ADCB", spaced, t0 + 160_000), "repost")
    check("copy 3 (ticker-style prefix, zero-width space) is a repost",
      NotificationCaptureStore.append(c, pkg, "ADCBAlert", "ADCBAlert: ​$alert", t0 + 300_000), "repost")
    check("a copy cut off before the limit is a repost",
      NotificationCaptureStore.append(c, pkg, "ADCBAlert", alert.substringBefore(". Available"), t0 + 310_000), "repost")
    check("a genuine second charge (another second) is appended",
      NotificationCaptureStore.append(c, pkg, "ADCBAlert", alert.replace("17:38:39", "17:39:02"), t0 + 23_000), "appended")
    check("a same-second repeat whose limit moved is appended",
      NotificationCaptureStore.append(c, pkg, "ADCBAlert", alert.replace("58823.09", "58533.09"), t0 + 25_000), "appended")
    check("another package with the same words is appended",
      NotificationCaptureStore.append(c, "com.other.bank", "ADCBAlert", alert, t0 + 26_000), "appended")
    check("a re-post beyond the 30-minute window is appended",
      NotificationCaptureStore.append(c, pkg, "ADCBAlert", alert, t0 + 31 * 60_000L), "appended")
  }
  run {
    val c = enabledContext()
    val noSeconds = alert.replace("17:38:39", "17:38")
    check("no seconds: the first copy is appended", NotificationCaptureStore.append(c, pkg, "ADCBAlert", noSeconds, t0), "appended")
    check("no seconds: an identical later copy is still appended",
      NotificationCaptureStore.append(c, pkg, "ADCBAlert", noSeconds, t0 + 60_000), "appended")
    check("the same posted notification unchanged is a duplicate",
      NotificationCaptureStore.append(c, pkg, "ADCBAlert", noSeconds, t0), "duplicate")
    check("the same posted notification with a better surface is repaired",
      NotificationCaptureStore.append(c, pkg, "ADCBAlert", alert, t0), "repaired")
    check("a repaired row guards against re-posts of its healed text",
      NotificationCaptureStore.append(c, pkg, "ADCB", alert, t0 + 90_000), "repost")
  }
  run {
    val c = enabledContext()
    NotificationCaptureStore.append(c, pkg, "ADCBAlert", alert.replace("XX2518", "XX1111"), t0)
    check("another card's receipt does not suppress this charge",
      NotificationCaptureStore.append(c, pkg, "ADCBAlert", alert, t0 + 1_000), "appended")
    NotificationCaptureStore.clear(c)
    check("clearing erases the receipts with the queue",
      NotificationCaptureStore.append(c, pkg, "ADCB", alert, System.currentTimeMillis() + 1_000), "appended")
  }
  println(if (bad == 0) "STORE ALL OK" else "STORE FAILURES $bad")
  System.exit(if (bad == 0) 0 else 1)
}
