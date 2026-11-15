#!/usr/bin/env python3
"""Ten tiny fake cases; no network/keys/CMS/decryption/extraction. Not yet run."""
import copy
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import shutil
import stat
import tempfile
import unittest
import warnings
import zipfile
from unittest import mock

spec=importlib.util.spec_from_file_location('verifier',pathlib.Path(__file__).parents[1]/'ci/ios-sealed-artifact-verify.py')
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)


def fixture():
    opaque={'wafra':b'opaque Wafra bytes','wda':b'opaque WDA bytes'}
    manifest={'schema':'wafra-ios-local-signing-inputs-v1','sourceCommit':v.SOURCE,'workflowCommit':v.SOURCE,
              'runId':str(v.RUN),'label':'local signing inputs for '+v.SOURCE,'qaSigningPerformed':False,
              'buildProvenance':copy.deepcopy(v.PROVENANCE),'wdaSource':{'package':'appium-webdriveragent','version':'16.12.5','sha256':'a'*64},'files':[],
              'wdaProductFileHashes':{'synthetic/member':'b'*64},'wafraProductFileHashes':{'synthetic/member':'c'*64}}
    for label,name in v.FILES.items():manifest['files'].append({'source':name,'sealed':name+'.enc','sha256':'d'*64,'sealedSha256':hashlib.sha256(opaque[label]).hexdigest(),'bytes':123456})
    return manifest,opaque


def encoded(manifest):return (json.dumps(manifest,indent=2)+'\n').encode()


def archive(path,manifest=None,variant=None):
    original,opaque=fixture();manifest=original if manifest is None else manifest
    with warnings.catch_warnings():
        warnings.simplefilter('ignore',UserWarning)
        with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_STORED) as z:
            for label,name in v.FILES.items():
                info=zipfile.ZipInfo(name+'.enc');info.external_attr=(stat.S_IFLNK|0o777)<<16 if variant=='link' and label=='wda' else (stat.S_IFREG|0o600)<<16
                z.writestr(info,opaque[label])
            z.writestr('verification.json',encoded(manifest))
            if variant=='extra':z.writestr('extra',b'x')
            if variant=='duplicate':z.writestr('verification.json',encoded(manifest))
    if variant in ('encrypted','compression'):
        data=bytearray(path.read_bytes());index=data.index(b'PK\x01\x02')
        data[index+(8 if variant=='encrypted' else 10)]=1 if variant=='encrypted' else 99
        path.write_bytes(data)


