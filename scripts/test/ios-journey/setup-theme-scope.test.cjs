'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('../repair/load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const jsx = require('react/jsx-runtime');
const theme = load(path.join(root, 'src/constants/theme.ts'), {
  '@/global.css': {}, 'react-native': { Platform: { select: value => value.ios ?? value.default } },
});

function render(onboarding, saved = 'light', contrast = false) {
  const themeApi = load(path.join(root, 'src/hooks/use-theme.ts'), {
    react: React, '@/constants/theme': theme,
    '@/hooks/use-color-scheme': { useColorScheme: () => saved },
    '@/hooks/use-increased-contrast': { useIncreasedContrast: () => contrast },
  });
  const host = ({ children, testID }) => React.createElement('div', { 'data-testid': testID }, children);
  const { SetupShell } = load(path.join(root, 'src/components/onboarding/setup-shell.tsx'), {
    react: React, 'react/jsx-runtime': jsx,
    'react-native': { View: host, StyleSheet: { create: value => value, absoluteFillObject: {} } },
    'expo-router': { Stack: { Screen: () => null } },
    'expo-status-bar': { StatusBar: () => null },
    './alive-scenes': { OnboardingAtmosphere: () => React.createElement('i', null, 'atmosphere'), WafraTile: () => null },
    '@/components/themed-text': { ThemedText: host },
    '@/components/ui/action-icon-button': { ActionIconButton: host },
    '@/components/ui/controls': { Button: host },
    '@/components/ui/screen-header': { ScreenHeader: host },
    '@/constants/theme': theme, '@/hooks/use-theme': themeApi,
    '@/lib/i18n': { hasArabicScript: () => false },
  });
  function Probe({ id }) {
    const colors = themeApi.useTheme();
    return React.createElement('span', { id, 'data-text': colors.text, 'data-border': colors.controlBorder });
  }
  return renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(SetupShell, { onboarding }, React.createElement(Probe, { id: 'inside' })),
    React.createElement(Probe, { id: 'outside' })));
}

test('first-run descendants use dark onboarding palette while the saved light preference stays outside', () => {
  const result = render(true);
  assert.ok(result.includes(`id="inside" data-text="${theme.Colors.dark.text}"`));
  assert.ok(result.includes(`id="outside" data-text="${theme.Colors.light.text}"`));
  assert.ok(result.includes('onboarding-setup-shell'));
  assert.ok(result.includes('atmosphere'));
});
test('Settings setup inherits both light and dark preferences and has no onboarding atmosphere', () => {
  for (const saved of ['light', 'dark']) {
    const result = render(false, saved);
    assert.ok(result.includes(`id="inside" data-text="${theme.Colors[saved].text}"`));
    assert.ok(result.includes('settings-setup-shell'));
    assert.ok(!result.includes('atmosphere'));
  }
});
test('scoped onboarding still honors increased contrast', () => {
  const result = render(true, 'light', true);
  assert.ok(result.includes(`id="inside" data-text="${theme.Colors.dark.text}" data-border="${theme.Colors.dark.controlBorderHigh}"`));
  assert.ok(result.includes(`id="outside" data-text="${theme.Colors.light.text}" data-border="${theme.Colors.light.controlBorderHigh}"`));
});
