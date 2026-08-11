package expo.modules.notificationreader

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.security.KeyStore
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
  private const val LEGACY_PREFS = "wafra_notification_capture"
  private const val KEY_ALIAS = "wafra.notification.capture.v1"
  private const val MAX_ROWS = 500
  private const val RETENTION_MS = 7L * 24 * 60 * 60 * 1000
  private const val VERSION = 1

  @Synchronized
  fun append(context: Context, pkg: String, title: String, text: String, ts: Long) {
    purgeLegacyPlaintext(context)
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (ts <= prefs.getLong(CLEARED_THROUGH, 0L)) return
    val current = readAll(context).filter { it.ts >= System.currentTimeMillis() - RETENTION_MS }
    if (current.any { it.pkg == pkg && it.text == text && it.ts == ts }) return
    val next = (current + CapturedBankNotification(
      id = UUID.randomUUID().toString(),
      pkg = pkg,
      title = title,
      text = text,
      ts = ts,
    )).sortedBy { it.ts }.takeLast(MAX_ROWS)
    writeAll(context, next)
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

  @Synchronized
  fun acknowledge(context: Context, ids: Set<String>) {
    if (ids.isEmpty()) return
    purgeLegacyPlaintext(context)
    val current = readAll(context)
    writeAll(context, current.filterNot { ids.contains(it.id) })
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

  private fun writeAll(context: Context, rows: List<CapturedBankNotification>) {
    val encrypted = JSONArray()
    val secretKey = if (rows.isEmpty()) null else key()
    rows.forEach { encrypted.put(encrypt(it, requireNotNull(secretKey))) }
    val ok = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit().putString(QUEUE, encrypted.toString()).commit()
    if (!ok) throw IllegalStateException("Notification queue could not be persisted")
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
