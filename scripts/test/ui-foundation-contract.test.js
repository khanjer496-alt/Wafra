const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(ROOT, relative));

const theme = read('src/constants/theme.ts');
assert.match(theme, /export const Colors/);
assert.match(theme, /export const Fonts/);
assert.match(theme, /export const Spacing/);

const perf = read('src/hooks/use-screen-entering.ts');
assert.match(perf, /Platform\.OS === 'android' \|\| reducedMotion \? undefined : animation/);

const sheet = read('src/components/ui/bottom-sheet.tsx');
assert.match(sheet, /accessibilityViewIsModal/);
assert.match(sheet, /onAccessibilityEscape/);
assert.match(sheet, /useKeyboardHeight/);

const sourceFiles = (dir = path.join(ROOT, 'src')) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
const modalOwners = sourceFiles()
  .filter((file) => fs.readFileSync(file, 'utf8').includes('<Modal'))
  .map((file) => path.relative(ROOT, file));
assert.ok(modalOwners.includes('src/components/ui/bottom-sheet.tsx'));
assert.ok(modalOwners.every((relative) =>
  relative === 'src/components/ui/bottom-sheet.tsx' ||
  relative === 'src/components/limit-sheet.tsx'));

for (const token of ['inverseSurface', 'inverseText', 'scrim']) {
  assert.equal(
    (theme.match(new RegExp(`\\b${token}:`, 'g')) ?? []).length,
    2,
    `${token} must exist in both palettes`,
  );
}

for (const relative of [
  'src/components/ui/section-header.tsx',
  'src/components/ui/action-icon-button.tsx',
  'src/components/ui/segmented-control.tsx',
  'src/components/ui/platform-symbol.tsx',
  'src/components/ui/platform-symbol.ios.tsx',
]) assert.ok(exists(relative), `missing ${relative}`);

