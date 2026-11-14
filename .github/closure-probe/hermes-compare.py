import json
node=json.load(open('node-hermes-closure.json')); hermes=json.load(open('hermes-closure.json'))
a=node['rows'];b=hermes['rows'];cases=json.load(open('hermes-cases.json'))
diffs=[(x,y) for x,y in zip(a,b) if x!=y]; errors=[]
for engine,rows in [('Node',a),('Hermes013',b)]:
 for c,r in zip(cases,rows):
  amount=str(c.get('minorUnits',25000));expected='none' if c['expected']=='none' else c['expected']+':'+amount
  ses=c.get('sessionExpected',c['expected']); session='none' if ses=='none' else ses+':'+amount
  rev=r.get('review') or {};retained=rev.get('decision')=='review' and rev.get('status')=='informational' and rev.get('role')=='transaction' and r['nativeRoute']=='review'
  accepted=(c['expected']=='income' or c.get('acceptInformationalReview')) and r['sms']=='none' and r['session']=='none' and retained
  if not accepted and (r['sms']!=expected or r['session']!=session):errors.append((engine,c['id'],'source',r))
  if c.get('requireReview') and not retained:errors.append((engine,c['id'],'review-retention',r))
  if c['expected']=='none' and r['native'].startswith(('credit:','debit:')):errors.append((engine,c['id'],'unexpected-native-posting',r))
  if c.get('requireDebitParity') and r['native']!='debit:'+amount:errors.append((engine,c['id'],'debit-parity',r))
  if c['expected']=='income' and r['native'].startswith('debit:'):errors.append((engine,c['id'],'native-direction',r))
  if r['native'].startswith(('credit:','debit:')) and r['native'].split(':',1)[1]!=amount:errors.append((engine,c['id'],'native-amount',r))
  n=c.get('nativeExpected')
  if n=='no-post' and r['native'].startswith(('credit:','debit:')):errors.append((engine,c['id'],'native',r))
  elif (n=='no-credit' or c['expected']=='expense') and r['native'].startswith('credit:'):errors.append((engine,c['id'],'native',r))
  elif n in ['credit','debit'] and r['native']!=n+':'+amount:errors.append((engine,c['id'],'native',r))
  if c['id']=='reviewer-focused:S5' and r['sms']!='none' and r['merchant']!='أمازون':errors.append((engine,c['id'],'merchant',r))
summary={'sourceHash':node['sourceHash'],'rows':len(a),'engine_differences':len(diffs),'expectation_failures':len(errors),'n13_equal':node['n13']==hermes['n13'],'differences':diffs,'failures':errors}
json.dump(summary,open('hermes-summary.json','w'),ensure_ascii=False,indent=2);print(json.dumps(summary,ensure_ascii=False))
assert len(a)==len(b)==len(cases) and not diffs and not errors and summary['n13_equal']
