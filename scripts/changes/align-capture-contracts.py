from pathlib import Path
import hashlib

# Runs after apply-capture-receipts.py. Require exact post-apply test source;
# only add the real dependency and assert the new, more specific status shape.
edits = {
    'scripts/test/build.sh': ('af07c140a8d67992fdf9c201024a3320bc00af7f', [
        ('ios-bank-senders.generated ios-bank-senders local-message-record ios-local-capture; do',
         'ios-bank-senders.generated ios-bank-senders local-message-record ios-capture-health ios-local-capture; do'),
    ]),
    'scripts/test/contracts.test.js': ('12d48435511e6e1de1469ffb9b355ae45b122eae', [
        (r'/firstCapturedAt !== null/.test(setupWorkflow)', r'/isCaptureTimestamp\(status\.firstCapturedAt\)/.test(setupWorkflow)'),
    ]),
    'scripts/test/ios-capture-setup.test.js': ('8475b4814f948681f510cf51e8f6916181bddbc1', [
        ("const normalizedTypes = types.replace(/\\s+/g, ' ').trim();", "const normalizedTypes = types.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '').replace(/\\s+/g, ' ').trim();"),
        ('      firstCapturedAt: number | null;\n    }', '      firstCapturedAt: number | null;\n      lastReceivedAt?: number | null;\n      lastHandledAt?: number | null;\n    }'),
        ("      failure: null,\n    });\n    ok('setup controller: unsupported platforms never resolve a native module',", "      failure: null,\n      captureHealth: null,\n    });\n    ok('setup controller: unsupported platforms never resolve a native module',"),
    ]),
}
outputs = {}
for name, (sha, replacements) in edits.items():
    data = Path(name).read_bytes()
    assert hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest() == sha, name
    text = data.decode()
    for before, after in replacements:
        assert text.count(before) == 1, (name, before[:80])
        text = text.replace(before, after)
    outputs[name] = text
for name, text in outputs.items():
    Path(name).write_text(text)
print('Fixture compilation and exact status assertions aligned; no suites skipped.')
