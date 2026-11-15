import hashlib
import json
import os
from pathlib import Path

legacy = json.load(open('legacy-harness-results.json'))
current = json.load(open('reviewer-harness-results.json'))
assert len(legacy) == len(current)
diffs = [b['id'] for a, b in zip(legacy, current) if a['id'] != b['id'] or a['result'] != b['result']['paths']]
errors = []
for row in current:
    paths = row['result']['paths']
    review = row['result'].get('review') or {}
    amount = str(row.get('minorUnits', 25000))
    native_posted = paths[2].startswith(('parsed:movement:credit:', 'parsed:movement:debit:'))
    held = paths[:2] == ['none', 'none'] and review.get('status') == 'informational' and (paths[2].startswith('review:') or row.get('nativeKnownBoundary'))
    expected = 'none' if row['expected'] == 'none' else row['expected'] + ':' + amount
    session = row.get('sessionExpected', row['expected'])
    expected_session = 'none' if session == 'none' else session + ':' + amount
    if row.get('incompleteExpense') and paths[2] != 'ignore:':
        errors.append((row['id'], 'incomplete-expense-money-preview', paths))
    if row.get('rejectBorrowedReview') and (paths[2] != 'ignore:' or review):
        errors.append((row['id'], 'borrowed-purchase-review', paths, review))
    if row.get('nativeKnownBoundary'):
        if not held or paths[2] != 'ignore:':
            errors.append((row['id'], 'native-boundary', paths))
        continue
    if not (row['expected'] == 'income' and held) and paths[:2] != [expected, expected_session]:
        errors.append((row['id'], 'source', paths))
    if row['expected'] == 'none' and native_posted:
        errors.append((row['id'], 'native-posted', paths))
    if row.get('requireDebitParity') and paths[2] != 'parsed:movement:debit:' + amount:
        errors.append((row['id'], 'debit-parity', paths))
meta = json.load(open('modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.meta.json'))
summary = {'head': os.environ['GITHUB_SHA'], 'sourceHash': meta['sourceHash'], 'rows': len(current),
           'harness_path_differences': diffs, 'expectation_failures': errors,
           'legacy_revision_parameterized_sha256': hashlib.sha256(Path('.github/reviewer-gate/legacy-probe.cjs').read_bytes()).hexdigest(),
           'unmodified_r4_harness_sha256': hashlib.sha256(Path('.github/reviewer-gate/r4-original-probe.cjs').read_bytes()).hexdigest(),
           'bound_source': str(Path('.github/reviewer-gate/scratch', os.environ['GITHUB_SHA']).resolve())}
json.dump(summary, open('reviewer-harness-summary.json', 'w'), ensure_ascii=False, indent=2)
print(json.dumps(summary, ensure_ascii=False))
assert summary['bound_source'] == str(Path.cwd()) and not diffs and not errors
