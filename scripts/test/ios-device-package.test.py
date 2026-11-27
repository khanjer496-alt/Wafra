#!/usr/bin/env python3
"""Producer-only tiny fixtures: actual workflow recipe, no keys/crypto/app build."""
import ctypes
import functools
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode = True
REPO = pathlib.Path(__file__).resolve().parents[2]
BASE = 'ab62f9c02d32e34f6c0240feaf9011861dbbe3ca'
spec = importlib.util.spec_from_file_location('seal', REPO/'scripts/ci/ios-device-seal.py')
seal = importlib.util.module_from_spec(spec); spec.loader.exec_module(seal)


def recipe(base=False):
    if base:
        data = subprocess.check_output(['git','-C',str(REPO),'show',BASE+':.github/workflows/ios-device-build.yml'])
    else:
        data = (REPO/'.github/workflows/ios-device-build.yml').read_bytes()
    program = 'w=YAML.load(STDIN.read); puts JSON.generate(w["jobs"]["github-macos"]["steps"].find{|s|s["name"]=="Package inputs for local signing (no QA signing account changes)"}["run"])'
    return json.loads(subprocess.check_output(['ruby','-ryaml','-rjson','-e',program],input=data))


OBSERVATIONS = []
COMPARISONS = []
EARLY_ERRORS = []
NATIVE_BOUND = False


class XattrReadError(RuntimeError):
    pass


@functools.lru_cache(maxsize=1)
def native_xattrs():
    """Darwin ABI from sys/xattr.h; bind read-only calls only."""
    global NATIVE_BOUND
    if sys.platform != 'darwin': raise XattrReadError()
    native=ctypes.CDLL('/usr/lib/libSystem.B.dylib',use_errno=True)
    native.listxattr.argtypes=[ctypes.c_char_p,ctypes.c_void_p,ctypes.c_size_t,ctypes.c_int]
    native.listxattr.restype=ctypes.c_ssize_t
    native.getxattr.argtypes=[ctypes.c_char_p,ctypes.c_char_p,ctypes.c_void_p,ctypes.c_size_t,ctypes.c_uint32,ctypes.c_int]
    native.getxattr.restype=ctypes.c_ssize_t
    NATIVE_BOUND=True
    return native


def read_xattrs(path,native=None):
    # XATTR_NOFOLLOW=1 on BOTH calls: inspect the symlink node, not its target.
    # Size/collection errors and races fail closed; zero is valid only after a
    # successful native call. Keep NUL-delimited name bytes and value bytes exact.
    native=native if native is not None else native_xattrs()
    encoded=os.fsencode(path)
    def collect(call):
        size=call(None,0)
        if not 0<=size<=1048576:raise XattrReadError()
        buffer=ctypes.create_string_buffer(max(size,1))
        count=call(buffer,size)
        if count!=size:raise XattrReadError()
        return buffer.raw[:count]
    packed=collect(lambda buf,size:native.listxattr(encoded,buf,size,1))
    if packed and not packed.endswith(b'\0'):raise XattrReadError()
    names=packed[:-1].split(b'\0') if packed else []
    if any(not name for name in names) or len(set(names))!=len(names):raise XattrReadError()
    return {name:collect(lambda buf,size:native.getxattr(encoded,name,buf,size,0,1)) for name in names}


def error_evidence(test,stage,error):
    case=getattr(getattr(test,'test_case',test),'_testMethodName',test if isinstance(test,str) else 'unknown-case')
    if case not in CASE_IDS:case='unknown-case'
    stages={'setup','snapshot','source-state','measurement','recipe-exit','archive-read','source','source-nodes','consumer','test'}
    allowed={'AttributeError','OSError','ValueError','RuntimeError','XattrReadError','AssertionError','TypeError','NotImplementedError'}
    EARLY_ERRORS.append({'case':case,'stage':stage if stage in stages else 'test',
                         'errorClass':type(error).__name__ if type(error).__name__ in allowed else 'OtherError',
                         'osListxattrAvailable':callable(getattr(os,'listxattr',None)),
                         'osGetxattrAvailable':callable(getattr(os,'getxattr',None)),
                         'nativeReadAPIsBound':NATIVE_BOUND})


