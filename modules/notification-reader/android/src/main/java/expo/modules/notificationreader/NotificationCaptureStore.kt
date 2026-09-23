package expo.modules.notificationreader

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class CapturedBankNotification(
  val id: String,
  val pkg: String,
  val title: String,
  val text: String,
  val ts: Long,
)

/**
 * Device-bound encrypted queue shared by the notification service and Expo module.
 *
 * SharedPreferences stores only opaque ids, IVs and AES-GCM ciphertext. The key
 * never leaves AndroidKeyStore, and acknowledgement is a synchronous atomic
 * replacement of the queue after the JS capture executor has persisted its work.
 */
object NotificationCaptureStore {
  private const val PREFS = "wafra_notification_capture_v2"
  private const val QUEUE = "encrypted_queue"
  private const val CLEARED_THROUGH = "cleared_through_ms"
  private const val ACKED = "acked_fingerprints"
  private const val LEGACY_PREFS = "wafra_notification_capture"
  private const val KEY_ALIAS = "wafra.notification.capture.v1"
  private const val MAX_ROWS = 500
  private const val MAX_ACKED_FINGERPRINTS = 2_000
  private const val RETENTION_MS = 7L * 24 * 60 * 60 * 1000
  private const val VERSION = 1

  /**
   * A BANK APP RE-POSTING ONE ALERT IS NOT A SECOND CHARGE.
   *
   * Identity here used to be (package, post time) alone, and every other layer
   * trusted it: the JS capture key for a notification is `s{postTime}-{amount}`
   * and the ledger's cross-channel test only pairs a push with an SMS, never a
   * push with a push. So when an issuer re-posted the same notification with a
   * fresh postTime — FCM redelivering after a doze window, a background sync,
   * or the app updating its own shade entry — nothing downstream could see the
   * two copies as one event, and the charge was counted twice. ADCB is
   * notification-only for some users, which makes this every alert they get.
   *
   * The content is an identity only when the bank includes an explicit
   * transaction date and time. Without that clock, two equal purchases can
   * legitimately produce identical text within minutes of each other.
   *
   * THE WINDOW IS THE WHOLE SAFETY ARGUMENT and must stay short. Two genuinely
   * identical charges — the same amount at the same merchant, worded the same
   * way down to the balance — are a real thing, and beyond this window they
   * must both survive. Thirty minutes covers redelivery and sync retries while
   * leaving a repeat purchase later in the day untouched.
   */
  private const val REPOST_WINDOW_MS = 30L * 60 * 1000
  private const val RECENT_CONTENT = "recent_content"
  private const val MAX_RECENT_CONTENT = 200
  private val TRANSACTION_DATETIME_RE = Regex("""\b\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}:\d{2}\b""")

  @Synchronized
  fun append(context: Context, pkg: String, title: String, text: String, ts: Long): String {
    // Recheck while holding the queue lock: an opt-out racing a callback must
    // never leave a candidate behind after the opt-out's clear completes.
    if (!NotificationCapturePolicy.isEnabled(context)) return "policy"
    purgeLegacyPlaintext(context)
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (ts <= prefs.getLong(CLEARED_THROUGH, 0L)) return "cleared-through"
    if (readAcked(prefs).contains(notificationFingerprint(pkg, ts))) return "acknowledged"
    val current = readAll(context).filter { it.ts >= System.currentTimeMillis() - RETENTION_MS }
    val samePostedNotification = current.indexOfFirst { it.pkg == pkg && it.ts == ts }
    if (samePostedNotification >= 0) {
      val prior = current[samePostedNotification]
      if (prior.title == title && prior.text == text) return "duplicate"
      // A newer app version may learn how an OEM actually exposes the visible
      // body (for example ColorOS moved ADCB's amount out of EXTRA_TEXT). A
      // shade re-sweep must HEAL the retained encrypted row rather than append
      // a second copy while the broken one remains stuck for seven days.
      val repaired = current.toMutableList()
      repaired[samePostedNotification] = prior.copy(title = title, text = text)
      writeAll(context, repaired.sortedBy { it.ts }.takeLast(MAX_ROWS))
      contentFingerprint(pkg, title, text)?.let { recordRecentContent(prefs, it, ts) }
      return "repaired"
    }
    // The re-post guard, which has to outlive the queue row itself: by the time
    // an issuer redelivers, the first copy is normally drained and acknowledged
    // and `current` is empty, so comparing against the queue alone would see
    // nothing. Recent content receipts are the only record left of it.
    val eventIdentity = contentFingerprint(pkg, title, text)
    val recent = if (eventIdentity != null) recentContent(prefs) else emptyList()
    if (eventIdentity != null && recent.any { it.first == eventIdentity && kotlin.math.abs(it.second - ts) <= REPOST_WINDOW_MS }) {
      return "repost"
    }
    val next = (current + CapturedBankNotification(
      id = UUID.randomUUID().toString(),
      pkg = pkg,
      title = title,
      text = text,
      ts = ts,
    )).sortedBy { it.ts }.takeLast(MAX_ROWS)
    writeAll(context, next)
    if (eventIdentity != null) recordRecentContent(prefs, eventIdentity, ts)
    return "appended"
  }

