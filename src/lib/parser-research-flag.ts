/**
 * Build marker for the internal parser-research tools (the full-inbox scan in
 * parser-research-source.ts and the research upload in feedback-transport.ts).
 * Expo inlines the EXPO_PUBLIC_* value and Metro's release constant folding
 * keeps exactly one string, which build-apk.yml reads back from a Play bundle
 * and fails on "=on" (scripts/android-build-flags.cjs). Both gates are derived
 * from it. No imports, so any module can use it.
 */
export const PARSER_RESEARCH_BUILD_FLAG =
  process.env.EXPO_PUBLIC_WAFRA_PARSER_RESEARCH === '1'
    ? 'wafra-build-flag:parser-research=on'
    : 'wafra-build-flag:parser-research=off';
