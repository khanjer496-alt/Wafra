import importlib.util, pathlib, unittest, tempfile, json, zipfile, hashlib, copy, sys, base64, struct
ROOT=pathlib.Path(__file__).resolve().parents[3]
HELPER=ROOT/'scripts/ci/android-static-report.py'
def module():
    assert HELPER.is_file(), 'pre-seal complete static report producer is absent'
    spec=importlib.util.spec_from_file_location('report',HELPER);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
# Real-format fixtures from one manifest (tests/fixture source in the evidence packet):
# APK_MANIFEST_B64 = binary AndroidManifest.xml from SDK build-tools 36.0.0 aapt2 2.20-13193326 `link`;
# AAB_DUMP = exact stdout of pinned bundletool 1.18.3 `dump manifest` on the proto-format AAB of the same manifest.
APK_MANIFEST_B64=(
    'AwAIAEAMAAABABwAjAcAACoAAAAAAAAAAAAAAMQAAAAAAAAAAAAAAA4AAAAaAAAAMgAAAEQAAABWAAAAbgAAAIIAAACcAAAAqgAA'
    'AMgAAADiAAAA/AAAACABAABGAQAAfAEAAIoBAACSAQAAwgEAANYBAADoAQAAMgIAAHICAADEAgAAVgMAAMoDAADwAwAAMAQAAHgE'
    'AACSBAAAEgUAAGoFAAB+BQAAlAUAAKYFAADaBQAADgYAACIGAAA2BgAASAYAAGoGAAB+BgAABQBsAGEAYgBlAGwAAAAEAG4AYQBt'
    'AGUAAAAKAHAAZQByAG0AaQBzAHMAaQBvAG4AAAAHAGgAYQBzAEMAbwBkAGUAAAAHAGUAbgBhAGIAbABlAGQAAAAKAGQAZQBiAHUA'
    'ZwBnAGEAYgBsAGUAAAAIAGUAeABwAG8AcgB0AGUAZAAAAAsAYQB1AHQAaABvAHIAaQB0AGkAZQBzAAAABQB2AGEAbAB1AGUAAAAN'
    'AG0AaQBuAFMAZABrAFYAZQByAHMAaQBvAG4AAAALAHYAZQByAHMAaQBvAG4AQwBvAGQAZQAAAAsAdgBlAHIAcwBpAG8AbgBOAGEA'
    'bQBlAAAAEAB0AGEAcgBnAGUAdABTAGQAawBWAGUAcgBzAGkAbwBuAAAAEQBjAG8AbQBwAGkAbABlAFMAZABrAFYAZQByAHMAaQBv'
    'AG4AAAAZAGMAbwBtAHAAaQBsAGUAUwBkAGsAVgBlAHIAcwBpAG8AbgBDAG8AZABlAG4AYQBtAGUAAAAFADEALgAwAC4AMAAAAAIA'
    'MQA2AAAAFgBXAGEAZgByAGEAIAAmACAAPABIBkEGMQYpBj4AIAAiAHEAIgAgACcAYQAnAAAACABhAGMAdABpAHYAaQB0AHkAAAAH'
    'AGEAbgBkAHIAbwBpAGQAAAAjAGEAbgBkAHIAbwBpAGQALgBwAGUAcgBtAGkAcwBzAGkAbwBuAC4AQgBJAE4ARABfAEoATwBCAF8A'
    'UwBFAFIAVgBJAEMARQAAAB4AYQBuAGQAcgBvAGkAZAAuAHAAZQByAG0AaQBzAHMAaQBvAG4ALgBSAEUAQwBFAEkAVgBFAF8AUwBN'
    'AFMAAAAnAGEAbgBkAHIAbwBpAGQAeAAuAHMAdABhAHIAdAB1AHAALgBJAG4AaQB0AGkAYQBsAGkAegBhAHQAaQBvAG4AUAByAG8A'
    'dgBpAGQAZQByAAAARwBhAG4AZAByAG8AaQBkAHgALgB3AG8AcgBrAC4AaQBtAHAAbAAuAGIAYQBjAGsAZwByAG8AdQBuAGQALgBz'
    'AHkAcwB0AGUAbQBhAGwAYQByAG0ALgBDAG8AbgBzAHQAcgBhAGkAbgB0AFAAcgBvAHgAeQBVAHAAZABhAHQAZQBSAGUAYwBlAGkA'
    'dgBlAHIAAAA4AGEAbgBkAHIAbwBpAGQAeAAuAHcAbwByAGsALgBpAG0AcABsAC4AYgBhAGMAawBnAHIAbwB1AG4AZAAuAHMAeQBz'
    'AHQAZQBtAGoAbwBiAC4AUwB5AHMAdABlAG0ASgBvAGIAUwBlAHIAdgBpAGMAZQAAABEAYQBwAHAALgB3AGEAZgByAGEALgBhAG4A'
    'ZAByAG8AaQBkAAAAHgBhAHAAcAAuAHcAYQBmAHIAYQAuAGEAbgBkAHIAbwBpAGQALgBNAGEAaQBuAEEAYwB0AGkAdgBpAHQAeQAA'
    'ACIAYQBwAHAALgB3AGEAZgByAGEALgBhAG4AZAByAG8AaQBkAC4AYQBuAGQAcgBvAGkAZAB4AC0AcwB0AGEAcgB0AHUAcAAAAAsA'
    'YQBwAHAAbABpAGMAYQB0AGkAbwBuAAAAPgBlAHgAcABvAC4AbQBvAGQAdQBsAGUAcwAuAHUAcABkAGEAdABlAHMALgBVAFAARABB'
    'AFQARQBTAF8AQwBPAE4ARgBJAEcAVQBSAEEAVABJAE8ATgBfAFIARQBRAFUARQBTAFQAXwBIAEUAQQBEAEUAUgBTAF8ASwBFAFkA'
    'AAAqAGgAdAB0AHAAOgAvAC8AcwBjAGgAZQBtAGEAcwAuAGEAbgBkAHIAbwBpAGQALgBjAG8AbQAvAGEAcABrAC8AcgBlAHMALwBh'
    'AG4AZAByAG8AaQBkAAAACABtAGEAbgBpAGYAZQBzAHQAAAAJAG0AZQB0AGEALQBkAGEAdABhAAAABwBwAGEAYwBrAGEAZwBlAAAA'
    'GABwAGwAYQB0AGYAbwByAG0AQgB1AGkAbABkAFYAZQByAHMAaQBvAG4AQwBvAGQAZQAAABgAcABsAGEAdABmAG8AcgBtAEIAdQBp'
    'AGwAZABWAGUAcgBzAGkAbwBuAE4AYQBtAGUAAAAIAHAAcgBvAHYAaQBkAGUAcgAAAAgAcgBlAGMAZQBpAHYAZQByAAAABwBzAGUA'
    'cgB2AGkAYwBlAAAADwB1AHMAZQBzAC0AcABlAHIAbQBpAHMAcwBpAG8AbgAAAAgAdQBzAGUAcwAtAHMAZABrAAAAIgB7ACIAZQB4'
    'AHAAbwAtAGMAaABhAG4AbgBlAGwALQBuAGEAbQBlACIAOgAiAHAAcgBvAGQAdQBjAHQAaQBvAG4AIgB9AAAAAACAAQgARAAAAAEA'
    'AQEDAAEBBgABAQwAAQEOAAEBDwABARAAAQEYAAEBJAABAQwCAQEbAgEBHAIBAXACAQFyBQEBcwUBAQABEAAYAAAAAgAAAP////8T'
    'AAAAHgAAAAIBEACwAAAAAgAAAP//////////HwAAABQAFAAHAAAAAAAAAB4AAAAKAAAA/////wgAABCXAQAAHgAAAAsAAAAPAAAA'
    'CAAAAw8AAAAeAAAADQAAAP////8IAAAQJAAAAB4AAAAOAAAAEAAAAAgAAAMQAAAA/////yEAAAAZAAAACAAAAxkAAAD/////IgAA'
    'AP////8IAAAQJAAAAP////8jAAAA/////wgAABAQAAAAAgEQAEwAAAADAAAA//////////8oAAAAFAAUAAIAAAAAAAAAHgAAAAkA'
    'AAD/////CAAAEBgAAAAeAAAADAAAAP////8IAAAQJAAAAAMBEAAYAAAAAwAAAP//////////KAAAAAIBEAA4AAAABAAAAP//////'
    '////JwAAABQAFAABAAAAAAAAAB4AAAABAAAAFQAAAAgAAAMVAAAAAwEQABgAAAAEAAAA//////////8nAAAAAgEQAGAAAAAFAAAA'
    '//////////8cAAAAFAAUAAMAAAAAAAAAHgAAAAAAAAARAAAACAAAAxEAAAAeAAAAAwAAAP////8IAAASAAAAAB4AAAAFAAAA////'
    '/wgAABIAAAAAAgEQAEwAAAAGAAAA//////////8SAAAAFAAUAAIAAAAAAAAAHgAAAAEAAAAaAAAACAAAAxoAAAAeAAAABgAAAP//'
    '//8IAAAS/////wMBEAAYAAAABgAAAP//////////EgAAAAIBEABgAAAABwAAAP//////////JAAAABQAFAADAAAAAAAAAB4AAAAB'
    'AAAAFgAAAAgAAAMWAAAAHgAAAAYAAAD/////CAAAEgAAAAAeAAAABwAAABsAAAAIAAADGwAAAAMBEAAYAAAABwAAAP//////////'
    'JAAAAAIBEAB0AAAACAAAAP//////////JgAAABQAFAAEAAAAAAAAAB4AAAABAAAAGAAAAAgAAAMYAAAAHgAAAAIAAAAUAAAACAAA'
    'AxQAAAAeAAAABAAAAP////8IAAABAQABfx4AAAAGAAAA/////wgAABL/////AwEQABgAAAAIAAAA//////////8mAAAAAgEQAGAA'
    'AAAJAAAA//////////8lAAAAFAAUAAMAAAAAAAAAHgAAAAEAAAAXAAAACAAAAxcAAAAeAAAABAAAAP////8IAAABAAABfx4AAAAG'
    'AAAA/////wgAABIAAAAAAwEQABgAAAAJAAAA//////////8lAAAAAgEQAEwAAAAKAAAA//////////8gAAAAFAAUAAIAAAAAAAAA'
    'HgAAAAEAAAAdAAAACAAAAx0AAAAeAAAACAAAACkAAAAIAAADKQAAAAMBEAAYAAAACgAAAP//////////IAAAAAMBEAAYAAAABQAA'
    'AP//////////HAAAAAMBEAAYAAAAAgAAAP//////////HwAAAAEBEAAYAAAAAgAAAP////8TAAAAHgAAAA=='
)
AAB_DUMP="<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" android:compileSdkVersion=\"36\" android:compileSdkVersionCodename=\"16\" android:versionCode=\"407\" android:versionName=\"1.0.0\" package=\"app.wafra.android\" platformBuildVersionCode=\"36\" platformBuildVersionName=\"16\">\n    \n  <uses-sdk android:minSdkVersion=\"24\" android:targetSdkVersion=\"36\"/>\n    \n  <uses-permission android:name=\"android.permission.RECEIVE_SMS\"/>\n    \n  <application android:debuggable=\"false\" android:hasCode=\"false\" android:label=\"Wafra &amp; &lt;وفرة&gt; &quot;q&quot; 'a'\">\n        \n    <activity android:exported=\"true\" android:name=\"app.wafra.android.MainActivity\"/>\n        \n    <provider android:authorities=\"app.wafra.android.androidx-startup\" android:exported=\"false\" android:name=\"androidx.startup.InitializationProvider\"/>\n        \n    <service android:enabled=\"@bool/enable_system_job_service_default\" android:exported=\"true\" android:name=\"androidx.work.impl.background.systemjob.SystemJobService\" android:permission=\"android.permission.BIND_JOB_SERVICE\"/>\n        \n    <receiver android:enabled=\"@bool/enable_system_alarm_service_default\" android:exported=\"false\" android:name=\"androidx.work.impl.background.systemalarm.ConstraintProxyUpdateReceiver\"/>\n        \n    <meta-data android:name=\"expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY\" android:value=\"{&quot;expo-channel-name&quot;:&quot;production&quot;}\"/>\n      \n  </application>\n  \n</manifest>\n"
LABEL='Wafra & <وفرة> "q" \'a\''
def apk_with(manifest_bytes,directory):
    path=pathlib.Path(directory)/'fixture.apk'
    with zipfile.ZipFile(path,'w') as z:z.writestr('AndroidManifest.xml',manifest_bytes)
    return path
