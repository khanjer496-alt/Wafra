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
            if response.status == 204:
                return {}
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Apple's response can include profileContent and device identifiers.
        raise RuntimeError(f'Apple {method} {route.split("?")[0]} returned HTTP {error.code}') from None


def api_list(route):
    items = []
    while route:
        response = api('GET', route)
        items.extend(response['data'])
        next_url = response.get('links', {}).get('next')
        if next_url:
            assert next_url.startswith('https://api.appstoreconnect.apple.com/v1/')
            route = next_url.removeprefix('https://api.appstoreconnect.apple.com/v1/')
        else:
            route = None
    return items


def cert_metadata(cert):
    attrs = cert['attributes']
    return {'id': cert['id'], 'type': attrs['certificateType'],
            'name': attrs.get('name') or attrs['displayName'],
            'serial': attrs['serialNumber'],
            'sha1': hashlib.sha1(base64.b64decode(attrs['certificateContent'])).hexdigest().upper()}


def inventory():
    certificates = api_list('certificates?limit=200')
    profiles = api_list('profiles?limit=200')
    result = {'certificates': [{'id': c['id'], 'type': c['attributes']['certificateType'],
                               'name': c['attributes'].get('name') or c['attributes'].get('displayName')}
                              for c in certificates],
              'profiles': [{'id': p['id'], 'type': p['attributes']['profileType'],
                            'name': p['attributes']['name']} for p in profiles]}
    print('Pre-creation signing inventory: ' + json.dumps(result, sort_keys=True), flush=True)
    return result


def prepare(root):
    os.umask(0o077)
    root.mkdir(parents=True, exist_ok=True)
    state = {'team': TEAM, 'profiles': {}, 'runId': os.environ['GITHUB_RUN_ID'],
             'runAttempt': os.environ['GITHUB_RUN_ATTEMPT'], 'before': inventory()}
    # Receipt is persisted immediately after each mutation, even on later failure.
    receipt = pathlib.Path('sealed/signing-receipt.json')
    receipt.parent.mkdir(exist_ok=True)
    write_json(receipt, state)
    devices = api('GET', f'profiles/{REFERENCE_PROFILE}/devices')['data']
    assert len(devices) == 2 and all(d['attributes']['status'] == 'ENABLED' for d in devices)
    device_ids = [{'type': 'devices', 'id': d['id']} for d in devices]
    run('openssl', 'req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(root/'key.pem'),
        '-out', str(root/'request.csr'), '-subj',
        '/CN=Wafra QA CI ' + state['runId'] + '-' + state['runAttempt'])
    try:
        cert = api('POST', 'certificates', {'data': {'type': 'certificates', 'attributes': {
            'certificateType': 'DEVELOPMENT', 'csrContent': (root/'request.csr').read_text()}}})['data']
    except RuntimeError:
        print('STOP: Apple refused development certificate creation. Check certificate capacity/permissions; '
              'no retry, deletion or revocation will be attempted.', flush=True)
        raise
    state['certificateId'] = cert['id']
    write_json(receipt, state)
    print('Created development certificate id: ' + cert['id'], flush=True)
    state['certificate'] = cert_metadata(cert)
    assert cert['id'] not in {c['id'] for c in state['before']['certificates']}
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
        state['profiles'][bundle] = {'id': profile['id'], 'uuid': attrs.get('uuid'), 'name': name}
        write_json(receipt, state)
        print('Created CI profile id: ' + profile['id'], flush=True)
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
    print('Created signing IDs: ' + json.dumps({'certificate': state['certificate'],
                                              'profiles': state['profiles']}, sort_keys=True), flush=True)


def linked_profiles(certificate_id):
    linked = []
    for profile in api_list('profiles?limit=200'):
        certs = api_list('profiles/' + profile['id'] + '/certificates?limit=200')
        if any(cert['id'] == certificate_id for cert in certs):
            linked.append(profile)
    return linked


