#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputPath = resolve(process.argv[2] ?? "WafraCapture.json");

const uuids = {
  setupText: "2B6784B8-1C4D-4F1B-A3E9-88B0D0BF0121",
  setupDictionary: "9445E194-BFE5-4BE0-AD79-A34A74B9D6E5",
  version: "04B76D8B-C453-4407-96DA-2BB6EA10F5CA",
  url: "3FB9D81E-54AC-444C-9E7D-E06F70F4F147",
  token: "CB34670A-E45C-4CC0-AE49-74480CB050A7",
  versionText: "AF83A243-A7EA-49E8-BDC2-E073C49D3143",
  urlText: "47A25FF6-96C7-4C71-84EF-CC534FE36B14",
  invalidVersionGroup: "3B88D385-A834-47F9-B74A-339BB0E47326",
  invalidSchemeGroup: "8809B3C7-A292-4946-A705-52B06C9028F5",
  invalidPathGroup: "CF292A10-1277-429F-BEE7-E99AE2DE6B34",
  invalidTokenGroup: "4E420E7B-B0F9-43B2-85FC-C7FD84333780",
  missingInputGroup: "AF2EDC3A-16C7-4E72-80C9-6A53B2EA2D78",
  randomA: "990FE4DB-BF39-46CD-919D-120050D9A2BA",
  randomB: "8CD0EEDC-008E-4B02-B324-D647C1A9906A",
  uuidSeed: "D7F63580-298C-47DC-927E-8FA49A92DA41",
  uuidHash: "B2F0B764-154B-4DAE-A527-54E3B2C979F6",
  eventId: "E0F97C1D-13CE-45BF-8B20-892FB97C9A52",
  inputType: "C77D548B-49D1-45A4-B9E2-D7B71D8C01E6",
  inputTypeGroup: "A6123DB8-24C1-42A5-BC49-C87A02BF7162",
  manualText: "8AF3EFBC-B05F-4F0C-94B2-31691A1F61B5",
  manualEmptyGroup: "1F3DECB0-2374-4329-BDEB-1B95B4336274",
  manualRequest: "9FBE0C71-D537-4D0A-B6F0-9FB9BA2C4306",
  messageText: "DFC36902-E4D8-48D8-8219-C80846C6D585",
  senderText: "7305B385-1A7A-4B99-AF2E-4FFBEE113C23",
  messageEmptyGroup: "32B55F7B-A279-40B0-A50F-79E8C7E2C038",
  messageRequest: "516950DD-481B-4690-B1B2-6661FD4E7C38",
};

const actionOutputValue = (outputUUID, outputName) => ({
  OutputUUID: outputUUID,
  Type: "ActionOutput",
  OutputName: outputName,
});

const actionOutput = (outputUUID, outputName) => ({
  Value: actionOutputValue(outputUUID, outputName),
  WFSerializationType: "WFTextTokenAttachment",
});

const extensionInputValue = (aggrandizements = []) => ({
  Type: "ExtensionInput",
  ...(aggrandizements.length > 0 ? { Aggrandizements: aggrandizements } : {}),
});

const extensionInput = (aggrandizements = []) => ({
  Value: extensionInputValue(aggrandizements),
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

const extensionInputTextToken = (aggrandizements = []) =>
  textToken("\ufffc", {
    "{0, 1}": extensionInputValue(aggrandizements),
  });

const dictionaryItem = (key, value) => ({
  WFKey: textToken(key),
  WFItemType: 0,
  WFValue: typeof value === "string" ? textToken(value) : value,
});

const variableInput = (variable) => ({ Type: "Variable", Variable: variable });

const conditionalStart = (group, input, condition, comparison = {}) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
  WFWorkflowActionParameters: {
    WFInput: variableInput(input),
    WFControlFlowMode: 0,
    GroupingIdentifier: group,
    WFCondition: condition,
    ...comparison,
  },
});

const conditionalMarker = (group, mode) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
  WFWorkflowActionParameters: {
    GroupingIdentifier: group,
    WFControlFlowMode: mode,
  },
});

const stopAction = () => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.exit",
  WFWorkflowActionParameters: {},
});

const notificationAction = (body) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.notification",
  WFWorkflowActionParameters: { WFNotificationActionBody: body },
});

const invalidSetupGuard = (group, input, condition, comparison = {}) => [
  conditionalStart(group, input, condition, comparison),
  notificationAction("Open Wafra and copy a new setup code"),
  stopAction(),
  conditionalMarker(group, 2),
];

