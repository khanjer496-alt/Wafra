from pathlib import Path
import hashlib

# One-use, exact-source edit transport. It is removed after the checked normal
# source is committed. Never patch an unknown or concurrently edited file.
p = Path.cwd()
expected = {
 'modules/wafra-live-capture/ios/Tests/WafraLiveCaptureBridgeBehaviorTests.swift': '8b13b9816f24637ed9d05538bb225ca04977f727',
 'modules/wafra-live-capture/ios/Tests/WafraLiveCaptureStoreStub.swift': 'd5d8b6ce5a61064a5a78c88e359f7a1e93bcb668',
 'modules/wafra-live-capture/ios/WafraLiveCaptureModule.swift': 'd3690f1776b52eaae02be850efde4cbf614c48fc',
 'modules/wafra-live-capture/ios/WafraLiveCaptureStore.swift': 'b9005eecd0acb972f402f5412da04e9ab7408e4b',
 'modules/wafra-live-capture/src/WafraLiveCapture.types.ts': '2cfa4f3d6a089afe7fa72a3451234199b002325c',
 'scripts/test/ios-capture-setup.test.js': '310f16539875dec52e2259d0f657f2bd82675be2',
 'scripts/test/ios-setup-ux.test.js': 'ffd3c2ac4601ec712a5c33ab03e08346dc37d0de',
 'src/app/ios-setup.tsx': 'd87116271882fa11de7970aec12e6da54f7f322b',
 'src/components/ios-message-setup/setup-journey.tsx': '3bac5adb514f454705cf3472730cfb1391f5b737',
 'src/hooks/use-auto-import.ts': '08f32380369fda4c680923945548f0b84480a5b6',
 'src/lib/ios-capture-setup.ts': 'e9e0aba6d7771e7c17ae0179381abfbaf470ccd7',
 'src/lib/ios-local-capture.ts': 'c1eab2b66940db8377732836ec53801caadbf9ce',
}
files = {}
for path, sha in expected.items():
 data = (p/path).read_bytes()
 if hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest() != sha:
  raise RuntimeError(f'Source changed: refusing to overwrite {path}')
 files[path] = data.decode()
def edit(path, before, after, count=1):
 text = files[path]
 if text.count(before) != count: raise RuntimeError(f'Edit anchor changed in {path}: {before[:45]}')
 files[path] = text.replace(before, after)
store = 'modules/wafra-live-capture/ios/WafraLiveCaptureStore.swift'
edit(store, '  public let firstCapturedAt: TimeInterval?\n', '  public let firstCapturedAt: TimeInterval?\n  /// Wall-clock receipts, not transaction timestamps or proof of complete coverage.\n  public let lastReceivedAt: TimeInterval?\n  public let lastHandledAt: TimeInterval?\n')
edit(store, '    var firstCapturedAt: TimeInterval?\n', '    var firstCapturedAt: TimeInterval?\n    var lastReceivedAt: TimeInterval?\n    var lastHandledAt: TimeInterval?\n')
edit(store, '      case setupProofVersion, setupProofAt, automationInputProbeAt, firstCapturedAt\n', '      case setupProofVersion, setupProofAt, automationInputProbeAt, firstCapturedAt\n      case lastReceivedAt, lastHandledAt\n')
edit(store, '      firstCapturedAt = try values.decodeIfPresent(TimeInterval.self, forKey: .firstCapturedAt)\n', '''      firstCapturedAt = try values.decodeIfPresent(TimeInterval.self, forKey: .firstCapturedAt)
      // Additive diagnostics must never invalidate an older financial queue.
      // Missing or malformed receipt fields are unknown, not corruption of events.
      lastReceivedAt = (try? values.decodeIfPresent(TimeInterval.self, forKey: .lastReceivedAt))
        .flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
      lastHandledAt = (try? values.decodeIfPresent(TimeInterval.self, forKey: .lastHandledAt))
        .flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
''')
edit(store, '      do {\n        try writeManifest(manifest, in: root)\n      } catch {', '''      // Publish receipt and queued event in the same durable manifest write.
      // Duplicate/replayed, invalid, disabled and capacity-refused calls never advance it.
      manifest.lastReceivedAt = max(manifest.lastReceivedAt ?? 0, receiptTime.timeIntervalSince1970)
      do {
        try writeManifest(manifest, in: root)
      } catch {''')
edit(store, '      try writeManifest(manifest, in: root)\n      for id in removed where !verified.contains', '''      // This means the queue was handled, not necessarily that money was recorded:
      // acknowledgements also include duplicates and non-financial messages.
      if !verified.isEmpty {
        manifest.lastHandledAt = max(manifest.lastHandledAt ?? 0, acknowledgementDate.timeIntervalSince1970)
      }
      try writeManifest(manifest, in: root)
      for id in removed where !verified.contains''')
