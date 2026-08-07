/**
 * What the Shortcut is allowed to tell the relay besides the message itself.
 *
 * The intended iOS automation passes the whole Message object, not just its
 * text, so the Shortcut can extract one field worth carrying: the sender.
 * Whether the installed iOS version exposes that detail to Run Shortcut must
 * be proven with a real alert on a physical phone before parity is claimed.
 * Android never had to ask for it — the inbox row it scans already names the
 * bank — but the relay only ever saw `text`, so every iOS row arrived with no
 * bank identity at all.
 * `bankFromSender` returned null, and two cards ending in the same four digits
 * at two different banks became indistinguishable: the import planner could
 * not tell them apart, and a payment could settle the wrong card's statement.
 *
 * The sender is a LABEL — "ADCB", "Emirates NBD", a shortcode — and that is
 * the only thing this accepts. It is not the message and is never stored or
 * logged in plaintext. It exists in the relay queue only inside device-sealed
 * ciphertext and goes no further than the user's own devices.
 * A caller that sends anything else is refused rather than trimmed into shape,
 * because the failure mode of quietly truncating an over-long value is storing
 * the first eighty characters of a bank message in a field that was supposed
 * to hold a bank name.
 */

/**
 * Must not exceed `MAX_RELAY_SENDER_LENGTH` in src/lib/relay.ts. The app
 * validates every field of a decrypted row and drops the WHOLE row when one
 * fails, so a sender this side accepts but the phone does not would not lose a
 * label — it would lose the transaction, silently, after the text is gone.
 */
export const MAX_RELAY_SENDER_LENGTH = 80;

/**
 * The codepoints a one-line bank label may never contain.
 *
 * Written as ranges rather than as a character class because every one of them
 * is invisible in source: a regex literal holding these would read as an empty
 * bracket expression, and a reviewer could not see what it excluded. The app
 * rejects exactly this set in `validRelaySender`.
 */
function unsafeSenderCodePoint(codePoint: number): boolean {
  return (
    // C0 controls: NUL, newline, tab — a label is one line.
    codePoint <= 0x1f ||
    // DEL and the C1 controls.
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    // Bidi embeddings and overrides, then the isolates. Both can make a
    // rendered sender read as a different bank than the row came from.
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

/**
 * Validate a caller-supplied sender label.
 *
 * Three outcomes, in the same shape the friendly-name validator in index.ts
 * uses: `null` for "nothing to attach" — the field is absent, or it is empty
 * once trimmed, which is what an older Shortcut and a manual text test both
 * produce — a normalized string to attach, or `undefined` for "malformed,
 * refuse the request".
 */
export function relaySender(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  for (const character of value) {
    if (unsafeSenderCodePoint(character.codePointAt(0) as number)) return undefined;
  }
  // Internal runs collapse rather than reject: iOS sender labels legitimately
  // contain non-breaking spaces, and a bank name is a bank name either way.
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  if ([...normalized].length > MAX_RELAY_SENDER_LENGTH) return undefined;
  return normalized;
}
