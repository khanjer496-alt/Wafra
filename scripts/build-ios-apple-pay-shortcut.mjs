#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const IOS_APPLE_PAY_SHORTCUT_NAME = 'Wafra Apple Pay v1';
const SETUP_INTENT = 'RecordWafraApplePaySetupProofIntent';
const CAPTURE_INTENT = 'CaptureWafraApplePayIntent';
const BUNDLE = 'app.wafra.ios';
const uuid = n => `A9910000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const action = (identifier, parameters) => ({
  WFWorkflowActionIdentifier: identifier,
  WFWorkflowActionParameters: parameters,
});
const native = (name, number, parameters = {}) => action(`${BUNDLE}.${name}`, {
  UUID: uuid(number),
  AppIntentDescriptor: {
    TeamIdentifier: 'UV7YN4GQ66', BundleIdentifier: BUNDLE, Name: 'Wafra', AppIntentIdentifier: name,
  },
  ...parameters,
});

// Property names and the coercion class are serialized by Apple's own
// WorkflowKit/ContentKit schema. A scalar magic-variable token binds the
// property value into the AppIntent's typed parameter; it is not a Text action.
// In particular, Amount remains an INCurrencyAmount for IntentCurrencyAmount,
// with no string formatting, numeric conversion or separately guessed currency.
const transactionProperty = name => ({
  Value: {
    string: '\ufffc',
    attachmentsByRange: {
      '{0, 1}': {
        Type: 'ExtensionInput',
        Aggrandizements: [
          { Type: 'WFCoercionVariableAggrandizement', CoercionItemClass: 'WFWalletTransactionContentItem' },
          { Type: 'WFPropertyVariableAggrandizement', PropertyName: name },
        ],
      },
    },
  },
  WFSerializationType: 'WFTextTokenString',
});

// An unpublished Shortcut candidate, not a personal-automation export. The
// owner must select Apple's Transaction -> When I tap trigger and their cards.
// This covers neither historical Wallet data nor arbitrary Wallet notices.
// The input class/schema was inspected on macOS 26.1; a real iPhone Transaction
// retaining its object across Run Shortcut still needs device qualification.
// If that handoff loses the type, configure the native capture AppIntent
// directly in the automation with its Amount and Merchant magic variables.
const createApplePayShortcut = () => ({
  WFWorkflowName: IOS_APPLE_PAY_SHORTCUT_NAME,
  // Shortcuts serialization versions, not minimum iOS version declarations.
  WFWorkflowMinimumClientVersionString: '1106',
  WFWorkflowMinimumClientVersion: 1106,
  WFWorkflowClientVersion: '4042.0.2.2',
  WFWorkflowIcon: { WFWorkflowIconStartColor: -314141441, WFWorkflowIconGlyphNumber: 61440 },
  WFWorkflowHasOutputFallback: false,
  WFWorkflowOutputContentItemClasses: [],
  WFWorkflowInputContentItemClasses: ['WFWalletTransactionContentItem'],
  WFWorkflowImportQuestions: [],
  WFWorkflowTypes: ['WFWorkflowTypeShowInSearch'],
  WFQuickActionSurfaces: [],
  WFWorkflowHasShortcutInputVariables: true,
  WFWorkflowActions: [
    action('is.workflow.actions.conditional', {
      UUID: uuid(1), GroupingIdentifier: uuid(100), WFControlFlowMode: 0, WFCondition: 101,
      WFInput: { Type: 'Variable', Variable: {
        Value: { Type: 'ExtensionInput' }, WFSerializationType: 'WFTextTokenAttachment',
      } },
    }),
    // No-input setup has its own zero-parameter intent. It cannot create money
    // or query Wallet; a missing field on a real object remains the native
    // receiver's validation responsibility and is never replaced with zero.
    native(SETUP_INTENT, 2),
    action('is.workflow.actions.exit', { UUID: uuid(3) }),
    action('is.workflow.actions.conditional', {
      UUID: uuid(4), GroupingIdentifier: uuid(100), WFControlFlowMode: 2,
    }),
    native(CAPTURE_INTENT, 5, {
      amount: transactionProperty('Amount'),
      merchant: transactionProperty('Merchant'),
    }),
    action('is.workflow.actions.exit', { UUID: uuid(6) }),
  ],
});

const allowedActions = new Set([
  'is.workflow.actions.conditional', 'is.workflow.actions.exit',
  `${BUNDLE}.${SETUP_INTENT}`, `${BUNDLE}.${CAPTURE_INTENT}`,
]);

export function verifyApplePayShortcutGraph(candidate) {
  const fail = detail => { throw new Error(`artifact is not the exact Wafra Apple Pay v1 graph: ${detail}`); };
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) fail('root is not an object');
  if (!Array.isArray(candidate.WFWorkflowActions)) fail('WFWorkflowActions is missing');
  for (const item of candidate.WFWorkflowActions) {
    if (!allowedActions.has(item?.WFWorkflowActionIdentifier)) fail('unapproved or malformed action');
  }
  if (!isDeepStrictEqual(candidate, createApplePayShortcut())) fail('metadata, semantic graph or dataflow changed');
  return true;
}

export function buildApplePayShortcut() {
  const graph = createApplePayShortcut();
  verifyApplePayShortcutGraph(graph);
  return graph;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outputPath = resolve(process.argv[2] ?? 'WafraApplePay.json');
  await writeFile(outputPath, `${JSON.stringify(buildApplePayShortcut(), null, 2)}\n`, 'utf8');
  console.log(outputPath);
}
