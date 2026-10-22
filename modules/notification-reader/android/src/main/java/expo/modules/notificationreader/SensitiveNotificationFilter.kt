package expo.modules.notificationreader

import java.text.Normalizer

/** Credentials are refused before the encrypted bank-notification queue. */
internal object SensitiveNotificationFilter {
  val CREDENTIAL_RE = Regex(
    "\\b(?:otp|one[ -]?time password|verification code|security code|authentication code|login code|passcode)\\b\\s*(?:is\\s*)?[:\\-]?\\s*[0-9]{4,8}\\b" +
      "|\\b[0-9]{4,8}\\s*(?:is\\s*)?(?:your\\s*)?(?:otp|one[ -]?time password|verification code|security code|authentication code|login code|passcode)\\b" +
      "|\\b(?:approve|authori[sz]e|confirm) (?:this )?(?:payment|purchase|transaction|login)\\b" +
      "|\\b(?:use|enter|input|key in)\\s+[0-9]{4,8}\\s+(?:to|for)\\s+(?:authenticate|verify|confirm|approve|authori[sz]e|complete)\\b" +
      "|(?:رمز (?:التحقق|التأكيد|الأمان)|كلمة المرور لمرة واحدة|ओटीपी|सत्यापन कोड)\\s*[:\\-]?\\s*[0-9٠-٩]{4,8}" +
      "|\\b(?:otp|one[ -]?time password|verification code|security code|authentication code|login code|passcode)\\b\\s+(?:for|to)\\b(?:(?!\\b(?:ref(?:erence)?|receipt|rrn)\\s*(?:is\\b|[:#=]))[^\\r\\n.!?;,]|(?<=\\p{Nd})[.,](?=\\p{Nd})){0,120}?\\s+(?:is\\s+|[:#=]\\s*)(?<!\\p{Nd})\\p{Nd}(?:[\\p{Zs}\\t\\p{Pd}]{0,3}\\p{Nd}){3,7}(?![\\p{Zs}\\t\\p{Pd}]{0,3}\\p{Nd})",
    RegexOption.IGNORE_CASE
  )

  // Keep the baseline above identical to the SMS boundary. These locale
  // additions bind an actual code to a credential label in either order;
  // ordinary completed-payment wording and code-sharing advice are not codes.
  private const val LOCAL_CREDENTIAL_LABELS =
    "(?:otp|verification code|security code|authentication code|login code|passcode" +
    "|best[aä]tigungscode|sicherheitscode|verifizierungscode|einmal(?:passwort|code)|anmeldecode|zugangscode|freigabecode|tan" +
    "|code\\s+(?:de\\s+|d['’]\\s*)(?:v[eé]rification|s[eé]curit[eé]|validation|authentification|connexion)|code\\s+unique|mot\\s+de\\s+passe\\s+[aà]\\s+usage\\s+unique" +
    "|c[oó]digo\\s+(?:de\\s+)?(?:verificaci[oó]n|seguridad|validaci[oó]n|autenticaci[oó]n|acceso)|contrase[nñ]a\\s+de\\s+un\\s+solo\\s+uso" +
    "|codice\\s+(?:di\\s+)?(?:verifica|sicurezza|autenticazione|accesso)|codice\\s+monouso|password\\s+monouso" +
    "|verificatiecode|beveiligingscode|inlogcode|authenticatiecode|eenmalige\\s+(?:code|wachtwoord)" +
    "|رمز\\s+(?:التحقق|التأكيد|التاكيد|الأمان|الامان)|كلمة\\s+المرور\\s+لمرة\\s+واحدة|ओटीपी|सत्यापन\\s+कोड)"

  // Four to eight digits may be displayed in groups. Keep separators bounded
  // and do not match a suffix/prefix of a longer grouped number. This pattern
  // is used only next to an explicit credential label, never for references.
  private const val LOCAL_CREDENTIAL_CODE =
    "(?<!\\p{Nd})(?<!\\p{Nd}[\\p{Zs}\\t\\p{Pd}]{1,3})\\p{Nd}(?:[\\p{Zs}\\t\\p{Pd}]{0,3}\\p{Nd}){3,7}(?![\\p{Zs}\\t\\p{Pd}]{0,3}\\p{Nd})"

  private val LOCAL_CREDENTIAL_RE = Regex(
    "(?<![\\p{L}\\p{N}])$LOCAL_CREDENTIAL_LABELS(?![\\p{L}\\p{N}])\\s*(?:(?:ist|lautet|est|es|[eè]|is|luidt|है)\\s*)?[:#=\\-]?\\s*$LOCAL_CREDENTIAL_CODE" +
      "|$LOCAL_CREDENTIAL_CODE\\s*[,;:\\-]?\\s*(?:(?:ist|est|es|[eè]|is|luidt)\\s+)?(?:(?:ihr(?:e|en)?|dein(?:e|en)?|votre|your|tu|su|il|tuo|uw|jouw|आपका|आपकी)\\s+){0,2}$LOCAL_CREDENTIAL_LABELS(?![\\p{L}\\p{N}])" +
      "|(?<![\\p{L}\\p{N}])(?:best[aä]tigen|best[aä]tige|autorisieren|genehmigen)\\s+(?:(?:sie|bitte|diese|diesen|die|den|ihre)\\s+){0,2}(?:zahlung|[uü]berweisung|transaktion|anmeldung|kauf)(?![\\p{L}\\p{N}])" +
      "|(?<![\\p{L}\\p{N}])(?:confirmez|validez|autorisez|authentifiez)\\s+(?:(?:ce|cet|cette|le|la|votre|une)\\s+){0,2}(?:paiement|achat|transaction|connexion|virement)(?![\\p{L}\\p{N}])" +
      "|(?<![\\p{L}\\p{N}])(?:confirma|confirmar|confirme|autoriza|autorizar|autorice|valida|validar)\\s+(?:(?:este|esta|el|la|tu|su|una)\\s+){0,2}(?:pago|compra|transacci[oó]n|transferencia|inicio\\s+de\\s+sesi[oó]n)(?![\\p{L}\\p{N}])" +
      "|(?<![\\p{L}\\p{N}])(?:conferma|confermare|autorizza|autorizzare|approva|approvare|verifica)\\s+(?:(?:questo|questa|il|la|tuo)\\s+){0,2}(?:pagamento|acquisto|transazione|accesso|bonifico)(?![\\p{L}\\p{N}])" +
      "|(?<![\\p{L}\\p{N}])(?:bevestig|bevestigen|autoriseer)\\s+(?:(?:deze|dit|de|het|uw|jouw)\\s+){0,2}(?:betaling|aankoop|transactie|overboeking|inloggen)(?![\\p{L}\\p{N}])",
    RegexOption.IGNORE_CASE,
  )

  private val FORMAT_MARK_RE = Regex("[\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]")

  fun shouldReject(body: String): Boolean {
    val normalized = FORMAT_MARK_RE.replace(Normalizer.normalize(body, Normalizer.Form.NFKC), "")
    return CREDENTIAL_RE.containsMatchIn(normalized) || LOCAL_CREDENTIAL_RE.containsMatchIn(normalized)
  }
}
