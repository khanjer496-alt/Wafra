#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const APP_TEAM_ID = "UV7YN4GQ66";
const APP_BUNDLE_ID = "app.wafra.ios";
const SETUP_INTENT = "RecordWafraCaptureSetupProofIntent";
const STAGE_INTENT = "StageWafraLiveMessageIntent";

const ids = {
  noInputGroup: "C335E95B-5E0C-4455-A135-C598E297ECAE",
  setupProof: "6D39ED50-25D8-497F-B651-290645878561",
  senderText: "1233D840-DCE7-4FFD-9415-20736825C74F",
  messageBody: "DE001532-690F-465F-982A-DB5C8A6B560A",
  messageGuid: "633B29C7-23F7-4124-982E-C88E40A9D53E",
  guidHash: "C3BF02F3-896A-446C-91F7-3E005311B28F",
  lowercaseHash: "300400CB-8AE3-4F65-8CD2-7F9BB6D12465",
  stage: "7B9A112F-0C18-4D95-BFC5-C373523C16B6",
};

const actionOutputValue = (outputUUID, outputName) => ({
  Type: "ActionOutput",
  OutputUUID: outputUUID,
  OutputName: outputName,
});

const actionOutput = (outputUUID, outputName) => ({
  Value: actionOutputValue(outputUUID, outputName),
  WFSerializationType: "WFTextTokenAttachment",
});

const textToken = (string, attachmentsByRange = undefined) => ({
  Value: {
    string,
    ...(attachmentsByRange ? { attachmentsByRange } : {}),
  },
  WFSerializationType: "WFTextTokenString",
});

const outputTextToken = (outputUUID, outputName) =>
  textToken("\ufffc", {
    "{0, 1}": actionOutputValue(outputUUID, outputName),
  });

const extensionInputValue = (aggrandizements = []) => ({
  Type: "ExtensionInput",
  ...(aggrandizements.length > 0 ? { Aggrandizements: aggrandizements } : {}),
});

const extensionInput = (aggrandizements = []) => ({
  Value: extensionInputValue(aggrandizements),
  WFSerializationType: "WFTextTokenAttachment",
});

const extensionInputTextToken = (aggrandizements) =>
  textToken("\ufffc", {
    "{0, 1}": extensionInputValue(aggrandizements),
  });

const property = (propertyName) => ({
  Type: "WFPropertyVariableAggrandizement",
  PropertyName: propertyName,
});

const stringCoercion = () => ({
  Type: "WFCoercionVariableAggrandizement",
  CoercionItemClass: "WFStringContentItem",
});

const appIntentDescriptor = (intent) => ({
  TeamIdentifier: APP_TEAM_ID,
  BundleIdentifier: APP_BUNDLE_ID,
  Name: "Wafra",
  AppIntentIdentifier: intent,
});

const textAction = (uuid, customOutputName, propertyName) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.gettext",
  WFWorkflowActionParameters: {
    UUID: uuid,
    CustomOutputName: customOutputName,
    WFTextActionText: extensionInputTextToken([
      property(propertyName),
      stringCoercion(),
    ]),
  },
});

const stopAction = () => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.exit",
  WFWorkflowActionParameters: {},
});