edit(store, '        firstCapturedAt: manifest.firstCapturedAt\n', '        firstCapturedAt: manifest.firstCapturedAt,\n        lastReceivedAt: manifest.lastReceivedAt,\n        lastHandledAt: manifest.lastHandledAt\n')
bridge = 'modules/wafra-live-capture/ios/WafraLiveCaptureModule.swift'
edit(bridge, '  @Field var firstCapturedAt: Double?\n', '  @Field var firstCapturedAt: Double?\n  @Field var lastReceivedAt: Double?\n  @Field var lastHandledAt: Double?\n')
edit(bridge, '      record.firstCapturedAt = try epochMilliseconds(status.firstCapturedAt)\n', '      record.firstCapturedAt = try epochMilliseconds(status.firstCapturedAt)\n      record.lastReceivedAt = try epochMilliseconds(status.lastReceivedAt)\n      record.lastHandledAt = try epochMilliseconds(status.lastHandledAt)\n')
stub = 'modules/wafra-live-capture/ios/Tests/WafraLiveCaptureStoreStub.swift'
edit(stub, '  public let firstCapturedAt: TimeInterval?\n', '  public let firstCapturedAt: TimeInterval?\n  public let lastReceivedAt: TimeInterval?\n  public let lastHandledAt: TimeInterval?\n')
edit(stub, '    firstCapturedAt: 987.5\n', '    firstCapturedAt: 987.5,\n    lastReceivedAt: 1234.5,\n    lastHandledAt: 1244.75\n')
edit('modules/wafra-live-capture/src/WafraLiveCapture.types.ts', '  firstCapturedAt: number | null;\n', '''  firstCapturedAt: number | null;
  /** Optional on older binaries. Milliseconds of durable native queue activity. */
  lastReceivedAt?: number | null;
  /** Includes duplicates and non-financial messages, NOT last transaction time. */
  lastHandledAt?: number | null;
''')
f = 'src/lib/ios-capture-setup.ts'
edit(f, 'export const SHORTCUTS_APP_STORE_URL =', '''import {
  isCaptureTimestamp,
  readIosCaptureHealth,
  type IosCaptureHealth,
} from './ios-capture-health';

export const SHORTCUTS_APP_STORE_URL =''')
edit(f, '  failure: IosSetupFailure;\n', '  failure: IosSetupFailure;\n  captureHealth: IosCaptureHealth | null;\n')
edit(f, '  failure: null,\n};', '  failure: null,\n  captureHealth: null,\n};')
edit(f, "  if (!status.enabled) return 'not-added';", "  if (status.enabled !== true) return 'not-added';")
edit(f, "  if (status.firstCapturedAt !== null) return 'first-alert-captured';", "  if (isCaptureTimestamp(status.firstCapturedAt)) return 'first-alert-captured';")
edit(f, "        readiness: 'not-added',", "        readiness: 'not-added',\n        captureHealth: null,", 3)
edit(f, '        readiness,\n', '        readiness,\n        captureHealth: readIosCaptureHealth(status),\n')
edit('src/app/ios-setup.tsx', '                detectedBanks={detectedBanks}\n', '                detectedBanks={detectedBanks}\n                captureHealth={setup.captureHealth}\n')
f = 'src/components/ios-message-setup/setup-journey.tsx'
edit(f, "import React from 'react';", "import React from 'react';\nimport { IosCaptureHealthPanel } from './capture-health';\nimport type { IosCaptureHealth } from '@/lib/ios-capture-health';")
edit(f, '  detectedBanks: readonly string[];\n', '  detectedBanks: readonly string[];\n  captureHealth?: IosCaptureHealth | null;\n')
edit(f, '  automationConfirmed, detectedBanks }: IosSetupJourneyProps)', '  automationConfirmed, detectedBanks, captureHealth }: IosSetupJourneyProps)')
edit(f, '      </View>\n    </View>\n', '      </View>\n      <IosCaptureHealthPanel health={captureHealth ?? null} language={language} />\n    </View>\n')
f = 'scripts/test/ios-capture-setup.test.js'
edit(f, '    requireModule, loaded, loaded.exports, filename, path.dirname(filename),', "    (id) => id === './ios-capture-health' || id === '@/lib/ios-capture-health'\n      ? execute('src/lib/ios-capture-health.ts', requireModule) : requireModule(id),\n    loaded, loaded.exports, filename, path.dirname(filename),")
edit('scripts/test/ios-setup-ux.test.js', '    (request) => dependencies[request] ?? {},', "    (request) => dependencies[request] ??\n      (request === './ios-capture-health' ? execute('src/lib/ios-capture-health.ts') : {}),")
f = 'src/hooks/use-auto-import.ts'
edit(f, "import { useStore } from '@/lib/store';", "import { useStore } from '@/lib/store';\nimport { isCaptureTimestamp } from '@/lib/ios-capture-health';")
edit(f, "if (firstCapturedAt !== null) return 'first-alert-captured';", "if (isCaptureTimestamp(firstCapturedAt)) return 'first-alert-captured';")
edit(f, 'retirementPending: nativeStatus?.firstCapturedAt !== null &&', 'retirementPending: isCaptureTimestamp(nativeStatus?.firstCapturedAt) &&')
f = 'src/lib/ios-local-capture.ts'
edit(f, 'import type { CaptureLedgerAdapter }', "import { isCaptureTimestamp } from '@/lib/ios-capture-health';\n\nimport type { CaptureLedgerAdapter }")
edit(f, "if (status.firstCapturedAt === null) return 'not-needed';", "if (!isCaptureTimestamp(status.firstCapturedAt)) return 'not-needed';")
edit(f, 'let firstCapturedAt = initialStatus.firstCapturedAt;', 'let firstCapturedAt = isCaptureTimestamp(initialStatus.firstCapturedAt)\n      ? initialStatus.firstCapturedAt : null;')
f = 'modules/wafra-live-capture/ios/Tests/WafraLiveCaptureBridgeBehaviorTests.swift'
a = '    let automationInputProbeAt = try invoke("getAutomationInputProbeAt", as: Double.self)'
edit(f, a, '''    check("status converts last received receipt from seconds to milliseconds",
      recordField(status, "lastReceivedAt", as: Double.self) == 1_234_500)
    check("status converts last handled receipt from seconds to milliseconds",
      recordField(status, "lastHandledAt", as: Double.self) == 1_244_750)

''' + a)
for path, text in files.items(): (p/path).write_text(text)
print('Applied twelve hash-checked source/test edits; parser rules and file protection unchanged.')
