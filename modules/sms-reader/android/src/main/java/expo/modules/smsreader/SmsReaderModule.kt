package expo.modules.smsreader

import android.content.Context
import android.net.Uri
import android.provider.Telephony
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * Reads SMS from the device inbox. The app must hold the READ_SMS runtime
 * permission before calling getInboxSms; the query returns an empty list
 * if the permission is missing rather than crashing.
 *
 * Paged: pass untilMs from a previous page's oldest timestamp to walk the
 * full inbox history in batches without loading everything at once.
 */
class SmsReaderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SmsReader")

    AsyncFunction("getInboxSms") { sinceMs: Double, untilMs: Double, max: Int ->
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val messages = mutableListOf<Map<String, Any>>()
      try {
        val cursor = context.contentResolver.query(
          Telephony.Sms.Inbox.CONTENT_URI,
          arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
          "${Telephony.Sms.DATE} >= ? AND ${Telephony.Sms.DATE} < ?",
          arrayOf(sinceMs.toLong().toString(), untilMs.toLong().toString()),
          "${Telephony.Sms.DATE} DESC"
        )
        cursor?.use {
          val addressIdx = it.getColumnIndex(Telephony.Sms.ADDRESS)
          val bodyIdx = it.getColumnIndex(Telephony.Sms.BODY)
          val dateIdx = it.getColumnIndex(Telephony.Sms.DATE)
          while (it.moveToNext() && messages.size < max) {
            messages.add(
              mapOf(
                "address" to (it.getString(addressIdx) ?: ""),
                "body" to (it.getString(bodyIdx) ?: ""),
                "date" to it.getLong(dateIdx).toDouble()
              )
            )
          }
        }
      } catch (_: SecurityException) {
        // Permission not granted — return what we have (empty).
      }
      messages
    }

    /**
     * A support export must not freeze the app by copying a whole inbox over
     * the JS bridge. Stream JSONL directly from the SMS provider into Wafra's
     * cache instead. Nothing is uploaded here; JavaScript can only hand the
     * resulting local file to Android's user-controlled share sheet.
     */
    AsyncFunction("exportInboxSms") {
      val context = appContext.reactContext
        ?: throw IllegalStateException("sms_context_unavailable")
      val file = File(context.cacheDir, "wafra-financial-sms-${System.currentTimeMillis()}.jsonl")
      var count = 0
      try {
        file.bufferedWriter(Charsets.UTF_8).use { writer ->
          writer.append(
            JSONObject()
              .put("type", "wafra-sms-export")
              .put("version", 1)
              .put("scope", "financial")
              .put("exportedAt", System.currentTimeMillis())
              .toString()
          )
          writer.newLine()
          val cursor = context.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
            null,
            null,
            "${Telephony.Sms.DATE} ASC"
          )
          cursor?.use {
            val addressIdx = it.getColumnIndex(Telephony.Sms.ADDRESS)
            val bodyIdx = it.getColumnIndex(Telephony.Sms.BODY)
            val dateIdx = it.getColumnIndex(Telephony.Sms.DATE)
            while (it.moveToNext()) {
              val body = it.getString(bodyIdx) ?: ""
              if (
                !SmsDeliveryReceiver.MONEY_RE.containsMatchIn(body) ||
                !isRecognizedBankSender(it.getString(addressIdx) ?: "") ||
                SENSITIVE_AUTH_RE.containsMatchIn(body)
              ) {
                continue
              }
              writer.append(
                JSONObject()
                  .put("sender", it.getString(addressIdx) ?: "")
                  .put("body", body)
                  .put("date", it.getLong(dateIdx))
                  .toString()
              )
              writer.newLine()
              count += 1
            }
          }
        }
      } catch (error: SecurityException) {
        file.delete()
        throw IllegalStateException("sms_permission_missing", error)
      } catch (error: Exception) {
        file.delete()
        throw error
      }
      mapOf(
        "uri" to Uri.fromFile(file).toString(),
        "count" to count
      )
    }

    /**
     * Alerts captured by SmsDeliveryReceiver at delivery time, oldest first.
     * Entries older than sinceMs are dropped rather than returned, so the
     * buffer does not grow across scans.
     */
    AsyncFunction("getReceived") { sinceMs: Double ->
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val messages = mutableListOf<Map<String, Any>>()
      try {
        val prefs = context.getSharedPreferences(
          SmsDeliveryReceiver.PREFS,
          Context.MODE_PRIVATE
        )
        val arr = JSONArray(prefs.getString(SmsDeliveryReceiver.KEY, "[]"))
        val keep = JSONArray()
        val since = sinceMs.toLong()
        for (i in 0 until arr.length()) {
          val entry = arr.optJSONObject(i) ?: continue
          val date = entry.optLong("date")
          if (date < since) continue
          keep.put(entry)
          messages.add(
            mapOf(
              "address" to entry.optString("address"),
              "body" to entry.optString("body"),
              "date" to date.toDouble()
            )
          )
        }
        if (keep.length() != arr.length()) {
          prefs.edit().putString(SmsDeliveryReceiver.KEY, keep.toString()).apply()
        }
      } catch (_: Exception) {
        // A malformed buffer must not break the scan; the inbox query still runs.
      }
      messages.sortedBy { it["date"] as Double }
    }

    /**
     * Turn the delivery-time banner on or off.
     *
     * It has to live in SharedPreferences rather than in the app's own state,
     * because the receiver that reads it runs with no JavaScript engine and
     * cannot see AsyncStorage. JS owns the setting; this is how it reaches
     * the only code that can act on it.
     */
    Function("setInstantAlerts") { enabled: Boolean ->
      val context = appContext.reactContext ?: return@Function false
      InstantAlert.setEnabled(context, enabled)
      true
    }

    Function("getInstantAlerts") {
      val context = appContext.reactContext ?: return@Function false
      InstantAlert.isEnabled(context)
    }
  }

  companion object {
    /**
     * Support exports may contain raw text, so an amount alone is not enough:
     * a personal conversation can mention AED too. Require a recognized UAE
     * or Saudi financial brand in the sender ID before it can leave Wafra's
     * cache through the user-controlled share sheet. The body is deliberately
     * not trusted: a personal or scam message can mention "FAB" or "ADCB".
     */
    val FINANCIAL_BRAND_RE = Regex(
      "^(?:(?:AD|AE|UAE)[._-]?)?(?:ENBD|Emirates\\s*NBD|FAB|First\\s*Abu\\s*Dhabi(?:\\s*Bank)?|" +
        "ADCB|ADIB|DIB|Dubai\\s*Islamic(?:\\s*Bank)?|" +
        "Mashreq|RAK\\s*BANK|RAKBANK|CBD|HSBC|Emirates\\s*Islamic|Sharjah\\s*Islamic|" +
        "SIB|NBF|Wio|Liv|Ajman\\s*Bank|CBI|Al\\s*Rajhi|SNB|AlAhli|Riyad\\s*Bank|" +
        "Alinma|Albilad|SAB|ANB|Saudi\\s*Fransi|BSF|AlJazira|stc\\s*pay|urpay|D360)" +
        "(?:[._-]?(?:AE|UAE|ALERTS?|NOTIFY|NOTIFICATION|BANK))?\\.?$",
      RegexOption.IGNORE_CASE
    )

    fun isRecognizedBankSender(sender: String): Boolean {
      val normalized = sender.trim()
      // Sender IDs are compact alphanumeric shortcodes. Requiring that shape
      // keeps a personal contact such as "My FAB friend" outside the export,
      // while accepting the real suffixes banks use (ADCBAlert, RAKBANKUAE,
      // Liv.). Phone numbers are deliberately never trusted as bank identity.
      if (!Regex("^[A-Za-z0-9._-]{2,32}$").matches(normalized)) return false
      if (Regex("^\\+?[0-9]+$").matches(normalized)) return false
      return FINANCIAL_BRAND_RE.matches(normalized)
    }

    /**
     * Authentication messages are never useful parser fixtures. Match an
     * actual 3–8 digit secret near the keyword, not the generic footer banks
     * append to ordinary purchases ("Never share your OTP/PIN/CVV").
     */
    val SENSITIVE_AUTH_RE = Regex(
      "(?:(?:\\b(?:OTP|one[- ]time password|verification code|security code|authentication code|" +
        "authori[sz]ation code|passcode|password|PIN|mPIN|iPIN|tPIN|CVV|CVC|secure key)\\b|" +
        "رمز\\s+(?:التحقق|الأمان|التفويض|السري)|الرقم\\s+السري|كلمة\\s+(?:المرور|السر))" +
        "[^\\r\\n]{0,60}[0-9٠-٩]{3,8}(?![0-9٠-٩]))|" +
        "(?:[0-9٠-٩]{3,8}\\s+(?:is\\s+(?:your\\s+)?)?(?:\\b(?:OTP|verification code|security code|PIN|CVV|CVC)\\b))|" +
        "(?:[0-9٠-٩]{3,8}\\s+هو\\s+رمز\\s+(?:التحقق|الأمان|التفويض|السري))|" +
        "\\b(?:password|passcode|PIN|mPIN|iPIN|tPIN)[ -]?(?:reset|change)\\b",
      RegexOption.IGNORE_CASE
    )
  }
}
