#!/usr/bin/env python3
"""Fail-closed profile checks; runs without Apple, keychain or device access."""
import copy
import base64
import contextlib
import datetime
import hashlib
import importlib.util
import json
import io
import os
import pathlib
import plistlib
import unittest
import tempfile
import subprocess
import sys
import types
import urllib.error
from unittest.mock import patch

path = pathlib.Path(__file__).resolve().parents[1]/'ci/ios-device-signing.py'
spec = importlib.util.spec_from_file_location('device_signing', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.cert = b'fixture-public-certificate'
        self.state = {'identitySha1': hashlib.sha1(self.cert).hexdigest().upper()}
        self.profile = {'TeamIdentifier': [module.TEAM],
                        'ExpirationDate': datetime.datetime.now() + datetime.timedelta(days=1),
                        'DeveloperCertificates': [self.cert], 'ProvisionedDevices': ['device-a', 'device-b'],
                        'Entitlements': {'application-identifier': module.TEAM + '.app.wafra.ios',
                                         'get-task-allow': True, 'aps-environment': 'development',
                                         'com.apple.security.application-groups': ['group.app.wafra.ios']}}

    def check(self, profile):
        module.assert_profile(profile, 'app.wafra.ios', self.state, {'device-a', 'device-b'})

    def test_accepts_development_profile_for_both_devices(self):
        self.check(self.profile)

    def test_rejects_missing_phone(self):
        self.profile['ProvisionedDevices'] = ['device-a']
        with self.assertRaises(AssertionError): self.check(self.profile)

    def test_rejects_extra_phone(self):
        self.profile['ProvisionedDevices'].append('device-c')
        with self.assertRaises(AssertionError): self.check(self.profile)

    def test_rejects_distribution_profile(self):
        self.profile['Entitlements']['get-task-allow'] = False
        with self.assertRaises(AssertionError): self.check(self.profile)

    def test_rejects_wrong_certificate(self):
        self.profile['DeveloperCertificates'] = [b'wrong']
        with self.assertRaises(AssertionError): self.check(self.profile)

    def test_rejects_wrong_team_or_bundle(self):
        for field, value in [('TeamIdentifier', ['wrong']), ('ExpirationDate', datetime.datetime(2020, 1, 1))]:
            profile = copy.deepcopy(self.profile); profile[field] = value
            with self.assertRaises(AssertionError): self.check(profile)
        self.profile['Entitlements']['application-identifier'] += '.other'
        with self.assertRaises(AssertionError): self.check(self.profile)

    def test_rejects_missing_app_group_and_production_aps(self):
        for key, value in [('com.apple.security.application-groups', []), ('aps-environment', 'production')]:
            profile = copy.deepcopy(self.profile); profile['Entitlements'][key] = value
            with self.assertRaises(AssertionError): self.check(profile)


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.cert = {'id': 'NEWCERT', 'attributes': {'certificateType': 'DEVELOPMENT',
                     'displayName': 'Apple Development: Created via API', 'serialNumber': '012345',
                     'certificateContent': base64.b64encode(b'fixture certificate').decode()}}
        self.profiles = {'NEWPROFILE': {'id': 'NEWPROFILE', 'attributes': {
            'name': 'Wafra QA CI 123-1', 'uuid': 'fixture-uuid', 'profileType': 'IOS_APP_DEVELOPMENT'}}}
        self.receipt = {'team': module.TEAM, 'runId': '123', 'runAttempt': '1',
                        'certificateId': 'NEWCERT', 'certificate': module.cert_metadata(self.cert),
                        'before': {'certificates': [{'id': 'EXISTING'}], 'profiles': []},
                        'profiles': {'fixture-bundle': {'id': 'NEWPROFILE',
                                      'name': 'Wafra QA CI 123-1', 'uuid': 'fixture-uuid'}}}
        self.deleted = []

    def api(self, method, route, body=None):
        if method == 'DELETE':
            self.deleted.append(route)
            if route.startswith('profiles/'):
                del self.profiles[route.split('/')[1]]
            return {}
        if route.startswith('certificates/'):
            return {'data': copy.deepcopy(self.cert)}
        if route.startswith('profiles?'):
            return {'data': copy.deepcopy(list(self.profiles.values()))}
        if '/certificates?' in route:
            return {'data': [copy.deepcopy(self.cert)]}
        return {'data': copy.deepcopy(self.profiles[route.split('/')[1]])}

    def cleanup(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(module, 'api', self.api):
            module.cleanup(self.receipt, 'NEWCERT', ['NEWPROFILE'],
                           '00000000-0000-0000-0000-000000000000', pathlib.Path(tmp)/'report.json')

    def test_only_recorded_new_resources_deleted_in_order(self):
        self.cleanup()
        self.assertEqual(self.deleted, ['profiles/NEWPROFILE', 'certificates/NEWCERT'])

    def test_existing_certificate_never_deleted(self):
        self.receipt['before']['certificates'].append({'id': 'NEWCERT'})
        with self.assertRaises(AssertionError): self.cleanup()
        self.assertEqual(self.deleted, [])

    def test_existing_profile_never_deleted(self):
        self.receipt['before']['profiles'].append({'id': 'NEWPROFILE'})
        with self.assertRaises(AssertionError): self.cleanup()
        self.assertEqual(self.deleted, [])

    def test_rejects_all_certificate_identity_changes(self):
        for field, value in [('certificateType', 'DISTRIBUTION'), ('serialNumber', 'other'),
                             ('displayName', 'other'), ('certificateContent', base64.b64encode(b'other').decode())]:
            with self.subTest(field=field):
                original = self.cert['attributes'][field]
                self.cert['attributes'][field] = value
                with self.assertRaises(AssertionError): self.cleanup()
                self.assertEqual(self.deleted, [])
                self.cert['attributes'][field] = original

    def test_rejects_unrecorded_linked_profile(self):
        self.profiles['OTHER'] = {'id': 'OTHER', 'attributes': {'name': 'Do not delete'}}
        with self.assertRaises(AssertionError): self.cleanup()
        self.assertEqual(self.deleted, [])

    def test_rejects_profile_name_or_type_change(self):
        for field, value in [('name', 'Wafra production'), ('profileType', 'IOS_APP_STORE'), ('uuid', 'other')]:
            with self.subTest(field=field):
                original = self.profiles['NEWPROFILE']['attributes'][field]
                self.profiles['NEWPROFILE']['attributes'][field] = value
                with self.assertRaises(AssertionError): self.cleanup()
                self.assertEqual(self.deleted, [])
                self.profiles['NEWPROFILE']['attributes'][field] = original

    def test_rechecks_profile_before_delete(self):
        original_api = self.api
        def changed(method, route, body=None):
            result = original_api(method, route, body)
            if route == 'profiles/NEWPROFILE':
                result['data']['attributes']['name'] = 'renamed after initial check'
            return result
        with tempfile.TemporaryDirectory() as tmp, patch.object(module, 'api', changed):
            with self.assertRaises(AssertionError):
                module.cleanup(self.receipt, 'NEWCERT', ['NEWPROFILE'],
                               '00000000-0000-0000-0000-000000000000', pathlib.Path(tmp)/'report.json')
        self.assertEqual(self.deleted, [])


class EntitlementTests(unittest.TestCase):
    def setUp(self):
        self.allowed = {'application-identifier': module.TEAM + '.app.wafra.ios',
                        'com.apple.developer.team-identifier': module.TEAM,
                        'get-task-allow': True, 'aps-environment': 'development',
                        'keychain-access-groups': [module.TEAM + '.*'],
                        'com.apple.security.application-groups': ['group.app.wafra.ios']}

    def test_store_only_entitlements_removed_and_development_values_applied(self):
        original = dict(self.allowed, **{'beta-reports-active': True, 'unknown-store-key': True,
                                        'get-task-allow': False, 'aps-environment': 'production'})
        actual = module.development_entitlements(original, self.allowed)
        self.assertNotIn('beta-reports-active', actual)
        self.assertNotIn('unknown-store-key', actual)
        self.assertIs(actual['get-task-allow'], True)
        self.assertEqual(actual['aps-environment'], 'development')
        module.assert_entitlements_allowed(actual, self.allowed)

    def test_verify_rejects_entitlement_absent_from_profile(self):
        with self.assertRaises(AssertionError):
            module.assert_entitlements_allowed(dict(self.allowed, **{'beta-reports-active': True}), self.allowed)

    def test_verify_allows_keychain_wildcard_without_granting_other_teams(self):
        module.assert_entitlements_allowed({'keychain-access-groups': [module.TEAM + '.app.wafra.ios']}, self.allowed)
        with self.assertRaises(AssertionError):
            module.assert_entitlements_allowed({'keychain-access-groups': ['OTHER.app']}, self.allowed)

    def test_app_groups_intersection_drops_ungranted_group(self):
        actual = module.development_entitlements({'com.apple.security.application-groups':
                                                 ['group.app.wafra.ios', 'group.other']}, self.allowed)
        self.assertEqual(actual['com.apple.security.application-groups'], ['group.app.wafra.ios'])

    def test_verify_rejects_value_mismatch_and_boolean_integer_confusion(self):
        for entitlement in [{'aps-environment': 'production'}, {'get-task-allow': 1}]:
            with self.assertRaises(AssertionError): module.assert_entitlements_allowed(entitlement, self.allowed)


class BuildProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        (self.root/'app.json').write_text(json.dumps({'expo': {'version': '1.0.0', 'ios': {'buildNumber': '194'}}}))
        self.original_app = (self.root/'app.json').read_bytes()
        (self.root/'eas.json').write_text(json.dumps({'build': {'production': {'autoIncrement': True},
                                                            'production-candidate': {'extends': 'production'}}}))
        self.report = self.root/'provenance.json'
        module.pin_build(self.root, self.report)
        self.app = self.root/'Wafra.app'
        self.widget = self.app/'PlugIns/Widget.appex'
        self.widget.mkdir(parents=True)
        for path, bundle in [(self.app, 'app.wafra.ios'), (self.widget, 'app.wafra.ios.widget')]:
            (path/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': bundle,
                'CFBundleVersion': '194', 'CFBundleShortVersionString': '1.0.0'}))

    def test_pins_both_increment_settings_without_changing_app_source(self):
        candidate = json.loads((self.root/'eas.json').read_text())['build']['production-candidate']
        self.assertIs(candidate['autoIncrement'], False)
        self.assertIs(candidate['ios']['autoIncrement'], False)
        self.assertEqual((self.root/'app.json').read_bytes(), self.original_app)
        self.assertEqual(json.loads(self.report.read_text())['expectedBuildNumber'], '194')

    def test_accepts_exact_rebuild_version(self):
        module.preflight_app(self.app, self.report)
        self.assertTrue(json.loads(self.report.read_text())['storeIpaVersionsAndPluginSetVerified'])

    def test_rejects_incremented_app_or_widget(self):
        for path in [self.app, self.widget]:
            with self.subTest(path=path.name):
                original = (path/'Info.plist').read_bytes()
                info = plistlib.loads(original); info['CFBundleVersion'] = '195'
                (path/'Info.plist').write_bytes(plistlib.dumps(info))
                with self.assertRaises(AssertionError): module.preflight_app(self.app, self.report)
                (path/'Info.plist').write_bytes(original)

    def test_rejects_missing_or_unexpected_widget(self):
        self.widget.rename(self.app/'Unexpected.appex')
        with self.assertRaises(AssertionError): module.preflight_app(self.app, self.report)

    def test_rejects_unexpected_extra_appex(self):
        (self.app/'PlugIns/Other.appex').mkdir()
        with self.assertRaises(AssertionError): module.preflight_app(self.app, self.report)


