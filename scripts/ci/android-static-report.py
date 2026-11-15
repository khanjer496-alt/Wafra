#!/usr/bin/env python3
"""Pre-seal static evidence only. Never builds, uploads, decrypts or prints tool output."""
import argparse,copy,hashlib,json,os,re,subprocess,sys,zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
ROOT=Path(__file__).resolve().parents[2]
EXPECTED_SIGNER='782b21c38c20f60425b171255718df54629c2909f3273c53e81d31fdbe3b446b'
BUNDLETOOL_SHA='a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29'
FLAGS=['founder-unlock','auto-founder-pro','sms-corpus-export','parser-research','sms-corpus-native']
WORKFLOW='.github/workflows/build-apk.yml'
SCHEMA='scripts/ci/android-static-report.schema.json'
SELF='scripts/ci/android-static-report.py'
NS='{http://schemas.android.com/apk/res/android}'
class Refusal(Exception):pass

def require(value,code):
    if not value:raise Refusal(code)

def encoded(value):
    result=(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True)+'\n').encode()
    require(len(result)<=65536,'report-size');return result

def digest(data):return hashlib.sha256(data).hexdigest()
def file_hash(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def validate(value,schema):
    # Deliberately small supported JSON-schema vocabulary, no remote references.
    require(not(set(schema)-{'type','const','enum','pattern','minimum','maximum','maxLength','maxItems','minItems','required','properties','additionalProperties','items'}),'schema-keyword')
    if 'const' in schema:require(type(value)==type(schema['const']) and value==schema['const'],'schema-const')
    if 'enum' in schema:require(value in schema['enum'],'schema-enum')
    t=schema.get('type');kinds={'object':dict,'array':list,'string':str,'integer':int,'boolean':bool,'null':type(None)}
    if t:require(type(value) in [kinds[x] for x in (t if isinstance(t,list) else [t])],'schema-type')
    if type(value)==dict:
        props=schema.get('properties',{});require(set(schema.get('required',[]))<=set(value),'schema-required')
        require(schema.get('additionalProperties') is False and set(value)<=set(props),'schema-extra')
        for key,item in value.items():validate(item,props[key])
    if type(value)==list:
        require(schema.get('minItems',0)<=len(value)<=schema.get('maxItems',1000),'schema-items')
        for item in value:validate(item,schema['items'])
    if type(value)==str:
        require(len(value)<=schema.get('maxLength',4096),'schema-length')
        if 'pattern' in schema:require(re.fullmatch(schema['pattern'],value) is not None,'schema-pattern')
    if type(value)==int:
        require(schema.get('minimum',-10**20)<=value<=schema.get('maximum',10**20),'schema-number')

def inputs(raw,role):
    keys={'bundle','corpus','founder_unlock','auto_pro','architecture','capture_trace'}
    require(type(raw)==dict and set(raw)==keys,'input-fields')
    result={}
    for k in keys-{'architecture'}:
        v=raw[k];require(type(v)==bool or v in ['true','false'],'input-boolean')
        result[k]=v if type(v)==bool else v=='true'
    result['architecture']=raw['architecture']
    require(result['architecture']=='universal','input-architecture')
    require(result['bundle']==(role=='rc') and all(not result[k] for k in keys-{'bundle','architecture'}),'input-policy')
    return result

def provenance(env):
    sha=env.get('GITHUB_SHA','');ref=env.get('GITHUB_REF_NAME','')
    require(env.get('GITHUB_REPOSITORY')=='khanjer496-alt/Wafra','repository')
    require(re.fullmatch('[a-f0-9]{40}',sha),'source-sha')
    role=next((r for r in ['rc','control'] if ref=='android/final-'+r+'-'+sha[:12]),None)
    require(role,'final-ref')
    nums={}
    for k in ['GITHUB_RUN_ID','GITHUB_RUN_NUMBER','GITHUB_RUN_ATTEMPT']:
        require(re.fullmatch('[1-9][0-9]{0,15}',env.get(k,'')),'run-identity');nums[k]=int(env[k])
    require(nums['GITHUB_RUN_NUMBER']>=407,'version-floor')
    return {'repository':env['GITHUB_REPOSITORY'],'source':sha,'ref':ref,'role':role,'runId':nums['GITHUB_RUN_ID'],'runAttempt':nums['GITHUB_RUN_ATTEMPT'],'versionCode':nums['GITHUB_RUN_NUMBER']}

def version_stamp(before,after,code):
    expected=copy.deepcopy(before);expected['expo'].setdefault('android',{})['versionCode']=code
    require(expected==after,'unexpected-app-config-drift');return True

def raw_run(argv):
    p=subprocess.run(argv,cwd=ROOT,capture_output=True,text=True,timeout=120,env=dict(os.environ,LC_ALL='C',LANG='C'))
    require(p.returncode==0,'tool-failed');require(len(p.stdout)+len(p.stderr)<=8*1024*1024,'tool-output-size')
    return p.stdout+'\n'+p.stderr

def checked(run,argv,label=None):
    try:return run([str(x) for x in argv])
    except Exception:raise Refusal('tool-failed') from None

def snapshot(run=raw_run):
    paths=checked(run,['git','ls-files','-z']).strip('\n').split('\0');paths=[x for x in paths if x]
    require(0<len(paths)<=20000 and len(set(paths))==len(paths),'source-file-list')
    result={}
    for relative in paths:
        p=ROOT/relative
        require(not Path(relative).is_absolute() and '..' not in Path(relative).parts and p.is_file() and not p.is_symlink(),'source-file')
        result[relative]=file_hash(p)
    return result

def manifest(xml,code,role):
    require(type(xml)==str and len(xml.encode())<=262144 and '<!DOCTYPE' not in xml.upper() and '<!ENTITY' not in xml.upper(),'manifest-xml')
    try:tree=ET.fromstring(xml)
    except Exception:raise Refusal('manifest-xml') from None
    require(tree.tag=='manifest' and tree.get('package')=='app.wafra.android','package')
    require(tree.get(NS+'versionCode')==str(code) and tree.get(NS+'versionName')=='1.0.0','package-version')
    sdk=tree.find('uses-sdk');app=tree.find('application')
    require(sdk is not None and sdk.get(NS+'minSdkVersion')=='24' and sdk.get(NS+'targetSdkVersion')=='36','sdk')
    require(app is not None and app.get(NS+'debuggable','false')=='false','debuggable')
    names=[];details=[]
    for item in tree:
        if item.tag in ['uses-permission','uses-permission-sdk-23','permission']:
            name=item.get(NS+'name');require(name and re.fullmatch('[A-Za-z0-9_.]+',name),'permission-name');names.append(name)
            details.append({'kind':item.tag,'name':name,'structureSha256':digest(ET.tostring(item,encoding='utf-8'))})
    permissions=sorted(set(names));require(len(permissions)<=100,'permission-count')
    components=[]
    for item in app:
        if item.tag in ['activity','activity-alias','service','receiver','provider']:
            name=item.get(NS+'name','');require(re.fullmatch('[A-Za-z0-9_.$]+',name),'component-name')
            exported=item.get(NS+'exported');enabled=item.get(NS+'enabled')
            require(exported in [None,'true','false'] and enabled in [None,'true','false'],'component-boolean')
            permission=item.get(NS+'permission');authorities=item.get(NS+'authorities')
            require(permission is None or re.fullmatch('[A-Za-z0-9_.]+',permission),'component-permission')
            require(authorities is None or re.fullmatch('[A-Za-z0-9_.;]+',authorities),'component-authority')
            components.append({'kind':item.tag,'name':name,'exported':None if exported is None else exported=='true','enabled':None if enabled is None else enabled=='true','permission':permission,'authorities':authorities,'structureSha256':digest(ET.tostring(item,encoding='utf-8'))})
    require(len(components)<=200,'component-count');components.sort(key=lambda x:(x['kind'],x['name']))
    headers=[x.get(NS+'value','') for x in app.findall('meta-data') if x.get(NS+'name')=='expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY']
    production=False
    if headers:
        require(len(headers)==1,'update-headers')
        try:production=json.loads(headers[0]).get('expo-channel-name')=='production'
        except Exception:raise Refusal('update-headers') from None
    overlay='android.permission.SYSTEM_ALERT_WINDOW' in permissions
    if role=='rc':require(production and not overlay,'production-manifest')
    return {'package':'app.wafra.android','versionName':'1.0.0','versionCode':code,'minSdk':24,'targetSdk':36,'debuggable':False,'permissions':permissions,'permissionDetails':details,'components':components,'productionChannel':production,'overlayPermission':overlay,'xmlSha256':digest(xml.encode())}

def apk_signer(text):
    matches=re.findall(r'^Signer #[0-9]+ certificate SHA-256 digest: ([a-fA-F0-9]{64})\s*$',text,re.M)
    require(len(matches)==1 and matches[0].lower()==EXPECTED_SIGNER,'apk-signer');return EXPECTED_SIGNER

def compiled_flags(data):
    require(type(data)==dict and set(data)==set(FLAGS) and all(v=='off' for v in data.values()),'compiled-flags');return data

def inventory(path,kind):
    require(path.is_file() and not path.is_symlink(),'artifact-file')
    if kind=='aab':require(path.stat().st_size<=100000000,'aab-size')
    try:
        with zipfile.ZipFile(path) as z:
            names=z.namelist();require(len(names)<=50000 and len(set(names))==len(names),'zip-entries')
            require(sum(i.file_size for i in z.infolist())<=2*1024**3,'zip-expanded-size')
            require(all(not n.startswith('/') and '\\' not in n and '..' not in Path(n).parts for n in names),'zip-path')
            abi=set()
            for n in names:
                match=re.match(r'(?:[^/]+/(?:root/)?lib|lib|BUNDLE-METADATA/com\.android\.tools\.build\.debugsymbols)/([^/]+)/',n)
                if match:abi.add(match[1])
            expected={'arm64-v8a','armeabi-v7a'} if kind=='aab' else {'arm64-v8a','armeabi-v7a','x86','x86_64'}
            require(abi==expected,'artifact-abis')
            bundle='base/assets/index.android.bundle' if kind=='aab' else 'assets/index.android.bundle'
            require(bundle in names and any(re.fullmatch(r'(?:base/dex/)?classes[0-9]*\.dex',n) for n in names),'artifact-payload')
            return sorted(abi)
    except Refusal:raise
    except Exception:raise Refusal('artifact-zip') from None

def parser_identity():
    directory=ROOT/'modules/wafra-live-capture/ios/Resources'
    meta=json.loads((directory/'WafraBackgroundParser.meta.json').read_text())
    require(re.fullmatch('[a-f0-9]{64}',meta.get('sourceHash','')) and re.fullmatch('[a-f0-9]{64}',meta.get('bundleSha256','')),'parser-metadata')
    require(type(meta.get('parserVersion'))==int and type(meta.get('moduleCount'))==int,'parser-version')
    require(file_hash(directory/'WafraBackgroundParser.js')==meta['bundleSha256'],'generated-parser-hash')
    constant=(ROOT/'src/lib/ios-background-parser-source.generated.ts').read_text()
    require(re.findall(r"IOS_BACKGROUND_PARSER_SOURCE_HASH = '([a-f0-9]{64})'",constant)==[meta['sourceHash']],'parser-constant')
    return {'version':meta['parserVersion'],'moduleCount':meta['moduleCount'],'sourceHash':meta['sourceHash'],'generatedSha256':meta['bundleSha256'],'metadataSha256':file_hash(directory/'WafraBackgroundParser.meta.json'),'binding':'checkout-and-payload-hash-not-standalone-Android-parser-proof'}

def payload(path,kind,parser):
    with zipfile.ZipFile(path) as z:
        names=z.namelist();bundle=z.read('base/assets/index.android.bundle' if kind=='aab' else 'assets/index.android.bundle')
        dexnames=sorted(n for n in names if re.fullmatch(r'(?:base/dex/)?classes[0-9]*\.dex',n))
        dex=[z.read(n) for n in dexnames];body=b'\0'.join(dex)
        require(all(x in body for x in [b'WafraPlayBillingModule',b'BankNotificationListenerService']),'required-native-classes')
        cipher=any(b'sqlcipher_version' in z.read(n) for n in names if re.search(r'/(?:libexpo-sqlite|libsqlcipher)\.so$',n))
        require(cipher,'sqlcipher-library-symbol')
    return {'bundleSha256':digest(bundle),'dexSha256':digest(body),'dexCount':len(dex),'sourceMarkerPresent':parser['sourceHash'].encode() in bundle,'sqlcipherSymbolNameBytesPresent':cipher,'nativeClassNameMarkersPresent':True,'nativeClassDefinitionsVerified':False,'sqlcipherSymbolDefinitionsVerified':False,'nativeRegistrationVerified':False}

def tool_version(run,argv,pattern):
    out=checked(run,argv);m=re.search(pattern,out);require(m,'tool-version');return m.group(1)

def collect(baseline,bundletool,env,run=raw_run):
    identity=provenance(env);code=identity['versionCode'];role=identity['role']
    raw=json.loads(env.get('STATIC_INPUTS_JSON','null'));safe=inputs(raw,role)
    require(baseline['provenance']==identity and baseline['inputs']==safe,'baseline-identity')
    require(checked(run,['git','rev-parse','HEAD']).strip()==identity['source'],'checkout-sha')
    current=snapshot(run);require(set(current)==set(baseline['tracked']),'tracked-files-drift')
    require([p for p in current if current[p]!=baseline['tracked'][p]] in [[],['app.json']],'tracked-source-drift')
    version_stamp(baseline['appConfig'],json.loads((ROOT/'app.json').read_text()),code)
    require(file_hash(bundletool)==BUNDLETOOL_SHA,'bundletool-digest')
    sdk=Path(env.get('ANDROID_HOME') or env.get('ANDROID_SDK_ROOT') or '/missing')
    tools=sdk/'build-tools/36.0.0';analyzer=sdk/'cmdline-tools/latest/bin/apkanalyzer'
    files=[];parser=parser_identity()
    for kind in (['apk','aab'] if role=='rc' else ['apk']):
        path=ROOT/('wafra.'+kind);abis=inventory(path,kind)
        output=checked(run,['node','scripts/android-build-flags.cjs','verify-production',path])
        try:flags=compiled_flags(json.loads(output))
        except Refusal:raise
        except Exception:raise Refusal('flags-output') from None
        if kind=='apk':
            apk_signer(checked(run,[tools/'apksigner','verify','--print-certs',path]))
            xml=checked(run,[analyzer,'manifest','print',path]).strip()
        else:
            verified=checked(run,['jarsigner','-J-Duser.language=en','-J-Duser.country=US','-verify',path])
            require('jar verified.' in verified and 'unsigned entries' not in verified,'aab-integrity')
            cert=checked(run,['keytool','-J-Duser.language=en','-J-Duser.country=US','-printcert','-jarfile',path])
            certs=re.findall(r'SHA256:\s*([A-Fa-f0-9:]{64,95})',cert)
            require(len(certs)==1 and certs[0].replace(':','').lower()==EXPECTED_SIGNER,'aab-signer')
            xml=checked(run,['java','-jar',bundletool,'dump','manifest','--module=base','--bundle='+str(path)]).strip()
        mf=manifest(xml,code,role)
        files.append({'kind':kind,'sha256':file_hash(path),'bytes':path.stat().st_size,'signerSha256':EXPECTED_SIGNER,'signatureVerified':True,'abis':abis,'flags':flags,'manifest':mf,'payload':payload(path,kind,parser)})
    versions={'python':'.'.join(map(str,sys.version_info[:3])),'node':tool_version(run,['node','--version'],r'v(22\.[0-9]+\.[0-9]+)'), 'java':tool_version(run,['java','-version'],r'version "(17\.[0-9.]+)'), 'apksigner':tool_version(run,[tools/'apksigner','version'],r'\b([0-9]+(?:\.[0-9]+)+)\b'),'bundletool':'1.18.3','bundletoolSha256':BUNDLETOOL_SHA,'sdkBuildTools':'36.0.0','manifestReader':'apkanalyzer-manifest-print'}
    require(snapshot(run)==current,'post-inspection-source-drift')
    report={'schema':'wafra-android-static-v1','status':'passed','provenance':identity,'inputs':safe,'producer':{'workflowBlob':checked(run,['git','hash-object',WORKFLOW]).strip(),'helperSha256':file_hash(ROOT/SELF),'schemaSha256':file_hash(ROOT/SCHEMA),'flagsCheckerSha256':file_hash(ROOT/'scripts/android-build-flags.cjs')},'tools':versions,'source':{'trackedFileCount':len(current),'beforeSha256':digest(json.dumps(baseline['tracked'],sort_keys=True).encode()),'afterSha256':digest(json.dumps(current,sort_keys=True).encode()),'onlyVersionStamp':True},'parser':parser,'files':files,'limits':{'staticOnly':True,'deviceAcceptance':False,'billingRestoreAcceptance':False,'reproducibleBuildClaim':False}}
    validate_report(report);encoded(report);return report

def validate_report(report):
    validate(report,json.loads((ROOT/SCHEMA).read_text()))
    p=report['provenance'];role=p['role']
    require(p['ref']=='android/final-'+role+'-'+p['source'][:12],'report-ref')
    inputs(report['inputs'],role)
    require([f['kind'] for f in report['files']]==(['apk','aab'] if role=='rc' else ['apk']),'report-files')
    for f in report['files']:
        require(f['manifest']['versionCode']==p['versionCode'],'report-code')
        if role=='rc':require(f['manifest']['productionChannel'] and not f['manifest']['overlayPermission'],'report-production')
        if f['kind']=='aab':require(f['bytes']<=100000000,'report-aab-size')
    return True

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('phase',choices=['baseline','report']);p.add_argument('--baseline',type=Path,required=True);p.add_argument('--out',type=Path);p.add_argument('--bundletool',type=Path);a=p.parse_args()
    env=os.environ;identity=provenance(env);safe=inputs(json.loads(env.get('STATIC_INPUTS_JSON','null')),identity['role'])
    # State must stay in runner temp, never source or public artifacts.
    temp=Path(env.get('RUNNER_TEMP','/missing')).resolve();require(temp in a.baseline.resolve().parents,'baseline-location')
    if a.phase=='baseline':
        require(not a.baseline.exists(),'baseline-exists');require(checked(raw_run,['git','rev-parse','HEAD']).strip()==identity['source'],'checkout-sha')
        require(not checked(raw_run,['git','status','--porcelain','--untracked-files=all']).strip(),'initial-source-drift')
        a.baseline.write_text(json.dumps({'provenance':identity,'inputs':safe,'tracked':snapshot(),'appConfig':json.loads((ROOT/'app.json').read_text())}));return
    require(a.out and a.bundletool and not a.out.exists(),'report-output')
    report=collect(json.loads(a.baseline.read_text()),a.bundletool,env);a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_bytes(encoded(report))
    print('Static report produced; device and billing acceptance remain separate.')
if __name__=='__main__':
    try:main()
    except Exception as error:
        # Never emit exception/tool output that could contain credential material.
        print('android-static-report:'+ (str(error) if isinstance(error,Refusal) else 'invalid-input'),file=sys.stderr);sys.exit(1)