class SafeResult(unittest.TestResult):
    # Store no raw unittest traceback/assertion/exception text, even internally.
    def addError(self,test,err):
        error_evidence(test,getattr(getattr(test,'test_case',test),'_stage','test'),err[1])
        self.errors.append((test,'fixed-error'))
    def addFailure(self,test,err):self.failures.append((test,'fixed-failure'))
    def addSubTest(self,test,subtest,err):
        if err is not None:
            if issubclass(err[0],test.failureException):self.addFailure(subtest,err)
            else:self.addError(subtest,err)



def measure_both(observer,case="unknown-case"):
    """A legacy observation must never prevent measuring the proposed producer."""
    observations = {}
    for origin in ('legacy', 'corrected'):
        try:
            observations[origin] = dict(observer(origin), entered=True)
        except Exception as error:
            error_evidence(case,'measurement',error)
            # No exception text, paths, argv or subprocess output in reports.
            observations[origin] = {'complete': False, 'outcome': 'observation-error', 'entered': True}
    return observations


class FakeNativeXattrs:
    """Pure ABI double: no native library, xattr command or attribute mutation."""
    def __init__(self,attrs):self.attrs=attrs;self.calls=[]
    def transfer(self,data,buf,size):
        if buf is not None:
            if size!=len(data):return -1
            if data:ctypes.memmove(buf,data,len(data))
        return len(data)
    def listxattr(self,path,buf,size,options):
        self.calls.append((path,options))
        return self.transfer(b''.join(name+b'\0' for name in self.attrs[path]),buf,size)
    def getxattr(self,path,name,buf,size,position,options):
        self.calls.append((path,options));assert position==0
        return self.transfer(self.attrs[path][name],buf,size)


