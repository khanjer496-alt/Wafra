#!/usr/bin/env python3
"""Offline signing with an existing file key; never export or change login keys."""
import argparse
import contextlib
import hashlib
import importlib.util
import json
import os
import pathlib
import plistlib
import re
import secrets
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile

if not __debug__:
    raise RuntimeError('Optimized Python is refused')

CERTIFICATE_ID = '2DY4K5NUMM'
IDENTITY = '8E7181E5C2CB4F0C6967BA5B9CCEB437E8158161'
spec = importlib.util.spec_from_file_location('signing', pathlib.Path(__file__).with_name('ios-device-signing.py'))
signing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signing)


def run(*args, data=None):
    return subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          check=True).stdout


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def extract_regular_archive(archive, destination):
    """Hosted tar -h removes links. Refuse links/devices/traversal before extraction."""
    destination.mkdir()
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        seen = set()
        for member in members:
            name = pathlib.PurePosixPath(member.name)
            assert not name.is_absolute() and '..' not in name.parts
            assert member.isfile() or member.isdir()
            assert str(name) not in seen
            seen.add(str(name))
        for member in members:
            target = destination/member.name
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
                target.chmod(member.mode & 0o777)


def verify_tree(root, expected):
    assert root.is_dir() and expected
    files = {str(p.relative_to(root)): p for p in root.rglob('*') if p.is_file()}
    assert not any(p.is_symlink() for p in root.rglob('*'))
    assert set(files) == set(expected)
    assert all(sha256(path) == expected[name] for name, path in files.items())


def verify_file_key(key, certificate):
    assert key.is_file() and not key.is_symlink()
    assert key.stat().st_mode & 0o077 == 0
    assert key.parent.stat().st_mode & 0o077 == 0
    der = run('openssl', 'x509', '-inform', 'DER', '-in', str(certificate), '-outform', 'DER')
    assert hashlib.sha1(der).hexdigest().upper() == IDENTITY
    cert_public = run('openssl', 'x509', '-inform', 'DER', '-in', str(certificate), '-pubkey', '-noout')
    cert_public = run('openssl', 'pkey', '-pubin', '-outform', 'DER', data=cert_public)
    key_public = run('openssl', 'pkey', '-in', str(key), '-passin', 'pass:', '-pubout', '-outform', 'DER')
    assert cert_public == key_public


@contextlib.contextmanager
def temporary_keychain(key, certificate):
    # Only import from the original file. No p12, private-key copy or login access.
    with tempfile.TemporaryDirectory(prefix='wafra-qa-keychain-') as temporary:
        keychain = pathlib.Path(temporary)/'qa.keychain-db'
        password = secrets.token_urlsafe(32)
        try:
            run('security', 'create-keychain', '-p', password, str(keychain))
            run('security', 'set-keychain-settings', '-lut', '7200', str(keychain))
            run('security', 'unlock-keychain', '-p', password, str(keychain))
            run('security', 'import', str(key), '-k', str(keychain), '-t', 'priv',
                '-x', '-T', '/usr/bin/codesign')
            run('security', 'import', str(certificate), '-k', str(keychain), '-t', 'cert')
            run('security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:',
                '-s', '-k', password, str(keychain))
            identities = run('security', 'find-identity', '-v', '-p', 'codesigning', str(keychain))
            assert IDENTITY.encode() in identities
            yield str(keychain)
        finally:
            # Exact fresh keychain only, including on import/codesign/interruption failure.
            run('security', 'delete-keychain', str(keychain))
            assert not keychain.exists()


def validate_profiles(work, profiles, receipt, reference):
    state = {'identitySha1': IDENTITY, 'profiles': receipt['profiles']}
    state_dir = work/'signing'; state_dir.mkdir()
    (state_dir/'state.json').write_text(json.dumps(state))
    devices = set(receipt['deviceUdids'])
    assert len(devices) == 2
    reference = plistlib.loads(run('security', 'cms', '-D', '-i', str(reference)))
    assert reference['UUID'] == 'a57e79a7-02f7-49b5-808c-9e88b1e81cd8'
    assert reference['TeamIdentifier'] == [signing.TEAM]
    assert set(reference['ProvisionedDevices']) == devices
    for bundle in signing.BUNDLES:
        profile = profiles/(bundle + '.mobileprovision')
        assert profile.is_file() and not profile.is_symlink()
        decoded = plistlib.loads(run('security', 'cms', '-D', '-i', str(profile)))
        signing.assert_profile(decoded, bundle, state, devices)
        assert len(decoded['DeveloperCertificates']) == 1
        assert decoded['UUID'] == receipt['profiles'][bundle]['uuid']
        assert decoded['Name'] == receipt['profiles'][bundle]['name']
        assert sha256(profile) == receipt['profiles'][bundle]['sha256']
        shutil.copyfile(profile, state_dir/profile.name)
    return state_dir


