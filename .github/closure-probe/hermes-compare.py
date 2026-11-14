import json,sys
node=json.load(open('node-hermes-closure.json')); hermes=json.load(open('hermes-closure.json'))
a=node['rows'];b=hermes['rows'];cases=json.load(open('scripts/test/repair/credit-settlement-sweep.json'))
diffs=[(x,y) for x,y in zip(a,b) if x!=y]; errors=[]
for engine,rows in [('Node',a),('Hermes013',b)]:
 for c,r in zip(cases,rows):
  expected='none' if c['expected']=='none' else c['expected']+':25000'
  session='none' if c['sessionExpected']=='none' else c['sessionExpected']+':25000'
  if r['sms']!=expected or r['session']!=session:errors.append((engine,c['id'],'source',r))
  n=c['nativeExpected']
  if n=='no-post' and r['native'].startswith(('credit:','debit:')):errors.append((engine,c['id'],'native',r))
  elif n=='no-credit' and r['native'].startswith('credit:'):errors.append((engine,c['id'],'native',r))
  elif n not in ['no-credit','no-post'] and r['native']!=n+':25000':errors.append((engine,c['id'],'native',r))
summary={'sourceHash':node['sourceHash'],'rows':len(a),'engine_differences':len(diffs),'expectation_failures':len(errors),'n13_equal':node['n13']==hermes['n13'],'differences':diffs,'failures':errors}
json.dump(summary,open('hermes-summary.json','w'),ensure_ascii=False,indent=2);print(json.dumps(summary,ensure_ascii=False))
assert len(a)==len(b)==443 and not diffs and not errors and summary['n13_equal']
