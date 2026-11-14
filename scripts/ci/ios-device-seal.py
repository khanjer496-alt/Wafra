#!/usr/bin/env python3
"""#239 CMS envelope pattern, with iOS signing verification (no plaintext upload)."""
import hashlib
import json
import os
import pathlib
import subprocess


def sha256(path):
    with path.open('rb') as stream:
        digest = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
        return digest.hexdigest()


def main():
    temp = pathlib.Path(os.environ['RUNNER_TEMP'])
    signing = pathlib.Path(os.environ['SIGNING_DIR'])
    output = pathlib.Path('sealed')
    output.mkdir(exist_ok=True)
    manifest = {'schema': 'wafra-ios-device-sealed-v1', 'sourceCommit': os.environ['SOURCE_COMMIT'],
                'workflowCommit': os.environ['GITHUB_SHA'], 'runId': os.environ['GITHUB_RUN_ID'],
                'label': 'dev-signed build of ' + os.environ['SOURCE_COMMIT'],
                'buildProvenance': json.loads((temp/'ios-build-provenance.json').read_text()),
                'wdaSource': {'package': 'appium-webdriveragent', 'version': '16.12.5',
                              'sha256': sha256(temp/'wda.tgz')},
                'signing': {key: value for key, value in json.loads((signing/'state.json').read_text()).items()
                            if key != 'before'}, 'files': []}
    for name, verified in [('Wafra-dev.ipa', 'wafra-verified.json'), ('WDA-Products.tar.gz', 'wda-verified.json')]:
        source = temp/name
        sealed = output/(name + '.enc')
        subprocess.run(['openssl', 'cms', '-encrypt', '-binary', '-aes-256-cbc', '-outform', 'DER',
                        '-in', str(source), '-out', str(sealed), '.github/android-artifact-recipient.pem'], check=True)
        manifest['files'].append({'source': name, 'sealed': sealed.name, 'sha256': sha256(source),
                                  'sealedSha256': sha256(sealed), 'bytes': source.stat().st_size,
                                  'products': json.loads((signing/verified).read_text())})
    products = temp/'wda-build/Build/Products'
    manifest['wdaProductFileHashes'] = {str(p.relative_to(products)): sha256(p)
                                        for p in products.rglob('*') if p.is_file() and not p.is_symlink()}
    (output/'verification.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
