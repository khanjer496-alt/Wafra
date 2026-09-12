#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const APP_TEAM_ID = "UV7YN4GQ66";
const APP_BUNDLE_ID = "app.wafra.ios";
const SETUP_INTENT = "RecordWafraCaptureSetupProofIntent";
const STAGE_INTENT = "StageWafraLiveMessageIntent";
const STAGE_TEXT_INTENT = "StageWafraLiveTextIntent";
const FIND_MESSAGES = "com.apple.MobileSMS.MessageEntity";
export const IOS_LOCAL_CAPTURE_CATCHUP_LIMIT = 300;
export const IOS_LOCAL_CAPTURE_SETUP_CHECK_MARKER = "WAFRA_SETUP_CHECK_V1";

const ids = {
  noInputGroup: "C335E95B-5E0C-4455-A135-C598E297ECAE",
  setupProof: "6D39ED50-25D8-497F-B651-290645878561",
  catchupFind: "A8C4A13F-48E0-4B90-A8EE-65016E9C6E89",
  catchupRepeatGroup: "056DB282-A0ED-4DA6-A2A1-E4CB49A7305D",
  catchupSenderText: "5528A51D-6031-45C7-B148-14953531EED9",
  catchupMessageBody: "6FE51E1C-F71A-4531-B294-8775349DE462",
  catchupMessageGuid: "12CD25AD-05B1-4DBB-8560-10BC61BDE514",
  catchupGuidHash: "868CF71D-A8A4-49A9-872A-A5F7A9B7FCFB",
  catchupLowercaseHash: "04992CD4-87A9-470D-A340-D180E4528F77",
  catchupStage: "6808B616-C034-46D6-A2CE-927BD68D764E",
  senderText: "1233D840-DCE7-4FFD-9415-20736825C74F",
  messageBody: "DE001532-690F-465F-982A-DB5C8A6B560A",
  messageGuid: "633B29C7-23F7-4124-982E-C88E40A9D53E",
  guidHash: "C3BF02F3-896A-446C-91F7-3E005311B28F",
  lowercaseHash: "300400CB-8AE3-4F65-8CD2-7F9BB6D12465",
  stage: "7B9A112F-0C18-4D95-BFC5-C373523C16B6",
  inputType: "B9C299ED-2437-40C7-A839-194976CC7282",
  inputTypeGroup: "42D178D1-49EA-4BEF-9CE4-58FC30D00B37",
  fallbackText: "6C7FA999-6A5A-4CC0-886A-3BAE9A9ACBD1",
  fallbackStage: "3979D819-B1FA-49CB-B44C-768CD2ADDC84",
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

const variableValue = (variableName, aggrandizements = []) => ({
  Type: "Variable",
  VariableName: variableName,
  ...(aggrandizements.length > 0 ? { Aggrandizements: aggrandizements } : {}),
});

const variable = (variableName, aggrandizements = []) => ({
  Value: variableValue(variableName, aggrandizements),
  WFSerializationType: "WFTextTokenAttachment",
});

const variableTextToken = (variableName, aggrandizements = []) =>
  textToken("\ufffc", {
    "{0, 1}": variableValue(variableName, aggrandizements),
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

const variableTextAction = (uuid, customOutputName, variableName, propertyName) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.gettext",
  WFWorkflowActionParameters: {
    UUID: uuid,
    CustomOutputName: customOutputName,
    WFTextActionText: variableTextToken(variableName, [
      property(propertyName),
      stringCoercion(),
    ]),
  },
});

const hashAction = (uuid, inputUUID, inputName) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.hash",
  WFWorkflowActionParameters: {
    UUID: uuid,
    WFInput: actionOutput(inputUUID, inputName),
    WFHashType: "SHA256",
  },
});

const lowercaseAction = (uuid, hashUUID) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.text.changecase",
  WFWorkflowActionParameters: {
    UUID: uuid,
    CustomOutputName: "Lowercase Message ID",
    WFCaseType: "lowercase",
    text: outputTextToken(hashUUID, "Hash"),
  },
});

