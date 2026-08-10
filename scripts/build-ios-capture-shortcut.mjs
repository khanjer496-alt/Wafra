#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputPath = resolve(process.argv[2] ?? "WafraCapture.json");

const uuids = {
  setupText: "2B6784B8-1C4D-4F1B-A3E9-88B0D0BF0121",
  setupDictionary: "9445E194-BFE5-4BE0-AD79-A34A74B9D6E5",
  messageText: "DFC36902-E4D8-48D8-8219-C80846C6D585",
  senderText: "7305B385-1A7A-4B99-AF2E-4FFBEE113C23",
  eventId: "E0F97C1D-13CE-45BF-8B20-892FB97C9A52",
  missingInputGroup: "AF2EDC3A-16C7-4E72-80C9-6A53B2EA2D78",
  readyNotification: "7F2CB6A7-FF85-43D9-A907-A4B2D8D2417B",
  url: "3FB9D81E-54AC-444C-9E7D-E06F70F4F147",
  token: "CB34670A-E45C-4CC0-AE49-74480CB050A7",
  request: "516950DD-481B-4690-B1B2-6661FD4E7C38",
};

const actionOutput = (outputUUID, outputName) => ({
  Value: {
    OutputUUID: outputUUID,
    Type: "ActionOutput",
    OutputName: outputName,
  },
  WFSerializationType: "WFTextTokenAttachment",
});

const textToken = (string, attachmentsByRange = undefined) => ({
  Value: {
    string,
    ...(attachmentsByRange ? { attachmentsByRange } : {}),
  },
  WFSerializationType: "WFTextTokenString",
});

