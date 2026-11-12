#!/usr/bin/env python3
"""Artifact-only simulator capture. Never signs, submits, streams, or edits a ledger DB."""
import argparse
import datetime as dt
import hashlib
import http.server
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import struct
import subprocess
import threading

ROOT = Path(__file__).resolve().parents[2]
SURFACES = ('01-home', '02-import', '03-bills', '04-subscription-detail',
            '05-accounts', '06-spending', '07-category-limit', '08-settings')
DEVICES = (('6.9', 'iPhone 17 Pro Max', (1320, 2868)),
           ('6.5', 'iPhone 14 Plus', (1284, 2778)))
FLAGS = ('EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK', 'EXPO_PUBLIC_WAFRA_AUTO_FOUNDER_PRO',
         'EXPO_PUBLIC_WAFRA_PARSER_RESEARCH', 'EXPO_PUBLIC_WAFRA_SMS_CORPUS_EXPORT',
         'WAFRA_SMS_CORPUS_EXPORT')


def run(*args, timeout=180, output=False):
    result = subprocess.run(list(map(str, args)), check=True, text=True,
                            stdout=subprocess.PIPE if output else None, timeout=timeout)
    return result.stdout.strip() if output else None


def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def png_size(file):
    head = Path(file).read_bytes()[:24]
    if len(head) != 24 or head[:8] != b'\x89PNG\r\n\x1a\n' or head[12:16] != b'IHDR':
        raise ValueError('Invalid PNG header')
    return struct.unpack('>II', head[16:24])


def write_json(file, data):
    Path(file).write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')


def validate(images, source_sha, out):
    expected = {(size, lang, surface) for size, _, _ in DEVICES
                for lang in ('en', 'ar') for surface in SURFACES}
    actual = {(i['sizeGroup'], i['language'], i['surface']) for i in images}
    if len(images) != 32 or actual != expected:
        raise ValueError('Incomplete or duplicate 32-image matrix')
    hashes = set()
    old = {sha(p) for p in (ROOT / 'docs/store-assets').rglob('*.png')}
    for i in images:
        expected_pixels = dict((d[0], d[2]) for d in DEVICES)[i['sizeGroup']]
        original = out / i['file']
        image = original.resolve()
        if not image.is_relative_to(out.resolve()) or original.is_symlink():
            raise ValueError('Capture path escapes its artifact')
        if tuple(i['pixels']) != expected_pixels or png_size(image) != expected_pixels or i['sourceSha'] != source_sha:
            raise ValueError('Wrong dimensions or source provenance')
        if sha(image) != i['sha256']:
            raise ValueError('Image changed after provenance was written')
        if i['sha256'] in hashes or i['sha256'] in old:
            raise ValueError('Duplicate capture or reused old asset')
        hashes.add(i['sha256'])


def prepare(out):
    """Resolve checked-in candidate env. No EAS login or remote secrets required."""
    source = run('git', 'rev-parse', 'HEAD', output=True)
    if not re.fullmatch(r'[a-f0-9]{40}', os.environ.get('EXPECTED_SHA', '')) or source != os.environ['EXPECTED_SHA']:
        raise ValueError('Dispatch and approved immutable source SHA must match')
    if os.environ.get('GITHUB_SHA') != source or os.environ.get('GITHUB_EVENT_NAME') != 'workflow_dispatch':
        raise ValueError('Only an exact-SHA manual dispatch is allowed')
    profiles = json.loads((ROOT / 'eas.json').read_text())['build']
    def resolve(name, seen=()):
        if name in seen:
            raise ValueError('Build profile inheritance cycle')
        p = profiles[name]
        return {**(resolve(p['extends'], (*seen, name)) if p.get('extends') else {}), **p.get('env', {})}
    env = resolve('production-candidate')
    if any(env.get(k) != '0' for k in FLAGS):
        raise ValueError('Candidate must disable founder, research and corpus flags')
    if any('E2E' in k or 'FIXTURE' in k or 'DEMO' in k for k in env):
        raise ValueError('A product fixture flag is not part of this capture path')
    with open(os.environ['GITHUB_ENV'], 'a') as f:
        # app.config.js must select Release metadata during prebuild too.
        # Keep NODE_ENV unset here so npm ci still installs dev dependencies.
        f.write('EAS_BUILD_PROFILE=production-candidate\n')
        for key, value in env.items():
            if not re.fullmatch(r'(?:EXPO_PUBLIC_[A-Z0-9_]+|WAFRA_[A-Z0-9_]+)', key) or not isinstance(value, str) or '\n' in value or '\r' in value:
                raise ValueError('Invalid checked-in public profile environment')
            f.write(f'{key}={value}\n')
    write_json(out / 'build-provenance.json', {
        'sourceSha': source, 'runId': os.environ['GITHUB_RUN_ID'], 'runAttempt': os.environ['GITHUB_RUN_ATTEMPT'],
        'runnerImage': os.environ.get('ImageOS'), 'runnerImageVersion': os.environ.get('ImageVersion'),
        'configuration': 'Release', 'profile': 'production-candidate',
        'flags': {k: env[k] for k in FLAGS}, 'fixturePath': 'welcome > system DocumentPicker > normal Restore',
        'fixtureSeam': False, 'syntheticData': True, 'visibleSampleLabel': False,
        'fixtureReferenceDateUTC': dt.datetime.now(dt.timezone.utc).date().isoformat(),
        'captureOnlyDifferences': ['unsigned iphonesimulator binary', 'Expo OTA checks disabled in generated Expo.plist to retain embedded JS'],
        'storePurchaseEvidence': False, 'complete': False, 'images': [],
    })


