#!/usr/bin/env python3
"""#239 CMS envelopes; fixed-field failure evidence, never raw tool output."""
import errno
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import tarfile
import tempfile

PHASES = {'initialization', 'input-observation', 'tool-observation', 'provenance-read', 'wda-source-hash',
          'encrypt-wafra', 'encrypt-wda', 'hash-wafra-input', 'hash-wafra-output', 'stat-wafra',
          'hash-wda-input', 'hash-wda-output', 'stat-wda',
          'archive-wda', 'archive-wafra', 'manifest-write', 'publication', 'complete'}
ERRORS = {'ArchiveRejected', 'FileNotFoundError', 'FileExistsError', 'PermissionError', 'JSONDecodeError',
          'CalledProcessError', 'TimeoutExpired', 'OSError', 'ValueError', 'KeyError', 'AssertionError', 'TypeError'}
ERRNOS = {errno.ENOENT, errno.EACCES, errno.EPERM, errno.ENOSPC, errno.EIO, errno.EEXIST, errno.EROFS}


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


class ArchiveRejected(ValueError):
    def __init__(self, reason, ordinal, files, directories, kind):
        self.evidence = {'reason': reason, 'ordinal': ordinal, 'files': files,
                         'directories': directories, 'memberType': kind}
        super().__init__('Archive rejected')


def archive_hashes(path, prefix):
    """Same refusal policy as41d; rejection metadata contains no member paths."""
    result = {}; ordinal = 0; directories = 0; kind = 'unknown'
    def reject(reason):
        raise ArchiveRejected(reason, ordinal, len(result), directories, kind)
    try:
        with tarfile.open(path, 'r:gz') as tar:
            for member in tar:
                ordinal += 1
                kind = ('regular' if member.isfile() else 'directory' if member.isdir() else
                        'symlink' if member.issym() else 'hardlink' if member.islnk() else 'special')
                name = pathlib.PurePosixPath(member.name)
                if name.is_absolute() or '..' in name.parts: reject('traversal')
                try: relative = str(name.relative_to(prefix))
                except ValueError: reject('wrong-prefix')
                if not (member.isfile() or member.isdir()): reject('non-regular-type')
                if member.isdir(): directories += 1
                if member.isfile():
                    if relative in result: reject('duplicate-file')
                    digest = hashlib.sha256()
                    with tar.extractfile(member) as stream:
                        for block in iter(lambda: stream.read(1024 * 1024), b''):
                            digest.update(block)
                    result[relative] = digest.hexdigest()
    except tarfile.TarError:
        reject('unreadable')
    if not result: reject('empty')
    return result


def tool_observation():
    binary = shutil.which('openssl')
    location = ('system' if binary == '/usr/bin/openssl' else
                'homebrew' if binary and binary.startswith(('/opt/homebrew/', '/usr/local/')) else
                'other' if binary else 'unavailable')
    tool = {'available': binary is not None, 'location': location, 'implementation': 'unknown',
            'version': 'unknown', 'cmsHelpRecognized': False}
    if binary:
        try:
            version = subprocess.run([binary, 'version'], capture_output=True, timeout=5)
            match = re.match(rb'^(OpenSSL|LibreSSL) ([0-9]+(?:\.[0-9]+){1,3})\b', version.stdout[:256])
            if match:
                tool['implementation'] = match[1].decode('ascii'); tool['version'] = match[2].decode('ascii')
            help_result = subprocess.run([binary, 'cms', '-help'], capture_output=True, timeout=5)
            text = (help_result.stdout + help_result.stderr)[:65536].lower()
            tool['cmsHelpRecognized'] = b'usage: cms' in text or b'usage: openssl cms' in text
        except (OSError, subprocess.SubprocessError):
            pass  # Observation is not a speculative CLI/capability gate.
    return binary or 'openssl', tool


