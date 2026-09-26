// Off-device stand-in for Android's bundled org.json, just enough for
// NotificationCaptureStore to compile and run under kotlin-regex.test.js
// (when kotlinc is available). Test-only; never packaged. See
// NotificationCaptureStoreCheck.kt.
package org.json

class JSONException(message: String) : Exception(message)

private class Parser(private val s: String) {
  private var i = 0

  private fun skipSpace() {
    while (i < s.length && s[i].isWhitespace()) i++
  }

  fun value(): Any? {
    skipSpace()
    if (i >= s.length) throw JSONException("unexpected end")
    return when (s[i]) {
      '{' -> obj()
      '[' -> arr()
      '"' -> str()
      't' -> { i += 4; true }
      'f' -> { i += 5; false }
      'n' -> { i += 4; null }
      else -> num()
    }
  }

  private fun obj(): JSONObject {
    val out = JSONObject()
    i++
    skipSpace()
    if (s[i] == '}') { i++; return out }
    while (true) {
      skipSpace()
      val key = str()
      skipSpace()
      if (s[i] != ':') throw JSONException("expected :")
      i++
      out.values[key] = value()
      skipSpace()
      when (s[i++]) {
        ',' -> continue
        '}' -> return out
        else -> throw JSONException("bad object")
      }
    }
  }

  private fun arr(): JSONArray {
    val out = JSONArray()
    i++
    skipSpace()
    if (s[i] == ']') { i++; return out }
    while (true) {
      out.items.add(value())
      skipSpace()
      when (s[i++]) {
        ',' -> continue
        ']' -> return out
        else -> throw JSONException("bad array")
      }
    }
  }

  private fun str(): String {
    if (s[i] != '"') throw JSONException("expected string")
    i++
    val out = StringBuilder()
    while (s[i] != '"') {
      if (s[i] == '\\') {
        i++
        when (s[i]) {
          'n' -> out.append('\n')
          'u' -> { out.append(s.substring(i + 1, i + 5).toInt(16).toChar()); i += 4 }
          else -> out.append(s[i])
        }
      } else {
        out.append(s[i])
      }
      i++
    }
    i++
    return out.toString()
  }

  private fun num(): Any {
    val start = i
    while (i < s.length && (s[i].isDigit() || s[i] in "-+.eE")) i++
    val token = s.substring(start, i)
    return token.toLongOrNull() ?: token.toDouble()
  }
}

private fun quote(value: Any?): String = when (value) {
  null -> "null"
  is String -> "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\""
  else -> value.toString()
}

class JSONObject() {
  internal val values = LinkedHashMap<String, Any?>()

  constructor(source: String) : this() {
    val parsed = Parser(source).value() as? JSONObject ?: throw JSONException("not an object")
    values.putAll(parsed.values)
  }

  fun put(key: String, value: Any?): JSONObject { values[key] = value; return this }
  fun getString(key: String): String = values[key] as? String ?: throw JSONException(key)
  fun getLong(key: String): Long = (values[key] as? Number)?.toLong() ?: throw JSONException(key)
  fun optString(key: String): String = values[key]?.toString() ?: ""
  fun optLong(key: String, fallback: Long): Long = (values[key] as? Number)?.toLong() ?: fallback
  fun optInt(key: String): Int = (values[key] as? Number)?.toInt() ?: 0
  override fun toString() = values.entries.joinToString(",", "{", "}") { quote(it.key) + ":" + quote(it.value) }
}

class JSONArray() {
  internal val items = mutableListOf<Any?>()

  constructor(source: String) : this() {
    val parsed = Parser(source).value() as? JSONArray ?: throw JSONException("not an array")
    items.addAll(parsed.items)
  }

  constructor(values: Collection<*>) : this() { items.addAll(values) }

  fun put(value: Any?): JSONArray { items.add(value); return this }
  fun length() = items.size
  fun optJSONObject(index: Int) = items.getOrNull(index) as? JSONObject
  fun optString(index: Int) = items.getOrNull(index)?.toString() ?: ""
  override fun toString() = items.joinToString(",", "[", "]") { quote(it) }
}
