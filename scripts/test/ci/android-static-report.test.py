import importlib.util, pathlib, unittest, tempfile, json, zipfile, hashlib, copy, sys
ROOT=pathlib.Path(__file__).resolve().parents[3]
HELPER=ROOT/'scripts/ci/android-static-report.py'
def module():
    assert HELPER.is_file(), 'pre-seal complete static report producer is absent'
    spec=importlib.util.spec_from_file_location('report',HELPER);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
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
            tool=root/'bundletool.jar';tool.write_bytes(b'fake tool');original=m.file_hash;m.file_hash=lambda p:m.BUNDLETOOL_SHA if pathlib.Path(p)==tool else original(p)
            xml='<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="app.wafra.android" android:versionCode="407" android:versionName="1.0.0"><uses-sdk android:minSdkVersion="24" android:targetSdkVersion="36"/><application android:debuggable="false"><activity android:name=".Main"/><meta-data android:name="expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY" android:value="{&quot;expo-channel-name&quot;:&quot;production&quot;}"/></application></manifest>'
            calls=[]
            def run(args):
                args=list(map(str,args));calls.append(args)
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
            self.assertTrue(m.validate_report(report));self.assertEqual(len(report['files']),2);self.assertLess(len(m.encoded(report)),65536)
            self.assertTrue(all(x['payload']['sourceMarkerPresent'] for x in report['files']))
            self.assertFalse(report['limits']['billingRestoreAcceptance'])
            for item in report['files']:
                self.assertTrue(item['payload']['nativeClassNameMarkersPresent'])
                self.assertTrue(item['payload']['sqlcipherSymbolNameBytesPresent'])
                for field in ['nativeClassDefinitionsVerified','sqlcipherSymbolDefinitionsVerified','nativeRegistrationVerified']:
                    self.assertFalse(item['payload'][field])
            for change in ['extra-field','wrong-code','missing-file','definition-claim']:
                bad=copy.deepcopy(report)
                if change=='extra-field':bad['token']='DO_NOT_EMIT'
                elif change=='wrong-code':bad['files'][0]['manifest']['versionCode']=408
                elif change=='definition-claim':bad['files'][0]['payload']['nativeClassDefinitionsVerified']=True
                else:bad['files']=[]
                with self.assertRaises(m.Refusal):m.validate_report(bad)
            (root/'scripts/android-build-flags.cjs').write_text('unexpected changed source')
            with self.assertRaisesRegex(m.Refusal,'tracked-source-drift'):m.collect(baseline,tool,env,run)
if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])
    if suite.countTestCases()!=12:raise SystemExit('report contract requires exactly 12 collected tests')
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