const requiredSetupGuard = (group, input, condition, comparison) => [
  conditionalStart(group, input, condition, comparison),
  conditionalMarker(group, 1),
  notificationAction("Open Wafra and copy a new setup code"),
  stopAction(),
  conditionalMarker(group, 2),
];

const emptyTextGuard = (group, textUUID, outputName) => [
  conditionalStart(group, actionOutput(textUUID, outputName), 101),
  stopAction(),
  conditionalMarker(group, 2),
];

const propertyAggrandizement = (propertyName) => ({
  Type: "WFPropertyVariableAggrandizement",
  PropertyName: propertyName,
});

const textCoercion = {
  Type: "WFCoercionVariableAggrandizement",
  CoercionItemClass: "WFStringContentItem",
};

const textAction = (uuid, customOutputName, token) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.gettext",
  WFWorkflowActionParameters: {
    UUID: uuid,
    CustomOutputName: customOutputName,
    WFTextActionText: token,
  },
});

const requestAction = (uuid, bodyItems) => ({
  WFWorkflowActionIdentifier: "is.workflow.actions.downloadurl",
  WFWorkflowActionParameters: {
    WFHTTPHeaders: {
      Value: {
        WFDictionaryFieldValueItems: [
          dictionaryItem(
            "Authorization",
            textToken("Bearer \ufffc", {
              "{7, 1}": actionOutputValue(uuids.token, "Token"),
            }),
          ),
          dictionaryItem("Content-Type", "application/json"),
        ],
      },
      WFSerializationType: "WFDictionaryFieldValue",
    },
    ShowHeaders: true,
    UUID: uuid,
    WFURL: outputTextToken(uuids.urlText, "URL Text"),
    WFJSONValues: {
      Value: { WFDictionaryFieldValueItems: bodyItems },
      WFSerializationType: "WFDictionaryFieldValue",
    },
    WFHTTPMethod: "POST",
  },
});

