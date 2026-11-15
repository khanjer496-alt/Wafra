#!/usr/bin/env python3
"""Pinned hosted ciphertext consistency only. No decrypt/extract/execute/CMS."""
import hashlib
import json
import os
import pathlib
import re
import shutil
import signal
import stat
import struct
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile

REPO = 'khanjer496-alt/Wafra'
REPOSITORY_ID = 1312657453
SOURCE = 'f8addb95341dd7f661e47c18ec85da5eb019c1fe'
RUN = 43689629732
ATTEMPT = 1
WORKFLOW = 418243062
JOB = 132737324650
ARTIFACT = 14152642203
ARTIFACT_NAME = 'wafra-ios-device-sealed-43689629732-1'
ARCHIVE_BYTES = 32607613
ARCHIVE_SHA256 = '748b4a1367477e155e4c4a7a824d6d91537522ab737c3c07b6c09053c551f22d'
FILES = {'wafra': 'Wafra-resignable.tar.gz', 'wda': 'WDA-Products-unsigned.tar.gz'}
MEMBERS = {name + '.enc' for name in FILES.values()} | {'verification.json'}
# The producer supplies no count/size ceiling for JSON/maps. Explicit fail-closed
# verifier budgets are derived from the ONE pinned object budget, not purported
# producer guarantees. Each expanded member <= object bytes; total <=3*object.
JSON_BYTES = ARCHIVE_BYTES
MAP_ENTRIES = JSON_BYTES // 70  # min one-character key + 64hex string + JSON syntax
API_BYTES = 1048576  # separate transport budget; failure, never truncated parsing
REPORT_BYTES = 32768
PROVIDER_BYTES = 65536
CHUNK = 65536
SHA = re.compile(r'[0-9a-f]{64}\Z')
PINS = {
    '.github/workflows/ios-device-build.yml': '178820ab7c9d53a09071841f1ab7125c23de4a1c4020a2a620bdab959755c3f3',
    'scripts/ci/ios-device-seal.py': 'b5b27c42a8e5a6090ebd79cfe19d6f79290357164e39dca1d2f29608f67a2b46',
    'scripts/ci/ios-device-signing.py': 'd18f855f160085f508d68b297c5ce0ac526be5d1b9a2d176c7096e5c58d87648',
    '.github/android-artifact-recipient.pem': '72062c5872f31416cc68e545ce4884f72ec42375ea1610c6674c7d384ffa5fd6',
}
PROVENANCE = {
    'expectedBuildNumber': '194', 'expectedVersion': '1.0.0',
    'rebuildOfSource': True, 'testFlightBinaryReused': False,
    'buildConfigOverride': {'profile': 'production-candidate', 'autoIncrement': False, 'ios.autoIncrement': False},
    'originalEasJsonSha256': 'a4a39980f74f6744dbdd24515b632d801decd13892eb6e25d613ef74d07709c7',
    'buildEasJsonSha256': '86162db2f059208b02cb663f0c29f58b4e809f97a8a03a909ef7e21456f3d481',
    'storeIpaVersionsAndPluginSetVerified': True,
}
PHASES = {'host', 'identity', 'source-pins', 'download', 'zip', 'manifest', 'ciphertexts', 'cleanup', 'report', 'provider', 'complete'}
FAILURES = {'host', 'identity', 'transport', 'source-pins', 'download-size', 'archive-digest', 'zip-layout', 'zip-budget', 'json', 'manifest', 'ciphertext-digest', 'cleanup', 'output-size', 'provider', 'interrupted', 'unexpected'}
CONTEXT = {'phase': 'host'}


class Refusal(Exception):
    def __init__(self, code):
        self.code = code if code in FAILURES else 'unexpected'
        super().__init__('Refused')


def need(value, code):
    if not value: raise Refusal(code)


def phase(value):
    need(value in PHASES, 'unexpected'); CONTEXT['phase'] = value


def pairs(items):
    result = {}
    for key, value in items:
        need(key not in result, 'json'); result[key] = value
    return result