class Cases(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=pathlib.Path(self.temp.name)
        self.old_phase=v.CONTEXT['phase'];self.addCleanup(v.CONTEXT.update,phase=self.old_phase)

    def test_positive_opaque_streams_not_plaintext_and_no_extraction(self):
        path=self.root/'fake.zip';archive(path)
        with mock.patch.object(zipfile.ZipFile,'extract',side_effect=AssertionError),mock.patch.object(zipfile.ZipFile,'extractall',side_effect=AssertionError):result=v.verify_archive(path)
        self.assertEqual(set(result),{'wafra','wda'})
        self.assertEqual(result['wafra']['plaintextBytesDeclared'],123456)
        self.assertNotEqual(result['wafra']['ciphertextBytesMeasured'],123456)
        self.assertFalse(v.report_base()['limits']['plaintextVerified'])

    def test_layout_duplicate_extra_link_encryption_compression_refused(self):
        for variant in ('duplicate','extra','link','encrypted','compression'):
            with self.subTest(variant=variant):
                path=self.root/(variant+'.zip');archive(path,variant=variant)
                with self.assertRaises((v.Refusal,zipfile.BadZipFile)):v.verify_archive(path)

    def test_json_duplicates_depth_constants_and_unknown_fields_refused(self):
        for data in (b'{"x":1,"x":2}',b'[[[[0]]]]',b'{"x":NaN}'):
            with self.assertRaises(v.Refusal):v.parse_json(data,100,depth=3)
        m,_=fixture();m['unknown']='withheld synthetic prose'
        with self.assertRaises(v.Refusal):v.validate_manifest(encoded(m))

    def test_manifest_identity_provenance_and_wda_pin_mismatch_refused(self):
        for change in ('source','run','qa','provenance','wda'):
            m,_=fixture()
            if change=='source':m['sourceCommit']='0'*40
            if change=='run':m['runId']='1'
            if change=='qa':m['qaSigningPerformed']=True
            if change=='provenance':m['buildProvenance']['rebuildOfSource']=False
            if change=='wda':m['wdaSource']['version']='0'
            with self.assertRaises(v.Refusal):v.validate_manifest(encoded(m))

    def test_ciphertext_hash_mismatch_refused(self):
        m,_=fixture();m['files'][0]['sealedSha256']='f'*64;path=self.root/'mismatch.zip';archive(path,m)
        with self.assertRaises(v.Refusal):v.verify_archive(path)

    def test_hash_map_traversal_and_bounds_are_declarations_only(self):
        for name in ('../escape','/absolute','a/../b'):
            m,_=fixture();m['wdaProductFileHashes']={name:'a'*64}
            with self.assertRaises(v.Refusal):v.validate_manifest(encoded(m))
        m,_=fixture()
        with mock.patch.object(v,'MAP_ENTRIES',0):
            with self.assertRaises(v.Refusal):v.validate_manifest(encoded(m))
        records,maps=v.validate_manifest(encoded(m));self.assertEqual(maps['wda']['declaredCount'],1)

    def test_archive_digest_and_size_fail_before_any_zip_parse(self):
        data=b'opaque not parsed';response=io.BytesIO(data);response.headers={}
        with mock.patch.object(v,'response',return_value=response),mock.patch.object(v,'ARCHIVE_BYTES',len(data)),mock.patch.object(v,'ARCHIVE_SHA256','0'*64),mock.patch.object(zipfile,'ZipFile') as parser:
            with self.assertRaises(v.Refusal):v.download(self.root/'download.zip')
            parser.assert_not_called()
        response=io.BytesIO(data+b'x');response.headers={}
        with mock.patch.object(v,'response',return_value=response),mock.patch.object(v,'ARCHIVE_BYTES',len(data)):
            with self.assertRaises(v.Refusal):v.download(self.root/'oversize.zip')

    def test_private_cleanup_failure_blocks_candidate_publication(self):
        path=self.root/'fixture.zip';archive(path)
        env={'GITHUB_ACTIONS':'true','RUNNER_OS':'Linux','GITHUB_REPOSITORY':v.REPO,'RUNNER_TEMP':str(self.root)}
        listing={'total_count':1,'artifacts':[{'id':v.ARTIFACT}]}
        with mock.patch.dict(os.environ,env),mock.patch.object(v.sys,'platform','linux'),mock.patch.object(v,'api',return_value=listing),mock.patch.object(v,'validate_identity'),mock.patch.object(v,'source_pins'),mock.patch.object(v,'download',side_effect=lambda p:shutil.copyfile(path,p)),mock.patch.object(v.shutil,'rmtree',side_effect=OSError('withheld')):
            self.assertEqual(v.verify(),1)
        report=json.loads((self.root/'sealed-verifier-report/result.json').read_text())
        self.assertFalse(report['candidateVerified']);self.assertFalse(report['privateTempDeleted']);self.assertEqual(report['failure'],'cleanup')
        self.assertNotIn('withheld',json.dumps(report))

    def test_original_identity_failure_prevents_download(self):
        env={'GITHUB_ACTIONS':'true','RUNNER_OS':'Linux','GITHUB_REPOSITORY':v.REPO,'RUNNER_TEMP':str(self.root)}
        with mock.patch.dict(os.environ,env),mock.patch.object(v.sys,'platform','linux'),mock.patch.object(v,'api',return_value={'id':v.RUN+1}),mock.patch.object(v,'download') as download,mock.patch.object(v,'source_pins') as pins:
            self.assertEqual(v.verify(),1);download.assert_not_called();pins.assert_not_called()
        report=json.loads((self.root/'sealed-verifier-report/result.json').read_text())
        self.assertEqual(report['failure'],'identity');self.assertFalse(report['candidateVerified'])

    def test_provider_actual_size_and_output_allowlist_gate(self):
        env={'GITHUB_ACTIONS':'true','RUNNER_OS':'Linux','GITHUB_REPOSITORY':v.REPO,'GITHUB_RUN_ID':'222','GITHUB_SHA':'1'*40,'REPORT_ARTIFACT_ID':'111','REPORT_ARTIFACT_DIGEST':'a'*64}
        item={'id':111,'name':'wafra-sealed-check-222','expired':False,'size_in_bytes':v.PROVIDER_BYTES+1,'digest':'sha256:'+'a'*64,'workflow_run':{'id':222,'repository_id':v.REPOSITORY_ID,'head_repository_id':v.REPOSITORY_ID,'head_sha':'1'*40}}
        with mock.patch.dict(os.environ,env),mock.patch.object(v.sys,'platform','linux'),mock.patch.object(v,'api',return_value=item):
            with self.assertRaises(v.Refusal):v.provider_gate()
            item['size_in_bytes']=100;self.assertEqual(v.provider_gate(),0)
        report=v.report_base();report['unknown']='withheld'
        with self.assertRaises(v.Refusal):v.validate_report(report)


class Quiet(unittest.TestResult):
    def addError(self,test,err):self.errors.append((test,'fixed'))
    def addFailure(self,test,err):self.failures.append((test,'fixed'))
    def addSubTest(self,test,subtest,err):
        if err is not None:
            (self.addFailure if issubclass(err[0],test.failureException) else self.addError)(subtest,err)


if __name__=='__main__':
    result=Quiet();unittest.defaultTestLoader.loadTestsFromTestCase(Cases).run(result)
    raise SystemExit(0 if result.testsRun==10 and result.wasSuccessful() and not result.skipped else 1)
