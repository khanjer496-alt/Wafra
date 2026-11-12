import importlib.util
import json
import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('capture', Path(__file__).with_name('capture.py'))
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        self.source = 'a' * 40
        self.images = []
        for size, _, pixels in capture.DEVICES:
            for lang in ('en', 'ar'):
                for index, surface in enumerate(capture.SURFACES):
                    file = self.out / f'{size}-{lang}-{surface}.png'
                    # Header fixtures test provenance guards, not screenshot rendering.
                    file.write_bytes(b'\x89PNG\r\n\x1a\n' + b'\x00\x00\x00\rIHDR' + struct.pack('>II', *pixels) + file.name.encode() + bytes([index]))
                    self.images.append({'file': file.name, 'sizeGroup': size, 'language': lang, 'surface': surface,
                                        'pixels': pixels, 'sourceSha': self.source, 'sha256': capture.sha(file)})

    def test_complete_exact_matrix(self):
        capture.validate(self.images, self.source, self.out)

    def test_missing_and_duplicate_surfaces_fail(self):
        for rows in (self.images[:-1], self.images[:-1] + [self.images[0]]):
            with self.assertRaises(ValueError):
                capture.validate(rows, self.source, self.out)

    def test_wrong_source_and_dimensions_fail(self):
        self.images[0]['sourceSha'] = 'b' * 40
        with self.assertRaises(ValueError): capture.validate(self.images, self.source, self.out)
        self.images[0]['sourceSha'] = self.source
        self.images[0]['pixels'] = (390, 844)
        with self.assertRaises(ValueError): capture.validate(self.images, self.source, self.out)

    def test_modified_or_reused_images_fail(self):
        (self.out / self.images[0]['file']).write_bytes(b'web is not native proof')
        with self.assertRaises(ValueError): capture.validate(self.images, self.source, self.out)

    def test_external_path_fails(self):
        self.images[0]['file'] = '../outside.png'
        with self.assertRaises(ValueError): capture.validate(self.images, self.source, self.out)

    def test_file_pixels_cannot_be_faked_by_manifest(self):
        file = self.out / self.images[0]['file']
        data = file.read_bytes()
        file.write_bytes(data[:16] + struct.pack('>II', 390, 844) + data[24:])
        self.images[0]['sha256'] = capture.sha(file)
        with self.assertRaises(ValueError): capture.validate(self.images, self.source, self.out)

    def test_old_asset_and_repeated_hash_fail(self):
        old = self.out / 'docs/store-assets'
        old.mkdir(parents=True)
        (old / 'old.png').write_bytes((self.out / self.images[0]['file']).read_bytes())
        with patch.object(capture, 'ROOT', self.out):
            with self.assertRaises(ValueError): capture.validate(self.images, self.source, self.out)

    def test_dispatch_ref_must_equal_frozen_source(self):
        with patch.object(capture, 'run', return_value=self.source), patch.dict(os.environ, {'EXPECTED_SHA': 'b' * 40}):
            with self.assertRaises(ValueError): capture.prepare(self.out)

    def test_candidate_flags_and_context_recorded_without_secrets(self):
        env = {'EXPECTED_SHA': self.source, 'GITHUB_SHA': self.source, 'GITHUB_EVENT_NAME': 'workflow_dispatch',
               'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_ENV': str(self.out / 'env')}
        with patch.object(capture, 'run', return_value=self.source), patch.dict(os.environ, env):
            capture.prepare(self.out)
        p = json.loads((self.out / 'build-provenance.json').read_text())
        self.assertTrue(all(v == '0' for v in p['flags'].values()))
        self.assertFalse(p['fixtureSeam'])
        self.assertFalse(p['storePurchaseEvidence'])
        self.assertNotIn('API_KEY', json.dumps(p))
        self.assertTrue('EAS_BUILD_PROFILE=production-candidate\n' in (self.out / 'env').read_text(),
                        'capture prebuild needs an explicit candidate profile')


if __name__ == '__main__':
    unittest.main()