def parse_json(data, maximum, depth=20):
    need(len(data) <= maximum, 'json')
    level = 0; quoted = False; escaped = False
    for char in data:
        if quoted:
            if escaped: escaped = False
            elif char == 92: escaped = True
            elif char == 34: quoted = False
        elif char == 34: quoted = True
        elif char in (91, 123):
            level += 1; need(level <= depth, 'json')
        elif char in (93, 125): level -= 1; need(level >= 0, 'json')
    need(not quoted and level == 0, 'json')
    return json.loads(data.decode('utf-8'), object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(Refusal('json')))


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    max_redirections = 3
    max_repeats = 1
    def redirect_request(self, request, fp, code, message, headers, url):
        parsed = urllib.parse.urlsplit(url)
        need(parsed.scheme == 'https' and not parsed.username and not parsed.password and parsed.port in (None, 443), 'transport')
        host = parsed.hostname or ''
        need(host.endswith(('.blob.core.windows.net', '.githubusercontent.com', '.s3.amazonaws.com')), 'transport')
        # Never forward the repository bearer or API headers to signed storage.
        return urllib.request.Request(url, headers={'User-Agent': 'wafra-pinned-artifact-verifier'})


def response(path):
    token = os.environ.get('GH_TOKEN', '')
    need(bool(token), 'host')
    request = urllib.request.Request('https://api.github.com/repos/' + REPO + '/' + path,
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'wafra-pinned-artifact-verifier'})
    return urllib.request.build_opener(SafeRedirect()).open(request, timeout=45)


def api(path):
    with response(path) as stream: data = stream.read(API_BYTES + 1)
    return parse_json(data, API_BYTES)


def validate_identity(run, jobs, artifact):
    for value, expected in [(run.get('id'), RUN), (run.get('run_attempt'), ATTEMPT), (run.get('workflow_id'), WORKFLOW),
                            (artifact.get('id'), ARTIFACT), (artifact.get('size_in_bytes'), ARCHIVE_BYTES), (jobs.get('total_count'), 1)]:
        need(type(value) is int and value == expected, 'identity')
    need(run.get('id') == RUN and run.get('run_attempt') == ATTEMPT and run.get('workflow_id') == WORKFLOW
         and run.get('path') == '.github/workflows/ios-device-build.yml' and run.get('head_sha') == SOURCE
         and run.get('head_branch') == 'release/1.0.0-rc1-reconciled' and run.get('event') == 'workflow_dispatch'
         and run.get('status') == 'completed' and run.get('conclusion') == 'success', 'identity')
    for key in ('repository', 'head_repository'):
        need(type(run[key]['id']) is int and run[key]['id'] == REPOSITORY_ID and run[key]['full_name'] == REPO, 'identity')
    need(jobs.get('total_count') == 1 and len(jobs['jobs']) == 1, 'identity')
    job = jobs['jobs'][0]
    need(type(job['id']) is int and type(job['run_id']) is int and job['id'] == JOB and job['run_id'] == RUN and job['name'] == 'github-macos'
         and job['status'] == 'completed' and job['conclusion'] == 'success', 'identity')
    steps = job['steps']
    need(all(type(s['number']) is int for s in steps), 'identity')
    need(len({s['number'] for s in steps}) == len(steps), 'identity')
    for required in ('Validate dispatch before secrets', 'Pin release source and production environment',
                     'Build unchanged release IPA using existing EAS signing', 'Build unsigned WDA and verify re-signable Wafra',
                     'Package inputs for local signing (no QA signing account changes)',
                     'Seal re-signable Wafra and unsigned WDA to this Mac', 'Upload only sealed installers and verification',
                     'Remove temporary build products and private logs'):
        selected = [s for s in steps if s['name'] == required]
        need(len(selected) == 1 and selected[0]['status'] == 'completed' and selected[0]['conclusion'] == 'success', 'identity')
    need(all(s['status'] == 'completed' and (s['conclusion'] == 'success' or
             (s['name'] == 'Preserve bounded sealing failure evidence' and s['conclusion'] == 'skipped')) for s in steps), 'identity')
    need(artifact['id'] == ARTIFACT and artifact['name'] == ARTIFACT_NAME and artifact['expired'] is False
         and artifact['size_in_bytes'] == ARCHIVE_BYTES and artifact['digest'] == 'sha256:' + ARCHIVE_SHA256, 'identity')
    record = artifact['workflow_run']
    need(all(type(record[k]) is int for k in ('id','repository_id','head_repository_id')), 'identity')
    need(record['id'] == RUN and record['head_sha'] == SOURCE and record['head_branch'] == run['head_branch']
         and record['repository_id'] == REPOSITORY_ID and record['head_repository_id'] == REPOSITORY_ID, 'identity')