const actions = [
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.gettext",
    WFWorkflowActionParameters: {
      UUID: uuids.setupText,
      WFTextActionText: "",
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.detect.dictionary",
    WFWorkflowActionParameters: {
      WFInput: actionOutput(uuids.setupText, "Text"),
      UUID: uuids.setupDictionary,
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.getvalueforkey",
    WFWorkflowActionParameters: {
      WFInput: actionOutput(uuids.setupDictionary, "Dictionary"),
      CustomOutputName: "Version",
      UUID: uuids.version,
      WFDictionaryKey: "v",
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.getvalueforkey",
    WFWorkflowActionParameters: {
      WFInput: actionOutput(uuids.setupDictionary, "Dictionary"),
      CustomOutputName: "URL",
      UUID: uuids.url,
      WFDictionaryKey: "url",
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.getvalueforkey",
    WFWorkflowActionParameters: {
      WFInput: actionOutput(uuids.setupDictionary, "Dictionary"),
      CustomOutputName: "Token",
      UUID: uuids.token,
      WFDictionaryKey: "token",
    },
  },
  textAction(
    uuids.versionText,
    "Version Text",
    outputTextToken(uuids.version, "Version"),
  ),
  textAction(uuids.urlText, "URL Text", outputTextToken(uuids.url, "URL")),
  ...invalidSetupGuard(
    uuids.invalidVersionGroup,
    actionOutput(uuids.versionText, "Version Text"),
    5,
    { WFConditionalActionString: "1" },
  ),
  ...requiredSetupGuard(
    uuids.invalidSchemeGroup,
    actionOutput(uuids.urlText, "URL Text"),
    8,
    { WFConditionalActionString: "https://" },
  ),
  ...requiredSetupGuard(
    uuids.invalidPathGroup,
    actionOutput(uuids.urlText, "URL Text"),
    9,
    { WFConditionalActionString: "/v1/ingest" },
  ),
  ...invalidSetupGuard(
    uuids.invalidTokenGroup,
    actionOutput(uuids.token, "Token"),
    101,
  ),
  conditionalStart(uuids.missingInputGroup, extensionInput(), 101),
  notificationAction("Wafra Capture is ready"),
  stopAction(),
  conditionalMarker(uuids.missingInputGroup, 2),
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.number.random",
    WFWorkflowActionParameters: {
      UUID: uuids.randomA,
      WFRandomNumberMinimum: 0,
      WFRandomNumberMaximum: 999999999999999,
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.number.random",
    WFWorkflowActionParameters: {
      UUID: uuids.randomB,
      WFRandomNumberMinimum: 0,
      WFRandomNumberMaximum: 999999999999999,
    },
  },
  textAction(
    uuids.uuidSeed,
    "UUID Seed",
    textToken("\ufffc:\ufffc:\ufffc", {
      "{0, 1}": actionOutputValue(uuids.randomA, "Random Number"),
      "{2, 1}": actionOutputValue(uuids.randomB, "Random Number"),
      "{4, 1}": { Type: "CurrentDate" },
    }),
  ),
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.hash",
    WFWorkflowActionParameters: {
      UUID: uuids.uuidHash,
      WFInput: actionOutput(uuids.uuidSeed, "UUID Seed"),
      WFHashType: "SHA256",
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.text.replace",
    WFWorkflowActionParameters: {
      UUID: uuids.eventId,
      CustomOutputName: "UUID",
      WFInput: outputTextToken(uuids.uuidHash, "Hash"),
      WFReplaceTextFind:
        "^([0-9A-F]{8})([0-9A-F]{4})[0-9A-F]([0-9A-F]{3})[0-9A-F]([0-9A-F]{3})([0-9A-F]{12}).*$",
      WFReplaceTextReplace: "$1-$2-4$3-8$4-$5",
      WFReplaceTextCaseSensitive: false,
      WFReplaceTextRegularExpression: true,
    },
  },
  {
    WFWorkflowActionIdentifier: "is.workflow.actions.getitemtype",
    WFWorkflowActionParameters: {
      UUID: uuids.inputType,
      WFInput: extensionInput(),
    },
  },
  conditionalStart(
    uuids.inputTypeGroup,
    actionOutput(uuids.inputType, "Type"),
    4,
    { WFConditionalActionString: "Text" },
  ),
  textAction(
    uuids.manualText,
    "Manual Text",
    extensionInputTextToken([textCoercion]),
  ),
  ...emptyTextGuard(uuids.manualEmptyGroup, uuids.manualText, "Manual Text"),
  requestAction(uuids.manualRequest, [
    dictionaryItem("text", outputTextToken(uuids.manualText, "Manual Text")),
    dictionaryItem("eventId", outputTextToken(uuids.eventId, "UUID")),
  ]),
  conditionalMarker(uuids.inputTypeGroup, 1),
  textAction(
    uuids.messageText,
    "Message Text",
    extensionInputTextToken([propertyAggrandizement("Content"), textCoercion]),
  ),
  textAction(
    uuids.senderText,
    "Sender Text",
    extensionInputTextToken([propertyAggrandizement("Sender"), textCoercion]),
  ),
  ...emptyTextGuard(uuids.messageEmptyGroup, uuids.messageText, "Message Text"),
  requestAction(uuids.messageRequest, [
    dictionaryItem("text", outputTextToken(uuids.messageText, "Message Text")),
    dictionaryItem("sender", outputTextToken(uuids.senderText, "Sender Text")),
    dictionaryItem("eventId", outputTextToken(uuids.eventId, "UUID")),
    dictionaryItem("automation", "message"),
  ]),
  conditionalMarker(uuids.inputTypeGroup, 2),
  stopAction(),
];

const shortcut = {
  WFWorkflowName: "Wafra Capture",
  WFWorkflowMinimumClientVersionString: "1106",
  WFWorkflowMinimumClientVersion: 1106,
  WFWorkflowIcon: {
    WFWorkflowIconStartColor: -314141441,
    WFWorkflowIconGlyphNumber: 61440,
  },
  WFWorkflowClientVersion: "4042.0.2.2",
  WFWorkflowHasOutputFallback: false,
  WFWorkflowOutputContentItemClasses: ["WFStringContentItem"],
  WFWorkflowInputContentItemClasses: [
    "WFStringContentItem",
    "WFMessageContentItem",
  ],
  WFWorkflowImportQuestions: [
    {
      Category: "Parameter",
      ParameterKey: "WFTextActionText",
      ActionIndex: 0,
      Text: "Paste the setup code copied by Wafra.",
      DefaultValue: "",
    },
  ],
  WFWorkflowTypes: ["WFWorkflowTypeShowInSearch"],
  WFQuickActionSurfaces: [],
  WFWorkflowHasShortcutInputVariables: true,
  WFWorkflowActions: actions,
};

await writeFile(outputPath, `${JSON.stringify(shortcut, null, 2)}\n`, "utf8");
console.log(outputPath);
