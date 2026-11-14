#!/usr/bin/env python3
"""Read-only synthetic StoreKit boundary evidence; never copies or edits simulator state."""
import argparse
import hashlib
import json
import plistlib
import subprocess
from datetime import datetime, timezone
from pathlib import Path

BUNDLES = ('dev.wafra.purchaseuitests.xctrunner', 'app.wafra.ios')


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def identity(path):
    info = plistlib.loads((path / 'Info.plist').read_bytes())
    executable = path / info['CFBundleExecutable']
    return {'bundle_id': info['CFBundleIdentifier'], 'executable_sha256': sha(executable),
            'js_sha256': sha(path / 'main.jsbundle')}


def configurations(root, fixture_sha):
    answer = {}
    for bundle in BUNDLES:
        files = sorted(root.glob('*/Documents/Persistence/Octane/' + bundle + '/Configuration.storekit'))
        hashes = [sha(path) for path in files]
        answer[bundle] = {'count': len(files), 'sha256': hashes,
                          'matches_fixture': len(files) == 1 and hashes == [fixture_sha]}
    return answer


def run(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=15)
    return result.returncode, result.stdout.strip(), result.stderr.strip()[:4000]


def observe(udid, source, fixture, stage, require_config):
    record = {'utc': datetime.now(timezone.utc).isoformat(), 'stage': stage,
              'binding': 'UNPROVEN: matching files do not establish shared transaction control',
              'commands': [], 'errors': []}
    try:
        record['source'] = identity(source)
        rc, out, err = run(['xcrun', 'simctl', 'get_app_container', udid, BUNDLES[1], 'app'])
        record['commands'].append({'name': 'get_app_container', 'exit': rc, 'stderr': err})
        if rc or not out:
            raise ValueError('installed app container unavailable')
        installed = Path(out)
        record['installed'] = identity(installed)
        record['identity_matches'] = record['source'] == record['installed'] and record['installed']['bundle_id'] == BUNDLES[1]
        rc, out, err = run(['codesign', '-dvvv', str(installed)])
        record['commands'].append({'name': 'codesign', 'exit': rc, 'stderr': '\n'.join(
            line for line in err.splitlines() if line.startswith(('Identifier=', 'CDHash=', 'TeamIdentifier=')))})
        root = Path.home() / 'Library/Developer/CoreSimulator/Devices' / udid / 'data/Containers/Shared/AppGroup'
        record['configs'] = configurations(root, sha(fixture))
        rc, out, err = run(['xcrun', 'simctl', 'spawn', udid, 'launchctl', 'list'])
        record['commands'].append({'name': 'storekitd_status', 'exit': rc, 'stderr': err,
                                   'service': [line for line in out.splitlines() if line.endswith('com.apple.storekitd')]})
        service = record['commands'][-1]['service']
        record['daemon_running'] = len(service) == 1 and service[0].split()[0].isdigit()
        record['checks_ok'] = bool(record['identity_matches'] and all(c['exit'] == 0 for c in record['commands']) and
                                   (not require_config or (record['daemon_running'] and all(v['matches_fixture'] for v in record['configs'].values()))))
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        record['errors'].append(str(error))
        record['checks_ok'] = False
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('udid'); parser.add_argument('source', type=Path); parser.add_argument('fixture', type=Path)
    parser.add_argument('stage'); parser.add_argument('output', type=Path)
    parser.add_argument('--require-config', action='store_true')
    args = parser.parse_args()
    record = observe(args.udid, args.source, args.fixture, args.stage, args.require_config)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('a') as target:
        target.write(json.dumps(record, sort_keys=True) + '\n')
    print(json.dumps({'stage': args.stage, 'checks_ok': record['checks_ok'], 'binding': record['binding']}))
    return 0 if record['checks_ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
