#!/usr/bin/env python3
"""Tiny synthetic sealing fixtures. Public recipient only; no key/decrypt/signing/API."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
REPO = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('seal', REPO/'scripts/ci/ios-device-seal.py')
seal = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(seal)
BASE = '41d371a69462e4df29abd3e5466d3dfe1ad19a33'
OBSERVATIONS = []


class SealFixtures(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(); self.root = pathlib.Path(self.temporary.name)
        self.old = pathlib.Path.cwd(); os.chdir(self.root)
        self.data = self.root/'inputs'; self.data.mkdir(); (self.root/'.github').mkdir()
        (self.root/'.github/android-artifact-recipient.pem').write_bytes((REPO/'.github/android-artifact-recipient.pem').read_bytes())
        (self.data/'wda.tgz').write_bytes(b'synthetic upstream package')
        (self.data/'ios-build-provenance.json').write_text('{"fixture":true}')
        self.env = patch.dict(os.environ, {'RUNNER_TEMP':str(self.data), 'SOURCE_COMMIT':'a'*40,
                                          'GITHUB_SHA':'b'*40, 'GITHUB_RUN_ID':'123', 'GITHUB_RUN_ATTEMPT':'1'})
        self.env.start()
        for prefix, name in [('Payload','Wafra-resignable.tar.gz'), ('Products','WDA-Products-unsigned.tar.gz')]:
            self.archive(name, prefix)

    def tearDown(self):
        self.env.stop(); os.chdir(self.old); self.temporary.cleanup()

    def archive(self, name, prefix, entries=None):
        with tarfile.open(self.data/name, 'w:gz') as tar:
            for path, kind in entries or [(prefix,tarfile.DIRTYPE),(prefix+'/synthetic',tarfile.REGTYPE)]:
                info = tarfile.TarInfo(path); info.type = kind
                if kind == tarfile.REGTYPE:
                    info.size = 4; tar.addfile(info, io.BytesIO(b'test'))
                else:
                    info.linkname = 'synthetic'; tar.addfile(info)

    def execute(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output): result = seal.main()
        receipt = self.data/'ios-seal-failure.json'
        observation = {'fixture':self._testMethodName, 'exitCode':result}
        if receipt.is_file(): observation['failure'] = json.loads(receipt.read_text())
        OBSERVATIONS.append(observation)
        return result, output.getvalue()

    def failure(self, phase):
        code, text = self.execute(); self.assertEqual(code,1)
        receipt = json.loads((self.data/'ios-seal-failure.json').read_text())
        self.assertEqual(receipt['phase'],phase); self.assertFalse(receipt['successPublished'])
        self.assertFalse((self.root/'sealed').exists())
        self.assertEqual(list(self.root.glob('.wafra-seal-*')),[])
        self.assertNotIn('SENSITIVE_SENTINEL', json.dumps(receipt)+text)
        self.assertNotIn(str(self.root), json.dumps(receipt)+text)
        return receipt

    def test_full_seal_clean_archives_and_manifest(self):
        code, output = self.execute(); self.assertEqual(code,0); self.assertEqual(output,'')
        manifest = json.loads((self.root/'sealed/verification.json').read_text())
        self.assertEqual(manifest['schema'],'wafra-ios-local-signing-inputs-v1')
        self.assertFalse(manifest['qaSigningPerformed'])
        self.assertEqual(manifest['wdaProductFileHashes'], {'synthetic':hashlib.sha256(b'test').hexdigest()})
        self.assertEqual(manifest['wafraProductFileHashes'], manifest['wdaProductFileHashes'])
        for item in manifest['files']:
            cipher = self.root/'sealed'/item['sealed']
            self.assertEqual(item['sha256'],seal.sha256(self.data/item['source']))
            self.assertEqual(item['sealedSha256'],seal.sha256(cipher)); self.assertGreater(cipher.stat().st_size,0)
            subprocess.run(['openssl','cms','-cmsout','-inform','DER','-in',str(cipher),'-noout'],
                           capture_output=True,check=True,timeout=5)
        self.assertFalse((self.data/'ios-seal-failure.json').exists())

    def test_cipher_failure_has_independent_receipt_and_no_partial_publication(self):
        original = subprocess.run
        def fail_cipher(args, **kwargs):
            if '-encrypt' in args:
                pathlib.Path(args[args.index('-out')+1]).write_bytes(b'partial')
                raise subprocess.CalledProcessError(7,args,stderr=b'SENSITIVE_SENTINEL cipher prose')
            return original(args,**kwargs)
        with patch.object(seal.subprocess,'run',side_effect=fail_cipher): receipt=self.failure('encrypt-wafra')
        self.assertEqual(receipt['returnCode'],7); self.assertEqual(receipt['errorClass'],'CalledProcessError')
        self.assertIn('cmsHelpRecognized',receipt['tool'])

    def test_missing_input_and_invalid_provenance_are_classified_without_prose(self):
        (self.data/'ios-build-provenance.json').write_text('SENSITIVE_SENTINEL')
        self.assertEqual(self.failure('provenance-read')['errorClass'],'JSONDecodeError')

    def test_missing_recipient_never_promotes_output(self):
        (self.root/'.github/android-artifact-recipient.pem').unlink()
        receipt=self.failure('encrypt-wafra')
        self.assertFalse(receipt['inputs']['recipient']['regularFile'])

    def test_archive_rejections_remain_fail_closed_with_only_fixed_metadata(self):
        cases=[('Products/../outside',tarfile.REGTYPE,'traversal'),
               ('._Products',tarfile.REGTYPE,'wrong-prefix'),
               ('Products/link',tarfile.SYMTYPE,'non-regular-type')]
        for name,kind,reason in cases:
            with self.subTest(reason=reason):
                self.archive('bad.tar.gz','Products',[(name,kind)])
                with self.assertRaises(seal.ArchiveRejected) as error:
                    seal.archive_hashes(self.data/'bad.tar.gz','Products')
                self.assertEqual(error.exception.evidence['reason'],reason)
                self.assertNotIn(name,json.dumps(error.exception.evidence))

    def test_full_seal_wrong_prefix_records_ordinal_and_removes_both_ciphertexts(self):
        self.archive('WDA-Products-unsigned.tar.gz','Products',[('SENSITIVE_SENTINEL',tarfile.REGTYPE)])
        receipt=self.failure('archive-wda')
        self.assertEqual(receipt['archive'], {'reason':'wrong-prefix','ordinal':1,'files':0,'directories':0,'memberType':'regular'})

    def test_empty_and_duplicate_archives_still_refuse(self):
        self.archive('bad.tar.gz','Products',[('Products',tarfile.DIRTYPE)])
        with self.assertRaises(seal.ArchiveRejected) as error:seal.archive_hashes(self.data/'bad.tar.gz','Products')
        self.assertEqual(error.exception.evidence['reason'],'empty')
        self.archive('bad.tar.gz','Products',[('Products/file',tarfile.REGTYPE),('Products/file',tarfile.REGTYPE)])
        with self.assertRaises(seal.ArchiveRejected) as error:seal.archive_hashes(self.data/'bad.tar.gz','Products')
        self.assertEqual(error.exception.evidence['reason'],'duplicate-file')

    def test_receipt_write_failure_cannot_make_failure_successful(self):
        with patch.object(seal,'seal',side_effect=PermissionError('SENSITIVE_SENTINEL')), \
             patch.object(pathlib.Path,'write_text',side_effect=OSError('SENSITIVE_SENTINEL')):
            code,text=self.execute()
        self.assertEqual(code,1)
        self.assertFalse(json.loads(text)['failureReceiptWritten'])
        self.assertNotIn('SENSITIVE_SENTINEL',text)
        self.assertFalse((self.root/'sealed').exists())

    @unittest.skipUnless(sys.platform=='darwin','BSD macOS xattr fixture')
    def test_macos_metadata_reproduces_baseline_rejection_and_classifies_failure(self):
        fixture=self.root/'Products';fixture.mkdir();(fixture/'synthetic').write_bytes(b'test')
        for path in [fixture,fixture/'synthetic']:
            subprocess.run(['/usr/bin/xattr','-w','com.openbot.seal.fixture','synthetic',str(path)],capture_output=True,check=True)
        # Force the metadata fixture independently of runner environment defaults.
        # Production packaging flags are deliberately unchanged.
        subprocess.run(['/usr/bin/tar','--mac-metadata','-czhf',str(self.data/'WDA-Products-unsigned.tar.gz'),'-C',str(self.root),'Products'],capture_output=True,check=True)
        baseline=subprocess.check_output(['git','-C',str(REPO),'show',BASE+':scripts/ci/ios-device-seal.py'])
        scope={'__name__':'baseline_fixture'};exec(compile(baseline,'baseline_fixture','exec'),scope)
        with self.assertRaises(ValueError):scope['archive_hashes'](self.data/'WDA-Products-unsigned.tar.gz','Products')
        receipt=self.failure('archive-wda')
        self.assertEqual(receipt['archive']['reason'],'wrong-prefix')
        self.assertEqual(receipt['archive']['ordinal'],1)


if __name__=='__main__':
    if os.environ.get('SEAL_FIXTURE_REPORT'):
        stream=io.StringIO();suite=unittest.defaultTestLoader.loadTestsFromTestCase(SealFixtures)
        result=unittest.TextTestRunner(stream=stream).run(suite)
        report={'schema':'wafra-seal-fixture-v1','testsRun':result.testsRun,'failures':len(result.failures),
                'errors':len(result.errors),'skipped':len(result.skipped),'success':result.wasSuccessful(),
                'baselineCommit':BASE,'realKeysUsed':False,'decryptionPerformed':False,'appBuildPerformed':False}
        report['tool'] = seal.tool_observation()[1]
        report['observations'] = OBSERVATIONS
        target=pathlib.Path(os.environ['SEAL_FIXTURE_REPORT']);target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));sys.exit(0 if result.wasSuccessful() else 1)
    unittest.main()
