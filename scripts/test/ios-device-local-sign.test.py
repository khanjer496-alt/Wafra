#!/usr/bin/env python3
"""Offline refusal/cleanup tests; never import real keys or invoke security."""
import contextlib
import datetime
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import plistlib
import subprocess
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

path = pathlib.Path(__file__).resolve().parents[1]/'ci/ios-device-local-sign.py'
spec = importlib.util.spec_from_file_location('local_sign', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ArchiveTests(unittest.TestCase):
    def test_rejects_traversal_symlink_and_device_before_extracting(self):
        for name, kind in [('../outside', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE),
                           ('Payload/link', tarfile.SYMTYPE), ('Payload/device', tarfile.CHRTYPE)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                root = pathlib.Path(tmp); archive = root/'input.tar.gz'
                with tarfile.open(archive, 'w:gz') as tar:
                    entry = tarfile.TarInfo(name); entry.type = kind; entry.linkname = '/private'
                    tar.addfile(entry)
                with self.assertRaises(AssertionError): module.extract_regular_archive(archive, root/'unpack')
                self.assertEqual(list((root/'unpack').iterdir()), [])

    def test_extracts_regular_files_and_preserves_executable_bit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp); archive = root/'input.tar.gz'
            with tarfile.open(archive, 'w:gz') as tar:
                entry = tarfile.TarInfo('Products/runner'); entry.mode = 0o755; entry.size = 3
                tar.addfile(entry, io.BytesIO(b'abc'))
            module.extract_regular_archive(archive, root/'unpack')
            module.verify_tree(root/'unpack/Products', {'runner': hashlib.sha256(b'abc').hexdigest()})
            self.assertEqual((root/'unpack/Products/runner').stat().st_mode & 0o777, 0o755)
            (root/'unpack/Products/extra').write_text('unexpected')
            with self.assertRaises(AssertionError):
                module.verify_tree(root/'unpack/Products', {'runner': hashlib.sha256(b'abc').hexdigest()})


class KeychainTests(unittest.TestCase):
    def test_deletes_only_fresh_keychain_on_success_or_signing_failure(self):
        for fail in (False, True):
            with self.subTest(fail=fail):
                calls = []
                def fake_run(*args, **kwargs):
                    calls.append(args)
                    return module.IDENTITY.encode() if args[1] == 'find-identity' else b''
                with patch.object(module, 'run', side_effect=fake_run), \
                     patch.object(module.secrets, 'token_urlsafe', return_value='PASSWORD_SENTINEL'):
                    try:
                        with module.temporary_keychain(pathlib.Path('/original/key'), pathlib.Path('/public/cert')) as keychain:
                            if fail: raise ValueError('signing failed')
                    except ValueError:
                        self.assertTrue(fail)
                self.assertEqual(calls[-1], ('security', 'delete-keychain', keychain))
                self.assertTrue(all('login' not in ' '.join(c) for c in calls))
                self.assertTrue(all(c[1] not in ('list-keychains', 'default-keychain', 'export') for c in calls))
                imports = [c for c in calls if c[1] == 'import']
                self.assertEqual(imports[0][2], '/original/key')
                self.assertIn('-x', imports[0])

    def test_import_failure_also_attempts_exact_keychain_deletion(self):
        calls = []
        def fail_import(*args, **kwargs):
            calls.append(args)
            if args[1] == 'import': raise subprocess.CalledProcessError(1, ['PRIVATE_PASSWORD'])
            return b''
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.object(module, 'run', side_effect=fail_import), \
             contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            with self.assertRaises(subprocess.CalledProcessError):
                with module.temporary_keychain(pathlib.Path('/original/key'), pathlib.Path('/public/cert')):
                    self.fail('import failure must not yield')
        self.assertEqual(calls[-1][1], 'delete-keychain')
        self.assertEqual(stdout.getvalue() + stderr.getvalue(), '')


class ProfileRefusalTests(unittest.TestCase):
    def test_missing_device_wrong_uuid_and_extra_certificate_refuse_before_signing(self):
        cert = b'fixture certificate'
        identity = hashlib.sha1(cert).hexdigest().upper()
        for variation in ('missing_device', 'wrong_uuid', 'extra_certificate'):
            with self.subTest(variation=variation), tempfile.TemporaryDirectory() as tmp:
                root = pathlib.Path(tmp); profiles = root/'profiles'; profiles.mkdir()
                work = root/'work'; work.mkdir()
                receipt = {'deviceUdids': ['phone-a', 'phone-b'], 'profiles': {}}
                decoded = {}
                decoded['reference.mobileprovision'] = {
                    'UUID': 'a57e79a7-02f7-49b5-808c-9e88b1e81cd8',
                    'TeamIdentifier': [module.signing.TEAM], 'ProvisionedDevices': ['phone-a', 'phone-b']}
                for bundle in module.signing.BUNDLES:
                    file = profiles/(bundle + '.mobileprovision'); file.write_bytes(b'fixture')
                    receipt['profiles'][bundle] = {'uuid': bundle, 'name': 'QA fixture', 'sha256': module.sha256(file)}
                    decoded[file.name] = {'TeamIdentifier': [module.signing.TEAM], 'UUID': bundle,
                        'Name': 'QA fixture', 'DeveloperCertificates': [cert],
                        'ExpirationDate': datetime.datetime(2099, 1, 1),
                        'ProvisionedDevices': ['phone-a', 'phone-b'], 'Entitlements': {
                            'application-identifier': module.signing.TEAM + '.' + bundle,
                            'get-task-allow': True, 'aps-environment': 'development',
                            'com.apple.security.application-groups': ['group.app.wafra.ios']}}
                first = decoded[module.signing.BUNDLES[0] + '.mobileprovision']
                if variation == 'missing_device': first['ProvisionedDevices'] = ['phone-a']
                if variation == 'wrong_uuid': first['UUID'] = 'different'
                if variation == 'extra_certificate': first['DeveloperCertificates'].append(b'other')
                def decode(*args, **kwargs):
                    self.assertEqual(args[:4], ('security', 'cms', '-D', '-i'))
                    return plistlib.dumps(decoded[pathlib.Path(args[4]).name])
                with patch.object(module, 'IDENTITY', identity), patch.object(module, 'run', side_effect=decode):
                    with self.assertRaises(AssertionError):
                        module.validate_profiles(work, profiles, receipt, root/'reference.mobileprovision')


class InputRefusalTests(unittest.TestCase):
    def test_source_run_and_schema_mismatches_cannot_reach_key_or_keychain(self):
        for field, value in [('sourceCommit', 'b'*40), ('runId', 'other'),
                             ('workflowCommit', 'd'*40), ('schema', 'old-signed-format'), ('qaSigningPerformed', True)]:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as tmp:
                root = pathlib.Path(tmp)
                data = {'schema': 'wafra-ios-local-signing-inputs-v1', 'sourceCommit': 'a'*40,
                        'workflowCommit': 'c'*40, 'runId': '123', 'qaSigningPerformed': False}; data[field] = value
                (root/'verification.json').write_text(json.dumps(data))
                args = types.SimpleNamespace(source_commit='a'*40, run_id='123', inputs_dir=root,
                                             workflow_commit='c'*40, output_dir=root/'output')
                with patch.object(module, 'verify_file_key') as key, patch.object(module, 'temporary_keychain') as kc:
                    with self.assertRaises(AssertionError): module.main(args)
                    key.assert_not_called(); kc.assert_not_called()

    def test_hosted_workflow_has_no_QA_account_mutation_and_only_sealed_upload(self):
        workflow = (path.parents[2]/'.github/workflows/ios-device-build.yml').read_text()
        self.assertIn('BUILD_ONLY_NO_QA_SIGNING', workflow)
        self.assertNotIn('EXPO_ASC_', workflow)
        self.assertNotIn('CREATE_QA_SIGNING', workflow)
        self.assertNotIn('ios-device-signing.py prepare', workflow)
        self.assertNotIn('CODE_SIGNING_ALLOWED=YES', workflow)
        self.assertIn('CODE_SIGNING_ALLOWED=NO', workflow)
        self.assertIn('sealed/*.enc', workflow)
        self.assertIn('sealed/verification.json', workflow)


if __name__ == '__main__': unittest.main()