def source_pins():
    # Independently checked source records, not a CMS recipient inspection.
    import base64
    for path, expected in PINS.items():
        record = api('contents/' + path + '?ref=' + SOURCE)
        need(record['encoding'] == 'base64', 'source-pins')
        data = base64.b64decode(''.join(record['content'].splitlines()), validate=True)
        need(hashlib.sha256(data).hexdigest() == expected, 'source-pins')


def download(path):
    digest = hashlib.sha256(); count = 0
    with response('actions/artifacts/' + str(ARTIFACT) + '/zip') as incoming, path.open('xb') as target:
        length = incoming.headers.get('Content-Length')
        if length is not None: need(length == str(ARCHIVE_BYTES), 'download-size')
        while True:
            chunk = incoming.read(min(CHUNK, ARCHIVE_BYTES - count + 1))
            if not chunk: break
            count += len(chunk); need(count <= ARCHIVE_BYTES, 'download-size')
            target.write(chunk); digest.update(chunk)
    need(count == ARCHIVE_BYTES, 'download-size')
    need(digest.hexdigest() == ARCHIVE_SHA256, 'archive-digest')  # before ANY ZIP parse


def zip_envelope(path):
    size = path.stat().st_size
    with path.open('rb') as stream:
        stream.seek(-22, 2); tail = stream.read(22)
    fields = struct.unpack('<4s4H2LH', tail)
    # 3 central entries, 46-byte headers and two uint16 variable-length fields.
    central_budget = sum(46 + len(name.encode()) + 2 * 65535 for name in MEMBERS)
    need(fields[0] == b'PK\x05\x06' and fields[1:3] == (0, 0) and fields[3:5] == (3, 3)
         and fields[7] == 0 and 0 < fields[5] <= central_budget
         and fields[5] + fields[6] == size - 22, 'zip-layout')
    return fields[6]


def layout(path, archive, central_offset):
    members = archive.infolist()
    need(len(members) == 3 and {x.orig_filename for x in members} == MEMBERS, 'zip-layout')
    need(sum(x.file_size for x in members) <= 3 * ARCHIVE_BYTES, 'zip-budget')
    end = 0
    with path.open('rb') as source:
        for item in sorted(members, key=lambda x: x.header_offset):
            need(item.filename == item.orig_filename and not item.is_dir() and not item.comment
                 and item.flag_bits & ~0x808 == 0 and item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                 and stat.S_IFMT(item.external_attr >> 16) in (0, stat.S_IFREG)
                 and not item.external_attr & 0x10 and 0 < item.file_size <= ARCHIVE_BYTES
                 and 0 <= item.compress_size <= ARCHIVE_BYTES and item.header_offset == end, 'zip-layout')
            source.seek(item.header_offset); header = struct.unpack('<4s5H3L2H', source.read(30))
            need(header[0] == b'PK\x03\x04' and header[2] == item.flag_bits and header[3] == item.compress_type
                 and header[9] == len(item.filename.encode()), 'zip-layout')
            need(source.read(header[9]) == item.filename.encode(), 'zip-layout')
            end = item.header_offset + 30 + header[9] + header[10] + item.compress_size
            need(end <= central_offset, 'zip-layout')
            if item.flag_bits & 8:
                source.seek(end); first = source.read(4)
                if first == b'PK\x07\x08':
                    crc, compressed, expanded = struct.unpack('<3L', source.read(12)); end += 16
                else:
                    crc = struct.unpack('<L', first)[0]
                    compressed, expanded = struct.unpack('<2L', source.read(8)); end += 12
                need((crc, compressed, expanded) == (item.CRC, item.compress_size, item.file_size), 'zip-layout')
            else:
                need(header[6:9] == (item.CRC, item.compress_size, item.file_size), 'zip-layout')
        need(end == central_offset, 'zip-layout')
    return {item.filename: item for item in members}


