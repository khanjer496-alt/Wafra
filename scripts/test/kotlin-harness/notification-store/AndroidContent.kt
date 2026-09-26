@file:Suppress("unused", "UNUSED_PARAMETER")
// Off-device stand-in for android.content.Context/SharedPreferences, just enough for NotificationCaptureStore to
// compile and run under kotlin-regex.test.js (when kotlinc is available).
// Test-only; never packaged. See NotificationCaptureStoreCheck.kt.
package android.content

interface SharedPreferences {
  interface Editor {
    fun putString(k: String, v: String?): Editor
    fun putLong(k: String, v: Long): Editor
    fun putBoolean(k: String, v: Boolean): Editor
    fun remove(k: String): Editor
    fun clear(): Editor
    fun commit(): Boolean
  }
  fun getString(k: String, d: String?): String?
  fun getLong(k: String, d: Long): Long
  fun getBoolean(k: String, d: Boolean): Boolean
  fun contains(k: String): Boolean
  val all: Map<String, *>
  fun edit(): Editor
}

class MemPrefs : SharedPreferences {
  val map = mutableMapOf<String, Any?>()
  override fun getString(k: String, d: String?) = map[k] as String? ?: d
  override fun getLong(k: String, d: Long) = map[k] as Long? ?: d
  override fun getBoolean(k: String, d: Boolean) = map[k] as Boolean? ?: d
  override fun contains(k: String) = map.containsKey(k)
  override val all: Map<String, *> get() = map
  override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
    val ops = mutableListOf<() -> Unit>()
    override fun putString(k: String, v: String?) = apply { ops += { map[k] = v } }
    override fun putLong(k: String, v: Long) = apply { ops += { map[k] = v } }
    override fun putBoolean(k: String, v: Boolean) = apply { ops += { map[k] = v } }
    override fun remove(k: String) = apply { ops += { map.remove(k) } }
    override fun clear() = apply { ops += { map.clear() } }
    override fun commit(): Boolean { ops.forEach { it() }; return true }
  }
}

open class Context {
  val prefs = mutableMapOf<String, MemPrefs>()
  fun getSharedPreferences(name: String, mode: Int): SharedPreferences = prefs.getOrPut(name) { MemPrefs() }
  companion object { const val MODE_PRIVATE = 0 }
}