ANDROID_IDS={'label':0x01010001,'name':0x01010003,'permission':0x01010006,'enabled':0x0101000e,'debuggable':0x0101000f,'exported':0x01010010,'authorities':0x01010018,'value':0x01010024,'minSdkVersion':0x0101020c,'versionCode':0x0101021b,'versionName':0x0101021c,'targetSdkVersion':0x01010270}
def axml(root,utf8=False,extra=b'',mutate=None,pool_extra=(),dup_offsets=0,ns_layout='wrap',astart=20,ids=None,resmap=True):
    # Minimal Android binary XML writer for malformed/edge controls; element=(tag,[(ns,name,type,data)],children).
    strings=[];index=lambda s:strings.index(s) if s in strings else (strings.append(s) or len(strings)-1);attr_ids={}
    table=dict(ANDROID_IDS,**(ids or {}))
    A='http://schemas.android.com/apk/res/android';index('android');index(A);body=[]
    def chunk(kind,head,payload=b''):return struct.pack('<HHI',kind,8+len(head),8+len(head)+len(payload))+head+payload
    def node(e):
        tag,attrs,children=e;parts=b''
        for ns,name,typ,val in attrs:
            data=index(val) if typ==3 else val
            if ns and name in table:attr_ids[index(name)]=table[name]
            elif ns is None and name in (ids or {}):attr_ids[index(name)]=ids[name]
            parts+=struct.pack('<IIIHBBI',index(A) if ns else 0xFFFFFFFF,index(name),data if typ==3 else 0xFFFFFFFF,8,0,typ,data)
        body.append(chunk(0x0102,struct.pack('<II',1,0xFFFFFFFF),struct.pack('<IIHHHHHH',0xFFFFFFFF,index(tag),astart,20,len(attrs),0,0,0)+b'\0'*(astart-20)+parts))
        for c in children:node(c)
        body.append(chunk(0x0103,struct.pack('<II',1,0xFFFFFFFF),struct.pack('<II',0xFFFFFFFF,index(tag))))
    node(root);[index(s) for s in pool_extra]
    ns=lambda k,uri=1:chunk(k,struct.pack('<II',1,0xFFFFFFFF),struct.pack('<II',0,uri))
    blobs=[]
    for s in strings:
        if utf8:
            raw=s.encode();l8=lambda n:bytes([n]) if n<0x80 else bytes([0x80|n>>8,n&0xff])
            blobs.append(l8(len(s))+l8(len(raw))+raw+b'\0')
        else:blobs.append((struct.pack('<H',len(s)) if len(s)<0x8000 else struct.pack('<HH',0x8000|len(s)>>16,len(s)&0xffff))+s.encode('utf-16-le')+b'\0\0')
    offsets=[];data=b''
    for b in blobs:offsets.append(len(data));data+=b
    offsets+=[offsets[-1]]*dup_offsets  # extra pool entries sharing one physical string
    data+=b'\0'*(-len(data)%4)
    pool=chunk(0x0001,struct.pack('<IIIII',len(offsets),0,0x100 if utf8 else 0,28+4*len(offsets),0),struct.pack('<%dI'%len(offsets),*offsets)+data)
    elements=b''.join(body)
    if resmap:
        width=max(attr_ids)+1 if attr_ids else 0
        pool+=chunk(0x0180,b'',struct.pack('<%dI'%width,*[attr_ids.get(i,0) for i in range(width)]))
    layout={'wrap':ns(0x0100)+elements+ns(0x0101),'unclosed':ns(0x0100)+elements,'mismatched':ns(0x0100)+elements+ns(0x0101,uri=0),
            'early-end':ns(0x0100)+ns(0x0101)+elements}[ns_layout]
    inner=pool+layout+extra
    out=bytearray(struct.pack('<HHI',3,8,8+len(inner))+inner)
    if mutate:mutate(out)
    return bytes(out)