const stageAction = ({ uuid, senderUUID, bodyUUID, eventIdUUID, observedAt }) => ({
  WFWorkflowActionIdentifier: `${APP_BUNDLE_ID}.${STAGE_INTENT}`,
  WFWorkflowActionParameters: {
    UUID: uuid,
    AppIntentDescriptor: appIntentDescriptor(STAGE_INTENT),
    sender: outputTextToken(senderUUID, "Sender Text"),
    body: outputTextToken(bodyUUID, "Message Body"),
    eventId: outputTextToken(eventIdUUID, "Lowercase Message ID"),
    observedAt,
  },
});

const stageTextAction = (uuid, bodyUUID) => ({
  WFWorkflowActionIdentifier: `${APP_BUNDLE_ID}.${STAGE_TEXT_INTENT}`,
  WFWorkflowActionParameters: {
    UUID: uuid,
    AppIntentDescriptor: appIntentDescriptor(STAGE_TEXT_INTENT),
    body: outputTextToken(bodyUUID, "Fallback Message Text"),
  },
});

const stopAction = () => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.exit",
  WFWorkflowActionParameters: {},
});

// The app sends this nonfinancial control text only for a verified new graph.
// Empty input still reaches catch-up; Message entities and ordinary text retain
// their existing capture path. Presence is checked before asking for input type.
const setupCheckActions = () => {
  const uuid = (number) => `C17E0000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const endIf = (number, group) => ({
    WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
    WFWorkflowActionParameters: { UUID: uuid(number), GroupingIdentifier: uuid(group), WFControlFlowMode: 2 },
  });
  return [
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
      WFWorkflowActionParameters: {
        UUID: uuid(1), GroupingIdentifier: uuid(101), WFControlFlowMode: 0,
        WFCondition: 100, WFInput: { Type: "Variable", Variable: extensionInput() },
      },
    },
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.getitemtype",
      WFWorkflowActionParameters: { UUID: uuid(2), WFInput: extensionInput() },
    },
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
      WFWorkflowActionParameters: {
        UUID: uuid(3), GroupingIdentifier: uuid(102), WFControlFlowMode: 0,
        WFCondition: 4, WFConditionalActionString: "Text",
        WFInput: { Type: "Variable", Variable: actionOutput(uuid(2), "Type") },
      },
    },
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
      WFWorkflowActionParameters: {
        UUID: uuid(4), GroupingIdentifier: uuid(103), WFControlFlowMode: 0,
        WFCondition: 4, WFConditionalActionString: IOS_LOCAL_CAPTURE_SETUP_CHECK_MARKER,
        WFInput: { Type: "Variable", Variable: extensionInput() },
      },
    },
    {
      WFWorkflowActionIdentifier: `${APP_BUNDLE_ID}.${SETUP_INTENT}`,
      WFWorkflowActionParameters: { UUID: uuid(5), AppIntentDescriptor: appIntentDescriptor(SETUP_INTENT) },
    },
    { ...stopAction(), WFWorkflowActionParameters: { UUID: uuid(6) } },
    endIf(7, 103),
    endIf(8, 102),
    endIf(9, 101),
  ];
};

const createLocalCaptureShortcut = () => {
  const actions = [
    ...setupCheckActions(),
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
    // A no-input run is also Wafra's recovery lane. It intentionally rereads a
    // bounded overlap of the newest retained Messages rather than trusting that
    // every personal Message automation fired. StageWafraLiveMessageIntent uses
    // SHA-256(Message.GUID), so rows already captured live are idempotent and
    // anything genuinely missed is queued through the exact same parser path.
    {
      WFWorkflowActionIdentifier: FIND_MESSAGES,
      WFWorkflowActionParameters: {
        UUID: ids.catchupFind,
        AppIntentDescriptor: {
          TeamIdentifier: "0000000000",
          BundleIdentifier: "com.apple.MobileSMS",
          Name: "Messages",
          AppIntentIdentifier: "MessageEntity",
          ActionRequiresAppInstallation: true,
        },
        WFContentItemFilter: {
          WFSerializationType: "WFContentPredicateTableTemplate",
          Value: {
            WFActionParameterFilterPrefix: 1,
            WFContentPredicateBoundedDate: false,
            WFActionParameterFilterTemplates: [],
          },
        },
        WFContentItemSortProperty: "date",
        WFContentItemSortOrder: "Latest First",
        WFContentItemLimitEnabled: true,
        WFContentItemLimitNumber: IOS_LOCAL_CAPTURE_CATCHUP_LIMIT,
      },
    },
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.repeat.each",
      WFWorkflowActionParameters: {
        UUID: ids.catchupRepeatGroup,
        GroupingIdentifier: ids.catchupRepeatGroup,
        WFControlFlowMode: 0,
        WFInput: actionOutput(ids.catchupFind, "Message"),
      },
    },
    variableTextAction(ids.catchupSenderText, "Sender Text", "Repeat Item", "Sender"),
    variableTextAction(ids.catchupMessageBody, "Message Body", "Repeat Item", "Content"),
    variableTextAction(ids.catchupMessageGuid, "Message GUID", "Repeat Item", "GUID"),
    hashAction(ids.catchupGuidHash, ids.catchupMessageGuid, "Message GUID"),
    lowercaseAction(ids.catchupLowercaseHash, ids.catchupGuidHash),
    stageAction({
      uuid: ids.catchupStage,
      senderUUID: ids.catchupSenderText,
      bodyUUID: ids.catchupMessageBody,
      eventIdUUID: ids.catchupLowercaseHash,
      observedAt: variableTextToken("Repeat Item", [property("date")]),
    }),
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.repeat.each",
      WFWorkflowActionParameters: {
        GroupingIdentifier: ids.catchupRepeatGroup,
        WFControlFlowMode: 2,
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
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.getitemtype",
      WFWorkflowActionParameters: {
        UUID: ids.inputType,
        WFInput: extensionInput(),
      },
    },
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
      WFWorkflowActionParameters: {
        GroupingIdentifier: ids.inputTypeGroup,
        WFControlFlowMode: 0,
        WFCondition: 4,
        WFConditionalActionString: "Text",
        WFInput: actionOutput(ids.inputType, "Type"),
      },
    },
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.gettext",
      WFWorkflowActionParameters: {
        UUID: ids.fallbackText,
        CustomOutputName: "Fallback Message Text",
        WFTextActionText: extensionInputTextToken([stringCoercion()]),
      },
    },
    stageTextAction(ids.fallbackStage, ids.fallbackText),
    stopAction(),
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
      WFWorkflowActionParameters: {
        GroupingIdentifier: ids.inputTypeGroup,
        WFControlFlowMode: 2,
      },
    },
    textAction(ids.senderText, "Sender Text", "Sender"),
    textAction(ids.messageBody, "Message Body", "Content"),
    textAction(ids.messageGuid, "Message GUID", "GUID"),
    hashAction(ids.guidHash, ids.messageGuid, "Message GUID"),
    lowercaseAction(ids.lowercaseHash, ids.guidHash),
    stageAction({
      uuid: ids.stage,
      senderUUID: ids.senderText,
      bodyUUID: ids.messageBody,
      eventIdUUID: ids.lowercaseHash,
      observedAt: extensionInputTextToken([property("date")]),
    }),
    stopAction(),
  ];

  return {
    WFWorkflowName: "Wafra Capture v2",
    WFWorkflowMinimumClientVersionString: "1106",
    WFWorkflowMinimumClientVersion: 1106,
    WFWorkflowIcon: {
      WFWorkflowIconStartColor: -314141441,
      WFWorkflowIconGlyphNumber: 61440,
    },
    WFWorkflowClientVersion: "4042.0.2.2",
    WFWorkflowHasOutputFallback: false,
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowInputContentItemClasses: [
      "WFStringContentItem",
      "WFMessageContentItem",
    ],
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
