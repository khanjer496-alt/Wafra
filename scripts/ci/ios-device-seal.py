#!/usr/bin/env python3
"""#239 envelopes for re-signable Wafra and unsigned WDA; no QA signing API."""
import hashlib
import json
import os
import pathlib
import subprocess
import tarfile


def sha256(path):
    with path.open('rb') as stream:
        digest = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
        return digest.hexdigest()


def archive_hashes(path, prefix):
    """Hash the actual dereferenced archive, including directory-link contents."""
    result = {}
    with tarfile.open(path, 'r:gz') as tar:
        for member in tar:
            name = pathlib.PurePosixPath(member.name)
            assert not name.is_absolute() and '..' not in name.parts
            relative = str(name.relative_to(prefix))
            assert member.isfile() or member.isdir()
            if member.isfile():
                assert relative not in result
                digest = hashlib.sha256()
                with tar.extractfile(member) as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b''):
                        digest.update(block)
                result[relative] = digest.hexdigest()
    assert result
    return result


def main():
    temp = pathlib.Path(os.environ['RUNNER_TEMP'])
    output = pathlib.Path('sealed')
    output.mkdir(exist_ok=True)
    manifest = {'schema': 'wafra-ios-local-signing-inputs-v1', 'sourceCommit': os.environ['SOURCE_COMMIT'],
                'workflowCommit': os.environ['GITHUB_SHA'], 'runId': os.environ['GITHUB_RUN_ID'],
                'label': 'local signing inputs for ' + os.environ['SOURCE_COMMIT'],
                'qaSigningPerformed': False,
                'buildProvenance': json.loads((temp/'ios-build-provenance.json').read_text()),
                'wdaSource': {'package': 'appium-webdriveragent', 'version': '16.12.5',
                              'sha256': sha256(temp/'wda.tgz')},
                'files': []}
    for name in ['Wafra-resignable.tar.gz', 'WDA-Products-unsigned.tar.gz']:
        source = temp/name
        sealed = output/(name + '.enc')
        subprocess.run(['openssl', 'cms', '-encrypt', '-binary', '-aes-256-cbc', '-outform', 'DER',
                        '-in', str(source), '-out', str(sealed), '.github/android-artifact-recipient.pem'], check=True)
        manifest['files'].append({'source': name, 'sealed': sealed.name, 'sha256': sha256(source),
                                  'sealedSha256': sha256(sealed), 'bytes': source.stat().st_size})
    manifest['wdaProductFileHashes'] = archive_hashes(temp/'WDA-Products-unsigned.tar.gz', 'Products')
    manifest['wafraProductFileHashes'] = archive_hashes(temp/'Wafra-resignable.tar.gz', 'Payload')
    (output/'verification.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
