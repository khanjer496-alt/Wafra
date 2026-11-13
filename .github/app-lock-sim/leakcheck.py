#!/usr/bin/env python3
"""S7: no ledger content in any locked screenshot.
Reads OCR TSV (path<TAB>text). Ledger vocabulary = words on the UNLOCKED home reference
minus the lock screen's own copy; a locked shot leaks if it contains any of them, or an amount."""
import re, sys, json
ocr = {}
for line in open(sys.argv[1], encoding='utf-8'):
    p, _, t = line.rstrip('\n').partition('\t'); ocr[p] = t
home_ref, locked = sys.argv[2], sys.argv[3:]
words = lambda s: {w.lower() for w in re.findall(r'[^\W\d_]{4,}', s)}
lock_copy = "Wafra is locked Your balances stay hidden until you unlock That didn't work Try again Your phone passcode works too Unlock with Face ID Touch ID Cancel Enter Passcode Face Not Recognized Try Again Try Face ID Again Sign in to Apple Account Password"
vocab = words(ocr.get(home_ref, '')) - words(lock_copy)
amount = re.compile(r'\d[\d,]*[.,]\d{2}\b')
bad = []
report = {'ledger_vocabulary_size': len(vocab), 'checked': []}
for p in locked:
    t = ocr.get(p, '')
    hit = sorted(words(t) & vocab); amt = amount.findall(t)
    report['checked'].append({'shot': p, 'ocr': t, 'ledger_words_found': hit, 'amounts_found': amt})
    if hit or amt: bad.append(p)
print(json.dumps(report, ensure_ascii=False, indent=1))
sys.exit(1 if bad or len(vocab) < 5 else 0)