class ControlFlowFixtures(unittest.TestCase):
    def setUp(self):
        self.saved=[len(OBSERVATIONS),len(COMPARISONS),len(EARLY_ERRORS)]
    def tearDown(self):
        # Discard only nested expected-fault evidence; retain this pure case's
        # own unexpected error diagnostics, even if the regression itself fails.
        own_errors=[r for r in EARLY_ERRORS[self.saved[2]:] if r['case']==self._testMethodName]
        for collection,size in zip((OBSERVATIONS,COMPARISONS,EARLY_ERRORS),self.saved):del collection[size:]
        EARLY_ERRORS.extend(own_errors)

    def test_legacy_exception_still_measures_corrected(self):
        calls=[]; fixture=ProducerFixtures()
        def observer(origin,expected,nodes,attrs):
            calls.append(origin)
            if origin=='legacy':raise ValueError('synthetic withheld detail')
            return {'complete':True,'records':[{'outcome':'canonical'}]}
        fixture.observe=observer; fixture.prefixes={}
        with self.assertRaises(AssertionError):fixture.compare_recipes({})
        self.assertEqual(calls,['legacy','corrected'])
        self.assertTrue(COMPARISONS.pop()['correctedEntered'])

    def test_legacy_mismatch_does_not_replace_corrected_oracle(self):
        for corrected in ('canonical','mismatch'):
            with self.subTest(corrected=corrected):
                calls=[]; fixture=ProducerFixtures(); fixture.prefixes={}
                def observer(origin,expected,nodes,attrs):
                    calls.append(origin)
                    return {'complete':True,'records':[{'outcome':'mismatch' if origin=='legacy' else corrected}]}
                fixture.observe=observer
                if corrected=='canonical':fixture.compare_recipes({})
                else:
                    with self.assertRaises(AssertionError):fixture.compare_recipes({})
                self.assertEqual(calls,['legacy','corrected'])
                self.assertTrue(COMPARISONS.pop()['correctedEntered'])

    def test_actual_source_state_without_linux_apis_preserves_binary_and_nodes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);target=root/'target';target.write_bytes(b'file bytes')
            link=root/'link';link.symlink_to('target')
            values={os.fsencode(root):{b'name with newline\n':b'\x00\xff\n'},
                    os.fsencode(target):{b'empty':b''},os.fsencode(link):{b'link-only':b'node bytes'}}
            native=FakeNativeXattrs(values);fixture=ProducerFixtures()
            with mock.patch.object(os,'listxattr',None,create=True),mock.patch.object(os,'getxattr',None,create=True):
                nodes,attrs=fixture.source_state(root,native=native)
            self.assertEqual(attrs['.'],values[os.fsencode(root)])
            self.assertEqual(attrs['target'],values[os.fsencode(target)])
            self.assertEqual(attrs['link'],values[os.fsencode(link)])
            self.assertEqual(nodes['link']['kind'],'symlink');self.assertEqual(nodes['link']['target'],'target')
            self.assertTrue(all(options==1 for path,options in native.calls))
            self.assertEqual({path for path,options in native.calls},set(values))

    def test_native_collection_errors_and_missing_symbols_never_default_empty(self):
        failing=mock.Mock();failing.listxattr.return_value=-1
        with self.assertRaises(XattrReadError):read_xattrs('synthetic',native=failing)
        with self.assertRaises(AttributeError):read_xattrs('synthetic',native=object())
        changing=mock.Mock();changing.listxattr.side_effect=[2,-1]
        with self.assertRaises(XattrReadError):read_xattrs('synthetic',native=changing)
        badvalue=mock.Mock();badvalue.listxattr.side_effect=lambda path,buf,size,options: FakeNativeXattrs({path:{b'a':b'x'}}).listxattr(path,buf,size,options)
        badvalue.getxattr.return_value=-1
        with self.assertRaises(XattrReadError):read_xattrs('synthetic',native=badvalue)

    def test_empty_attributes_require_successful_native_collection(self):
        native=FakeNativeXattrs({b'synthetic':{}})
        self.assertEqual(read_xattrs('synthetic',native=native),{})
        self.assertEqual(native.calls,[(b'synthetic',1),(b'synthetic',1)])

    def test_actual_preobservation_error_records_unentered_incomplete_state(self):
        fixture=ProducerFixtures('test_corrected_actual_recipe_preserves_clean_inputs_and_original_layout')
        result=SafeResult();start=len(EARLY_ERRORS);observed=len(OBSERVATIONS)
        with mock.patch(__name__+'.native_xattrs',return_value=object()),mock.patch.object(fixture,'execute_recipe') as execute:
            fixture.run(result)
        self.assertEqual(len(result.errors),1);execute.assert_not_called()
        self.assertEqual(len(OBSERVATIONS),observed)
        self.assertEqual(COMPARISONS[-1],{'case':fixture._testMethodName,'legacyEntered':False,'correctedEntered':False,'legacyComplete':False,'correctedComplete':False})
        self.assertEqual(EARLY_ERRORS[start]['stage'],'source-state')
        self.assertEqual(EARLY_ERRORS[start]['errorClass'],'AttributeError')

    def test_partial_setup_reports_safely_and_retains_prior_measurements(self):
        fixture=ProducerFixtures('test_corrected_actual_recipe_preserves_clean_inputs_and_original_layout')
        sentinel={'syntheticMeasured':True};OBSERVATIONS.append(sentinel);result=SafeResult()
        with mock.patch.object(pathlib.Path,'mkdir',side_effect=OSError('withheld synthetic path and secret')):
            fixture.run(result)
        self.assertEqual(len(result.errors),1);self.assertIs(OBSERVATIONS[-1],sentinel)
        self.assertEqual(EARLY_ERRORS[-1]['stage'],'setup');self.assertEqual(EARLY_ERRORS[-1]['errorClass'],'OSError')
        self.assertNotIn('withheld',json.dumps(EARLY_ERRORS));self.assertFalse(pathlib.Path(fixture.temp.name).exists())


