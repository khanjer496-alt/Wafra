package expo.modules.notificationreader

/** Credentials are refused before the encrypted bank-notification queue. */
internal object SensitiveNotificationFilter {
  val CREDENTIAL_RE = Regex(
    "\\b(?:otp|one[ -]?time password|verification code|security code|authentication code|login code|passcode)\\b\\s*(?:is\\s*)?[:\\-]?\\s*[0-9]{4,8}\\b" +
      "|\\b[0-9]{4,8}\\s*(?:is\\s*)?(?:your\\s*)?(?:otp|one[ -]?time password|verification code|security code|authentication code|login code|passcode)\\b" +
      "|\\b(?:approve|authori[sz]e|confirm) (?:this )?(?:payment|purchase|transaction|login)\\b" +
      "|\\b(?:use|enter|input|key in)\\s+[0-9]{4,8}\\s+(?:to|for)\\s+(?:authenticate|verify|confirm|approve|authori[sz]e|complete)\\b" +
      "|(?:رمز (?:التحقق|التأكيد|الأمان)|كلمة المرور لمرة واحدة|ओटीपी|सत्यापन कोड)\\s*[:\\-]?\\s*[0-9٠-٩]{4,8}",
    RegexOption.IGNORE_CASE
  )

  fun shouldReject(body: String): Boolean = CREDENTIAL_RE.containsMatchIn(body)
}