class ReportContract(unittest.TestCase):
    def test_report_producer_exists(self): self.assertTrue(HELPER.is_file(), 'pre-seal complete static report producer is absent')
    def test_safe_inputs_are_explicit_and_role_bound(self):
        m=module();values=dict(bundle=True,corpus=False,founder_unlock=False,auto_pro=False,architecture='universal',capture_trace=False)
        self.assertEqual(m.inputs(values,'rc')['bundle'],True)
        for key in ['corpus','founder_unlock','auto_pro','capture_trace']:
            bad=dict(values,**{key:True})
            with self.assertRaises(m.Refusal):m.inputs(bad,'rc')
        for bad in [dict(values,extra='token'),{k:v for k,v in values.items() if k!='founder_unlock'},dict(values,bundle=False)]:
            with self.assertRaises(m.Refusal):m.inputs(bad,'rc')
    def test_manifest_records_complete_permissions_and_components(self):
        m=module();x='<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="app.wafra.android" android:versionCode="407" android:versionName="1.0.0"><uses-sdk android:minSdkVersion="24" android:targetSdkVersion="36"/><uses-permission android:name="android.permission.READ_SMS"/><application android:debuggable="false"><activity android:name=".MainActivity" android:exported="true"/><service android:name=".Capture" android:exported="false"/><meta-data android:name="expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY" android:value="{&quot;expo-channel-name&quot;:&quot;production&quot;}"/></application></manifest>'
        v=m.manifest(x,407,'rc');self.assertEqual(v['permissions'],['android.permission.READ_SMS']);self.assertEqual(len(v['components']),2);self.assertEqual(v['productionChannel'],True)
        for text in [x.replace('debuggable="false"','debuggable="true"'),x.replace('versionCode="407"','versionCode="405"'),x.replace('production','preview'),x.replace('READ_SMS','SYSTEM_ALERT_WINDOW')]:
            with self.assertRaises(m.Refusal):m.manifest(text,407,'rc')
        # Control can retain the documented template overlay/channel difference.
        self.assertFalse(m.manifest(x.replace('production','preview').replace('READ_SMS','SYSTEM_ALERT_WINDOW'),407,'control')['productionChannel'])
    def test_xml_entity_and_oversized_or_unknown_values_refused(self):
        m=module()
        for x in ['<!DOCTYPE manifest [<!ENTITY a "x">]><manifest/>','x'*262145,'<manifest/>']:
            with self.assertRaises(m.Refusal):m.manifest(x,407,'rc')
    def test_signature_rejects_mismatch_multiple_or_missing(self):
        m=module();good='Signer #1 certificate SHA-256 digest: '+m.EXPECTED_SIGNER
        self.assertEqual(m.apk_signer(good),m.EXPECTED_SIGNER)
        for text in [good.replace(m.EXPECTED_SIGNER,'a'*64),good+'\n'+good,'secret-token']:
            with self.assertRaises(m.Refusal):m.apk_signer(text)
    def test_drift_only_exact_version_stamp_allowed(self):
        m=module()
        before={'expo':{'name':'Wafra','android':{'package':'app.wafra.android','versionCode':1}}}
        after=copy.deepcopy(before);after['expo']['android']['versionCode']=407
        self.assertTrue(m.version_stamp(before,after,407))
        after['expo']['name']='altered'
        with self.assertRaises(m.Refusal):m.version_stamp(before,after,407)
    def test_archive_inventory_requires_exact_abis_no_duplicate_or_traversal(self):
        m=module()
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'f.aab'
            def write(names):
                with zipfile.ZipFile(path,'w') as z:
                    for name in names:z.writestr(name,b'synthetic')
            names=['base/lib/arm64-v8a/a.so','base/lib/armeabi-v7a/a.so','base/assets/index.android.bundle','base/dex/classes.dex']
            write(names);self.assertEqual(m.inventory(path,'aab'),['arm64-v8a','armeabi-v7a'])
            for bad in [names+['../outside'],names+['base/lib/x86/a.so'],names[:-3]]:
                write(bad)
                with self.assertRaises(m.Refusal):m.inventory(path,'aab')
    def test_missing_or_enabled_compiled_flag_refused(self):
        m=module();good={x:'off' for x in m.FLAGS};self.assertEqual(m.compiled_flags(good),good)
        for bad in [{},dict(good,**{'founder-unlock':'on'}),dict(good,token='hidden')]:
            with self.assertRaises(m.Refusal):m.compiled_flags(bad)
    def test_schema_refuses_unknown_fields_and_report_above_64k(self):
        m=module();schema={'type':'object','additionalProperties':False,'required':['status'],'properties':{'status':{'const':'passed'}}}
        m.validate({'status':'passed'},schema)
        with self.assertRaises(m.Refusal):m.validate({'status':'passed','password':'secret'},schema)
        with self.assertRaises(m.Refusal):m.encoded({'status':'x'*65536})
    def test_native_command_failure_has_only_closed_vocabulary(self):
        m=module()
        def failed(*a,**kw):raise RuntimeError('password=DO_NOT_EMIT')
        with self.assertRaisesRegex(m.Refusal,'^tool-failed$'):m.checked(failed,['tool'],label='probe')
    def test_final_ref_identity_and_provenance_are_immutable(self):
        m=module();sha='a'*40;env={'GITHUB_REPOSITORY':'khanjer496-alt/Wafra','GITHUB_SHA':sha,'GITHUB_REF_NAME':'android/final-rc-'+sha[:12],'GITHUB_RUN_ID':'42','GITHUB_RUN_NUMBER':'407','GITHUB_RUN_ATTEMPT':'1'}
        self.assertEqual(m.provenance(env)['role'],'rc')
        for key,val in [('GITHUB_RUN_NUMBER','405'),('GITHUB_REF_NAME','main'),('GITHUB_SHA','branch'),('GITHUB_REPOSITORY','other/repo')]:
            with self.assertRaises(m.Refusal):m.provenance(dict(env,**{key:val}))

    def test_real_shaped_manifest_authority_and_resource_enabled(self):
        m=module();x='<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="app.wafra.android" android:versionCode="407" android:versionName="1.0.0"><uses-sdk android:minSdkVersion="24" android:targetSdkVersion="36"/><application><provider android:name="androidx.startup.InitializationProvider" android:exported="false" android:authorities="app.wafra.android.androidx-startup"/><service android:name="androidx.work.impl.background.systemjob.SystemJobService" android:enabled="ENABLED" android:exported="true" android:permission="android.permission.BIND_JOB_SERVICE"/><meta-data android:name="expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY" android:value="{&quot;expo-channel-name&quot;:&quot;production&quot;}"/></application></manifest>'
        for ref in ['@bool/enable_system_job_service_default','@0x7f050004']:
            v=m.manifest(x.replace('ENABLED',ref),407,'rc');c={i['name']:i for i in v['components']}
            self.assertEqual(c['androidx.startup.InitializationProvider']['authorities'],'app.wafra.android.androidx-startup')
            self.assertIsNone(c['androidx.work.impl.background.systemjob.SystemJobService']['enabled']);self.assertEqual(c['androidx.work.impl.background.systemjob.SystemJobService']['enabledReference'],ref)
        self.assertTrue(m.manifest(x.replace('ENABLED','true'),407,'rc')['components'][1]['enabled'])
        # exported stays literal-only; references, unknown words and unsafe authorities are refused.
        for bad in [x.replace('ENABLED','yes'),x.replace('ENABLED','@string/x'),x.replace('ENABLED','@ref/0x7f050004'),x.replace('ENABLED','@app.wafra.android:bool/x'),x.replace('ENABLED','@0x7F050004'),x.replace('ENABLED','true').replace('android:exported="true"','android:exported="@0x7f050004"'),x.replace('ENABLED','true').replace('androidx-startup','androidx startup'),x.replace('ENABLED','true').replace('androidx-startup','a/../b')]:
            with self.assertRaises(m.Refusal):m.manifest(bad,407,'rc')
    def test_tool_streams_stdout_xml_mixed_status_and_bounds(self):
        m=module();py=sys.executable;x='<manifest/>'
        warn=[py,'-c','import sys;sys.stdout.write("'+x+'");sys.stderr.write("WARNING: notice\\n")']
        self.assertEqual(m.raw_run(warn,stream='stdout'),x)
        mixed=m.raw_run(warn);self.assertIn(x,mixed);self.assertIn('WARNING',mixed)
        with self.assertRaisesRegex(m.Refusal,'^manifest-xml$'):m.manifest(mixed.strip(),407,'rc')
        self.assertIn('17.0.9',m.raw_run([py,'-c','import sys;sys.stderr.write(\'openjdk version "17.0.9"\')']))
        for argv,code in [([py,'-c','import sys;sys.stdout.write("'+x+'");sys.exit(3)'],'tool-failed'),([py,'-c','import sys;sys.stderr.write("e"*(8*1024*1024+1))'],'tool-output-size')]:
            with self.assertRaisesRegex(m.Refusal,'^'+code+'$'):m.raw_run(argv,stream='stdout')
        with self.assertRaisesRegex(m.Refusal,'^tool-failed$'):m.checked(m.raw_run,warn[:2]+['import sys;sys.exit(2)'],'bundletool-manifest',stream='stdout')
        with self.assertRaises(m.Refusal):m.raw_run(warn,stream='stderr')
    def test_binary_apk_manifest_real_aapt2_format(self):
        m=module();data=base64.b64decode(''.join(APK_MANIFEST_B64))
        with tempfile.TemporaryDirectory() as tmp:
            xml=m.binary_manifest(apk_with(data,tmp))
        v=m.manifest(xml,407,'rc');c={i['name']:i for i in v['components']}
        self.assertTrue(v['productionChannel']);self.assertFalse(v['overlayPermission']);self.assertEqual(v['permissions'],['android.permission.RECEIVE_SMS'])
        tree=m.ET.fromstring(xml);self.assertEqual(tree.find('application').get(m.NS+'label'),LABEL)
        self.assertEqual(c['androidx.startup.InitializationProvider']['authorities'],'app.wafra.android.androidx-startup')
        for name in ['androidx.work.impl.background.systemjob.SystemJobService','androidx.work.impl.background.systemalarm.ConstraintProxyUpdateReceiver']:
            self.assertIsNone(c[name]['enabled']);self.assertRegex(c[name]['enabledReference'],'^@0x7f[0-9a-f]{6}$')
        # Same source manifest through the AAB reader: identical typed facts, reference rendered by name.
        w=m.manifest(AAB_DUMP.strip(),407,'rc');d={i['name']:i for i in w['components']}
        self.assertEqual(w['permissions'],v['permissions']);self.assertEqual(w['productionChannel'],v['productionChannel'])
        for key in ['kind','exported','enabled','permission','authorities']:
            self.assertEqual({n:i[key] for n,i in c.items()},{n:i[key] for n,i in d.items()})
        self.assertEqual(d['androidx.work.impl.background.systemjob.SystemJobService']['enabledReference'],'@bool/enable_system_job_service_default')
        self.assertEqual(m.ET.fromstring(AAB_DUMP).find('application').get(m.NS+'label'),LABEL)
        # A text rendering with unescaped JSON quotes (apkanalyzer/aapt2 style) is refused, never repaired.
        with self.assertRaisesRegex(m.Refusal,'^manifest-xml$'):m.manifest(xml.replace('&quot;','"'),407,'rc')
    def test_binary_manifest_typed_values_and_fail_closed(self):
        m=module();B='http://schemas.android.com/apk/res/android'
        def root(attrs=(),children=()):
            return ('manifest',[(None,'package',3,'app.wafra.android'),(1,'versionCode',0x10,407),(1,'versionName',3,'1.0.0')]+list(attrs),[('uses-sdk',[(1,'minSdkVersion',0x10,24),(1,'targetSdkVersion',0x10,36)],[]),('application',[(1,'debuggable',0x12,0)],[('service',[(1,'name',3,'a.B'),(1,'exported',0x12,0xFFFFFFFF),(1,'enabled',0x01,0x7f050004)],[]),('meta-data',[(1,'name',3,'expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY'),(1,'value',3,'{"expo-channel-name":"production"}')],[])]+list(children))])
        with tempfile.TemporaryDirectory() as tmp:
            for utf8 in [False,True]:
                v=m.manifest(m.binary_manifest(apk_with(axml(root(),utf8=utf8),tmp)),407,'rc')
                self.assertEqual(v['components'][0]['exported'],True);self.assertEqual(v['components'][0]['enabledReference'],'@0x7f050004')
            deep=('activity',[(1,'name',3,'a.C')],[]);
            for _ in range(64):deep=('intent-filter',[],[deep])
            def end_name(b):struct.pack_into('<I',b,len(b)-24-4,0)
            bad=[b'',b'not axml',axml(root())[:-8],axml(root(),extra=struct.pack('<HHI',0x0104,8,8)),axml(root(),extra=b'\0'*8),
                 axml(root([(1,'versionCode',0x10,1)])),axml(root([(1,'exported',0x07,1)])),axml(root([(1,'debuggable',0x12,5)])),
                 axml(root(children=[deep])),axml(root(),mutate=end_name),axml(root(),mutate=lambda b:struct.pack_into('<I',b,4,len(b)+4))]
            for blob in bad:
                with self.assertRaisesRegex(m.Refusal,'^apk-binary-manifest$'):m.binary_manifest(apk_with(blob,tmp))
            empty=pathlib.Path(tmp)/'empty.apk'
            with zipfile.ZipFile(empty,'w') as z:z.writestr('classes.dex',b'x')
            with self.assertRaisesRegex(m.Refusal,'^apk-binary-manifest$'):m.binary_manifest(empty)
            big=pathlib.Path(tmp)/'big.apk'
            with zipfile.ZipFile(big,'w',zipfile.ZIP_DEFLATED) as z:z.writestr('AndroidManifest.xml',b'\0'*(4*1024*1024+1))
            with self.assertRaisesRegex(m.Refusal,'^apk-binary-manifest$'):m.binary_manifest(big)
    def test_binary_manifest_layout_namespace_and_resource_budgets(self):
        m=module()
        def root(attrs=(),children=()):
            return ('manifest',[(None,'package',3,'app.wafra.android'),(1,'versionCode',0x10,407),(1,'versionName',3,'1.0.0')]+list(attrs),[('uses-sdk',[(1,'minSdkVersion',0x10,24),(1,'targetSdkVersion',0x10,36)],[]),('application',[(1,'debuggable',0x12,0)],[('activity',[(1,'name',3,'a.B')],[]),('meta-data',[(1,'name',3,'expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY'),(1,'value',3,'{"expo-channel-name":"production"}')],[])]+list(children))])
        big='x'*30000
        with tempfile.TemporaryDirectory() as tmp:
            read=lambda blob:m.binary_manifest(apk_with(blob,tmp))
            # Shared physical offsets are decoded once: 50,000 aliases of one 30,000-char string stay accepted.
            self.assertIn('app.wafra.android',read(axml(root(),utf8=True,pool_extra=[big],dup_offsets=50000)))
            refused=[
                axml(root(),utf8=True,pool_extra=['%02d'%i+big for i in range(40)]),            # >1 MiB distinct decoded text
                axml(root(children=[('activity',[(1,'name',3,'a.C%d'%i),(1,'label',3,big)],[]) for i in range(10)])), # >256 KiB attribute output from one string
                axml(root(),ns_layout='unclosed'),axml(root(),ns_layout='mismatched'),axml(root(),ns_layout='early-end'),
                axml(root(),astart=24),                                                           # attribute block not where the header says
                axml(root(),mutate=lambda b:struct.pack_into('<I',b,8+12,1)),                    # styles are not allowed in a manifest
                axml(root(),mutate=lambda b:struct.pack_into('<I',b,8+20,struct.unpack_from('<I',b,8+20)[0]+4))]  # string data start drift
            for blob in refused:
                with self.assertRaisesRegex(m.Refusal,'^apk-binary-manifest$'):read(blob)
    def test_binary_manifest_binds_attributes_to_framework_resource_ids(self):
        m=module()
        def root(app_attrs=((1,'debuggable',0x12,0),)):
            return ('manifest',[(None,'package',3,'app.wafra.android'),(1,'versionCode',0x10,407),(1,'versionName',3,'1.0.0')],[('uses-sdk',[(1,'minSdkVersion',0x10,24),(1,'targetSdkVersion',0x10,36)],[]),('application',list(app_attrs),[('activity',[(1,'name',3,'a.B'),(1,'exported',0x12,0)],[]),('meta-data',[(1,'name',3,'expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY'),(1,'value',3,'{"expo-channel-name":"production"}')],[])])])
        with tempfile.TemporaryDirectory() as tmp:
            read=lambda blob:m.manifest(m.binary_manifest(apk_with(blob,tmp)),407,'rc')
            self.assertFalse(read(axml(root()))['debuggable'])
            # Real aapt2 fixture map carries the framework IDs for every android attribute it uses.
            self.assertIn('androidx-startup',m.binary_manifest(apk_with(base64.b64decode(''.join(APK_MANIFEST_B64)),tmp)))
            attacks=[
                axml(root([(1,'debuggableX',0x12,1),(1,'debuggable',0x12,0)]),ids={'debuggableX':0x0101000f,'debuggable':0x01010001}),  # real debuggable ID hidden under another name
                axml(root([(1,'debuggableX',0x12,1)]),ids={'debuggableX':0x0101000f}),                       # gated ID under a non-gated name
                axml(root(),ids={'debuggable':0x01010001}),                                                # gated name with the wrong ID
                axml(root([(1,'debuggable',0x12,0),(1,'label',3,'x')]),ids={'label':0x0101000f}),        # two attributes resolving to one ID
                axml(root(),ids={'debuggable':0}),                                                         # android attribute without an ID
                axml(root([(1,'debuggable',0x12,0),(None,'debuggable',0x12,1)]),ids={'debuggable':0x0101000f}),  # non-namespaced alias of a gated ID
                axml(root(),resmap=False),                                                                 # no resource map at all
                axml(root(),ids={'debuggable':0x7f010000})]                                               # app-package ID for a framework attribute
            for blob in attacks:
                with self.assertRaisesRegex(m.Refusal,'^apk-binary-manifest$'):read(blob)
            long_utf16='\u0648'*40000  # UTF-16 two-word length prefix (>0x7fff code units)
            self.assertIn(long_utf16,m.binary_manifest(apk_with(axml(root([(1,'debuggable',0x12,0),(1,'label',3,long_utf16)])),tmp)))
    def test_report_rejects_reference_reported_as_literal(self):
        m=module();self.assertTrue(m.ENABLED_REFERENCE.fullmatch('@bool/enable_system_job_service_default'))
        for bad in ['@ref/0x7f050004','@0x7F050004','@android:bool/x','@bool/']:self.assertIsNone(m.ENABLED_REFERENCE.fullmatch(bad))
    def test_failure_annotation_is_allowlisted_category_only(self):
        m=module();m.STAGE.update(role='rc',kind='apk',reader='apk-binary-manifest')
        self.assertEqual(m.annotation(m.Refusal('manifest-xml')),'::error title=android-static-report::category=manifest-xml,role=rc,kind=apk,reader=apk-binary-manifest')
        m.STAGE.update(reader='x\n::set-env name=A::B')
        for error in [RuntimeError('password=DO_NOT_EMIT'),m.Refusal('<manifest>secret'),m.Refusal('a'*41)]:
            line=m.annotation(error);self.assertTrue(line.startswith('::error title=android-static-report::category=invalid-input,'))
            self.assertNotIn('DO_NOT_EMIT',line);self.assertNotIn('\n',line);self.assertNotIn('secret',line);self.assertTrue(line.endswith('reader=none'))
        m.STAGE.update(role=None,kind=None,reader=None)