def bounded_member(archive, info, digest_only=False):
    count = 0; digest = hashlib.sha256(); chunks = []
    with archive.open(info) as stream:
        while True:
            data = stream.read(min(CHUNK, ARCHIVE_BYTES - count + 1))
            if not data: break
            count += len(data); need(count <= ARCHIVE_BYTES, 'zip-budget'); digest.update(data)
            if not digest_only: chunks.append(data)
    need(count == info.file_size, 'zip-layout')
    return (count, digest.hexdigest()) if digest_only else b''.join(chunks)


def validate_manifest(data):
    need(all(b < 128 for b in data), 'manifest')  # producer json.dumps default ensure_ascii
    m = parse_json(data, JSON_BYTES, depth=3)
    need(type(m) is dict and set(m) == {'schema','sourceCommit','workflowCommit','runId','label','qaSigningPerformed',
         'buildProvenance','wdaSource','files','wdaProductFileHashes','wafraProductFileHashes'}, 'manifest')
    need((json.dumps(m, indent=2) + '\n').encode() == data, 'manifest')
    need(m['schema'] == 'wafra-ios-local-signing-inputs-v1' and m['sourceCommit'] == SOURCE
         and m['workflowCommit'] == SOURCE and m['runId'] == str(RUN)
         and m['label'] == 'local signing inputs for ' + SOURCE and m['qaSigningPerformed'] is False, 'manifest')
    # Canonical exact byte equality additionally distinguishes bool/int types.
    need(json.dumps(m['buildProvenance'], sort_keys=True) == json.dumps(PROVENANCE, sort_keys=True), 'manifest')
    wda = m['wdaSource']
    need(type(wda) is dict and set(wda) == {'package','version','sha256'} and wda['package'] == 'appium-webdriveragent'
         and wda['version'] == '16.12.5' and type(wda['sha256']) is str and SHA.fullmatch(wda['sha256']), 'manifest')
    need(type(m['files']) is list and len(m['files']) == 2, 'manifest')
    records = {}
    for label, expected in FILES.items():
        selected = [x for x in m['files'] if type(x) is dict and x.get('source') == expected]
        need(len(selected) == 1, 'manifest'); item = selected[0]
        need(set(item) == {'source','sealed','sha256','sealedSha256','bytes'} and item['sealed'] == expected + '.enc'
             and type(item['bytes']) is int and 0 < item['bytes'] <= 2**63-1
             and all(type(item[k]) is str and SHA.fullmatch(item[k]) for k in ('sha256','sealedSha256')), 'manifest')
        records[label] = item
    maps = {}
    for label, key in [('wafra','wafraProductFileHashes'),('wda','wdaProductFileHashes')]:
        entries = m[key]; need(type(entries) is dict and 0 < len(entries) <= MAP_ENTRIES, 'manifest')
        for name, digest in entries.items():
            path = pathlib.PurePosixPath(name)
            need(name and path.parts and '\0' not in name and not path.is_absolute() and '..' not in path.parts
                 and str(path) == name and type(digest) is str and SHA.fullmatch(digest), 'manifest')
        maps[label] = {'declaredCount': len(entries), 'declarationDigest': hashlib.sha256(
            json.dumps(entries, sort_keys=True, separators=(',',':')).encode()).hexdigest()}
    return records, maps


def verify_archive(path):
    # Caller has authenticated byte size+digest before invoking this parser.
    central_offset = zip_envelope(path)  # bound count/central bytes before zipfile builds objects
    with zipfile.ZipFile(path) as archive:
        members = layout(path, archive, central_offset)
        phase('manifest'); records, maps = validate_manifest(bounded_member(archive, members['verification.json']))
        phase('ciphertexts'); measured = {}
        for label, item in records.items():
            count, digest = bounded_member(archive, members[item['sealed']], digest_only=True)
            need(digest == item['sealedSha256'], 'ciphertext-digest')
            measured[label] = {'ciphertextBytesMeasured': count, 'ciphertextSha256Measured': digest,
                               'plaintextBytesDeclared': item['bytes'], 'plaintextSha256Declared': item['sha256'],
                               'ciphertextDeclarationMatched': True, **maps[label]}
    return measured