const createLocalCaptureShortcut = () => {
  const actions = [
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
      WFWorkflowActionParameters: {
        GroupingIdentifier: ids.noInputGroup,
        WFControlFlowMode: 0,
        WFCondition: 101,
        WFInput: {
          Type: "Variable",
          Variable: extensionInput(),
        },
      },
    },
    {
      WFWorkflowActionIdentifier: `${APP_BUNDLE_ID}.${SETUP_INTENT}`,
      WFWorkflowActionParameters: {
        UUID: ids.setupProof,
        AppIntentDescriptor: appIntentDescriptor(SETUP_INTENT),
      },
    },
    stopAction(),
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
      WFWorkflowActionParameters: {
        GroupingIdentifier: ids.noInputGroup,
        WFControlFlowMode: 2,
      },
    },
    textAction(ids.senderText, "Sender Text", "Sender"),
    textAction(ids.messageBody, "Message Body", "Content"),
    textAction(ids.messageGuid, "Message GUID", "GUID"),
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.hash",
      WFWorkflowActionParameters: {
        UUID: ids.guidHash,
        WFInput: actionOutput(ids.messageGuid, "Message GUID"),
        WFHashType: "SHA256",
      },
    },
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.text.changecase",
      WFWorkflowActionParameters: {
        UUID: ids.lowercaseHash,
        CustomOutputName: "Lowercase Message ID",
        WFCaseType: "lowercase",
        text: outputTextToken(ids.guidHash, "Hash"),
      },
    },
    {
      WFWorkflowActionIdentifier: `${APP_BUNDLE_ID}.${STAGE_INTENT}`,
      WFWorkflowActionParameters: {
        UUID: ids.stage,
        AppIntentDescriptor: appIntentDescriptor(STAGE_INTENT),
        sender: outputTextToken(ids.senderText, "Sender Text"),
        body: outputTextToken(ids.messageBody, "Message Body"),
        eventId: outputTextToken(ids.lowercaseHash, "Lowercase Message ID"),
        observedAt: extensionInputTextToken([property("date")]),
      },
    },
    stopAction(),
  ];

  return {
    WFWorkflowName: "Wafra Local Capture",
    WFWorkflowMinimumClientVersionString: "1106",
    WFWorkflowMinimumClientVersion: 1106,
    WFWorkflowIcon: {
      WFWorkflowIconStartColor: -314141441,
      WFWorkflowIconGlyphNumber: 61440,
    },
    WFWorkflowClientVersion: "4042.0.2.2",
    WFWorkflowHasOutputFallback: false,
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowInputContentItemClasses: ["WFMessageContentItem"],
    WFWorkflowImportQuestions: [],
    WFWorkflowTypes: ["WFWorkflowTypeShowInSearch"],
    WFQuickActionSurfaces: [],
    WFWorkflowHasShortcutInputVariables: true,
    WFWorkflowActions: actions,
  };
};

const containsNull = (value) =>
  value === null ||
  (Array.isArray(value)
    ? value.some(containsNull)
    : typeof value === "object" && value !== null
      ? Object.values(value).some(containsNull)
      : false);

export const verifyLocalCaptureShortcutGraph = (candidate) => {
  const fail = (detail) => {
    throw new Error(`artifact is not the exact Wafra Local Capture graph: ${detail}`);
  };
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    fail("root is not an object");
  }
  if (containsNull(candidate)) fail("Apple property lists cannot encode null");

  const actions = candidate.WFWorkflowActions;
  if (!Array.isArray(actions)) fail("WFWorkflowActions is missing");
  const forbiddenIdentifier = actions.find((action) =>
    [
      /downloadurl|openurl|url\.getcontents/i,
      /(?:^|\.)(?:file|folder)(?:\.|$)|(?:get|save|move|create|delete|append)file/i,
      /clipboard/i,
      /notification|showresult|quicklook|speak|alert|log|print/i,
      /runworkflow/i,
    ].some((pattern) => pattern.test(action?.WFWorkflowActionIdentifier ?? "")),
  );
  if (forbiddenIdentifier) {
    fail(`forbidden action ${forbiddenIdentifier.WFWorkflowActionIdentifier}`);
  }
  const serialized = JSON.stringify(candidate);
  if (/https?:\/\/|Bearer\s|Authorization/i.test(serialized)) {
    fail("network endpoint or credential literal is present");
  }
  if (!isDeepStrictEqual(candidate, createLocalCaptureShortcut())) {
    fail("semantic graph or dataflow changed");
  }
  return true;
};

export const buildLocalCaptureShortcut = () => {
  const shortcut = createLocalCaptureShortcut();
  verifyLocalCaptureShortcutGraph(shortcut);
  return shortcut;
};

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const outputPath = resolve(process.argv[2] ?? "WafraLocalCapture.json");
  const shortcut = buildLocalCaptureShortcut();
  await writeFile(outputPath, `${JSON.stringify(shortcut, null, 2)}\n`, "utf8");
  console.log(outputPath);
}