const icon = read('src/components/ui/icon.tsx');
const platformSymbol = read('src/components/ui/platform-symbol.tsx');
const iosPlatformSymbol = read('src/components/ui/platform-symbol.ios.tsx');
assert.doesNotMatch(icon, /import \{ SymbolView/);
assert.match(icon, /import type \{ SFSymbol \} from 'expo-symbols'/);
assert.match(icon, /Record<IconName, SFSymbol>/);
assert.match(icon, /import \{ PlatformSymbol \} from '@\/components\/ui\/platform-symbol'/);
assert.doesNotMatch(platformSymbol, /expo-symbols|useFonts|SymbolView/);
assert.match(platformSymbol, /return <React\.Fragment>\{fallback\}<\/React\.Fragment>/);
assert.match(iosPlatformSymbol, /import \{ SymbolView/);
assert.match(iosPlatformSymbol, /<SymbolView/);
assert.doesNotMatch(iosPlatformSymbol, /as SFSymbol/);

const sectionHeader = read('src/components/ui/section-header.tsx');
assert.match(sectionHeader, /type SectionHeaderTrailing/);
assert.match(sectionHeader, /action\?: never/);
assert.match(sectionHeader, /minWidth: 44, minHeight: 44/);
assert.match(sectionHeader, /minWidth: 48, minHeight: 48/);

const actionIcon = read('src/components/ui/action-icon-button.tsx');
assert.match(actionIcon, /minWidth: 44/);
assert.match(actionIcon, /minHeight: 44/);
assert.match(actionIcon, /androidFrame: \{ minWidth: 48, minHeight: 48 \}/);
assert.doesNotMatch(actionIcon, /size\?: number/);

const segmented = read('src/components/ui/segmented-control.tsx');
assert.match(segmented, /label: string/);
assert.match(segmented, /role="tablist"/);
assert.match(segmented, /accessibilityState=\{\{ selected: active \}\}/);
assert.ok(Number(segmented.match(/segment:\s*\{[\s\S]*?minHeight:\s*(\d+)/)?.[1]) >= 48, 'unified segments meet the touch target floor');

assert.ok(exists('src/components/ui/text-field.tsx'));
const field = read('src/components/ui/text-field.tsx');
assert.match(field, /forwardRef<TextInput, TextFieldProps>/);
assert.match(field, /numeric: true; keyboardType\?: never; inputMode\?: never/);
assert.match(field, /errorText/);
assert.match(field, /accessibilityLiveRegion="polite"/);
assert.match(field, /accessibilityLabel = label/);
assert.match(field, /React\.useId\(\)/);
assert.match(field, /nativeID=\{labelId\}/);
assert.match(field, /nativeID=\{descriptionId\}/);
assert.match(field, /accessibilityLabelledBy=\{resolvedLabelledBy\}/);
assert.match(field, /accessibilityHint=\{resolvedHint\}/);
assert.match(field, /'aria-labelledby': resolvedWebLabelledBy/);
assert.match(field, /'aria-describedby': activeDescription \? descriptionId : undefined/);
assert.match(field, /const hasError = invalid \|\| !!errorText/);
assert.match(field, /borderColor: hasError \? theme\.expense : theme\.controlBorder/);
assert.match(field, /'aria-invalid': hasError/);
assert.match(field, /Platform\.OS === 'web' \? webAriaProps : \{\}/);

const amountSheet = read('src/components/ui/amount-sheet.tsx');
assert.match(amountSheet, /<TextField/);
assert.doesNotMatch(amountSheet, /<TextInput(?:\s|\/)/);
assert.match(amountSheet, /parseAmountToFils\(text\)/);

for (const relative of [
  'src/components/ui/section-header.tsx',
  'src/components/ui/action-icon-button.tsx',
  'src/components/ui/segmented-control.tsx',
]) {
  const source = read(relative);
  assert.doesNotMatch(source, /#[0-9a-fA-F]{6}\b/);
  assert.doesNotMatch(source, /fontWeight:/);
  assert.doesNotMatch(source, /<Modal\b/);
}

for (const relative of [
  'src/components/ui/screen-header.tsx',
  'src/components/ui/screen-scaffold.tsx',
]) assert.ok(exists(relative), `missing ${relative}`);

const screenHeader = read('src/components/ui/screen-header.tsx');
assert.match(screenHeader, /export type HeaderAction/);
assert.match(screenHeader, /export type ScreenHeaderProps/);
assert.match(screenHeader, /actions\.slice\(0, 2\)/);
assert.match(screenHeader, /back\.onPress/);
assert.match(screenHeader, /back\.icon \?\? 'chevron-left'/);
assert.match(screenHeader, /headerLeft/);
assert.match(screenHeader, /headerRight/);
assert.match(screenHeader, /headerLargeTitleEnabled/);
assert.match(screenHeader, /action\.icon \?/);
assert.match(screenHeader, /<ActionIconButton/);
assert.match(screenHeader, /minWidth: 44, minHeight: 44/);
assert.match(screenHeader, /androidTextAction: \{ minWidth: 48, minHeight: 48 \}/);
assert.match(screenHeader, /Platform\.OS === 'android'/);
assert.doesNotMatch(screenHeader, /router\.back\(\)/);

const screenScaffold = read('src/components/ui/screen-scaffold.tsx');
assert.match(screenScaffold, /const usesNativeHeader = Platform\.OS === 'ios'/);
assert.match(screenScaffold, /React\.cloneElement\(refreshControl/);
assert.match(screenScaffold, /progressViewOffset:/);
assert.match(screenScaffold, /virtualizedInlineHeader/);
assert.match(screenScaffold, /virtualizedHeader: \{/);
assert.match(screenScaffold, /paddingHorizontal: ScreenPadding/);

const finalSheet = read('src/components/ui/bottom-sheet.tsx');
assert.match(finalSheet, /dismissible: false; footer: React\.ReactElement/);
assert.match(finalSheet, /onRequestClose=\{requestImplicitDismiss\}/);
assert.match(finalSheet, /enabled\(dismissible && !reducedMotion\)/);
assert.match(finalSheet, /disabled=\{!dismissible\}/);
assert.match(finalSheet, /onAccessibilityEscape=\{dismissible \? requestDismiss : undefined\}/);
assert.match(finalSheet, /backgroundColor: theme\.scrim/);
assert.match(finalSheet, /testID=\{testID\}/);
assert.match(finalSheet, /\{dismissible \? \([\s\S]*styles\.grabber/);
assert.match(finalSheet, /\{dismissible \? \([\s\S]*accessibilityLabel=\{t\('close', language\)\}/);
assert.match(finalSheet, /close: \{[\s\S]*width: 44,[\s\S]*height: 44/);
assert.match(finalSheet, /Platform\.OS === 'android' && styles\.androidClose/);
assert.match(finalSheet, /androidClose: \{ width: 48, height: 48/);
assert.match(finalSheet, /style=\{styles\.scroll\}/);
assert.match(finalSheet, /scroll: \{ flexShrink: 1, minHeight: 0 \}/);
assert.match(finalSheet, /const bottomClearance = Spacing\.five - 2 \+ \(keyboardHeight > 0 \? 0 : insets\.bottom\)/);
assert.match(finalSheet, /const hasFooter = footer !== null && footer !== undefined && typeof footer !== 'boolean'/);
assert.match(finalSheet, /paddingBottom: hasFooter \? 0 : bottomClearance/);
assert.match(finalSheet, /styles\.footer[\s\S]*paddingBottom: bottomClearance/);
const scrollEnd = finalSheet.indexOf('</ScrollView>');
const footerStart = finalSheet.indexOf('{hasFooter ? (', scrollEnd);
assert.ok(scrollEnd >= 0 && footerStart > scrollEnd, 'fixed footer must follow and sit outside the ScrollView');
assert.doesNotMatch(finalSheet, /footer \?/);

const confirmSheet = read('src/components/ui/confirm-sheet.tsx');
assert.match(confirmSheet, /footer=\{[\s\S]*<View style=\{styles\.actions\}>/);
assert.match(confirmSheet, /variant="outline"[\s\S]*variant=\{destructive \? 'danger' : 'filled'\}/);

console.log('✓ UI foundation baseline contract');
