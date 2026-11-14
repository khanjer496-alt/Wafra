"""Synthetic secrets must never cross the public diagnostic export boundary."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('public_export', Path(__file__).with_name('public-export.py'))
export = importlib.util.module_from_spec(spec)
spec.loader.exec_module(export)


class PublicExportTests(unittest.TestCase):
    def test_sensitive_native_payloads_are_excluded(self):
        for text in ['Authorization: Bearer SYNTHETIC-TOKEN', 'headers={x:SYNTHETIC-HEADER}',
                     'receipt=SYNTHETIC-RECEIPT', 'JWS=eyJtest.eyJtest.signature',
                     'customerId=SYNTHETIC-CUSTOMER', 'account=SYNTHETIC-ACCOUNT',
                     'email=synthetic@example.invalid']:
            self.assertIsNone(export.event('StoreKit restore failed ' + text))

    def test_native_export_uses_only_allowlisted_fields(self):
        event = export.event('storekitd restore failed unknown_payload=SYNTHETIC-OPAQUE-VALUE app.wafra.ios')
        self.assertEqual(event['events'], ['restore', 'error'])
        self.assertNotIn('SYNTHETIC', json.dumps(event))
        self.assertEqual(set(event), {'events', 'bundles', 'products'})

    def test_result_rows_keep_verdict_but_drop_arbitrary_details(self):
        result = export.safe_results('P3c\tFAIL\tAuthorization: Bearer SYNTHETIC-TOKEN\nP3b\tFAIL\tUNPROVEN\n')
        self.assertIn('P3c\tFAIL\t', result)
        self.assertNotIn('SYNTHETIC-TOKEN', result)
        self.assertIn('UNPROVEN', result)

    def test_native_init_and_restore_windows_exclude_sensitive_lines(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'raw').write_text('2026-11-15 01:00:00.001 storekitd configure product app.wafra.ios\n'
                                     '2026-11-15 01:00:01.001 storekitd restore receipt=SYNTHETIC-SECRET\n')
            (root / 'notes').write_text('2026-11-15 01:00:00 +0000 INIT boundary start\n'
                                       '2026-11-15 01:00:01 +0000 P3c boundary Restore\n')
            export.native_windows(root / 'raw', root / 'notes', root / 'out')
            files = list((root / 'out').glob('*.json'))
            self.assertEqual(len(files), 2)
            for file in files:
                text = file.read_text()
                self.assertNotIn('SYNTHETIC-SECRET', text)
                self.assertEqual(json.loads(text)['sensitive_excluded'], 1)

    def test_unknown_stage_names_are_not_public_fields(self):
        self.assertEqual(export.stages('2026-11-15 01:00:00 +0000 SYNTHETIC-TOKEN boundary start'), [])

    def test_publication_withholds_ui_and_sdk_text(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'purchase-xcodebuild-test.log').write_text('Superwall token=SYNTHETIC-SECRET\nConnection to daemon interrupted\n')
            (root / 'INIT-ui.txt').write_text('customer=SYNTHETIC-CUSTOMER')
            (root / 'purchase-results.tsv').write_text('DIAG\tFAIL\taccount=SYNTHETIC-ACCOUNT\n')
            export.publish(root)
            for file in root.iterdir():
                self.assertNotIn('SYNTHETIC-', file.read_text())
            self.assertIn('daemon_interrupted', (root / 'purchase-xcodebuild-test.log').read_text())


if __name__ == '__main__':
    unittest.main()
