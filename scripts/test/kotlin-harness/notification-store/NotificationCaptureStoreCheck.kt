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
    c.getSharedPreferences("wafra_notification_capture", 0).edit().putString("queue", "legacy test body").commit()
    val legacy = c.prefs.getValue("wafra_notification_capture")
    legacy.failingCommits = 2
    check("startup erase failure is nonfatal", NotificationCaptureStore.purgeLegacyPlaintextAtStartup(c), false)
    check("failed erase can empty RAM", legacy.all.isEmpty(), true)
    check("failed erase retains plaintext on disk", legacy.disk.isNotEmpty(), true)
    check("failed erase is reported pending", NotificationCaptureStore.legacyCleanupPending, true)
    val rejected = try { NotificationCaptureStore.read(c, 0L); false } catch (_: IllegalStateException) { true }
    check("queue read retries pending erase and rejects another failure", rejected, true)
    check("second failed erase stays pending", NotificationCaptureStore.legacyCleanupPending, true)
    check("second failure keeps plaintext on disk", legacy.disk.isNotEmpty(), true)
    check("third erase succeeds before queue read", NotificationCaptureStore.read(c, 0L).isEmpty(), true)
    check("successful retry removes plaintext from disk", legacy.disk.isEmpty(), true)
    check("only durable success clears pending", NotificationCaptureStore.legacyCleanupPending, false)
    check("failed clears were retried despite empty RAM", legacy.commitAttempts, 4)
  }
  run {
    val c = enabledContext()
    c.getSharedPreferences("wafra_notification_capture", 0).edit().putString("queue", "legacy test body").commit()
    val legacy = c.prefs.getValue("wafra_notification_capture")
    legacy.throwingCommits = 1
    val rejected = try { NotificationCaptureStore.read(c, 0L); false } catch (_: IllegalStateException) { true }
    check("a thrown queue erase rejects access", rejected, true)
    check("a thrown erase keeps cleanup pending", NotificationCaptureStore.legacyCleanupPending, true)
    check("a thrown erase can leave plaintext on disk", legacy.disk.isNotEmpty(), true)
    NotificationCaptureStore.read(c, 0L)
    check("a thrown erase is retried despite empty RAM", legacy.disk.isEmpty(), true)
    check("retry after a thrown erase clears pending", NotificationCaptureStore.legacyCleanupPending, false)
  }
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
  run {
    // A pick from an ambiguous notification history is queued review-only.
    // The flag survives the encrypted queue, an ordinary row (written without
    // the key, like a row from an older build) reads back false, and healing
    // the same posting takes the new extraction's flag.
    val c = enabledContext()
    val noSeconds = alert.replace("17:38:39", "17:38")
    check("a review-only row is appended",
      NotificationCaptureStore.append(c, pkg, "ADCBAlert", noSeconds, t0, reviewOnly = true), "appended")
    NotificationCaptureStore.append(c, pkg, "ADCBAlert", noSeconds.replace("AED290.00", "AED12.00"), t0 + 5_000)
    check("the review-only flag survives the encrypted queue",
      NotificationCaptureStore.read(c, 0L).sortedBy { it.ts }.map { it.reviewOnly }, listOf(true, false))
    check("healing the same posting takes the new extraction's flag",
      NotificationCaptureStore.append(c, pkg, "ADCBAlert", alert, t0, reviewOnly = false), "repaired")
    check("the healed row is no longer review-only",
      NotificationCaptureStore.read(c, 0L).first { it.ts == t0 }.reviewOnly, false)
  }
  run {
    // A review-only pick is checked against receipts but leaves none: when it
    // was the NEW charge, that charge's own notification is still captured
    // (JS flags the Review card as a possible repeat). A pick repeating a
    // charge already captured is still refused as a re-post.
    val c = enabledContext()
    check("a review-only pick of a new charge is appended",
      NotificationCaptureStore.append(c, pkg, "ADCBAlert", alert, t0, reviewOnly = true), "appended")
    check("the charge's own notification is not refused as a re-post of the pick",
      NotificationCaptureStore.append(c, pkg, "ADCBAlert", alert, t0 + 60_000), "appended")
    check("a later review-only pick of that captured charge is a re-post",
      NotificationCaptureStore.append(c, pkg, "ADCBAlert", alert, t0 + 120_000, reviewOnly = true), "repost")
  }
  println(if (bad == 0) "STORE ALL OK" else "STORE FAILURES $bad")
  System.exit(if (bad == 0) 0 else 1)
}