  /** Source-free reason helper for admission diagnostics; never returns queue text. */
  @Synchronized
  fun admissionBlockReason(context: Context, pkg: String, text: String, ts: Long): String? {
    if (!NotificationCapturePolicy.isEnabled(context)) return "policy"
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (ts <= prefs.getLong(CLEARED_THROUGH, 0L)) return "cleared-through"
    if (readAcked(prefs).contains(notificationFingerprint(pkg, ts))) return "acknowledged"
    return try {
      if (readAll(context).any { it.pkg == pkg && it.text == text && it.ts == ts }) "duplicate" else null
    } catch (_: Exception) {
      "store-error"
    }
  }

  @Synchronized
  fun read(context: Context, sinceMs: Long): List<CapturedBankNotification> {
    purgeLegacyPlaintext(context)
    val clearedThrough = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getLong(CLEARED_THROUGH, 0L)
    val cutoff = maxOf(sinceMs, System.currentTimeMillis() - RETENTION_MS, clearedThrough + 1)
    val all = readAll(context)
    val retained = all.filter { it.ts >= System.currentTimeMillis() - RETENTION_MS }
    if (retained.size != all.size) writeAll(context, retained)
    return retained.filter { it.ts >= cutoff }.sortedBy { it.ts }
  }

  /**
   * Cheap source-free recovery hint. This deliberately does not open
   * AndroidKeyStore or decrypt queue rows; foreground startup only needs to
   * know whether an expensive drain might be necessary.
   */
  @Synchronized
  fun pendingCount(context: Context): Int {
    purgeLegacyPlaintext(context)
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(QUEUE, null) ?: return 0
    return try {
      JSONArray(raw).length()
    } catch (_: Exception) {
      0
    }
  }

  /**
   * Source-free identities for targeted OEM re-extraction.
   *
   * Package + Android post time are the same immutable pair used to heal one
   * retained notification in append(). Exposing only that pair lets the
   * listener revisit a handful of still-visible queued rows after an extractor
   * upgrade without walking every visible notification through the full
   * capture/encryption path again.
   */
  @Synchronized
  fun retainedIdentities(context: Context): Set<Pair<String, Long>> =
    read(context, 0L).mapTo(mutableSetOf()) { row -> row.pkg to row.ts }

  @Synchronized
  fun acknowledge(context: Context, ids: Set<String>) {
    if (ids.isEmpty()) return
    purgeLegacyPlaintext(context)
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val current = readAll(context)
    val acknowledgedRows = current.filter { ids.contains(it.id) }
    if (acknowledgedRows.isEmpty()) return
    val remaining = current.filterNot { ids.contains(it.id) }
    val acked = (readAcked(prefs) + acknowledgedRows.map { notificationFingerprint(it.pkg, it.ts) })
      .distinct().takeLast(MAX_ACKED_FINGERPRINTS)
    val ok = prefs.edit()
      .putString(QUEUE, encodeRows(remaining))
      .putString(ACKED, JSONArray(acked).toString())
      .commit()
    if (!ok) throw IllegalStateException("Notification capture acknowledgement could not be persisted")
  }

  @Synchronized
  fun clear(context: Context) {
    purgeLegacyPlaintext(context)
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val clearedThrough = maxOf(System.currentTimeMillis(), prefs.getLong(CLEARED_THROUGH, 0L))
    // Queue deletion and the resurrection guard are one preferences commit.
    // An append before this lock is removed; one after sees the watermark.
    val ok = prefs.edit()
      .remove(QUEUE)
      .remove(ACKED)
      .remove(RECENT_CONTENT)
      .putLong(CLEARED_THROUGH, clearedThrough)
      .commit()
    if (!ok) throw IllegalStateException("Notification queue could not be cleared")
  }

