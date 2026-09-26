"""Word pre-tokenizer shared (bit-for-bit) with src/lib/ai-alert-words.ts.

The tagger labels WORDS, not sub-word pieces: each word is encoded separately
by the SentencePiece tokenizer and its FIRST piece carries the word's label.
That keeps character offsets exact on device without tokenizer offset support.

Rules (per Unicode code point):
  letter  = general category L* or M*        -> maximal runs form one word
  digit   = general category Nd              -> a number: digits, and a separator
            from NUMBER_JOINERS directly followed by another digit continues it
  space   = SPACES                           -> separates, never a token
  other   = any other code point             -> a one-character token
Offsets are returned in UTF-16 code units (the app's string indices).
"""
import unicodedata

SPACES = set(" \t\n\r\f\v             "
             "    　﻿")
NUMBER_JOINERS = set(".,'’٫٬  ")


def _kind(ch):
    if ch in SPACES:
        return "S"
    cat = unicodedata.category(ch)
    if cat[0] in ("L", "M"):
        return "L"
    if cat == "Nd":
        return "N"
    return "P"


def words(text):
    """Return [(start_utf16, end_utf16, text)] for every word."""
    cps = list(text)
    u16 = [0]
    for ch in cps:
        u16.append(u16[-1] + (2 if ord(ch) > 0xFFFF else 1))
    out = []
    i, n = 0, len(cps)
    while i < n:
        k = _kind(cps[i])
        if k == "S":
            i += 1
            continue
        j = i + 1
        if k == "L":
            while j < n and _kind(cps[j]) == "L":
                j += 1
        elif k == "N":
            while j < n:
                kj = _kind(cps[j])
                if kj == "N":
                    j += 1
                elif cps[j] in NUMBER_JOINERS and j + 1 < n and _kind(cps[j + 1]) == "N":
                    j += 2
                else:
                    break
        out.append((u16[i], u16[j], "".join(cps[i:j])))
        i = j
    return out
