// An in-memory JCA provider registered under the name "AndroidKeyStore", so
// the store's real KeyStore/KeyGenerator/AES-GCM code runs unchanged off-device.
// Test-only; never packaged. See NotificationCaptureStoreCheck.kt.
package harness
import java.security.*
import java.security.cert.Certificate
import java.util.*
import javax.crypto.*
import javax.crypto.spec.SecretKeySpec

object Keys { val keys = mutableMapOf<String, SecretKey>() }
class MemKeyStoreSpi : KeyStoreSpi() {
  override fun engineGetKey(a: String, p: CharArray?): Key? = Keys.keys[a]
  override fun engineGetEntry(a: String, p: KeyStore.ProtectionParameter?): KeyStore.Entry? = Keys.keys[a]?.let { KeyStore.SecretKeyEntry(it) }
  override fun engineGetCertificateChain(a: String?): Array<Certificate>? = null
  override fun engineGetCertificate(a: String?): Certificate? = null
  override fun engineGetCreationDate(a: String?): Date? = null
  override fun engineSetKeyEntry(a: String?, k: Key?, p: CharArray?, c: Array<out Certificate>?) {}
  override fun engineSetKeyEntry(a: String?, k: ByteArray?, c: Array<out Certificate>?) {}
  override fun engineSetCertificateEntry(a: String?, c: Certificate?) {}
  override fun engineDeleteEntry(a: String?) {}
  override fun engineAliases(): Enumeration<String> = Collections.enumeration(Keys.keys.keys)
  override fun engineContainsAlias(a: String) = Keys.keys.containsKey(a)
  override fun engineSize() = Keys.keys.size
  override fun engineIsKeyEntry(a: String?) = true
  override fun engineIsCertificateEntry(a: String?) = false
  override fun engineGetCertificateAlias(c: Certificate?): String? = null
  override fun engineStore(s: java.io.OutputStream?, p: CharArray?) {}
  override fun engineLoad(s: java.io.InputStream?, p: CharArray?) {}
}
class MemKeyGenSpi : KeyGeneratorSpi() {
  var alias = ""
  override fun engineInit(r: SecureRandom?) {}
  override fun engineInit(p: java.security.spec.AlgorithmParameterSpec?, r: SecureRandom?) { alias = (p as android.security.keystore.KeyGenParameterSpec).alias }
  override fun engineInit(n: Int, r: SecureRandom?) {}
  override fun engineGenerateKey(): SecretKey { val b = ByteArray(32); SecureRandom().nextBytes(b); val k = SecretKeySpec(b, "AES"); Keys.keys[alias] = k; return k }
}
class MemoryKeyStoreProvider : java.security.Provider("AndroidKeyStore", "1.0", "test") {
  init { put("KeyStore.AndroidKeyStore", MemKeyStoreSpi::class.java.name); put("KeyGenerator.AES", MemKeyGenSpi::class.java.name) }
}
