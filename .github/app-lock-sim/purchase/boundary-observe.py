#!/usr/bin/env python3
"""Read-only, allowlisted boundary observations. No simulator state is copied."""
import argparse
import hashlib
import json
import os
import plistlib
import re
import signal
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

BUNDLES = ('dev.wafra.purchaseuitests.xctrunner', 'app.wafra.ios')
BUDGET_SECONDS = 16
OUTPUT_SECONDS = 2
COMMAND_SECONDS = 4
STAGES = {'before-install', 'after-install', 'session-created', 'final'} | {
    'boundary-' + tag for tag in ('DIAG-launch', 'DIAG-paywall', 'P3b-launch', 'P3b', 'P3b-injected', 'P3c-launch', 'P3c')
} | {'reinstall-' + str(n) + '-after-install' for n in (1, 2, 3, 4)}
ERROR_KINDS = {'FileNotFoundError', 'PermissionError', 'ValueError', 'KeyError',
               'InvalidFileException', 'TimeoutError', 'TimeoutExpired', 'OSError'}


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def version(value):
    text = str(value)
    return text if re.fullmatch(r'[0-9]+(?:\.[0-9]+){0,4}', text) else 'unknown'


def identity(path):
    info = plistlib.loads((path / 'Info.plist').read_bytes())
    executable = info['CFBundleExecutable']
    if not isinstance(executable, str) or Path(executable).name != executable:
        raise ValueError('invalid executable name')
    return {'bundle_id': info['CFBundleIdentifier'] if info['CFBundleIdentifier'] in BUNDLES else 'unexpected',
            'build_version': version(info.get('CFBundleVersion', '')),
            'short_version': version(info.get('CFBundleShortVersionString', '')),
            'executable_sha256': sha(path / executable), 'js_sha256': sha(path / 'main.jsbundle')}


def run(args, timeout=COMMAND_SECONDS):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def observe(udid, source, fixture, stage, require_config):
    deadline = time.monotonic() + BUDGET_SECONDS
    cache_key = os.environ.get('APP_CACHE_KEY', '')
    harness_sha = os.environ.get('HARNESS_GIT_SHA', '')
    record = {'utc': datetime.now(timezone.utc).isoformat(),
              'stage': stage if stage in STAGES else 'invalid-stage',
              'binding': 'UNPROVEN', 'commands': [], 'errors': [],
              'provenance': {'artifact_kind': 'cached_release_simulator_app', 'git_source_proven': False,
                             'cache_key': cache_key if re.fullmatch(r'app-lock-sim-app-v3-[0-9a-fA-F]+', cache_key) else 'unknown',
                             'harness_git_sha': harness_sha if re.fullmatch(r'[0-9a-fA-F]{40}', harness_sha) else 'unknown'},
              'identity_matches': False, 'daemon_running': False, 'configs': {}}

    def probe(name, action):
        if time.monotonic() >= deadline:
            record['errors'].append({'probe': name, 'kind': 'BudgetExhausted'})
            return None
        try:
            return action()
        except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
            kind = type(error).__name__
            record['errors'].append({'probe': name, 'kind': kind if kind in ERROR_KINDS else 'ProbeError'})
            return None

    def command(name, args):
        timeout = min(COMMAND_SECONDS, max(0.05, deadline - time.monotonic()))
        result = run(args, timeout=timeout)
        record['commands'].append({'name': name, 'exit': result[0]})
        return result

    # Each category is independent. One absent app/JS/config never suppresses the
    # other config or daemon probes. No raw stderr/error text is exported.
    cached = probe('cached-app-identity', lambda: identity(source))
    if cached is not None:
        record['cached_app'] = cached
    container = probe('installed-container', lambda: command('get_app_container',
                      ['xcrun', 'simctl', 'get_app_container', udid, BUNDLES[1], 'app']))
    if container is not None and container[0] == 0 and container[1]:
        installed_path = Path(container[1])
        installed = probe('installed-app-identity', lambda: identity(installed_path))
        if installed is not None:
            record['installed'] = installed
            record['identity_matches'] = cached == installed and installed['bundle_id'] == BUNDLES[1]
        signing = probe('installed-signature', lambda: command('codesign', ['codesign', '-dvvv', str(installed_path)]))
        if signing is not None:
            matches = re.findall(r'^CDHash=([0-9a-fA-F]{40,64})$', signing[2], re.M)
            record['installed_cdhash'] = matches[0].lower() if len(matches) == 1 else 'unknown'
    elif container is not None:
        record['errors'].append({'probe': 'installed-container', 'kind': 'Unavailable'})

    fixture_sha = probe('synthetic-fixture', lambda: sha(fixture))
    root = Path.home() / 'Library/Developer/CoreSimulator/Devices' / udid / 'data/Containers/Shared/AppGroup'
    for bundle in BUNDLES:
        def config_probe(bundle=bundle):
            files = sorted(root.glob('*/Documents/Persistence/Octane/' + bundle + '/Configuration.storekit'))
            hashes = [sha(path) for path in files]
            return {'count': len(files), 'sha256': hashes,
                    'matches_fixture': fixture_sha is not None and len(files) == 1 and hashes == [fixture_sha]}
        record['configs'][bundle] = probe('config-' + bundle, config_probe)

    daemon = probe('daemon-status', lambda: command('storekitd_status',
                   ['xcrun', 'simctl', 'spawn', udid, 'launchctl', 'list']))
    if daemon is not None:
        rows = [line.split() for line in daemon[1].splitlines() if line.endswith('com.apple.storekitd')]
        if len(rows) == 1 and len(rows[0]) == 3 and rows[0][0].isdigit():
            record['daemon_pid'] = int(rows[0][0])
            record['daemon_running'] = daemon[0] == 0

    record['checks_ok'] = bool(not record['errors'] and record['identity_matches'] and
                               all(c['exit'] == 0 for c in record['commands']) and
                               (not require_config or (record['daemon_running'] and
                                all(v is not None and v['matches_fixture'] for v in record['configs'].values()))))
    record['elapsed_ms'] = round((time.monotonic() - deadline + BUDGET_SECONDS) * 1000)
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('udid'); parser.add_argument('source', type=Path); parser.add_argument('fixture', type=Path)
    parser.add_argument('stage'); parser.add_argument('output', type=Path)
    parser.add_argument('--require-config', action='store_true')
    args = parser.parse_args()
    # The enclosing process owns a 16-second probe + 2-second output budget, including blocked
    # hashing/filesystem calls. A timeout is terminal .failed, never late .done.
    def timeout(signum, frame):
        raise TimeoutError('observer deadline')
    signal.signal(signal.SIGALRM, timeout)
    signal.setitimer(signal.ITIMER_REAL, BUDGET_SECONDS)
    try:
        record = observe(args.udid, args.source, args.fixture, args.stage, args.require_config)
    except TimeoutError:
        record = {'stage': 'observer-deadline', 'checks_ok': False, 'binding': 'UNPROVEN',
                  'errors': [{'probe': 'observer', 'kind': 'BudgetExhausted'}]}
    signal.setitimer(signal.ITIMER_REAL, OUTPUT_SECONDS)
    try:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('a') as target:
            target.write(json.dumps(record, sort_keys=True) + '\n')
        print(json.dumps({'stage': record['stage'], 'checks_ok': record['checks_ok'], 'binding': 'UNPROVEN'}))
        return 0 if record['checks_ok'] else 1
    except (OSError, TimeoutError):
        print('{"stage":"observation-output-failed","checks_ok":false,"binding":"UNPROVEN"}')
        return 1
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)


if __name__ == '__main__':
    raise SystemExit(main())
