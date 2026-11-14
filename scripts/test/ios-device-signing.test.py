#!/usr/bin/env python3
"""Fail-closed profile checks; runs without Apple, keychain or device access."""
import copy
import datetime
import hashlib
import importlib.util
import pathlib
import unittest

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


if __name__ == '__main__': unittest.main()
