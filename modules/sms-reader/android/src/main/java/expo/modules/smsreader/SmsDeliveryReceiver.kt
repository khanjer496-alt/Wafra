package expo.modules.smsreader

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/**
 * Screens bank alerts at delivery time for the optional instant banner.
 *
 * The inbox query in SmsReaderModule already finds these messages, but only
 * once the app is next opened. This receiver deliberately keeps no second raw
 * message archive: the system inbox is the source of truth for ledger import.
 *
 * Only messages naming a currency amount are kept — everything else is
 * dropped here and never passed to the banner reader.
 */
class SmsDeliveryReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    try {
      if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
      val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
      if (parts.isEmpty()) return

      // A long alert arrives as several PDUs; the body only makes sense joined.
      val address = parts[0].originatingAddress ?: ""
      val body = parts.joinToString("") { it.messageBody ?: "" }.trim()
      if (body.isEmpty() || SensitiveMessageFilter.shouldReject(body) ||
        !MONEY_RE.containsMatchIn(body)) return
      InstantAlert.post(context, address, body)
      // Do not scan the inbox here. This broadcast is only the event edge that
      // wakes one bounded headless pass when Wafra is not already foregrounded.
      // If Android refuses the background service, the SMS remains in the inbox
      // and the normal foreground importer recovers it on the next open.
      val observedAt = parts.maxOfOrNull { it.timestampMillis } ?: System.currentTimeMillis()
      LiveCaptureHeadlessService.schedule(
        context,
        LiveCaptureHeadlessService.SOURCE_SMS,
        observedAt,
      )
    } catch (_: Exception) {
      // Never crash on a delivery broadcast. A dropped alert is recovered by
      // the next inbox scan; a crash loop on every incoming SMS is not.
    }
  }

  companion object {
    const val PREFS = "wafra_sms_capture"
    const val KEY = "received"
    // Must stay in step with the same-named pattern in
    // BankNotificationListenerService: both decide, before anything else can,
    // whether a message is about money at all. This one was left behind when
    // Arabic was added, so an Arabic bank SMS was dropped at delivery — the
    // parser had learned to read it and never got the chance.
    // Which currencies and symbols count as "money" for the native admission
    // gate. Case-insensitive only for the legacy Gulf/regional codes (which
    // always were); every other ISO 4217 code is UPPER CASE only, so ordinary
    // words ("all 3 items", "top 10 deals", "try 5 times") are never admitted
    // by the codes added later. Letter-led symbols (Rs, RM, Kč, S/ ...) must
    // not be glued to a preceding word, digit or path, and a code after a
    // figure needs a word end. Still only a cheap superset gate: the JS parser
    // decides. Bank apps also concatenate code and amount (ADCB posts
    // AED181.00), so the gap before the figure may be empty. The ISO list is
    // checked against CURRENCY_MINOR_UNITS by scripts/test/kotlin-regex.test.js;
    // keep both copies byte-identical.
    val MONEY_RE = Regex(
      "(?:AED|Dhs?|SAR|SR|QAR|KWD|BHD|OMR|EGP|INR|PKR|PHP|USD|EUR|GBP|CAD|AUD|JPY|CNY|CHF|TRY|GHS|د\\.إ|ر\\.س|درهم|ريال)[\\s\\u00A0\\u2007\\u202F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]*[0-9\\u0660-\\u0669\\u06F0-\\u06F9\\u0966-\\u096F\\u09E6-\\u09EF\\u0E50-\\u0E59\\u1040-\\u1049\\uFF10-\\uFF19]" +
      "|(?<![\\p{L}\\p{N}/_])(?-i:AED|AFN|ALL|AMD|AOA|ARS|AUD|AWG|AZN|BAM|BBD|BDT|BHD|BIF|BMD|BND|BOB|BOV|BRL|BSD|BTN|BWP|BYN|BZD|CAD|CDF|CHE|CHF|CHW|CLF|CLP|CNY|COP|COU|CRC|CUP|CVE|CZK|DJF|DKK|DOP|DZD|EGP|ERN|ETB|EUR|FJD|FKP|GBP|GEL|GHS|GIP|GMD|GNF|GTQ|GYD|HKD|HNL|HTG|HUF|IDR|ILS|INR|IQD|IRR|ISK|JMD|JOD|JPY|KES|KGS|KHR|KMF|KPW|KRW|KWD|KYD|KZT|LAK|LBP|LKR|LRD|LSL|LYD|MAD|MDL|MGA|MKD|MMK|MNT|MOP|MRU|MUR|MVR|MWK|MXN|MXV|MYR|MZN|NAD|NGN|NIO|NOK|NPR|NZD|OMR|PAB|PEN|PGK|PHP|PKR|PLN|PYG|QAR|RON|RSD|RUB|RWF|SAR|SBD|SCR|SDG|SEK|SGD|SHP|SLE|SOS|SRD|SSP|STN|SVC|SYP|SZL|THB|TJS|TMT|TND|TOP|TRY|TTD|TWD|TZS|UAH|UGX|USD|USN|UYI|UYU|UYW|UZS|VED|VES|VND|VUV|WST|XAD|XAF|XCD|XCG|XOF|XPF|YER|ZAR|ZMW|ZWG)[\\s\\u00A0\\u2007\\u202F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]*[0-9\\u0660-\\u0669\\u06F0-\\u06F9\\u0966-\\u096F\\u09E6-\\u09EF\\u0E50-\\u0E59\\u1040-\\u1049\\uFF10-\\uFF19]" +
      "|[\\u0024£€₹₦₩₺₫₱฿¥₵₽₴₸₼₾৳₪₡₲₭₮][\\s\\u00A0\\u2007\\u202F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]*[0-9\\u0660-\\u0669\\u06F0-\\u06F9\\u0966-\\u096F\\u09E6-\\u09EF\\u0E50-\\u0E59\\u1040-\\u1049\\uFF10-\\uFF19]" +
      "|(?<![\\p{L}\\p{N}/_])(?-i:Rs|RS|Rp|RP|Tk|TK|RM|TL|Ksh|KSh|KSH|Tsh|TSh|TSH|USh|USH|kr|Kr|KR|Kč|Kc|KC|zł|zl|ZL|Ft|S/|GH₵)\\.?[\\s\\u00A0\\u2007\\u202F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]*[0-9\\u0660-\\u0669\\u06F0-\\u06F9\\u0966-\\u096F\\u09E6-\\u09EF\\u0E50-\\u0E59\\u1040-\\u1049\\uFF10-\\uFF19]" +
      "|(?:د\\.ك|د\\.ب|ر\\.ع|ر\\.ق|د\\.أ|ج\\.م|جنيه|جم|港幣|港币|港元|新台幣|新台币|台幣|台币|人民幣|人民币|日圓|日元|บาท)[\\s\\u00A0\\u2007\\u202F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]*[0-9\\u0660-\\u0669\\u06F0-\\u06F9\\u0966-\\u096F\\u09E6-\\u09EF\\u0E50-\\u0E59\\u1040-\\u1049\\uFF10-\\uFF19]" +
      "|[0-9\\u0660-\\u0669\\u06F0-\\u06F9\\u0966-\\u096F\\u09E6-\\u09EF\\u0E50-\\u0E59\\u1040-\\u1049\\uFF10-\\uFF19][\\s\\u00A0\\u2007\\u202F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]*(?:د\\.إ|ر\\.س|درهم|ريال|د\\.ك|د\\.ب|ر\\.ع|ر\\.ق|د\\.أ|ج\\.م|جنيه|جم)" +
      "|[0-9\\u0660-\\u0669\\u06F0-\\u06F9\\u0966-\\u096F\\u09E6-\\u09EF\\u0E50-\\u0E59\\u1040-\\u1049\\uFF10-\\uFF19][\\s\\u00A0\\u2007\\u202F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]*(?-i:AED|AFN|ALL|AMD|AOA|ARS|AUD|AWG|AZN|BAM|BBD|BDT|BHD|BIF|BMD|BND|BOB|BOV|BRL|BSD|BTN|BWP|BYN|BZD|CAD|CDF|CHE|CHF|CHW|CLF|CLP|CNY|COP|COU|CRC|CUP|CVE|CZK|DJF|DKK|DOP|DZD|EGP|ERN|ETB|EUR|FJD|FKP|GBP|GEL|GHS|GIP|GMD|GNF|GTQ|GYD|HKD|HNL|HTG|HUF|IDR|ILS|INR|IQD|IRR|ISK|JMD|JOD|JPY|KES|KGS|KHR|KMF|KPW|KRW|KWD|KYD|KZT|LAK|LBP|LKR|LRD|LSL|LYD|MAD|MDL|MGA|MKD|MMK|MNT|MOP|MRU|MUR|MVR|MWK|MXN|MXV|MYR|MZN|NAD|NGN|NIO|NOK|NPR|NZD|OMR|PAB|PEN|PGK|PHP|PKR|PLN|PYG|QAR|RON|RSD|RUB|RWF|SAR|SBD|SCR|SDG|SEK|SGD|SHP|SLE|SOS|SRD|SSP|STN|SVC|SYP|SZL|THB|TJS|TMT|TND|TOP|TRY|TTD|TWD|TZS|UAH|UGX|USD|USN|UYI|UYU|UYW|UZS|VED|VES|VND|VUV|WST|XAD|XAF|XCD|XCG|XOF|XPF|YER|ZAR|ZMW|ZWG|SR|Dhs?|DHS?|Rs|RS|Rp|RP|Tk|TK|RM|TL|Ksh|KSh|KSH|Tsh|TSh|TSH|USh|USH|kr|Kr|KR|Kč|Kc|KC|zł|zl|ZL|Ft|GH₵|đồng|đ)(?![\\p{L}\\p{N}])" +
      "|[0-9\\u0660-\\u0669\\u06F0-\\u06F9\\u0966-\\u096F\\u09E6-\\u09EF\\u0E50-\\u0E59\\u1040-\\u1049\\uFF10-\\uFF19][\\s\\u00A0\\u2007\\u202F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]*(?:[£€₹₦₩₺₫₱฿¥₵₽₴₸₼₾৳₪₡₲₭₮\\u0024]|円|원|元|港幣|港币|港元|新台幣|新台币|台幣|台币|人民幣|人民币|日圓|日元|บาท)",
      RegexOption.IGNORE_CASE
    )
  }
}