const dictionaryItem = (key, value) => ({
  WFKey: textToken(key),
  WFItemType: 0,
  WFValue: textToken(value),
});

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
    "WFAppContentItem",
    "WFAppStoreAppContentItem",
    "WFArticleContentItem",
    "WFContactContentItem",
    "WFDateContentItem",
    "WFEmailAddressContentItem",
    "WFFolderContentItem",
    "WFGenericFileContentItem",
    "WFImageContentItem",
    "WFiTunesProductContentItem",
    "WFLocationContentItem",
    "WFDCMapsLinkContentItem",
    "WFAVAssetContentItem",
    "WFPDFContentItem",
    "WFPhoneNumberContentItem",
    "WFRichTextContentItem",
    "WFSafariWebPageContentItem",
    "WFStringContentItem",
    "WFURLContentItem",
    "WFMessageContentItem",
  ],
  WFWorkflowImportQuestions: [
    {
      Category: "Parameter",
      ParameterKey: "WFTextActionText",
      ActionIndex: 1,
      Text: "Paste the setup code shown in Wafra. It connects this Shortcut only to your Wafra account.",
      DefaultValue: "",
    },
  ],
  WFWorkflowTypes: ["WFWorkflowTypeShowInSearch"],
  WFQuickActionSurfaces: [],
  WFWorkflowHasShortcutInputVariables: true,
  WFWorkflowActions: [
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.number.random",
      WFWorkflowActionParameters: {
        UUID: uuids.eventId,
        WFRandomNumberMinimum: 100000000000,
        WFRandomNumberMaximum: 999999999999,
      },
    },
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
      WFWorkflowActionIdentifier: "is.workflow.actions.gettext",
      WFWorkflowActionParameters: {
        UUID: uuids.messageText,
        WFTextActionText: textToken("\ufffc", {
          "{0, 1}": {
            Type: "ExtensionInput",
            Aggrandizements: [
              {
                Type: "WFCoercionVariableAggrandizement",
                CoercionItemClass: "WFStringContentItem",
              },
            ],
          },
        }),
      },
    },
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
      WFWorkflowActionParameters: {
        WFInput: {
          Type: "Variable",
          Variable: actionOutput(uuids.messageText, "Text"),
        },
        WFControlFlowMode: 0,
        GroupingIdentifier: uuids.missingInputGroup,
        WFCondition: 101,
      },
    },
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.notification",
      WFWorkflowActionParameters: {
        WFNotificationActionBody: "Wafra Capture is ready. Use it from your Messages automation.",
        UUID: uuids.readyNotification,
      },
    },
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.exit",
      WFWorkflowActionParameters: {},
    },
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
      WFWorkflowActionParameters: {
        GroupingIdentifier: uuids.missingInputGroup,
        WFControlFlowMode: 1,
      },
    },
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.conditional",
      WFWorkflowActionParameters: {
        GroupingIdentifier: uuids.missingInputGroup,
        WFControlFlowMode: 2,
      },
    },
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.getvalueforkey",
      WFWorkflowActionParameters: {
        WFInput: actionOutput(uuids.setupDictionary, "Dictionary"),
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
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.gettext",
      WFWorkflowActionParameters: {
        UUID: uuids.senderText,
        WFTextActionText: textToken("\ufffc", {
          "{0, 1}": {
            Type: "ExtensionInput",
            Aggrandizements: [
              {
                Type: "WFPropertyVariableAggrandizement",
                PropertyName: "Sender",
              },
              {
                Type: "WFCoercionVariableAggrandizement",
                CoercionItemClass: "WFStringContentItem",
              },
            ],
          },
        }),
      },
    },
    {
      WFWorkflowActionIdentifier: "is.workflow.actions.downloadurl",
      WFWorkflowActionParameters: {
        WFHTTPHeaders: {
          Value: {
            WFDictionaryFieldValueItems: [
              dictionaryItem("Authorization", "Bearer \ufffc"),
              dictionaryItem("Content-Type", "application/json"),
            ],
          },
          WFSerializationType: "WFDictionaryFieldValue",
        },
        ShowHeaders: true,
        UUID: uuids.request,
        WFURL: textToken("\ufffc", {
          "{0, 1}": {
            OutputUUID: uuids.url,
            Type: "ActionOutput",
            OutputName: "Dictionary Value",
          },
        }),
        WFJSONValues: {
          Value: {
            WFDictionaryFieldValueItems: [
              {
                WFKey: textToken("text"),
                WFItemType: 0,
                WFValue: textToken("\ufffc", {
                  "{0, 1}": {
                    OutputUUID: uuids.messageText,
                    Type: "ActionOutput",
                    OutputName: "Text",
                  },
                }),
              },
              {
                WFKey: textToken("sender"),
                WFItemType: 0,
                WFValue: textToken("\ufffc", {
                  "{0, 1}": {
                    OutputUUID: uuids.senderText,
                    Type: "ActionOutput",
                    OutputName: "Text",
                  },
                }),
              },
              {
                WFKey: textToken("eventId"),
                WFItemType: 0,
                WFValue: textToken("\ufffc", {
                  "{0, 1}": {
                    OutputUUID: uuids.eventId,
                    Type: "ActionOutput",
                    OutputName: "Random Number",
                  },
                }),
              },
              {
                WFKey: textToken("receivedAt"),
                WFItemType: 0,
                WFValue: textToken("\ufffc", {
                  "{0, 1}": {
                    Type: "CurrentDate",
                    Aggrandizements: [
                      {
                        Type: "WFDateFormatVariableAggrandizement",
                        WFDateFormatStyle: "ISO 8601",
                        WFISO8601IncludeTime: true,
                      },
                    ],
                  },
                }),
              },
            ],
          },
          WFSerializationType: "WFDictionaryFieldValue",
        },
        WFHTTPMethod: "POST",
      },
    },
  ],
};

const authorizationValue =
  shortcut.WFWorkflowActions[12].WFWorkflowActionParameters.WFHTTPHeaders.Value
    .WFDictionaryFieldValueItems[0].WFValue;
authorizationValue.Value.attachmentsByRange = {
  "{7, 1}": {
    OutputUUID: uuids.token,
    Type: "ActionOutput",
    OutputName: "Token",
  },
};

await writeFile(outputPath, `${JSON.stringify(shortcut, null, 2)}\n`, "utf8");
console.log(outputPath);