def configure_native(out):
    # Prevent a subsequent launch from replacing frozen JS with an OTA update.
    # This modifies generated capture configuration only, never app.json/source.
    files = list((ROOT / 'ios').glob('*/Supporting/Expo.plist'))
    if len(files) != 1:
        raise ValueError('Expected one generated Expo.plist')
    data = plistlib.loads(files[0].read_bytes())
    data['EXUpdatesEnabled'] = False
    files[0].write_bytes(plistlib.dumps(data))
    write_json(out / 'capture-config.json', {'expoUpdatesEnabled': False, 'path': str(files[0].relative_to(ROOT))})


def inspect_app(app, out):
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    if info.get('CFBundleIdentifier') != 'app.wafra.ios' or info.get('DTPlatformName') != 'iphonesimulator':
        raise ValueError('Not the expected native simulator app')
    if not (app / 'main.jsbundle').is_file():
        raise ValueError('Release bundled JavaScript is missing; Metro is not an allowed source')
    exp = plistlib.loads((app / 'Expo.plist').read_bytes())
    if exp.get('EXUpdatesEnabled') is not False:
        raise ValueError('Capture could load a different OTA source')
    run('/usr/bin/python3', ROOT / 'scripts/check-ios-product-versions.py', app)
    manifest = json.loads((out / 'build-provenance.json').read_text())
    tree = hashlib.sha256()
    for file in sorted(p for p in app.rglob('*') if p.is_file()):
        tree.update(str(file.relative_to(app)).encode() + b'\0' + bytes.fromhex(sha(file)))
    manifest.update(appBundleSha256=tree.hexdigest(), executableSha256=sha(app / info['CFBundleExecutable']),
                    embeddedJsSha256=sha(app / 'main.jsbundle'), version=info['CFBundleShortVersionString'],
                    build=info['CFBundleVersion'], xcode=run('xcodebuild', '-version', output=True),
                    sdk=run('xcrun', '--sdk', 'iphonesimulator', '--show-sdk-version', output=True),
                    maestro=run('maestro', '--version', output=True))
    write_json(out / 'build-provenance.json', manifest)
    return manifest


class BackupHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path not in ('/wafra-capture-en.json', '/wafra-capture-ar.json'):
            self.send_error(404)
            return
        data = (self.server.fixture_dir / self.path[1:]).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Disposition', f'attachment; filename="{self.path[1:]}"')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_args):
        pass