def cleanup(receipt, certificate_id, profile_ids, qa_message, output):
    """Called only by a separately authorized dispatch after App QA completion."""
    import re
    assert re.fullmatch(r'[0-9a-fA-F-]{36}', qa_message)
    assert receipt['team'] == TEAM
    assert certificate_id == receipt['certificateId'] == receipt['certificate']['id']
    assert certificate_id not in {c['id'] for c in receipt['before']['certificates']}
    expected = {p['id']: p for p in receipt['profiles'].values()}
    assert set(profile_ids) == set(expected) and len(profile_ids) == len(expected)
    assert not set(profile_ids) & {p['id'] for p in receipt['before']['profiles']}
    marker = ' CI ' + receipt['runId'] + '-' + receipt['runAttempt']
    assert all(p['name'].endswith(marker) for p in expected.values())

    def verify_certificate():
        metadata = cert_metadata(api('GET', 'certificates/' + certificate_id)['data'])
        assert metadata == receipt['certificate'] and metadata['type'] == 'DEVELOPMENT'

    def verify_profile(profile):
        expected_profile = expected[profile['id']]
        attrs = profile['attributes']
        assert attrs['profileType'] == 'IOS_APP_DEVELOPMENT'
        assert attrs['name'] == expected_profile['name'] and attrs['name'].endswith(marker)
        assert attrs['uuid'] == expected_profile['uuid']
        linked = api_list('profiles/' + profile['id'] + '/certificates?limit=200')
        assert {c['id'] for c in linked} == {certificate_id}

    verify_certificate()
    linked = linked_profiles(certificate_id)
    assert {p['id'] for p in linked} == set(expected)
    for profile in linked:
        verify_profile(profile)
    events = {'sourceRunId': receipt['runId'], 'sourceRunAttempt': receipt['runAttempt'],
              'qaPassMessageId': qa_message, 'deletedProfileIds': [], 'revokedCertificateId': None}
    write_json(output, events)
    # Re-read each exact ID and name immediately before its destructive call.
    for profile_id in profile_ids:
        verify_profile(api('GET', 'profiles/' + profile_id)['data'])
        api('DELETE', 'profiles/' + profile_id)
        events['deletedProfileIds'].append(profile_id)
        write_json(output, events)
        print('Deleted CI profile id: ' + profile_id, flush=True)
    verify_certificate()
    assert not linked_profiles(certificate_id)
    api('DELETE', 'certificates/' + certificate_id)
    events['revokedCertificateId'] = certificate_id
    write_json(output, events)
    print('Revoked CI development certificate id: ' + certificate_id, flush=True)


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


def entitlement_permitted(value, allowed):
    if isinstance(value, str) and isinstance(allowed, str):
        return value == allowed or (allowed.endswith('*') and '*' not in allowed[:-1]
                                   and value.startswith(allowed[:-1]))
    if isinstance(value, list) and isinstance(allowed, list):
        return all(any(entitlement_permitted(item, grant) for grant in allowed) for item in value)
    if isinstance(value, dict) and isinstance(allowed, dict):
        return all(key in allowed and entitlement_permitted(item, allowed[key]) for key, item in value.items())
    return type(value) is type(allowed) and value == allowed


def assert_entitlements_allowed(entitlements, allowed):
    assert 'beta-reports-active' not in entitlements
    assert all(key in allowed and entitlement_permitted(value, allowed[key])
               for key, value in entitlements.items())


def development_entitlements(original, allowed):
    entitlements = {}
    for key, value in original.items():
        if key == 'beta-reports-active' or key not in allowed:
            continue
        if isinstance(value, list) and isinstance(allowed[key], list):
            entitlements[key] = [item for item in value if any(entitlement_permitted(item, grant) for grant in allowed[key])]
        elif entitlement_permitted(value, allowed[key]):
            entitlements[key] = value
    for key in ('application-identifier', 'com.apple.developer.team-identifier', 'get-task-allow', 'aps-environment'):
        if key in allowed:
            entitlements[key] = allowed[key]
    assert_entitlements_allowed(entitlements, allowed)
    return entitlements


