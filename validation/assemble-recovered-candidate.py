from pathlib import Path
import base64,hashlib,json,subprocess,sys,tempfile,textwrap,shutil
root=Path.cwd();app=root/'app';evidence=root/'recovery-evidence';evidence.mkdir(exist_ok=True)
# Reuse the earlier immutable 38-file source snapshot and all its SHA256 checks.
workflow=(root/'.github/workflows/redesign-browser-validation.yml').read_text()
body=workflow.split("python3 - <<'PY'\n",1)[1].split('\n          PY',1)[0]
exec(compile(textwrap.dedent(body),'<verified-redesign-snapshot>','exec'))
paths=['scripts/test/repair/journal-harness.cjs','scripts/test/repair/journal-ui.test.cjs','scripts/test/repair/reference-harness.cjs','scripts/test/repair/reference-redesign.test.cjs','scripts/test/repair/trend-accessibility.test.cjs','scripts/test/workflows/workflow-harness.cjs','scripts/test/workflows/workflow-source.test.cjs','scripts/test/workflows/workflow-ui.test.cjs']
base={}
for path in paths:
 result=subprocess.run(['git','show','HEAD:'+path],cwd=app,capture_output=True)
 base[path]=result.stdout.decode() if result.returncode==0 else ''
serialize=lambda value:json.dumps(value,separators=(',',':'),ensure_ascii=False).encode()
digest=lambda data:hashlib.sha256(data).hexdigest()
raw=serialize(base);assert digest(raw)=='9f329fd1042477533e3b9bd69f56cd7d55cb4fa404e8dcc573281a6a7fced940','Focused baseline changed'
encoded=''.join((root/'validation'/f'focused-tests-{part}.b64').read_text().strip() for part in ('a','b','c'))
delta=base64.b64decode(encoded,validate=True)
assert digest(delta)=='aafb34a660e5d5d416705135ca9d817dd0a928cacc54acec7d46acebd6a9c379','Focused delta mismatch'
with tempfile.TemporaryDirectory() as tmp:
 tmp=Path(tmp);(tmp/'base.json').write_bytes(raw);(tmp/'patch.zst').write_bytes(delta)
 subprocess.run(['zstd','-d','--patch-from='+str(tmp/'base.json'),str(tmp/'patch.zst'),'-o',str(tmp/'tests.json')],check=True)
 result=(tmp/'tests.json').read_bytes();assert digest(result)=='f8f5881fdacc3eb9051e8490eec7769162c50e64a8c6ad7976d7125a76a7a345'
 tests=json.loads(result);assert list(tests)==paths
 for path,text in tests.items():
  target=app/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(text)
subprocess.run([sys.executable,str(root/'validation/recover-source.py'),str(app)],check=True)
subprocess.run([sys.executable,str(root/'validation/recover-tests.py'),str(app)],check=True)
shutil.copyfile(root/'validation/redesign-contract-recovery.test.cjs',app/'scripts/test/repair/redesign-contract-recovery.test.cjs')
p=app/'scripts/test/run.sh';s=p.read_text();anchor='echo "run.sh: ${#SUITES[@]} app suites';i=s.index(anchor)
assert 'node --test repair/*.test.cjs workflows/*.test.cjs' not in s
p.write_text(s[:i]+'# Execute new interaction regressions in addition to every original gate.\nnode --test repair/*.test.cjs workflows/*.test.cjs\n\n'+s[i:])
manifest={p.relative_to(app).as_posix():digest(p.read_bytes()) for p in sorted((app/'src').rglob('*')) if p.is_file()}
assert digest(serialize(manifest))=='a5ee1c356e79432d6dab55ac50027ef0d91e464530e88ca8338c048d515ac3c0','Recovered production source differs from validated local source'
(evidence/'source-manifest.json').write_text(json.dumps({'base':'bcdf4f8b2d244801c3fb291454abaa293082dcd3','source_manifest_sha256':digest(serialize(manifest)),'files':manifest},indent=2))
(evidence/'test-manifest.json').write_text(json.dumps({p.relative_to(app).as_posix():digest(p.read_bytes()) for p in sorted((app/'scripts/test').rglob('*')) if p.is_file() and 'build' not in p.relative_to(app).parts},indent=2))
print('Verified complete 239-file production source against local green snapshot; retained original gates and added focused tests.')
