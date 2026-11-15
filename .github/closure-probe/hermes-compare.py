import json

node = json.load(open('node-hermes-closure.json'))
hermes = json.load(open('hermes-closure.json'))
cases = json.load(open('hermes-cases.json'))
diffs = [(x, y) for x, y in zip(node['rows'], hermes['rows']) if x != y]
errors = []
for engine, rows in [('Node', node['rows']), ('Hermes013', hermes['rows'])]:
    for case, result in zip(cases, rows):
        amount = str(case.get('minorUnits', 25000))
        review = result.get('review') or {}
        informational = review.get('decision') == 'review' and review.get('status') == 'informational'
        if case.get('rejectBorrowedReview') and (result['nativeRoute'] != 'ignore' or review):
            errors.append((engine, case['id'], 'borrowed-purchase-review', result))
        if case.get('reviewMinorUnits') is not None and (review.get('minorUnits') != str(case['reviewMinorUnits']) or result.get('nativeMinorUnits') != str(case['reviewMinorUnits'])):
            errors.append((engine, case['id'], 'independent-credit-review-money', result))
        if case.get('nativeKnownBoundary'):
            ok = result['sms'] == result['session'] == 'none' and result['nativeRoute'] == 'ignore' and informational
            if case['nativeKnownBoundary'] == 'multiple-money-fields':
                ok = ok and review.get('minorUnits') is None and sorted(review.get('alternatives', [])) == sorted(case['reviewAlternatives'])
            else:
                ok = ok and review.get('minorUnits') == amount
            if not ok:
                errors.append((engine, case['id'], 'explicit-native-boundary', result))
            continue
        expected = 'none' if case['expected'] == 'none' else case['expected'] + ':' + amount
        session_kind = case.get('sessionExpected', case['expected'])
        session_expected = 'none' if session_kind == 'none' else session_kind + ':' + amount
        retained = informational and review.get('role') == 'transaction' and result['nativeRoute'] == 'review'
        accepted_review = (case['expected'] == 'income' or case.get('acceptInformationalReview')) and result['sms'] == result['session'] == 'none' and retained
        if not accepted_review and (result['sms'] != expected or result['session'] != session_expected):
            errors.append((engine, case['id'], 'source', result))
        if case.get('requireReview') and not retained:
            errors.append((engine, case['id'], 'review-retention', result))
        posted = result['native'].startswith(('credit:', 'debit:'))
        if case['expected'] == 'none' and posted:
            errors.append((engine, case['id'], 'unexpected-native-posting', result))
        if case.get('requireDebitParity') and result['native'] != 'debit:' + amount:
            errors.append((engine, case['id'], 'debit-parity', result))
        if posted and result['native'].split(':', 1)[1] != amount:
            errors.append((engine, case['id'], 'native-amount', result))
        native_expected = case.get('nativeExpected')
        if native_expected == 'no-post' and posted:
            errors.append((engine, case['id'], 'native', result))
        elif (native_expected == 'no-credit' or case['expected'] == 'expense') and result['native'].startswith('credit:'):
            errors.append((engine, case['id'], 'native', result))
        elif native_expected in ['credit', 'debit'] and result['native'] != native_expected + ':' + amount:
            errors.append((engine, case['id'], 'native', result))
        if case['expected'] == 'income' and result['native'].startswith('debit:'):
            errors.append((engine, case['id'], 'native-direction', result))
        if case['expected'] == 'income' and result.get('nativeNotification') and result['nativeNotification']['direction'] == 'debit':
            errors.append((engine, case['id'], 'native-review-direction', result))
        if case['id'] == 'reviewer-focused:S5' and result['sms'] != 'none' and result['merchant'] != 'أمازون':
            errors.append((engine, case['id'], 'merchant', result))
summary = {'sourceHash': node['sourceHash'], 'rows': len(node['rows']), 'engine_differences': len(diffs),
           'expectation_failures': len(errors), 'explicit_native_exclusions': sum(bool(c.get('nativeKnownBoundary')) for c in cases),
           'n13_equal': node['n13'] == hermes['n13'], 'differences': diffs, 'failures': errors}
json.dump(summary, open('hermes-summary.json', 'w'), ensure_ascii=False, indent=2)
print(json.dumps(summary, ensure_ascii=False))
assert node['sourceHash'] == hermes['sourceHash'] and len(node['rows']) == len(hermes['rows']) == len(cases)
assert not diffs and not errors and summary['n13_equal']