def pin_build(source, report):
    config_path = source/'eas.json'
    original = config_path.read_bytes()
    config = json.loads(original)
    app = json.loads((source/'app.json').read_text())['expo']
    number = str(app['ios']['buildNumber'])
    assert number.isdigit() and int(number) >= 194
    # Local, explicitly recorded build-config override only. No app source or
    # app.json changes; no collision with the next real TestFlight number.
    candidate = config['build']['production-candidate']
    candidate['autoIncrement'] = False
    candidate.setdefault('ios', {})['autoIncrement'] = False
    write_json(config_path, config)
    value = {'expectedBuildNumber': number, 'expectedVersion': app['version'],
             'rebuildOfSource': True, 'testFlightBinaryReused': False,
             'buildConfigOverride': {'profile': 'production-candidate', 'autoIncrement': False,
                                     'ios.autoIncrement': False},
             'originalEasJsonSha256': hashlib.sha256(original).hexdigest(),
             'buildEasJsonSha256': hashlib.sha256(config_path.read_bytes()).hexdigest()}
    write_json(report, value)


def preflight_app(app, report):
    provenance = json.loads(report.read_text())
    plugins = list(app.glob('PlugIns/*.appex'))
    assert len(plugins) == 1
    # Reject an unexpected nested app/extension before any Apple mutation.
    assert not list(app.glob('Watch/*'))
    assert not list(app.glob('AppClips/*'))
    for path in [app, *plugins]:
        info = plistlib.loads((path/'Info.plist').read_bytes())
        assert info['CFBundleIdentifier'] == ('app.wafra.ios' if path == app else 'app.wafra.ios.widget')
        assert str(info['CFBundleVersion']) == provenance['expectedBuildNumber']
        assert info['CFBundleShortVersionString'] == provenance['expectedVersion']
    provenance['storeIpaVersionsAndPluginSetVerified'] = True
    write_json(report, provenance)


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
        entitlements = development_entitlements(original, profile['Entitlements'])
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
        assert_entitlements_allowed(ent, profile['Entitlements'])
        assert ent['get-task-allow'] is True and ent['application-identifier'] == TEAM + '.' + bundle
        if bundle in BUNDLES[1:]:
            assert 'group.app.wafra.ios' in ent['com.apple.security.application-groups']
        if bundle == 'app.wafra.ios':
            assert ent['aps-environment'] == 'development'
            provenance = json.loads((pathlib.Path(os.environ['RUNNER_TEMP'])/'ios-build-provenance.json').read_text())
            assert str(info['CFBundleVersion']) == provenance['expectedBuildNumber']
            assert info['CFBundleShortVersionString'] == provenance['expectedVersion']
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
        elif command == 'pin-build':
            pin_build(root, pathlib.Path(args[0]))
        elif command == 'preflight-app':
            preflight_app(root, pathlib.Path(args[0]))
        elif command == 'resign':
            resign(root, pathlib.Path(args[0]))
        elif command == 'verify':
            write_json(pathlib.Path(args[1]), verify(root, pathlib.Path(args[0])))
        elif command == 'cleanup':
            receipt = json.loads(root.read_text())
            assert receipt['runId'] == os.environ['SOURCE_RUN_ID']
            assert receipt['runAttempt'] == os.environ['SOURCE_RUN_ATTEMPT']
            cleanup(receipt, os.environ['CERTIFICATE_ID'], os.environ['PROFILE_IDS'].split(','),
                    os.environ['QA_PASS_MESSAGE_ID'], pathlib.Path('cleanup-report.json'))
        else:
            raise ValueError('Unknown command')
    except Exception as error:
        # Never print subprocess output or env; either can contain credentials.
        print('Device signing failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
