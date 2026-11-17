import collections,json,re,sys
from pathlib import Path
before_path,after_path,out_path=sys.argv[1:4]
def load(path):
    rows={}
    for line in Path(path).read_text().splitlines():
        fn,body,sender,shapes=json.loads(line);rows[(fn,body,sender)]=sorted(set(shapes))
    return rows
before,after=load(before_path),load(after_path)
income=lambda shapes:any(s.startswith(('income ','parsed income ')) for s in shapes)
expense=lambda shapes:any(s.startswith(('expense ','parsed expense ')) for s in shapes)
changed=[]
for key in sorted(before.keys()&after.keys()):
    if before[key]==after[key]:continue
    b,a=before[key],after[key]
    changed.append(dict(fn=key[0],body=key[1],sender=key[2],before=b,after=a,
        income='added' if income(a) and not income(b) else 'removed' if income(b) and not income(a) else 'same',
        expense='added' if expense(a) and not expense(b) else 'removed' if expense(b) and not expense(a) else 'same'))
only_before=[dict(fn=k[0],body=k[1],sender=k[2],before=before[k]) for k in sorted(before.keys()-after.keys())]
only_after=[dict(fn=k[0],body=k[1],sender=k[2],after=after[k]) for k in sorted(after.keys()-before.keys())]
summary=dict(before_keys=len(before),after_keys=len(after),shared_keys=len(before.keys()&after.keys()),changed=len(changed),
    changed_by=dict(collections.Counter(r['fn']+' income='+r['income']+' expense='+r['expense'] for r in changed)),
    only_before=len(only_before),only_after=len(only_after),only_before_income=sum(income(r['before']) for r in only_before),
    only_after_income=sum(income(r['after']) for r in only_after))
report=dict(summary=summary,changed=changed,only_before=only_before,only_after=only_after,
    limits=['A key is function/body/sender; result shapes are unions of calls with contexts not recorded by the historical tracer.',
            'Coverage-only rows and changed money require review; a zero new-income count on shared keys is not a full retention verdict.'])
Path(out_path).write_text(json.dumps(report,ensure_ascii=False,indent=1)+'\n')
print(json.dumps(summary,indent=2))
