const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const typesPath = path.resolve(__dirname, '../../../modules/wafra-live-capture/src/WafraLiveCapture.types.ts');

test('older native modules remain assignable when bundled message/history getters are absent', () => {
  const fixturePath = path.resolve(__dirname, '__bundled-shortcut-compatibility__.ts');
  const fixture = `
    import type { WafraLiveCaptureNativeModule } from ${JSON.stringify(typesPath.replace(/\.ts$/, ''))};
    declare const olderBinary: Omit<WafraLiveCaptureNativeModule, 'getMessageShortcutURL' | 'getHistoryShortcutURL'>;
    const compatible: WafraLiveCaptureNativeModule = olderBinary;
    export function messageURL(native: WafraLiveCaptureNativeModule): Promise<string> | null {
      return native.getMessageShortcutURL ? native.getMessageShortcutURL() : null;
    }
    export function historyURL(native: WafraLiveCaptureNativeModule): Promise<string> | null {
      return native.getHistoryShortcutURL ? native.getHistoryShortcutURL() : null;
    }
    export { compatible };
  `;
  const options = { strict: true, noEmit: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => file === fixturePath
    ? ts.createSourceFile(file, fixture, languageVersion, true)
    : getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([fixturePath, typesPath], options, host);
  const errors = ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), []);
});

test('bundled shortcut methods cannot accept caller-controlled resource paths', () => {
  const source = ts.createSourceFile(typesPath, fs.readFileSync(typesPath, 'utf8'), ts.ScriptTarget.Latest, true);
  const contract = source.statements.find((statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === 'WafraLiveCaptureNativeModule');
  for (const name of ['getMessageShortcutURL', 'getHistoryShortcutURL']) {
    const method = contract.members.find((member) => member.name?.getText(source) === name);
    assert.ok(method && ts.isMethodSignature(method), `Missing ${name}`);
    assert.ok(method.questionToken, `${name} must remain optional for older binaries`);
    assert.equal(method.parameters.length, 0, `${name} must not accept a path or filename`);
  }
});