class FailureDiagnosticsTests(unittest.TestCase):
    def test_http_failure_retains_only_status_and_allowlisted_codes(self):
        payload = {'errors': [{'code': 'ENTITY_ERROR.ATTRIBUTE.INVALID',
                              'title': 'PRIVATE_NAME', 'detail': 'PRIVATE_TOKEN'},
                             {'code': 'PRIVATE_TOKEN'}], 'csr': 'PRIVATE_CSR'}
        error = urllib.error.HTTPError('https://example.invalid', 409, 'PRIVATE_REASON', {},
                                       io.BytesIO(json.dumps(payload).encode()))
        fake_jwt = types.SimpleNamespace(encode=lambda *a, **k: 'PRIVATE_JWT')
        with patch.dict(os.environ, {'ASC_KEY_P8': 'BEGIN PRIVATE KEY fixture',
                                     'ASC_KEY_ID': 'fixture', 'ASC_ISSUER_ID': 'fixture'}), \
             patch.dict(sys.modules, {'jwt': fake_jwt}), \
             patch.object(module.urllib.request, 'urlopen', side_effect=error):
            with self.assertRaises(module.AppleAPIError) as raised:
                module.api('POST', 'certificates', {'csr': 'PRIVATE_CSR'})
        self.assertEqual(raised.exception.status, 409)
        self.assertEqual(raised.exception.codes, ['ENTITY_ERROR.ATTRIBUTE.INVALID'])
        self.assertNotIn('PRIVATE', str(raised.exception))

    def test_failure_record_is_sealed_and_plaintext_removed_without_output(self):
        cwd = pathlib.Path.cwd()
        captured = []
        def fake_encrypt(*args):
            source = pathlib.Path(args[args.index('-in') + 1])
            captured.append(json.loads(source.read_text()))
            pathlib.Path(args[args.index('-out') + 1]).write_bytes(b'encrypted fixture')
        def failing_prepare(root):
            module.diagnostic_phase('create_profile', module.BUNDLES[1])
            module._diagnostic_api = {'method': 'POST', 'route': 'profiles'}
            raise module.AppleAPIError(409, ['ENTITY_ERROR.ATTRIBUTE.INVALID'])
        try:
            with tempfile.TemporaryDirectory() as tmp:
                os.chdir(tmp); root = pathlib.Path(tmp)/'signing'; root.mkdir()
                stdout, stderr = io.StringIO(), io.StringIO()
                with patch.object(module, '_prepare', side_effect=failing_prepare), \
                     patch.object(module, 'run', side_effect=fake_encrypt), \
                     patch.dict(os.environ, {'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1'}), \
                     contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                    with self.assertRaises(module.AppleAPIError): module.prepare(root)
                self.assertEqual(stdout.getvalue() + stderr.getvalue(), '')
                record = captured[0]
                self.assertEqual(record['phase'], 'create_profile')
                self.assertEqual(record['bundleId'], module.BUNDLES[1])
                self.assertEqual(record['api'], {'method': 'POST', 'route': 'profiles'})
                self.assertEqual(record['httpStatus'], 409)
                self.assertEqual(record['appleErrorCodes'], ['ENTITY_ERROR.ATTRIBUTE.INVALID'])
                self.assertFalse((root/'signing-failure.json').exists())
                self.assertTrue(pathlib.Path('sealed/signing-failure.enc').is_file())
                self.assertFalse(pathlib.Path('sealed/signing-failure.json').exists())
        finally:
            os.chdir(cwd)

    def test_sealing_failure_still_deletes_plaintext_and_preserves_failure(self):
        cwd = pathlib.Path.cwd()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                os.chdir(tmp); root = pathlib.Path(tmp)/'signing'; root.mkdir()
                with patch.object(module, '_prepare', side_effect=AssertionError('PRIVATE_DEVICE')), \
                     patch.object(module, 'run', side_effect=RuntimeError('PRIVATE_KEY')):
                    with self.assertRaises(AssertionError): module.prepare(root)
                self.assertFalse((root/'signing-failure.json').exists())
        finally:
            os.chdir(cwd)