def capture(app, out):
    manifest = inspect_app(app, out)
    runtimes = json.loads(run('xcrun', 'simctl', 'list', 'runtimes', '-j', output=True))['runtimes']
    usable = [r for r in runtimes if r.get('isAvailable') and r['identifier'].startswith('com.apple.CoreSimulator.SimRuntime.iOS-')
              and int(r['version'].split('.')[0]) >= 26]
    if not usable:
        raise ValueError('No available iOS26+ simulator runtime')
    runtime = max(usable, key=lambda r: tuple(map(int, r['version'].split('.'))))
    device_types = {d['name']: d['identifier'] for d in json.loads(run('xcrun', 'simctl', 'list', 'devicetypes', '-j', output=True))['devicetypes']}
    if any(name not in device_types for _, name, _ in DEVICES):
        raise ValueError('A required exact device type is missing; no fallback allowed')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), BackupHandler)
    server.fixture_dir = out / 'fixtures'
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        for size, device, _pixels in DEVICES:
            for lang in ('en', 'ar'):
                dest = out / f'{size}-{lang}'
                dest.mkdir()
                udid = run('xcrun', 'simctl', 'create', f'wafra-store-{size}-{lang}-{manifest["runId"]}',
                           device_types[device], runtime['identifier'], output=True)
                try:
                    run('xcrun', 'simctl', 'boot', udid)
                    run('xcrun', 'simctl', 'bootstatus', udid, '-b', timeout=300)
                    run('xcrun', 'simctl', 'ui', udid, 'appearance', 'dark')
                    run('xcrun', 'simctl', 'status_bar', udid, 'override', '--time', '9:41', '--batteryState', 'charged',
                        '--batteryLevel', '100', '--cellularBars', '4', '--wifiBars', '3')
                    run('xcrun', 'simctl', 'install', udid, app)
                    def flow(name, **env):
                        command = ['maestro', '--device', udid, 'test', '--test-output-dir', str(dest / name)]
                        for key, value in env.items():
                            command += ['-e', f'{key}={value}']
                        run(*command, ROOT / '.maestro' / f'{name}.yaml', timeout=600)
                    flow('store-download', FIXTURE_URL=f'http://127.0.0.1:{server.server_port}/wafra-capture-{lang}.json')
                    run('xcrun', 'simctl', 'launch', udid, 'app.wafra.ios', '-AppleLanguages', '(en)', '-AppleLocale', 'en_US')
                    flow('store-restore', FIXTURE_NAME=f'(?i)wafra-capture-{lang}(\\.json)?')
                    run('xcrun', 'simctl', 'terminate', udid, 'app.wafra.ios')
                    run('xcrun', 'simctl', 'launch', udid, 'app.wafra.ios', '-AppleLanguages', f'({lang})',
                        '-AppleLocale', 'ar_SA' if lang == 'ar' else 'en_AE')
                    flow('store-surfaces', PERSON_NAME='.*لين.*' if lang == 'ar' else '.*Leen.*',
                         CLOSE_LABEL='إغلاق' if lang == 'ar' else 'Close')
                    for surface in SURFACES:
                        matches = list((dest / 'store-surfaces').rglob(f'{surface}.png'))
                        if len(matches) != 1:
                            raise ValueError(f'Expected one native capture for {size}/{lang}/{surface}')
                        image = matches[0]
                        target = out / 'images' / f'{size}-{lang}-{surface}.png'
                        target.parent.mkdir(exist_ok=True)
                        shutil.copyfile(image, target)
                        manifest['images'].append({'file': str(target.relative_to(out)), 'sourceSha': manifest['sourceSha'],
                            'sizeGroup': size, 'device': device, 'deviceType': device_types[device], 'udid': udid,
                            'runtime': runtime['identifier'], 'runtimeVersion': runtime['version'], 'language': lang,
                            'locale': 'ar_SA' if lang == 'ar' else 'en_AE', 'appearance': 'dark', 'surface': surface,
                            'capturedAt': dt.datetime.fromtimestamp(image.stat().st_mtime, dt.timezone.utc).isoformat(), 'pixels': png_size(target),
                            'sha256': sha(target), 'fixtureSha256': sha(out / 'fixtures' / f'wafra-capture-{lang}.json')})
                        write_json(out / 'provenance.json', manifest)
                finally:
                    subprocess.run(['xcrun', 'simctl', 'shutdown', udid], check=False)
                    subprocess.run(['xcrun', 'simctl', 'delete', udid], check=False)
        validate(manifest['images'], manifest['sourceSha'], out)
        manifest['complete'] = True
        manifest['visualReview'] = 'PENDING: App QA + native Arabic reader; not automatically uploadable'
    finally:
        server.shutdown()
        server.server_close()
        write_json(out / 'provenance.json', manifest)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('prepare', 'configure-native', 'capture'))
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--app', type=Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    if args.command == 'prepare':
        prepare(args.out)
    elif args.command == 'configure-native':
        configure_native(args.out)
    else:
        if not args.app:
            parser.error('--app required for capture')
        capture(args.app, args.out)