class FullFakeCollection(unittest.TestCase):
    def test_complete_rc_collection_and_fail_closed_identity(self):
        m=module()
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);m.ROOT=root
            files=['app.json','.github/workflows/build-apk.yml','scripts/ci/android-static-report.py','scripts/ci/android-static-report.schema.json','scripts/android-build-flags.cjs','modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.js','modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.meta.json','src/lib/ios-background-parser-source.generated.ts']
            app={'expo':{'name':'Wafra','android':{'package':'app.wafra.android','versionCode':1}}}
            generated=b'synthetic generated parser';meta={'parserVersion':74,'moduleCount':43,'sourceHash':'b'*64,'bundleSha256':hashlib.sha256(generated).hexdigest()}
            data={'app.json':json.dumps(app).encode(),files[1]:b'synthetic workflow',files[2]:HELPER.read_bytes(),files[3]:(ROOT/'scripts/ci/android-static-report.schema.json').read_bytes(),files[4]:b'fake checker identity',files[5]:generated,files[6]:json.dumps(meta).encode(),files[7]:("export const IOS_BACKGROUND_PARSER_SOURCE_HASH = '"+'b'*64+"';").encode()}
            for name,body in data.items():p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(body)
            sha='a'*40;env={'GITHUB_REPOSITORY':'khanjer496-alt/Wafra','GITHUB_SHA':sha,'GITHUB_REF_NAME':'android/final-rc-'+sha[:12],'GITHUB_RUN_ID':'42','GITHUB_RUN_NUMBER':'407','GITHUB_RUN_ATTEMPT':'1'}
            safe=dict(bundle=True,corpus=False,founder_unlock=False,auto_pro=False,architecture='universal',capture_trace=False);env['STATIC_INPUTS_JSON']=json.dumps(safe)
            baseline={'provenance':m.provenance(env),'inputs':safe,'tracked':{n:hashlib.sha256(b).hexdigest() for n,b in data.items()},'appConfig':app}
            stamped=copy.deepcopy(app);stamped['expo']['android']['versionCode']=407;(root/'app.json').write_text(json.dumps(stamped))
            for kind,abis in [('apk',['arm64-v8a','armeabi-v7a','x86','x86_64']),('aab',['arm64-v8a','armeabi-v7a'])]:
                prefix='base/' if kind=='aab' else ''
                with zipfile.ZipFile(root/('wafra.'+kind),'w') as z:
                    z.writestr(prefix+'assets/index.android.bundle',b'synthetic Hermes payload '+b'b'*64)
                    z.writestr(('base/dex/' if kind=='aab' else '')+'classes.dex',b'WafraPlayBillingModule BankNotificationListenerService')
                    for abi in abis:z.writestr(prefix+'lib/'+abi+'/libexpo-sqlite.so',b'sqlcipher_version')
                    if kind=='apk':z.writestr('AndroidManifest.xml',base64.b64decode(''.join(APK_MANIFEST_B64)))
            tool=root/'bundletool.jar';tool.write_bytes(b'fake tool');original=m.file_hash;m.file_hash=lambda p:m.BUNDLETOOL_SHA if pathlib.Path(p)==tool else original(p)
            xml='<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="app.wafra.android" android:versionCode="407" android:versionName="1.0.0"><uses-sdk android:minSdkVersion="24" android:targetSdkVersion="36"/><application android:debuggable="false"><activity android:name=".Main"/><meta-data android:name="expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY" android:value="{&quot;expo-channel-name&quot;:&quot;production&quot;}"/></application></manifest>'
            calls=[];streams={}
            def run(args,stream='mixed'):
                args=list(map(str,args));calls.append(args);streams[' '.join(args)]=stream
                # Real tools may write harmless warnings to stderr; a mixed read must never reach the XML parser.
                if 'manifest' in args and stream!='stdout':return AAB_DUMP+'\nWARNING: harmless tool notice on stderr'
                if 'manifest' in args:return AAB_DUMP
                if args[:2]==['git','ls-files']:return '\0'.join(files)+'\0'
                if args[:2]==['git','rev-parse']:return sha
                if args[:2]==['git','hash-object']:return 'c'*40
                if 'verify-production' in args:return json.dumps({x:'off' for x in m.FLAGS})
                if 'verify' in args:return 'Signer #1 certificate SHA-256 digest: '+m.EXPECTED_SIGNER
                if args[0]=='jarsigner':return 'jar verified.'
                if args[0]=='keytool':return 'SHA256: '+m.EXPECTED_SIGNER
                if 'manifest' in args:return xml
                if args==['node','--version']:return 'v22.22.3'
                if args==['java','-version']:return 'openjdk version "17.0.17"'
                if args[-1]=='version':return '0.9'
                raise AssertionError('unrecognized fake tool request')
            report=m.collect(baseline,tool,env,run)
            xml_reads=[s for k,s in streams.items() if ' manifest' in k];self.assertEqual(xml_reads,['stdout'])
            self.assertFalse(any('apkanalyzer' in ' '.join(c) for c in calls))
            self.assertEqual(report['tools']['manifestReader'],'apk-binary-axml-v1+bundletool-dump-manifest')
            refs=[c for f in report['files'] for c in f['manifest']['components'] if c['enabledReference']]
            self.assertEqual(sorted({c['enabledReference'][:6] for c in refs}),['@0x7f0','@bool/']);self.assertTrue(all(c['enabled'] is None for c in refs))
            self.assertTrue(all(s=='mixed' for k,s in streams.items() if ' manifest' not in k))
            self.assertEqual(streams.get('java -version'),'mixed')
            self.assertTrue(m.validate_report(report));self.assertEqual(len(report['files']),2);self.assertLess(len(m.encoded(report)),65536)
            self.assertTrue(all(x['payload']['sourceMarkerPresent'] for x in report['files']))
            self.assertFalse(report['limits']['billingRestoreAcceptance'])
            for item in report['files']:
                self.assertTrue(item['payload']['nativeClassNameMarkersPresent'])
                self.assertTrue(item['payload']['sqlcipherSymbolNameBytesPresent'])
                for field in ['nativeClassDefinitionsVerified','sqlcipherSymbolDefinitionsVerified','nativeRegistrationVerified']:
                    self.assertFalse(item['payload'][field])
            for change in ['extra-field','wrong-code','missing-file','definition-claim','reference-as-literal']:
                bad=copy.deepcopy(report)
                if change=='extra-field':bad['token']='DO_NOT_EMIT'
                elif change=='wrong-code':bad['files'][0]['manifest']['versionCode']=408
                elif change=='definition-claim':bad['files'][0]['payload']['nativeClassDefinitionsVerified']=True
                elif change=='reference-as-literal':
                    comp=next(c for c in bad['files'][0]['manifest']['components'] if c['enabledReference']);comp['enabled']=True
                else:bad['files']=[]
                with self.assertRaises(m.Refusal):m.validate_report(bad)
            (root/'scripts/android-build-flags.cjs').write_text('unexpected changed source')
            with self.assertRaisesRegex(m.Refusal,'tracked-source-drift'):m.collect(baseline,tool,env,run)
if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])
    if suite.countTestCases()!=20:raise SystemExit('report contract requires exactly 20 collected tests')
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
