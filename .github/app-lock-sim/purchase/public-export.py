#!/usr/bin/env python3
"""Export only structured, allowlisted synthetic diagnostic fields; never raw SDK text."""
import argparse
from collections import deque
from datetime import datetime
import json
from pathlib import Path
import re

STAGE = re.compile(r'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) \+0000 ([A-Z][A-Za-z0-9-]{0,40}) (?:buy tap|boundary)\b')
TIME = re.compile(r'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\.\d+ ')
SENSITIVE = re.compile(r'authorization|bearer|token|cookies?|api[-_ ]?key|password|secret|receipt|jws|jwt|customer|account|headers?|[\w.+-]+@[\w.-]+\.[a-z]{2,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', re.I)
WANT = re.compile(r'purchas|transaction|product|cancel|storekit|superwall|offer|payment|dialog|sheet|entitle|\[wafra:|error|fail|javascript|refus|unavailable|receipt|sandbox|account', re.I)
NOISE = re.compile(r'apsd|APSConnection|dt\.xctest|XCTElementQuery|AX element|XCTAutomation|XCUI|accessibility|Accessibility|launchservices|containermanager|libsystem|FSNode|BindingEvaluator|User Defaults|forced client overrides|xpc:connection|Truncating a list|AppleMediaServices|CFBundle|AMS')
STAGES = {'INIT', 'DIAG', 'DIAG-launch', 'DIAG-paywall', 'P1', 'P2', 'P3', 'P4', 'P5',
          'P3b', 'P3b-launch', 'P3b-injected', 'P3c', 'P3c-launch'}
IDS = {'CONFIG-FILES', 'FIXTURE', 'DIAG', 'P1', 'P2', 'P3', 'P4', 'P5', 'P3b', 'P3b-UI', 'P3c'}
EVENTS = (('daemon_interrupted', r'Connection to daemon interrupted'), ('restore', r'restor'),
          ('configuration', r'configur'), ('transaction', r'transaction'), ('catalog', r'product|offer'),
          ('purchase', r'purchas|payment'), ('error', r'error|fail|unavailable'))


def event(line):
    if SENSITIVE.search(line):
        return None
    events = [name for name, pattern in EVENTS if re.search(pattern, line, re.I)]
    if not events:
        return None
    # No snippets, arbitrary values, IDs, headers, exception strings or payloads.
    return {'events': events, 'bundles': [b for b in ('app.wafra.ios', 'dev.wafra.purchaseuitests.xctrunner') if b in line],
            'products': [p for p in ('wafra_pro_weekly', 'wafra_pro_yearly') if p in line]}


def stages(notes):
    answer = []
    for line in notes.splitlines():
        if len(answer) >= 24:
            break
        if line.startswith('{'):
            try:
                value = json.loads(line)
                if not isinstance(value, dict) or set(value) != {'stage', 'utc'}:
                    continue
                tag = value['stage']
                match = re.fullmatch(r'(.+)-([1-9]|1[0-9]|2[0-4])', tag) if isinstance(tag, str) else None
                if not match or match[1] not in STAGES or not isinstance(value['utc'], str):
                    continue
                stamp = datetime.strptime(value['utc'], '%Y-%m-%dT%H:%M:%S')
                answer.append((tag, stamp))
            except (ValueError, TypeError):
                continue
        else:
            match = STAGE.match(line)
            if match and match[2] in STAGES:
                answer.append((match[2] + '-' + str(len(answer) + 1), datetime.strptime(match[1], '%Y-%m-%d %H:%M:%S')))
    return answer


