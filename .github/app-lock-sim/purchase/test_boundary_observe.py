"""Focused fault tests using synthetic files and mocked commands; no simulator or build."""
import importlib.util
import json
import plistlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('boundary', Path(__file__).with_name('boundary-observe.py'))
boundary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boundary)


class BoundaryObservationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source.app'
        self.installed = self.root / 'installed.app'
        for app in (self.source, self.installed):
            app.mkdir()
            (app / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleExecutable': 'Wafra', 'CFBundleIdentifier': 'app.wafra.ios'}))
            (app / 'Wafra').write_bytes(b'synthetic executable')
            (app / 'main.jsbundle').write_bytes(b'synthetic JS')
        self.fixture = self.root / 'fixture.storekit'
        self.fixture.write_text(json.dumps({'products': []}))
        self.groups = self.root / 'Library/Developer/CoreSimulator/Devices/SYNTHETIC/data/Containers/Shared/AppGroup'

    def config(self, bundle, group='group'):
        path = self.groups / group / 'Documents/Persistence/Octane' / bundle / 'Configuration.storekit'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(self.fixture.read_bytes())
        return path

    def command(self, args):
        if args[:3] == ['xcrun', 'simctl', 'get_app_container']:
            return 0, str(self.installed), ''
        if args[0] == 'codesign':
            return 0, '', 'CDHash=synthetic\nIdentifier=app.wafra.ios'
        return 0, '123\t0\tcom.apple.storekitd', ''

    def observe(self, require=True, command=None):
        with patch.object(boundary.Path, 'home', return_value=self.root), patch.object(boundary, 'run', side_effect=command or self.command):
            return boundary.observe('SYNTHETIC', self.source, self.fixture, 'test', require)

    def test_runner_only_configuration_is_not_success(self):
        self.config(boundary.BUNDLES[0])
        result = self.observe()
        self.assertFalse(result['checks_ok'])
        self.assertEqual(result['configs']['app.wafra.ios']['count'], 0)

    def test_identical_files_are_not_a_transaction_binding_claim(self):
        for bundle in boundary.BUNDLES:
            self.config(bundle)
        before = {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        result = self.observe()
        self.assertTrue(result['checks_ok'])
        self.assertIn('UNPROVEN', result['binding'])
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_ambiguous_aut_configuration_fails(self):
        for bundle in boundary.BUNDLES:
            self.config(bundle)
        self.config('app.wafra.ios', 'other-group')
        self.assertFalse(self.observe()['checks_ok'])

    def test_different_config_fails(self):
        for bundle in boundary.BUNDLES:
            self.config(bundle)
        self.config('app.wafra.ios').write_text('{"products":["different"]}')
        self.assertFalse(self.observe()['checks_ok'])

    def test_installed_javascript_mismatch_fails_even_without_config_requirement(self):
        (self.installed / 'main.jsbundle').write_bytes(b'wrong build')
        self.assertFalse(self.observe(require=False)['checks_ok'])

    def test_daemon_status_command_failure_fails(self):
        def command(args):
            if 'launchctl' in args:
                return 71, '', 'synthetic interruption'
            return self.command(args)
        self.assertFalse(self.observe(require=False, command=command)['checks_ok'])

    def test_missing_daemon_service_fails_strict_observation(self):
        for bundle in boundary.BUNDLES:
            self.config(bundle)
        def command(args):
            if 'launchctl' in args:
                return 0, '', ''
            return self.command(args)
        self.assertFalse(self.observe(command=command)['checks_ok'])

    def test_missing_installed_container_is_recorded_failure(self):
        result = self.observe(command=lambda args: (1, '', 'synthetic missing app'))
        self.assertFalse(result['checks_ok'])
        self.assertEqual(result['commands'][0]['exit'], 1)
        self.assertIn('container unavailable', result['errors'][0])


if __name__ == '__main__':
    unittest.main()
