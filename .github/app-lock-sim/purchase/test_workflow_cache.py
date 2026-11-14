"""Exercise only the pure cache-key shell step; no checkout, build or network."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

WORKFLOW = Path(__file__).parents[2] / 'workflows/app-lock-sim.yml'


class WorkflowCacheTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = json.loads(subprocess.check_output(['ruby', '-rjson', '-ryaml', '-e',
            'puts JSON.generate(YAML.load_file(ARGV[0]))', str(WORKFLOW)], text=True))
        cls.steps = cls.workflow['jobs']['sim']['steps']
        cls.step = next(step for step in cls.steps if step.get('id') == 'cachekey')

    def run_key(self, digest):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'out'; envfile = Path(temp) / 'env'
            env = {**os.environ, 'SOURCE_DIGEST': digest, 'GITHUB_OUTPUT': str(output), 'GITHUB_ENV': str(envfile)}
            result = subprocess.run(['bash', '-c', self.step['run']], env=env, capture_output=True, text=True)
            return result.returncode, output.read_text() if output.exists() else '', envfile.read_text() if envfile.exists() else ''

    def test_hash_is_step_level_after_checkout(self):
        self.assertNotIn('hashFiles', json.dumps(self.workflow['jobs']['sim'].get('env', {})))
        self.assertIn('hashFiles', self.step['env']['SOURCE_DIGEST'])
        checkout = next(i for i, step in enumerate(self.steps) if step.get('uses') == 'actions/checkout@v4')
        self.assertLess(checkout, self.steps.index(self.step))
        cache = next(step for step in self.steps if step.get('id') == 'appcache')
        self.assertEqual(cache['with']['key'], '${{ steps.cachekey.outputs.key }}')

    def test_one_valid_full_key_is_shared_by_cache_and_observer(self):
        rc, output, env = self.run_key('a' * 64)
        self.assertEqual(rc, 0)
        self.assertEqual(output, 'key=app-lock-sim-app-v3-' + 'a' * 64 + '\n')
        self.assertEqual(env, 'APP_CACHE_KEY=app-lock-sim-app-v3-' + 'a' * 64 + '\n')

    def test_only_manual_label_uses_owner_base_cache_and_pins_head(self):
        triggers = self.workflow.get('on', self.workflow.get('true'))
        self.assertEqual(set(triggers), {'pull_request'})
        self.assertEqual(triggers['pull_request']['branches'], ['test/purchase-proof-pr251'])
        self.assertEqual(triggers['pull_request']['types'], ['labeled'])
        checkout = next(step for step in self.steps if step.get('uses') == 'actions/checkout@v4')
        self.assertEqual(checkout['with']['ref'], '${{ github.event.pull_request.head.sha }}')
        job = self.workflow['jobs']['sim']
        self.assertIn('run-reviewed-boundary-diagnostic', job['if'])
        self.assertIn('head.repo.full_name == github.repository', job['if'])
        self.assertEqual(job['env']['PURCHASE_CASE'], 'diagnostic')

    def test_empty_and_invalid_digests_stop_without_outputs(self):
        for digest in ('', 'abc', 'g' * 64, 'a' * 64 + '\ninjected=1'):
            rc, output, env = self.run_key(digest)
            self.assertNotEqual(rc, 0)
            self.assertEqual((output, env), ('', ''))


if __name__ == '__main__':
    unittest.main()