def report_base():
    return {'schema':'wafra-sealed-artifact-check-v1','candidateVerified':False,'phase':CONTEXT['phase'], 'failure':'unexpected',
            'verifierScriptSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
            'identity':{'repository':REPO,'repositoryId':REPOSITORY_ID,'runJobId':JOB,'artifactName':ARTIFACT_NAME,'runId':RUN,'attempt':ATTEMPT,'sourceCommit':SOURCE,'workflowCommit':SOURCE,
                        'workflowId':WORKFLOW,'artifactId':ARTIFACT,'artifactBytes':ARCHIVE_BYTES,'artifactSha256':ARCHIVE_SHA256},
            'checks':{},'ciphertexts':{},'privateTempDeleted':False,
            'limits':{'plaintextVerified':False,'decryptionPerformed':False,'cmsRecipientVerified':False,
                      'wdaSourceBytesVerified':False,'appCompilerCorrectnessVerified':False,'signingPerformed':False,
                      'deviceVerified':False,'runtimeVerified':False,'releaseApproved':False,
                      'acceptanceRequiresSuccessfulProviderGateStep':True}}


def validate_report(report):
    base = report_base()
    need(set(report) == set(base) and report['schema'] == base['schema'] and report['identity'] == base['identity']
         and report['limits'] == base['limits'] and report['verifierScriptSha256'] == base['verifierScriptSha256']
         and type(report['candidateVerified']) is bool and type(report['privateTempDeleted']) is bool
         and report['phase'] in PHASES and report['failure'] in FAILURES | {'none'}, 'output-size')
    checks = {'originalRunIdentity','originalArtifactIdentity','producerSourcePins','recipientSourcePin',
              'encryptedArchiveDigestMatched','fixedZipAndManifest','ciphertextDeclarationsMatched',
              'memberMapsDeclarationsOnly','wdaPackageVersionMatched'}
    need(type(report['checks']) is dict and set(report['checks']) <= checks
         and all(v is True for v in report['checks'].values()) and type(report['ciphertexts']) is dict
         and set(report['ciphertexts']) <= set(FILES), 'output-size')
    for row in report['ciphertexts'].values():
        need(set(row) == {'ciphertextBytesMeasured','ciphertextSha256Measured','plaintextBytesDeclared',
             'plaintextSha256Declared','ciphertextDeclarationMatched','declaredCount','declarationDigest'}, 'output-size')
        need(type(row['ciphertextBytesMeasured']) is int and 0 < row['ciphertextBytesMeasured'] <= ARCHIVE_BYTES
             and type(row['plaintextBytesDeclared']) is int and 0 < row['plaintextBytesDeclared'] <= 2**63-1
             and type(row['declaredCount']) is int and 0 < row['declaredCount'] <= MAP_ENTRIES
             and row['ciphertextDeclarationMatched'] is True and all(type(row[k]) is str and SHA.fullmatch(row[k])
             for k in ('ciphertextSha256Measured','plaintextSha256Declared','declarationDigest')), 'output-size')
    if report['candidateVerified']:
        need(report['privateTempDeleted'] is True and report['phase'] == 'complete' and report['failure'] == 'none'
             and set(report['checks']) == checks and set(report['ciphertexts']) == set(FILES), 'output-size')
    else: need(report['failure'] != 'none', 'output-size')


def save_report(report):
    validate_report(report)
    output = pathlib.Path(os.environ['RUNNER_TEMP'])/'sealed-verifier-report'
    need(not output.exists(), 'output-size'); output.mkdir(mode=0o700)
    data = (json.dumps(report, sort_keys=True, separators=(',',':')) + '\n').encode()
    need(len(data) <= REPORT_BYTES, 'output-size')
    target = output/'result.json'
    with target.open('xb') as stream: stream.write(data)
    target.chmod(0o600)


