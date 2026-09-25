package expo.modules.wafraondeviceai

import org.json.JSONArray
import org.json.JSONObject

/** One output property: a closed list of string choices, or a short free string. */
internal data class ClosedField(
  val name: String,
  val description: String?,
  val choices: List<String>?,
  val maxLength: Int?,
)

/**
 * The closed output shape JavaScript asks for. Gemini Nano (beta2 Prompt API)
 * has no constrained decoding, so the schema is rendered into the prompt and
 * JavaScript rejects any reply outside it. Mirrors WafraClosedSchema on iOS.
 */
internal data class ClosedSchema(val name: String, val fields: List<ClosedField>) {
  fun promptDescription(): String = buildString {
    append("Reply with only one JSON object and nothing else. ")
    append("It must have exactly these keys:\n")
    for (field in fields) {
      append("- \"").append(field.name).append("\": ")
      if (field.choices != null) {
        append("one of ")
        append(field.choices.joinToString(", ") { JSONObject.quote(it) })
      } else {
        append("a string of at most ").append(field.maxLength).append(" characters")
      }
      field.description?.let { append(". ").append(it) }
      append('\n')
    }
  }

  companion object {
    private val identifier = Regex("^[A-Za-z][A-Za-z0-9_]{0,39}$")

    fun parse(json: String): ClosedSchema? = try {
      if (json.length > 16_384) null else {
        val root = JSONObject(json)
        val name = root.getString("name")
        val rawFields: JSONArray = root.getJSONArray("fields")
        if (!identifier.matches(name) || rawFields.length() !in 1..16) null else {
          val seen = HashSet<String>()
          val fields = ArrayList<ClosedField>()
          var valid = true
          for (index in 0 until rawFields.length()) {
            val raw = rawFields.getJSONObject(index)
            val fieldName = raw.getString("name")
            val description = if (raw.has("description")) raw.getString("description") else null
            val choices = if (raw.has("choices")) {
              val array = raw.getJSONArray("choices")
              (0 until array.length()).map { array.getString(it) }
            } else null
            val maxLength = if (raw.has("maxLength")) raw.getInt("maxLength") else null
            val shapeValid = if (choices != null) {
              maxLength == null && choices.size in 1..64 && choices.toSet().size == choices.size &&
                choices.all { it.isNotEmpty() && it.length <= 64 }
            } else {
              maxLength != null && maxLength in 1..200
            }
            if (!identifier.matches(fieldName) || !seen.add(fieldName) || !shapeValid ||
              (description?.length ?: 0) > 400) {
              valid = false
              break
            }
            fields.add(ClosedField(fieldName, description, choices, maxLength))
          }
          if (valid) ClosedSchema(name, fields) else null
        }
      }
    } catch (_: Exception) {
      null
    }
  }
}