  @Synchronized
  fun purgeLegacyPlaintext(context: Context) {
    // Previous releases stored raw package/title/text JSON here. Never migrate
    // it through application memory; delete it before any v2 queue operation.
    val legacy = context.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE)
    if (legacy.all.isEmpty()) return
    if (!legacy.edit().clear().commit()) {
      throw IllegalStateException("Legacy notification queue could not be erased")
    }
  }

  private fun readAll(context: Context): List<CapturedBankNotification> {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(QUEUE, null)
      ?: return emptyList()
    val envelopes = try {
      JSONArray(raw)
    } catch (_: Exception) {
      clearUnreadable(context)
      return emptyList()
    }
    val out = mutableListOf<CapturedBankNotification>()
    // Key/provider failures are not evidence that every row is corrupt. Fetch
    // once outside the row-level rejection path so a transient KeyStore error
    // propagates without rewriting or deleting the ciphertext queue.
    val secretKey = key()
    for (index in 0 until envelopes.length()) {
      val envelope = envelopes.optJSONObject(index) ?: continue
      decrypt(envelope, secretKey)?.let { row ->
        // Upgrade cleanup: credentials encrypted by an older listener build
        // are deleted here and never cross the Expo bridge.
        if (!SensitiveNotificationFilter.shouldReject("${row.title} ${row.text}")) out.add(row)
      }
    }
    // Authentication failures, unknown versions and malformed rows are never
    // returned to JS. Compact them immediately so unreadable ciphertext does
    // not occupy the bounded queue forever.
    if (out.size != envelopes.length()) writeAll(context, out)
    return out
  }

  private fun encodeRows(rows: List<CapturedBankNotification>): String {
    val encrypted = JSONArray()
    val secretKey = if (rows.isEmpty()) null else key()
    rows.forEach { encrypted.put(encrypt(it, requireNotNull(secretKey))) }
    return encrypted.toString()
  }

  private fun writeAll(context: Context, rows: List<CapturedBankNotification>) {
    val ok = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit().putString(QUEUE, encodeRows(rows)).commit()
    if (!ok) throw IllegalStateException("Notification queue could not be persisted")
  }

  private fun readAcked(prefs: android.content.SharedPreferences): List<String> {
    val raw = prefs.getString(ACKED, null) ?: return emptyList()
    return try {
      val array = JSONArray(raw)
      buildList {
        for (index in 0 until array.length()) {
          val value = array.optString(index)
          if (value.isNotBlank()) add(value)
        }
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  private fun notificationFingerprint(pkg: String, ts: Long): String {
    val digest = MessageDigest.getInstance("SHA-256")
      .digest("$pkg\u0000$ts".toByteArray(Charsets.UTF_8))
    return Base64.encodeToString(digest, Base64.NO_WRAP or Base64.URL_SAFE)
  }

  /**
   * The identity of what the issuer actually SHOWED, independent of when.
   *
   * Only the digest is ever retained, and it is retained encrypted like every
   * other value in this store — the class invariant is that SharedPreferences
   * holds opaque ids, IVs and ciphertext, and a bare hash of a bank alert
   * would weaken it, since an attacker holding the file could confirm a
   * guessed body by hashing it.
   */
  private fun contentFingerprint(pkg: String, title: String, text: String): String? {
    if (!TRANSACTION_DATETIME_RE.containsMatchIn(text)) return null
    val digest = MessageDigest.getInstance("SHA-256")
      .digest("$pkg\u0000$title\u0000$text".toByteArray(Charsets.UTF_8))
    return Base64.encodeToString(digest, Base64.NO_WRAP or Base64.URL_SAFE)
  }

  /**
   * Recent content receipts as (fingerprint, post time), already windowed.
   *
   * Every failure here returns an EMPTY list, which degrades to the old
   * behaviour of letting the posting through. A KeyStore that will not open,
   * ciphertext that will not authenticate and malformed JSON all mean the
   * guard is missing — none of them is evidence that a charge is a duplicate,
   * and refusing money on a storage error is the one outcome worse than a
   * duplicate row.
   */
  private fun recentContent(prefs: android.content.SharedPreferences): List<Pair<String, Long>> {
    val stored = prefs.getString(RECENT_CONTENT, null) ?: return emptyList()
    val cutoff = System.currentTimeMillis() - REPOST_WINDOW_MS
    return try {
      val plaintext = decryptPayload(stored)
      if (plaintext == null) {
        // Unreadable receipts occupy the slot forever otherwise; the next
        // append rewrites them from scratch.
        prefs.edit().remove(RECENT_CONTENT).commit()
        return emptyList()
      }
      val array = JSONArray(plaintext)
      buildList {
        for (index in 0 until array.length()) {
          val value = array.optJSONObject(index) ?: continue
          val fingerprint = value.optString("f")
          val ts = value.optLong("t", 0L)
          if (fingerprint.isNotBlank() && ts >= cutoff) add(fingerprint to ts)
        }
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  /**
   * Remember that this content was accepted, so a later redelivery can be
   * recognised once the queue row itself is drained.
   *
   * The caller has ALREADY committed the queue row, so this must never throw:
   * a receipt that fails to persist costs the next re-post guard, while an
   * exception escaping here would abort the listener's wake-up and strand a
   * charge that is already stored.
   */
  private fun recordRecentContent(
    prefs: android.content.SharedPreferences,
    fingerprint: String,
    ts: Long,
  ) {
    try {
      val retained = (recentContent(prefs) + (fingerprint to ts))
        .distinct().takeLast(MAX_RECENT_CONTENT)
      val array = JSONArray()
      retained.forEach { array.put(JSONObject().put("f", it.first).put("t", it.second)) }
      prefs.edit().putString(RECENT_CONTENT, encryptPayload(array.toString())).commit()
    } catch (_: Exception) {
      // Guard lost, charge kept.
    }
  }

  private fun encryptPayload(plaintext: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    return JSONObject()
      .put("v", VERSION)
      .put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .put("ct", Base64.encodeToString(
        cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP,
      ))
      .toString()
  }

  private fun decryptPayload(stored: String): String? {
    val envelope = try { JSONObject(stored) } catch (_: JSONException) { return null }
    if (envelope.optInt("v") != VERSION) return null
    val iv: ByteArray
    val bytes: ByteArray
    try {
      iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)
      bytes = Base64.decode(envelope.getString("ct"), Base64.NO_WRAP)
    } catch (_: JSONException) {
      return null
    } catch (_: IllegalArgumentException) {
      return null
    }
    if (iv.size != 12 || bytes.size < 16) return null
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
    return try {
      String(cipher.doFinal(bytes), Charsets.UTF_8)
    } catch (_: AEADBadTagException) {
      null
    }
  }

  private fun encrypt(row: CapturedBankNotification, secretKey: SecretKey): JSONObject {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, secretKey)
    val plaintext = JSONObject()
      .put("id", row.id)
      .put("pkg", row.pkg)
      .put("title", row.title)
      .put("text", row.text)
      .put("ts", row.ts)
      .toString().toByteArray(Charsets.UTF_8)
    return JSONObject()
      .put("v", VERSION)
      .put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .put("ct", Base64.encodeToString(cipher.doFinal(plaintext), Base64.NO_WRAP))
  }

  private fun decrypt(envelope: JSONObject, secretKey: SecretKey): CapturedBankNotification? {
    if (envelope.optInt("v") != VERSION) return null
    val encodedIv: String
    val encodedCiphertext: String
    try {
      encodedIv = envelope.getString("iv")
      encodedCiphertext = envelope.getString("ct")
    } catch (_: JSONException) {
      return null
    }
    val iv: ByteArray
    val bytes: ByteArray
    try {
      iv = Base64.decode(encodedIv, Base64.NO_WRAP)
      bytes = Base64.decode(encodedCiphertext, Base64.NO_WRAP)
    } catch (_: IllegalArgumentException) {
      return null
    }
    if (iv.size != 12 || bytes.size < 16) return null

    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(128, iv))
    val plaintext = try {
      cipher.doFinal(bytes)
    } catch (_: AEADBadTagException) {
      return null
    }
    return try {
      val value = JSONObject(String(plaintext, Charsets.UTF_8))
      CapturedBankNotification(
        id = value.getString("id"),
        pkg = value.getString("pkg"),
        title = value.getString("title"),
        text = value.getString("text"),
        ts = value.getLong("ts"),
      )
    } catch (_: JSONException) {
      null
    }
  }

  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return generator.generateKey()
  }

  private fun clearUnreadable(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(QUEUE).commit()
  }
}