@unittest.skipUnless(sys.platform=='darwin','macOS BSD-tar producer fixtures')
class ProducerFixtures(unittest.TestCase):
    def setUp(self):
        self._stage='setup'
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup); self.root = pathlib.Path(self.temp.name)
        self.prefixes = {'Payload':self.root/'wafra/Payload', 'Products':self.root/'wda-build/Build/Products'}
        for prefix, path in self.prefixes.items():
            path.mkdir(parents=True); path.chmod(0o755)
            bundle = path/('Wafra.app' if prefix=='Payload' else 'Debug-iphoneos/Runner.app')
            bundle.mkdir(parents=True); bundle.chmod(0o750)
            (bundle/'empty').mkdir(); (bundle/'empty').chmod(0o711)
            # A normal ._ filename is data, not permission to strip members.
            for name, mode, data in [('executable',0o755,b'synthetic binary'), ('Info.plist',0o644,b'synthetic metadata'), ('private-fixture',0o600,b'synthetic bytes'), ('._ordinary',0o644,b'ordinary source file')]:
                f=bundle/name; f.write_bytes(data); f.chmod(mode)
        self.archives = {'Payload':self.root/'Wafra-resignable.tar.gz', 'Products':self.root/'WDA-Products-unsigned.tar.gz'}
        self.env = dict(os.environ,RUNNER_TEMP=str(self.root))
        # Control only the synthetic subprocess defaults; never clear xattrs.
        self.env.pop('COPYFILE_DISABLE',None)

    def tearDown(self):
        self.temp.cleanup()

    def execute_recipe(self, base=False):
        process = subprocess.run(['bash','-c',recipe(base)],cwd=REPO,env=self.env,capture_output=True,timeout=15)
        return {'recipe-exit':process.returncode==0,'recipe-output-empty':process.stdout==b''}

    def snapshot(self, root):
        self._stage='snapshot'
        result={}
        def visit(path, relative):
            path.resolve().relative_to(root.resolve())
            mode=stat.S_IMODE(path.stat().st_mode)
            if path.is_dir():
                result[relative]={'type':'directory','mode':mode}
                for child in sorted(path.iterdir()):visit(child,relative+'/'+child.name)
            else:
                result[relative]={'type':'regular','mode':mode,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
        visit(root,root.name)
        return result

    def source_state(self, root, native=None):
        self._stage='source-state'
        nodes={};attrs={}
        # rglob does not follow directory symlinks. Preserve original node kinds,
        # modes and link targets independently of the dereferenced byte oracle.
        for path in [root,*sorted(root.rglob('*'))]:
            key=str(path.relative_to(root)); info=path.lstat()
            kind=('symlink' if stat.S_ISLNK(info.st_mode) else 'directory' if stat.S_ISDIR(info.st_mode) else 'regular')
            nodes[key]={'kind':kind,'mode':stat.S_IMODE(info.st_mode)}
            if kind=='symlink':nodes[key]['target']=os.readlink(path)
            elif kind=='regular':nodes[key]['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
            attrs[key]=read_xattrs(path,native=native)
        return nodes,attrs

    def manifest(self, archive):
        result={}; counts=dict.fromkeys(('regular','directory','symlink','hardlink','special'),0)
        conditions={'member-kind':True,'path-safe':True,'duplicate-free':True}
        with tarfile.open(archive,'r:gz') as tar:
            for member in tar:
                name=str(pathlib.PurePosixPath(member.name))
                kind=('regular' if member.isfile() else 'directory' if member.isdir() else
                      'symlink' if member.issym() else 'hardlink' if member.islnk() else 'special')
                counts[kind]+=1
                conditions['path-safe'] &= not pathlib.PurePosixPath(name).is_absolute() and '..' not in pathlib.PurePosixPath(name).parts
                conditions['member-kind'] &= kind in ('regular','directory')
                conditions['duplicate-free'] &= name not in result
                value={'type':kind,'mode':member.mode & 0o7777}
                if member.isfile():value['sha256']=hashlib.sha256(tar.extractfile(member).read()).hexdigest()
                # The internal map may contain paths; only booleans/counts leave this function's caller.
                result[name]=value
        return result,conditions,counts

    def observe(self, origin, expected, nodes, attrs):
        recipe_observed=True
        try:recipe_conditions=self.execute_recipe(base=origin=='legacy')
        except Exception as error:
            error_evidence(self,'recipe-exit',error)
            recipe_observed=False; recipe_conditions={'recipe-exit':False}
        recipe_ok=all(recipe_conditions.values())
        records=[]
        for prefix,root in self.prefixes.items():
            conditions=dict(recipe_conditions)
            record={'case':self._testMethodName,'origin':origin,'prefix':prefix,'complete':False}
            stage='recipe-exit'
            try:
                if not recipe_ok:
                    record.update(outcome='recipe-failed' if recipe_observed else 'observation-error',conditions=conditions,
                                  firstFailedCondition=next(k for k,v in conditions.items() if not v))
                    continue
                stage='archive-read'
                actual,checks,counts=self.manifest(self.archives[prefix]); conditions.update(checks)
                wanted=expected[root]
                conditions['pathset']=actual.keys()==wanted.keys()
                conditions['type']=conditions['pathset'] and all(actual[k]['type']==v['type'] for k,v in wanted.items())
                conditions['bytes']=conditions['pathset'] and all(actual[k].get('sha256')==v.get('sha256') for k,v in wanted.items())
                conditions['mode']=conditions['pathset'] and all(actual[k]['mode']==v['mode'] for k,v in wanted.items())
                stage='source'
                conditions['source']=self.snapshot(root)==wanted
                stage='source-nodes'
                after_nodes,after_attrs=self.source_state(root)
                conditions['source-nodes']=after_nodes==nodes[root]
                conditions['sourceattrs']=after_attrs==attrs[root]
                stage='consumer'
                try:
                    seal.archive_hashes(self.archives[prefix],prefix)
                    consumer='accepted'
                except seal.ArchiveRejected as error:
                    allowed={'traversal','wrong-prefix','non-regular-type','duplicate-file','unreadable','empty'}
                    consumer=error.evidence['reason'] if error.evidence['reason'] in allowed else 'unknown-rejection'
                conditions['consumer']=consumer=='accepted'
                first=next((k for k,v in conditions.items() if not v),None)
                outcome='canonical' if first is None else 'consumer-rejected' if consumer!='accepted' else 'mismatch'
                record.update(complete=consumer!='unknown-rejection',outcome=outcome,conditions=conditions,memberCounts=counts,
                              consumer=consumer,firstFailedCondition=first)
            except Exception as error:
                error_evidence(self,stage,error)
                record.update(outcome='observation-error',conditions=conditions,firstFailedCondition=stage)
            finally:
                OBSERVATIONS.append(record); records.append(record)
        return {'complete':all(r['complete'] for r in records),'records':records}

    def compare_recipes(self, expected):
        comparison={'case':self._testMethodName,'legacyEntered':False,'correctedEntered':False,
                    'legacyComplete':False,'correctedComplete':False}
        COMPARISONS.append(comparison)
        state={root:self.source_state(root) for root in self.prefixes.values()}
        nodes={root:value[0] for root,value in state.items()}; attrs={root:value[1] for root,value in state.items()}
        observations=measure_both(lambda origin:self.observe(origin,expected,nodes,attrs),self._testMethodName)
        comparison.update(legacyEntered=observations['legacy']['entered'],correctedEntered=observations['corrected']['entered'],
                          legacyComplete=observations['legacy']['complete'],correctedComplete=observations['corrected']['complete'])
        # Assertions happen ONLY after both producers have been observed. Unknown
        # legacy failures remain failures, but never gate corrected measurement.
        self.assertTrue(observations['legacy']['complete'],'legacy observation incomplete')
        self.assertTrue(observations['corrected']['complete'],'corrected observation incomplete')
        self.assertTrue(all(r['outcome']=='canonical' for r in observations['corrected']['records']),
                        'corrected filesystem preservation or consumer condition failed')

    def add_xattrs(self):
        paths=[]
        for root in self.prefixes.values():
            paths += [root,next(p for p in root.rglob('*') if p.is_file())]
        for path in paths:
            subprocess.run(['/usr/bin/xattr','-w','com.openbot.package.fixture','synthetic',str(path)],capture_output=True,check=True,timeout=4)
        return paths

    def test_exact_old_production_recipe_xattr_reproduces_rejection(self):
        self.add_xattrs(); self.assertTrue(all(self.execute_recipe(base=True).values()))
        for prefix,archive in self.archives.items():
            with self.assertRaises(seal.ArchiveRejected) as caught:seal.archive_hashes(archive,prefix)
            self.assertEqual(caught.exception.evidence['reason'],'wrong-prefix')
            self.assertEqual(caught.exception.evidence['ordinal'],1)

    def test_corrected_actual_recipe_preserves_xattr_source_bytes_modes_layout(self):
        paths=self.add_xattrs()
        before={p:self.snapshot(p) for p in self.prefixes.values()}
        state={root:self.source_state(root) for root in self.prefixes.values()}
        observations=self.observe('corrected',before,{root:v[0] for root,v in state.items()},
                                  {root:v[1] for root,v in state.items()})
        self.assertTrue(observations['complete'])
        self.assertTrue(all(r['outcome']=='canonical' for r in observations['records']))
        for path in paths:
            value=subprocess.check_output(['/usr/bin/xattr','-p','com.openbot.package.fixture',str(path)],timeout=4)
            self.assertEqual(value.strip(),b'synthetic')

    def test_corrected_actual_recipe_preserves_clean_inputs_and_original_layout(self):
        expected={p:self.snapshot(p) for p in self.prefixes.values()}
        self.compare_recipes(expected)

    def test_dereference_policy_and_file_alias_bytes_are_preserved(self):
        for root in self.prefixes.values():
            executable=next(p for p in root.rglob('executable'))
            (root/'file-alias').symlink_to(executable.relative_to(root))
            empty=next(root.rglob('empty')); (root/'empty-directory-alias').symlink_to(empty.relative_to(root),target_is_directory=True)
            populated=executable.parent/'populated';populated.mkdir();populated.chmod(0o751)
            data=populated/'nested';data.write_bytes(b'populated directory alias bytes');data.chmod(0o640)
            (root/'directory-alias').symlink_to(populated.relative_to(root),target_is_directory=True)
        expected={p:self.snapshot(p) for p in self.prefixes.values()}
        self.compare_recipes(expected)

    def test_unchanged_guard_rejects_bad_prefix_traversal_links_types_duplicates(self):
        controls=[([('Other/file',tarfile.REGTYPE)],'wrong-prefix'),
                  ([('Products/../outside',tarfile.REGTYPE)],'traversal'),
                  ([('Products/link',tarfile.SYMTYPE)],'non-regular-type'),
                  ([('Products/link',tarfile.LNKTYPE)],'non-regular-type'),
                  ([('Products/device',tarfile.CHRTYPE)],'non-regular-type'),
                  ([('Products/file',tarfile.REGTYPE),('Products/file',tarfile.REGTYPE)],'duplicate-file')]
        for members,reason in controls:
            with self.subTest(reason=reason):
                archive=self.root/'bad.tar.gz'
                with tarfile.open(archive,'w:gz') as tar:
                    for name,kind in members:
                        info=tarfile.TarInfo(name);info.type=kind;info.linkname='synthetic'
                        if kind==tarfile.REGTYPE:info.size=1;tar.addfile(info,io.BytesIO(b'x'))
                        else:tar.addfile(info)
                with self.assertRaises(seal.ArchiveRejected) as caught:seal.archive_hashes(archive,'Products')
                self.assertEqual(caught.exception.evidence['reason'],reason)

    def test_actual_workflow_uses_shared_helper_not_fixture_copied_flags(self):
        actual=recipe();self.assertEqual(actual.count('bash scripts/ci/ios-device-package.sh'),2)
        self.assertNotIn('--no-mac-metadata',actual)
        self.assertNotIn('ios-device-package.sh',recipe(base=True))

    def test_invalid_prefix_refuses_without_creating_archive(self):
        output=self.root/'invalid.tar.gz'
        process=subprocess.run(['bash',str(REPO/'scripts/ci/ios-device-package.sh'),str(output),str(self.root),'Other'],capture_output=True,timeout=5)
        self.assertEqual(process.returncode,64);self.assertFalse(output.exists())
        self.assertEqual(json.loads(process.stdout)['errorClass'],'InvalidPrefix')


def tar_identity():
    """Parsed categories only; never export version prose or executable paths."""
    try:
        result=subprocess.run(['tar','--version'],capture_output=True,timeout=4)
        text=result.stdout[:1024].decode('ascii',errors='replace')
        match=re.match(r'bsdtar ([0-9]{1,3}\.[0-9]{1,3}(?:\.[0-9]{1,3})?)\b',text)
        if match:return {'implementation':'bsdtar','version':match.group(1)}
        match=re.match(r'tar \(GNU tar\) ([0-9]{1,3}\.[0-9]{1,3}(?:\.[0-9]{1,3})?)\b',text)
        if match:return {'implementation':'gnu','version':match.group(1)}
    except Exception:pass
    return {'implementation':'unknown','version':'unknown'}


CASE_IDS={name for cls in (ControlFlowFixtures,ProducerFixtures) for name in vars(cls) if name.startswith('test_')}


if __name__=='__main__':
    if os.environ.get('PACKAGE_FIXTURE_REPORT'):
        suite=unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(c) for c in (ControlFlowFixtures,ProducerFixtures))
        result=SafeResult();suite.run(result)
        head=subprocess.check_output(['git','-C',str(REPO),'rev-parse','HEAD'],text=True).strip()
        report={'schema':'wafra-producer-fixture-v3','testsRun':result.testsRun,'failures':len(result.failures),
                'errors':len(result.errors),'skipped':len(result.skipped),'success':result.wasSuccessful() and not result.skipped,
                'baselineCommit':BASE,'sourceCommit':head if re.fullmatch(r'[0-9a-f]{40}',head) else 'unknown',
                'packagingOnly':True,'privateKeysUsed':False,'decryptionPerformed':False,'appBuildPerformed':False,
                'scriptSha256':{p:hashlib.sha256((REPO/p).read_bytes()).hexdigest() for p in
                                ['scripts/ci/ios-device-package.sh','scripts/test/ios-device-package.test.py','scripts/ci/ios-device-seal.py']},
                'failedCases':[getattr(test,'test_case',test)._testMethodName for test,_ in result.failures+result.errors],
                'observations':OBSERVATIONS,'comparisons':COMPARISONS,'tar':tar_identity(),'earlyErrors':EARLY_ERRORS,
                'legacyFindings':[r for r in OBSERVATIONS if r['origin']=='legacy' and r['outcome']!='canonical']}
        target=pathlib.Path(os.environ['PACKAGE_FIXTURE_REPORT']);target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));sys.exit(0 if report['success'] else 1)
    unittest.main()
