#!/usr/bin/env python3
"""Producer-only tiny fixtures: actual workflow recipe, no keys/crypto/app build."""
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


@unittest.skipUnless(sys.platform=='darwin','macOS BSD-tar producer fixtures')
class ProducerFixtures(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = pathlib.Path(self.temp.name)
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
        self.assertEqual(process.returncode,0,'production packaging recipe failed')
        self.assertEqual(process.stdout,b'')

    def snapshot(self, root):
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

    def manifest(self, archive):
        result={}
        with tarfile.open(archive,'r:gz') as tar:
            for member in tar:
                name=str(pathlib.PurePosixPath(member.name))
                self.assertFalse(pathlib.PurePosixPath(name).is_absolute())
                self.assertNotIn('..',pathlib.PurePosixPath(name).parts)
                self.assertTrue(member.isfile() or member.isdir(),'producer emitted a non-regular member')
                self.assertNotIn(name,result,'duplicate producer member')
                value={'type':'directory' if member.isdir() else 'regular','mode':member.mode & 0o7777}
                if member.isfile():value['sha256']=hashlib.sha256(tar.extractfile(member).read()).hexdigest()
                result[name]=value
        return result

    def add_xattrs(self):
        paths=[]
        for root in self.prefixes.values():
            paths += [root,next(p for p in root.rglob('*') if p.is_file())]
        for path in paths:
            subprocess.run(['/usr/bin/xattr','-w','com.openbot.package.fixture','synthetic',str(path)],capture_output=True,check=True,timeout=4)
        return paths

    def test_exact_old_production_recipe_xattr_reproduces_rejection(self):
        self.add_xattrs(); self.execute_recipe(base=True)
        for prefix,archive in self.archives.items():
            with self.assertRaises(seal.ArchiveRejected) as caught:seal.archive_hashes(archive,prefix)
            self.assertEqual(caught.exception.evidence['reason'],'wrong-prefix')
            self.assertEqual(caught.exception.evidence['ordinal'],1)

    def test_corrected_actual_recipe_preserves_xattr_source_bytes_modes_layout(self):
        paths=self.add_xattrs()
        before={p:self.snapshot(p) for p in self.prefixes.values()}
        self.execute_recipe()
        for prefix,root in self.prefixes.items():
            self.assertEqual(self.manifest(self.archives[prefix]),before[root])
            self.assertEqual(self.snapshot(root),before[root])
            seal.archive_hashes(self.archives[prefix],prefix)
        for path in paths:
            value=subprocess.check_output(['/usr/bin/xattr','-p','com.openbot.package.fixture',str(path)],timeout=4)
            self.assertEqual(value.strip(),b'synthetic')

    def test_corrected_actual_recipe_preserves_clean_inputs_and_original_layout(self):
        expected={p:self.snapshot(p) for p in self.prefixes.values()}
        self.execute_recipe(base=True)
        old={k:self.manifest(v) for k,v in self.archives.items()}
        self.execute_recipe()
        for prefix,root in self.prefixes.items():
            self.assertEqual(self.manifest(self.archives[prefix]),expected[root])
            self.assertEqual(old[prefix],expected[root])
            seal.archive_hashes(self.archives[prefix],prefix)

    def test_dereference_policy_and_file_alias_bytes_are_preserved(self):
        for root in self.prefixes.values():
            executable=next(p for p in root.rglob('executable'))
            (root/'file-alias').symlink_to(executable.relative_to(root))
            empty=next(root.rglob('empty')); (root/'directory-alias').symlink_to(empty.relative_to(root),target_is_directory=True)
        expected={p:self.snapshot(p) for p in self.prefixes.values()}
        self.execute_recipe(base=True)
        old={k:self.manifest(v) for k,v in self.archives.items()}
        self.execute_recipe()
        for prefix,root in self.prefixes.items():
            self.assertEqual(self.manifest(self.archives[prefix]),old[prefix])
            self.assertEqual(old[prefix],expected[root])
            seal.archive_hashes(self.archives[prefix],prefix)

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


if __name__=='__main__':
    if os.environ.get('PACKAGE_FIXTURE_REPORT'):
        result=unittest.TextTestRunner(stream=io.StringIO()).run(unittest.defaultTestLoader.loadTestsFromTestCase(ProducerFixtures))
        head=subprocess.check_output(['git','-C',str(REPO),'rev-parse','HEAD'],text=True).strip()
        report={'schema':'wafra-producer-fixture-v1','testsRun':result.testsRun,'failures':len(result.failures),
                'errors':len(result.errors),'skipped':len(result.skipped),'success':result.wasSuccessful() and not result.skipped,
                'baselineCommit':BASE,'sourceCommit':head if re.fullmatch(r'[0-9a-f]{40}',head) else 'unknown',
                'packagingOnly':True,'privateKeysUsed':False,'decryptionPerformed':False,'appBuildPerformed':False,
                'scriptSha256':{p:hashlib.sha256((REPO/p).read_bytes()).hexdigest() for p in
                                ['scripts/ci/ios-device-package.sh','scripts/test/ios-device-package.test.py','scripts/ci/ios-device-seal.py']},
                'failedCases':[test._testMethodName for test,_ in result.failures+result.errors]}
        target=pathlib.Path(os.environ['PACKAGE_FIXTURE_REPORT']);target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));sys.exit(0 if report['success'] else 1)
    unittest.main()
