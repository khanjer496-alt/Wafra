#!/usr/bin/env python3
"""Runner-only development signing. Never prints API responses, keys or devices."""
import base64
import datetime
import hashlib
import json
import os
import pathlib
import plistlib
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

TEAM = 'UV7YN4GQ66'
REFERENCE_PROFILE = '7996Y2NL26'  # Wafra QA UI Tests 2026-11, a57e79a7…
BUNDLES = ('app.wafra.qa.wda.xctrunner', 'app.wafra.ios', 'app.wafra.ios.widget')


def run(*args):
    return subprocess.check_output(args, stderr=subprocess.PIPE)


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def api(method, route, body=None):
    import jwt
    key = os.environ['ASC_KEY_P8'].encode()
    if b'BEGIN PRIVATE KEY' not in key:
        key = base64.b64decode(key, validate=True)
    token = jwt.encode({'iss': os.environ['ASC_ISSUER_ID'], 'iat': int(time.time()),
                        'exp': int(time.time()) + 180, 'aud': 'appstoreconnect-v1'}, key,
                       algorithm='ES256', headers={'kid': os.environ['ASC_KEY_ID']})
    req = urllib.request.Request('https://api.appstoreconnect.apple.com/v1/' + route,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={'Authorization': 'Bearer ' + token,
                                          'Content-Type': 'application/json'}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Apple's response can include profileContent and device identifiers.
        raise RuntimeError(f'Apple {method} {route.split("?")[0]} returned HTTP {error.code}') from None


def prepare(root):
    os.umask(0o077)
    root.mkdir(parents=True, exist_ok=True)
    state = {'team': TEAM, 'profiles': {}}
    # Receipt is persisted immediately after each mutation, even on later failure.
    receipt = pathlib.Path('sealed/signing-receipt.json')
    receipt.parent.mkdir(exist_ok=True)
    write_json(receipt, state)
    devices = api('GET', f'profiles/{REFERENCE_PROFILE}/devices')['data']
    assert len(devices) == 2 and all(d['attributes']['status'] == 'ENABLED' for d in devices)
    device_ids = [{'type': 'devices', 'id': d['id']} for d in devices]
    run('openssl', 'req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(root/'key.pem'),
        '-out', str(root/'request.csr'), '-subj', '/CN=Wafra Hosted Device QA')
    cert = api('POST', 'certificates', {'data': {'type': 'certificates', 'attributes': {
        'certificateType': 'DEVELOPMENT', 'csrContent': (root/'request.csr').read_text()}}})['data']
    state['certificateId'] = cert['id']
    write_json(receipt, state)
    der = base64.b64decode(cert['attributes']['certificateContent'])
    (root/'cert.der').write_bytes(der)
    state['identitySha1'] = hashlib.sha1(der).hexdigest().upper()
    run('openssl', 'x509', '-inform', 'DER', '-in', str(root/'cert.der'), '-out', str(root/'cert.pem'))
    password = base64.b64encode(os.urandom(32)).decode()
    # Password never enters GITHUB_ENV, stdout, an artifact or a build log.
    env = dict(os.environ, WAFRA_P12_PASSWORD=password)
    subprocess.run(['openssl', 'pkcs12', '-export', '-inkey', str(root/'key.pem'), '-in', str(root/'cert.pem'),
                    '-out', str(root/'identity.p12'), '-passout', 'env:WAFRA_P12_PASSWORD'],
                   env=env, check=True, capture_output=True)
    keychain = str(root/'qa.keychain-db')
    run('security', 'create-keychain', '-p', password, keychain)
    run('security', 'set-keychain-settings', '-lut', '21600', keychain)
    run('security', 'unlock-keychain', '-p', password, keychain)
    run('security', 'import', str(root/'identity.p12'), '-k', keychain, '-P', password,
        '-T', '/usr/bin/codesign', '-T', '/usr/bin/security')
    run('security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain)
    run('security', 'list-keychains', '-d', 'user', '-s', keychain,
        str(pathlib.Path.home()/'Library/Keychains/login.keychain-db'))
    for bundle in BUNDLES:
        query = urllib.parse.urlencode({'filter[identifier]': bundle})
        matches = api('GET', 'bundleIds?' + query)['data']
        assert len(matches) == 1
        name = ('Wafra QA UI Tests 2026-11' if bundle == BUNDLES[0] else 'Wafra QA ' + bundle)
        name += ' CI ' + os.environ['GITHUB_RUN_ID'] + '-' + os.environ['GITHUB_RUN_ATTEMPT']
        profile = api('POST', 'profiles', {'data': {'type': 'profiles', 'attributes': {
            'name': name, 'profileType': 'IOS_APP_DEVELOPMENT'}, 'relationships': {
                'bundleId': {'data': {'type': 'bundleIds', 'id': matches[0]['id']}},
                'certificates': {'data': [{'type': 'certificates', 'id': cert['id']}]},
                'devices': {'data': device_ids}}}})['data']
        attrs = profile['attributes']
        state['profiles'][bundle] = {'id': profile['id'], 'uuid': attrs['uuid'], 'name': name}
        write_json(receipt, state)
        content = base64.b64decode(attrs['profileContent'])
        profile_path = root/(bundle + '.mobileprovision')
        profile_path.write_bytes(content)
        decoded = plistlib.loads(run('security', 'cms', '-D', '-i', str(profile_path)))
        assert_profile(decoded, bundle, state, {d['attributes']['udid'] for d in devices})
        for directory in ('Library/MobileDevice/Provisioning Profiles', 'Library/Developer/Xcode/UserData/Provisioning Profiles'):
            dest = pathlib.Path.home()/directory
            dest.mkdir(parents=True, exist_ok=True)
            (dest/(attrs['uuid'] + '.mobileprovision')).write_bytes(content)
    write_json(root/'state.json', state)
    write_json(receipt, state)


def assert_profile(profile, bundle, state, devices=None):
    assert profile['TeamIdentifier'] == [TEAM]
    assert profile['Entitlements']['application-identifier'] == TEAM + '.' + bundle
    assert profile['Entitlements']['get-task-allow'] is True
    assert profile['ExpirationDate'] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    assert hashlib.sha1(profile['DeveloperCertificates'][0]).hexdigest().upper() == state['identitySha1']
    if devices is not None:
        assert set(profile['ProvisionedDevices']) == devices
    else:
        assert len(profile['ProvisionedDevices']) == 2
    if bundle != BUNDLES[0]:
        assert 'group.app.wafra.ios' in profile['Entitlements']['com.apple.security.application-groups']
    if bundle == 'app.wafra.ios':
        assert profile['Entitlements']['aps-environment'] == 'development'


def resign(root, app):
    state = json.loads((root/'state.json').read_text())
    identity = state['identitySha1']
    # Sign nested frameworks/dylibs first, widget second, root app last.
    for item in sorted(app.rglob('*'), key=lambda p: len(p.parts), reverse=True):
        if item.suffix in ('.framework', '.dylib') and not item.is_symlink():
            run('codesign', '--force', '--sign', identity, str(item))
    for bundle_path in [*app.glob('PlugIns/*.appex'), app]:
        info = plistlib.loads((bundle_path/'Info.plist').read_bytes())
        bundle = info['CFBundleIdentifier']
        assert bundle in BUNDLES[1:]
        profile_file = root/(bundle + '.mobileprovision')
        profile = plistlib.loads(run('security', 'cms', '-D', '-i', str(profile_file)))
        original = plistlib.loads(run('codesign', '-d', '--entitlements', ':-', str(bundle_path)))
        entitlements = dict(original)
        for key in ('application-identifier', 'com.apple.developer.team-identifier', 'get-task-allow', 'aps-environment'):
            if key in profile['Entitlements']:
                entitlements[key] = profile['Entitlements'][key]
        ent_path = root/(bundle + '.entitlements.plist')
        ent_path.write_bytes(plistlib.dumps(entitlements))
        shutil.copyfile(profile_file, bundle_path/'embedded.mobileprovision')
        run('codesign', '--force', '--sign', identity, '--entitlements', str(ent_path), str(bundle_path))
    run('codesign', '--verify', '--deep', '--strict', str(app))


def verify(root, app):
    state = json.loads((root/'state.json').read_text())
    result = []
    for path in [*app.glob('PlugIns/*.appex'), app]:
        run('codesign', '--verify', '--deep', '--strict', str(path))
        info = plistlib.loads((path/'Info.plist').read_bytes())
        bundle = info['CFBundleIdentifier']
        profile = plistlib.loads(run('security', 'cms', '-D', '-i', str(path/'embedded.mobileprovision')))
        assert_profile(profile, bundle, state)
        ent = plistlib.loads(run('codesign', '-d', '--entitlements', ':-', str(path)))
        assert ent['get-task-allow'] is True and ent['application-identifier'] == TEAM + '.' + bundle
        if bundle in BUNDLES[1:]:
            assert 'group.app.wafra.ios' in ent['com.apple.security.application-groups']
        if bundle == 'app.wafra.ios':
            assert ent['aps-environment'] == 'development'
            assert int(info['CFBundleVersion']) >= 194
        cert_prefix = root/'verified-cert'
        run('codesign', '-d', '--extract-certificates', str(cert_prefix), str(path))
        assert hashlib.sha1(pathlib.Path(str(cert_prefix)+'0').read_bytes()).hexdigest().upper() == state['identitySha1']
        assert profile['UUID'] == state['profiles'][bundle]['uuid']
        result.append({'bundleId': bundle, 'profileUuid': profile['UUID'], 'signingIdentitySha1': state['identitySha1'],
                       'twoReferenceDevicesCovered': True, 'buildNumber': str(info.get('CFBundleVersion', ''))})
    return result


if __name__ == '__main__':
    try:
        command, directory, *args = sys.argv[1:]
        root = pathlib.Path(directory)
        if command == 'prepare':
            prepare(root)
        elif command == 'resign':
            resign(root, pathlib.Path(args[0]))
        elif command == 'verify':
            write_json(pathlib.Path(args[1]), verify(root, pathlib.Path(args[0])))
        else:
            raise ValueError('Unknown command')
    except Exception as error:
        # Never print subprocess output or env; either can contain credentials.
        print('Device signing failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