def verify():
    report = report_base(); temporary = None
    try:
        phase('host')
        need(sys.platform == 'linux' and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_OS') == 'Linux'
             and os.environ.get('GITHUB_REPOSITORY') == REPO, 'host')
        phase('identity')
        validate_identity(api('actions/runs/' + str(RUN)), api('actions/runs/' + str(RUN) + '/attempts/1/jobs?per_page=100'),
                          api('actions/artifacts/' + str(ARTIFACT)))
        listing = api('actions/runs/' + str(RUN) + '/artifacts?per_page=100')
        need(type(listing['total_count']) is int and listing['total_count'] == 1 and len(listing['artifacts']) == 1 and listing['artifacts'][0]['id'] == ARTIFACT, 'identity')
        phase('source-pins'); source_pins()
        report['checks'] = {'originalRunIdentity':True,'originalArtifactIdentity':True,'producerSourcePins':True,
                            'recipientSourcePin':True}
        temporary = pathlib.Path(tempfile.mkdtemp(prefix='wafra-sealed-verifier-', dir=os.environ['RUNNER_TEMP']))
        temporary.chmod(0o700); archive = temporary/'input.zip'
        phase('download'); download(archive); report['checks']['encryptedArchiveDigestMatched'] = True
        phase('zip'); report['ciphertexts'] = verify_archive(archive)
        report['checks'].update(fixedZipAndManifest=True,ciphertextDeclarationsMatched=True,memberMapsDeclarationsOnly=True,wdaPackageVersionMatched=True)
    except (Exception, KeyboardInterrupt) as error:
        report['failure'] = error.code if isinstance(error,Refusal) else 'unexpected'
        report['phase'] = CONTEXT['phase']
    else:
        report.update(candidateVerified=True,failure='none',phase='complete')
    finally:
        try:
            if temporary is not None: shutil.rmtree(temporary)
            need(temporary is None or not temporary.exists(), 'cleanup'); report['privateTempDeleted'] = True
        except Exception: report.update(candidateVerified=False,failure='cleanup',phase='cleanup')
    # No success is published while private owned input remains.
    save_report(report)
    return 0 if report['candidateVerified'] else 1


def provider_gate():
    phase('provider')
    need(sys.platform == 'linux' and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_OS') == 'Linux'
         and os.environ.get('GITHUB_REPOSITORY') == REPO, 'provider')
    artifact_id = os.environ.get('REPORT_ARTIFACT_ID',''); run_id = os.environ.get('GITHUB_RUN_ID','')
    need(re.fullmatch(r'[0-9]{1,20}',artifact_id) and re.fullmatch(r'[0-9]{1,20}',run_id), 'provider')
    artifact = api('actions/artifacts/' + artifact_id)
    need(type(artifact['id']) is int and type(artifact['size_in_bytes']) is int
         and type(artifact['workflow_run']['id']) is int and artifact['id'] == int(artifact_id) and artifact['name'] == 'wafra-sealed-check-' + run_id
         and artifact['expired'] is False and 0 < artifact['size_in_bytes'] <= PROVIDER_BYTES
         and artifact['workflow_run']['id'] == int(run_id)
         and artifact['workflow_run']['repository_id'] == REPOSITORY_ID
         and artifact['workflow_run']['head_sha'] == os.environ.get('GITHUB_SHA')
         and artifact['workflow_run']['head_repository_id'] == REPOSITORY_ID
         and artifact['digest'] == 'sha256:' + os.environ.get('REPORT_ARTIFACT_DIGEST','')
         and SHA.fullmatch(os.environ.get('REPORT_ARTIFACT_DIGEST','')), 'provider')
    return 0


def entry():
    def interrupted(*_): raise Refusal('interrupted')
    signal.signal(signal.SIGTERM,interrupted)
    try:
        if sys.argv[1:] == ['--verify']: return verify()
        if sys.argv[1:] == ['--provider-gate']: return provider_gate()
    except (Exception,KeyboardInterrupt): return 1  # no exception/argv/tool prose
    return 1


if __name__ == '__main__':
    raise SystemExit(entry())