def native_windows(raw, notes, out):
    windows = {tag: {'time': stamp, 'first': [], 'last': deque(maxlen=120), 'count': 0, 'sensitive_excluded': 0}
               for tag, stamp in stages(notes.read_text(errors='replace'))}
    with raw.open(errors='replace') as stream:
        for line in stream:
            match = TIME.match(line)
            if not match or not WANT.search(line) or NOISE.search(line):
                continue
            stamp = datetime.strptime(match[1], '%Y-%m-%d %H:%M:%S')
            for window in windows.values():
                if not -2 <= (stamp - window['time']).total_seconds() <= 40:
                    continue
                value = event(line)
                if value is None:
                    window['sensitive_excluded'] += int(bool(SENSITIVE.search(line)))
                    continue
                value['utc'] = match[1]
                window['count'] += 1
                if len(window['first']) < 120:
                    window['first'].append(value)
                else:
                    window['last'].append(value)
    out.mkdir(parents=True, exist_ok=True)
    for tag, window in windows.items():
        data = {'stage': tag, 'window_seconds': [-2, 40], 'count': window['count'],
                'sensitive_excluded': window['sensitive_excluded'],
                'events': window['first'] + list(window['last'])}
        (out / ('native-' + tag + '.json')).write_text(json.dumps(data, sort_keys=True) + '\n')


def safe_results(text):
    rows = []
    for line in text.splitlines():
        parts = line.split('\t')
        if len(parts) >= 2 and parts[0] in IDS and parts[1] in {'PASS', 'FAIL'}:
            detail = 'allowlisted result; binding and causal proof not inferred from UI alone'
            if len(parts) > 2 and re.search(r'UNPROVEN|FIXTURE-UNAVAILABLE|observer.race', parts[2], re.I):
                detail = 'UNPROVEN: fixture, readiness or causal evidence unavailable'
            rows.append('\t'.join([parts[0], parts[1], detail]))
    return '\n'.join(rows) + '\n'


def safe_test_log(text):
    lines = []
    for line in text.splitlines():
        if line.startswith('{'):
            try:
                value = json.loads(line)
                if value == {'event': 'daemon_interrupted'}:
                    lines.append(json.dumps(value))
                elif isinstance(value, dict) and set(value) == {'event', 'result'} and value['event'] == 'xctest_result' and value['result'] in {'passed', 'failed'}:
                    lines.append(json.dumps(value))
            except (ValueError, TypeError):
                pass
            continue
        if 'Connection to daemon interrupted' in line:
            lines.append(json.dumps({'event': 'daemon_interrupted'}))
        elif re.search(r"Test (?:Case|Suite).* (?:passed|failed)", line):
            lines.append(json.dumps({'event': 'xctest_result', 'result': 'failed' if 'failed' in line else 'passed'}))
    return '\n'.join(lines) + '\n'


def publish(root, skip_run_log=False):
    # Raw logs never go to the artifact. Native windows are already structured.
    for path in root.rglob('*'):
        if skip_run_log and path.name == 'purchase-run.log':
            continue
        if not path.is_file() or path.suffix not in {'.log', '.txt', '.tsv'}:
            continue
        text = path.read_text(errors='replace')
        if path.name == 'purchase-results.tsv':
            output = safe_results(text)
        elif path.name == 'purchase-xcodebuild-test.log':
            output = safe_test_log(text)
        elif path.name == 'purchase-notes.log':
            output = ''.join(json.dumps({'stage': tag, 'utc': stamp.isoformat()}) + '\n' for tag, stamp in stages(text))
        elif path.name.endswith('-ui.txt'):
            # Old raw UI trees are never exported, even from interrupted legacy tests.
            output = '[withheld: raw UI hierarchy is not a public field]\n'
        elif path.name == 'purchase-run.log':
            # Workflow tee writes fixed script/manifest output only; still do not
            # publish arbitrary command output from a failure path.
            rc = re.search(r'^test rc=(\d+)$', text, re.M)
            output = ('test rc=' + rc[1] + '\n') if rc else 'test rc=unknown\n'
        else:
            output = '[withheld: not on public text allowlist]\n'
        path.write_text(output)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--native', nargs=3, metavar=('RAW', 'NOTES', 'OUT'))
    parser.add_argument('--publish', type=Path)
    parser.add_argument('--skip-run-log', action='store_true')
    args = parser.parse_args()
    if args.native:
        native_windows(*(Path(value) for value in args.native))
    if args.publish:
        publish(args.publish, skip_run_log=args.skip_run_log)


if __name__ == '__main__':
    main()