class InventoryPrivacyTests(unittest.TestCase):
    def test_only_ids_and_types_public_counts_only_in_stdout(self):
        certificate = {'id': 'EXAMPLECERT', 'attributes': {'certificateType': 'DEVELOPMENT',
                       'name': 'Apple Development: EXAMPLE_PERSON'}}
        profile = {'id': 'EXAMPLEPROFILE', 'attributes': {'profileType': 'IOS_APP_DEVELOPMENT',
                   'name': 'EXAMPLE_PERSON personal profile'}}
        stdout = io.StringIO()
        cwd = pathlib.Path.cwd()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                root = pathlib.Path(tmp); (root/'private').mkdir(); os.chdir(root)
                with patch.object(module, 'api_list', side_effect=[[certificate], [profile]]), \
                     patch.object(module, 'run') as encrypt, contextlib.redirect_stdout(stdout):
                    public = module.inventory(root/'private')
                self.assertEqual(public, {'certificates': [{'id': 'EXAMPLECERT', 'type': 'DEVELOPMENT'}],
                                          'profiles': [{'id': 'EXAMPLEPROFILE', 'type': 'IOS_APP_DEVELOPMENT'}]})
                self.assertNotIn('EXAMPLE_PERSON', stdout.getvalue())
                self.assertIn('EXAMPLE_PERSON', (root/'private/signing-inventory.json').read_text())
                self.assertIn('sealed/signing-inventory.enc', encrypt.call_args.args)
        finally:
            os.chdir(cwd)

    def test_certificate_name_is_recorded_as_digest_only(self):
        cert = {'id': 'EXAMPLE', 'attributes': {'certificateType': 'DEVELOPMENT',
                'displayName': 'EXAMPLE_PERSON', 'serialNumber': '123',
                'certificateContent': base64.b64encode(b'fixture').decode()}}
        metadata = module.cert_metadata(cert)
        self.assertNotIn('EXAMPLE_PERSON', json.dumps(metadata))
        self.assertEqual(metadata['nameSha256'], hashlib.sha256(b'EXAMPLE_PERSON').hexdigest())

    def test_optimized_python_cannot_disable_signing_guards(self):
        result = subprocess.run([sys.executable, '-O', str(path), 'unknown', '/tmp'], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Optimized Python is refused', result.stderr)


if __name__ == '__main__': unittest.main()