def seal(context):
    def phase(value):
        assert value in PHASES
        context['phase'] = value
    temp = pathlib.Path(os.environ['RUNNER_TEMP'])
    output = pathlib.Path('sealed')
    phase('input-observation')
    paths = {'provenance': temp/'ios-build-provenance.json', 'wda-source': temp/'wda.tgz',
             'wafra-archive': temp/'Wafra-resignable.tar.gz', 'wda-archive': temp/'WDA-Products-unsigned.tar.gz',
             'recipient': pathlib.Path('.github/android-artifact-recipient.pem')}
    context['inputs'] = {}
    for name, path in paths.items():
        context['inputs'][name] = {'regularFile': path.is_file(),
                                   'nonempty': path.is_file() and path.stat().st_size > 0}
    phase('tool-observation')
    binary, context['tool'] = tool_observation()
    phase('provenance-read')
    provenance = json.loads(paths['provenance'].read_text())
    phase('wda-source-hash')
    manifest = {'schema': 'wafra-ios-local-signing-inputs-v1', 'sourceCommit': os.environ['SOURCE_COMMIT'],
                'workflowCommit': os.environ['GITHUB_SHA'], 'runId': os.environ['GITHUB_RUN_ID'],
                'label': 'local signing inputs for ' + os.environ['SOURCE_COMMIT'], 'qaSigningPerformed': False,
                'buildProvenance': provenance, 'wdaSource': {'package': 'appium-webdriveragent',
                'version': '16.12.5', 'sha256': sha256(paths['wda-source'])}, 'files': []}
    # A fresh staging directory keeps incomplete/unverified ciphertext out of
    # the success path. Rename is on the same filesystem and publishes once.
    if output.exists(): raise FileExistsError('Output already exists')
    with tempfile.TemporaryDirectory(prefix='.wafra-seal-', dir='.') as temporary:
        staging = pathlib.Path(temporary)
        for label, name in [('wafra', 'Wafra-resignable.tar.gz'), ('wda', 'WDA-Products-unsigned.tar.gz')]:
            phase('encrypt-' + label)
            source = temp/name; encrypted = staging/(name + '.enc')
            subprocess.run([binary, 'cms', '-encrypt', '-binary', '-aes-256-cbc', '-outform', 'DER',
                            '-in', str(source), '-out', str(encrypted), str(paths['recipient'])],
                           capture_output=True, check=True, timeout=120)
            phase('hash-' + label + '-input'); input_hash = sha256(source)
            phase('hash-' + label + '-output')
            assert encrypted.stat().st_size > 0
            output_hash = sha256(encrypted)
            phase('stat-' + label)
            manifest['files'].append({'source': name, 'sealed': encrypted.name, 'sha256': input_hash,
                                      'sealedSha256': output_hash, 'bytes': source.stat().st_size})
        phase('archive-wda')
        manifest['wdaProductFileHashes'] = archive_hashes(paths['wda-archive'], 'Products')
        phase('archive-wafra')
        manifest['wafraProductFileHashes'] = archive_hashes(paths['wafra-archive'], 'Payload')
        phase('manifest-write')
        (staging/'verification.json').write_text(json.dumps(manifest, indent=2) + '\n')
        phase('publication')
        staging.rename(output)
    phase('complete')


def main():
    context = {'schema': 'wafra-ios-seal-failure-v1', 'phase': 'initialization',
               'environmentPresent': {key: bool(os.environ.get(key)) for key in
                                      ['RUNNER_TEMP', 'SOURCE_COMMIT', 'GITHUB_SHA', 'GITHUB_RUN_ID']}}
    for env, key, pattern in [('SOURCE_COMMIT', 'sourceCommit', r'[0-9a-f]{40}'),
                               ('GITHUB_SHA', 'workflowCommit', r'[0-9a-f]{40}'),
                               ('GITHUB_RUN_ID', 'runId', r'[0-9]{1,20}'),
                               ('GITHUB_RUN_ATTEMPT', 'runAttempt', r'[0-9]{1,6}')]:
        value = os.environ.get(env, '')
        context[key] = value if re.fullmatch(pattern, value) else 'unknown'
    try:
        seal(context)
        return 0
    except Exception as error:
        kind = type(error).__name__
        context.update(errorClass=kind if kind in ERRORS else 'OtherError', successPublished=False)
        number = getattr(error, 'errno', None)
        if number in ERRNOS: context['errno'] = number
        code = getattr(error, 'returncode', None)
        if isinstance(code, int) and -255 <= code <= 255: context['returnCode'] = code
        if isinstance(error, ArchiveRejected): context['archive'] = error.evidence
        written = False
        try:
            target = pathlib.Path(os.environ['RUNNER_TEMP'])/'ios-seal-failure.json'
            target.write_text(json.dumps(context, indent=2) + '\n')
            written = True
        except Exception:
            pass  # Failure receipt cannot change the failed exit status.
        print(json.dumps({'schema': context['schema'], 'phase': context['phase'],
                          'errorClass': context['errorClass'], 'failureReceiptWritten': written}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