def sign_products(work, receipt, keychain, state_dir):

    # Every private signing operation selects this temporary keychain explicitly.
    def isolated_run(*args):
        if args[0] == 'codesign' and '--sign' in args:
            args = (args[0], '--keychain', keychain, *args[1:])
        return run(*args)

    signing.run = isolated_run
    app = work/'app/Payload/Wafra.app'
    signing.resign(state_dir, app)
    products = work/'wda/Products'
    runner = products/'Debug-iphoneos/WebDriverAgentRunner-Runner.app'
    assert runner.is_dir()
    assert plistlib.loads((runner/'Info.plist').read_bytes())['CFBundleIdentifier'] == signing.BUNDLES[0]
    assert list(products.glob('*.xctestrun'))
    assert (products/'Debug-iphoneos/WebDriverAgentLib.framework').is_dir()
    for item in sorted(products.rglob('*'), key=lambda p: len(p.parts), reverse=True):
        if item.suffix in ('.framework', '.dylib', '.xctest'):
            isolated_run('codesign', '--force', '--sign', IDENTITY, str(item))
            run('codesign', '--verify', '--deep', '--strict', str(item))
    profile_file = state_dir/(signing.BUNDLES[0] + '.mobileprovision')
    profile = plistlib.loads(run('security', 'cms', '-D', '-i', str(profile_file)))
    entitlements = signing.development_entitlements({}, profile['Entitlements'])
    ent_path = state_dir/'wda.entitlements.plist'; ent_path.write_bytes(plistlib.dumps(entitlements))
    shutil.copyfile(profile_file, runner/'embedded.mobileprovision')
    isolated_run('codesign', '--force', '--sign', IDENTITY, '--entitlements', str(ent_path), str(runner))
    # Helper verification also binds app/widget versions to the pinned provenance.
    os.environ['RUNNER_TEMP'] = str(work)
    return {'wafra': signing.verify(state_dir, app), 'wda': signing.verify(state_dir, runner)}


def main(args):
    os.umask(0o077)
    assert re.fullmatch(r'[0-9a-f]{40}', args.source_commit)
    assert re.fullmatch(r'[0-9a-f]{40}', args.workflow_commit)
    assert re.fullmatch(r'[0-9]+', args.run_id)
    assert not args.output_dir.exists()
    manifest = json.loads((args.inputs_dir/'verification.json').read_text())
    assert manifest['schema'] == 'wafra-ios-local-signing-inputs-v1'
    assert manifest['sourceCommit'] == args.source_commit and manifest['runId'] == args.run_id
    assert manifest['workflowCommit'] == args.workflow_commit
    assert manifest['qaSigningPerformed'] is False
    expected_names = {'Wafra-resignable.tar.gz', 'WDA-Products-unsigned.tar.gz'}
    assert {f['source'] for f in manifest['files']} == expected_names and len(manifest['files']) == 2
    for item in manifest['files']:
        assert sha256(args.inputs_dir/item['source']) == item['sha256']
    receipt = json.loads((args.profiles_dir/'receipt.json').read_text())
    assert receipt['team'] == signing.TEAM and receipt['certificateId'] == CERTIFICATE_ID
    assert receipt['identitySha1'] == IDENTITY and receipt['certificateReused'] is True
    assert set(receipt['profiles']) == set(signing.BUNDLES)
    assert len({p['id'] for p in receipt['profiles'].values()}) == 3
    assert re.fullmatch(r'\d{4}-\d{2}-\d{2}', receipt['date'])
    assert all(p['name'].endswith(' QA ' + receipt['date']) for p in receipt['profiles'].values())
    verify_file_key(args.key_file, args.certificate_file)
    with tempfile.TemporaryDirectory(prefix='wafra-local-sign-') as temporary:
        work = pathlib.Path(temporary)
        extract_regular_archive(args.inputs_dir/'Wafra-resignable.tar.gz', work/'app')
        extract_regular_archive(args.inputs_dir/'WDA-Products-unsigned.tar.gz', work/'wda')
        verify_tree(work/'app/Payload', manifest['wafraProductFileHashes'])
        verify_tree(work/'wda/Products', manifest['wdaProductFileHashes'])
        (work/'ios-build-provenance.json').write_text(json.dumps(manifest['buildProvenance']))
        signing.preflight_app(work/'app/Payload/Wafra.app', work/'ios-build-provenance.json')
        state_dir = validate_profiles(work, args.profiles_dir, receipt, args.reference_profile)
        with temporary_keychain(args.key_file, args.certificate_file) as keychain:
            verified = sign_products(work, receipt, keychain, state_dir)
        # Publish outputs only after signing verification AND keychain deletion.
        args.output_dir.mkdir(parents=True)
        shutil.copytree(work/'app/Payload', args.output_dir/'Payload')
        shutil.copytree(work/'wda/Products', args.output_dir/'Products')
        run('ditto', '-c', '-k', '--keepParent', str(args.output_dir/'Payload'), str(args.output_dir/'Wafra-dev.ipa'))
        run('tar', '-czf', str(args.output_dir/'WDA-Products.tar.gz'), '-C', str(args.output_dir), 'Products')
        report = {'sourceCommit': args.source_commit, 'workflowCommit': manifest['workflowCommit'],
                  'runId': args.run_id, 'label': 'dev-signed rebuild of ' + args.source_commit,
                  'certificateId': CERTIFICATE_ID, 'identitySha1': IDENTITY, 'certificateReused': True,
                  'temporaryKeychainDeleted': True, 'profiles': receipt['profiles'], 'verified': verified,
                  'wdaProductFileHashes': {str(p.relative_to(args.output_dir/'Products')): sha256(p)
                                          for p in (args.output_dir/'Products').rglob('*') if p.is_file()},
                  'sha256': {n: sha256(args.output_dir/n) for n in ['Wafra-dev.ipa', 'WDA-Products.tar.gz']}}
        (args.output_dir/'verification.json').write_text(json.dumps(report, indent=2) + '\n')
    print('Verified local QA products: ' + str(args.output_dir))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ['inputs-dir', 'profiles-dir', 'output-dir', 'certificate-file', 'key-file', 'reference-profile']:
        parser.add_argument('--' + flag, required=True, type=pathlib.Path)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--workflow-commit', required=True)
    parser.add_argument('--run-id', required=True)
    def interrupted(signum, frame):
        raise InterruptedError('interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    try:
        main(parser.parse_args())
    except (Exception, KeyboardInterrupt) as error:
        # subprocess exceptions include password-bearing argv: never format them.
        print('Local signing failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
