#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const IOS_NOTIFICATION_SHORTCUT_NAME = 'Wafra Notifications v1';
export const IOS_NOTIFICATION_SETUP_CHECK_MARKER = 'Wafra notification setup check';

const NATIVE_ACTION = 'app.wafra.ios.CaptureWafraNotificationIntent';
const descriptor = () => ({
  TeamIdentifier: 'UV7YN4GQ66',
  BundleIdentifier: 'app.wafra.ios',
  Name: 'Wafra',
  AppIntentIdentifier: 'CaptureWafraNotificationIntent',
});

const ids = {
  noInputGroup: 'A8707847-CFC5-4A62-88F7-33CBE91DE711',
  noInput: '3A5910D7-F399-4BDB-97C3-9C948B741801',
  setup: 'DFE12275-59F3-4C64-A426-985685C45102',
  setupStop: '21F1F027-EA99-4E56-A54D-305966146403',
  noInputEnd: '16BC7CA0-31F9-4120-BFB5-3BFDA3A03F04',
  text: '3ECEB5FB-E5C1-4AEC-B218-AE4A0797CF05',
  capture: '703BB3E1-A941-4E25-A7A3-E07C1867CE06',
  captureStop: '235BD2B5-8148-4336-8DB6-9F294CB9B507',
};

const textToken = (string, attachmentsByRange) => ({
  Value: { string, ...(attachmentsByRange ? { attachmentsByRange } : {}) },
  WFSerializationType: 'WFTextTokenString',
});

const action = (identifier, parameters) => ({
  WFWorkflowActionIdentifier: identifier,
  WFWorkflowActionParameters: parameters,
});

const captureAction = (uuid, text) => action(NATIVE_ACTION, {
  UUID: uuid,
  AppIntentDescriptor: descriptor(),
  text,
});

// A prebound candidate, not an exported iOS 27 personal automation. The user
// must select the bank app/trigger on their phone. No Notification property or
// trusted sender mapping is assumed. Apple's real Notification-to-Text behavior
// still needs physical iOS 27 qualification; synthetic graph tests cannot prove it.
const createNotificationShortcut = () => ({
  WFWorkflowName: IOS_NOTIFICATION_SHORTCUT_NAME,
  // These are known Shortcuts serialization versions from our existing builder,
  // NOT iOS release numbers or a claim of iOS 27 compatibility.
  WFWorkflowMinimumClientVersionString: '1106',
  WFWorkflowMinimumClientVersion: 1106,
  WFWorkflowIcon: {
    WFWorkflowIconStartColor: -314141441,
    WFWorkflowIconGlyphNumber: 61440,
  },
  WFWorkflowClientVersion: '4042.0.2.2',
  WFWorkflowHasOutputFallback: false,
  WFWorkflowOutputContentItemClasses: [],
  WFWorkflowInputContentItemClasses: ['WFStringContentItem'],
  WFWorkflowImportQuestions: [],
  WFWorkflowTypes: ['WFWorkflowTypeShowInSearch'],
  WFQuickActionSurfaces: [],
  WFWorkflowHasShortcutInputVariables: true,
  WFWorkflowActions: [
    action('is.workflow.actions.conditional', {
      UUID: ids.noInput,
      GroupingIdentifier: ids.noInputGroup,
      WFControlFlowMode: 0,
      WFCondition: 101,
      WFInput: {
        Type: 'Variable',
        Variable: {
          Value: { Type: 'ExtensionInput' },
          WFSerializationType: 'WFTextTokenAttachment',
        },
      },
    }),
    // The receiver recognizes this exact benign marker as setup proof only.
    // A manual no-input run must stop here, with no inbox/history catch-up.
    captureAction(ids.setup, textToken(IOS_NOTIFICATION_SETUP_CHECK_MARKER)),
    action('is.workflow.actions.exit', { UUID: ids.setupStop }),
    action('is.workflow.actions.conditional', {
      UUID: ids.noInputEnd,
      GroupingIdentifier: ids.noInputGroup,
      WFControlFlowMode: 2,
    }),
    action('is.workflow.actions.gettext', {
      UUID: ids.text,
      CustomOutputName: 'Notification Text',
      WFTextActionText: textToken('\ufffc', {
        '{0, 1}': {
          Type: 'ExtensionInput',
          Aggrandizements: [{
            Type: 'WFCoercionVariableAggrandizement',
            CoercionItemClass: 'WFStringContentItem',
          }],
        },
      }),
    }),
    captureAction(ids.capture, textToken('\ufffc', {
      '{0, 1}': {
        Type: 'ActionOutput',
        OutputUUID: ids.text,
        OutputName: 'Notification Text',
      },
    })),
    action('is.workflow.actions.exit', { UUID: ids.captureStop }),
  ],
});

const allowedActions = new Set([
  'is.workflow.actions.conditional',
  'is.workflow.actions.exit',
  'is.workflow.actions.gettext',
  NATIVE_ACTION,
]);

// Verify all metadata, control flow, UUIDs, parameters and token attachments.
// Checking only action names would miss a changed target, literal text, an
// unresolved output, or an unsafe action hidden behind Stop.
export const verifyNotificationShortcutGraph = candidate => {
  const fail = detail => {
    throw new Error(`artifact is not the exact Wafra Notifications v1 graph: ${detail}`);
  };
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail('root is not an object');
  }
  if (!Array.isArray(candidate.WFWorkflowActions)) fail('WFWorkflowActions is missing');
  for (const item of candidate.WFWorkflowActions) {
    if (!allowedActions.has(item?.WFWorkflowActionIdentifier)) {
      fail('unapproved or malformed action');
    }
  }
  if (!isDeepStrictEqual(candidate, createNotificationShortcut())) {
    fail('metadata, semantic graph or dataflow changed');
  }
  return true;
};

export const buildNotificationShortcut = () => {
  const shortcut = createNotificationShortcut();
  verifyNotificationShortcutGraph(shortcut);
  return shortcut;
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const outputPath = resolve(process.argv[2] ?? 'WafraNotifications.json');
  await writeFile(outputPath, `${JSON.stringify(buildNotificationShortcut(), null, 2)}\n`, 'utf8');
  console.log(outputPath);
}
