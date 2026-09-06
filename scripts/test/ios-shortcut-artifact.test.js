#!/usr/bin/env node

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const repoRoot = resolve(__dirname, "../..");
const generator = join(repoRoot, "scripts/build-ios-capture-shortcut.mjs");
const checker = join(repoRoot, "scripts/check-ios-shortcut-artifact.sh");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "wafra-shortcut-test-"));
const generatedPath = join(temporaryDirectory, "WafraCapture.json");

try {
  execFileSync(process.execPath, [generator, generatedPath], { stdio: "pipe" });
} catch (error) {
  rmSync(temporaryDirectory, { force: true, recursive: true });
  throw error;
}

const shortcut = JSON.parse(readFileSync(generatedPath, "utf8"));
const checkerSource = readFileSync(checker, "utf8");
const actions = shortcut.WFWorkflowActions;
const parameters = (action) => action.WFWorkflowActionParameters;
const identifier = (action) => action.WFWorkflowActionIdentifier;

const tokenAttachment = (value, range = "{0, 1}") =>
  value?.Value?.attachmentsByRange?.[range];

const referencedUUID = (value, range = "{0, 1}") => {
  if (value?.Value?.OutputUUID) return value.Value.OutputUUID;
  return tokenAttachment(value, range)?.OutputUUID;
};

const inputAttachment = (action) => {
  const input = parameters(action).WFInput;
  return input?.Variable ?? input;
};

const dictionaryItems = (request, field) =>
  parameters(request)[field].Value.WFDictionaryFieldValueItems;

const dictionaryEntries = (request, field) =>
  Object.fromEntries(
    dictionaryItems(request, field).map((item) => [
      item.WFKey.Value.string,
      item.WFValue,
    ]),
  );

const assertOutputReference = (value, action, outputName, range = "{0, 1}") => {
  assert.equal(referencedUUID(value, range), parameters(action).UUID);
  const attachment = value?.Value?.OutputUUID
    ? value.Value
    : tokenAttachment(value, range);
  assert.equal(attachment.Type, "ActionOutput");
  assert.equal(attachment.OutputName, outputName);
};

const extensionInputAttachment = (value) => {
  if (value?.Value?.Type === "ExtensionInput") return value.Value;
  if (value?.Type === "ExtensionInput") return value;
  return tokenAttachment(value);
};

const assertExtensionInput = (value, expectedAggrandizements = []) => {
  const attachment = extensionInputAttachment(value);
  assert.equal(attachment?.Type, "ExtensionInput");
  assert.deepEqual(attachment.Aggrandizements ?? [], expectedAggrandizements);
};

const assertGuard = ({
  inputAction,
  condition,
  comparisonKey,
  comparisonValue,
  message,
  failureInElse = false,
}) => {
  const startIndex = actions.findIndex((action) => {
    if (identifier(action) !== "is.workflow.actions.conditional") return false;
    const candidate = parameters(action);
    if (candidate.WFControlFlowMode !== 0 || candidate.WFCondition !== condition) {
      return false;
    }
    return referencedUUID(inputAttachment(action)) === parameters(inputAction).UUID;
  });

  assert.notEqual(startIndex, -1, `missing validation guard for ${comparisonValue}`);
  const start = actions[startIndex];
  if (comparisonKey) {
    assert.equal(parameters(start)[comparisonKey], comparisonValue);
  }
  const failureIndex = startIndex + (failureInElse ? 2 : 1);
  if (failureInElse) {
    assert.equal(identifier(actions[startIndex + 1]), "is.workflow.actions.conditional");
    assert.equal(parameters(actions[startIndex + 1]).WFControlFlowMode, 1);
    assert.equal(
      parameters(actions[startIndex + 1]).GroupingIdentifier,
      parameters(start).GroupingIdentifier,
    );
  }
  assert.equal(identifier(actions[failureIndex]), "is.workflow.actions.notification");
  assert.equal(
    parameters(actions[failureIndex]).WFNotificationActionBody,
    message,
  );
  assert.equal(identifier(actions[failureIndex + 1]), "is.workflow.actions.exit");
  assert.deepEqual(parameters(actions[failureIndex + 1]), {});
  assert.equal(identifier(actions[failureIndex + 2]), "is.workflow.actions.conditional");
  assert.equal(parameters(actions[failureIndex + 2]).WFControlFlowMode, 2);
  assert.equal(
    parameters(actions[failureIndex + 2]).GroupingIdentifier,
    parameters(start).GroupingIdentifier,
  );
  return startIndex;
};

const assertEmptyTextGuard = (textAction, request) => {
  const textIndex = actions.indexOf(textAction);
  const requestIndex = actions.indexOf(request);
  const startIndex = actions.findIndex(
    (action, index) =>
      index > textIndex &&
      index < requestIndex &&
      identifier(action) === "is.workflow.actions.conditional" &&
      parameters(action).WFControlFlowMode === 0 &&
      parameters(action).WFCondition === 101 &&
      referencedUUID(inputAttachment(action)) === parameters(textAction).UUID,
  );
  assert.notEqual(startIndex, -1, "missing non-empty text guard");
  assert.equal(identifier(actions[startIndex + 1]), "is.workflow.actions.exit");
  assert.equal(identifier(actions[startIndex + 2]), "is.workflow.actions.conditional");
  assert.equal(parameters(actions[startIndex + 2]).WFControlFlowMode, 2);
  assert.equal(
    parameters(actions[startIndex + 2]).GroupingIdentifier,
    parameters(actions[startIndex]).GroupingIdentifier,
  );
};

const assertRequest = ({
  request,
  expectedBody,
  expectedLiterals = {},
  urlAction,
  tokenAction,
  eventId,
}) => {
  const requestParameters = parameters(request);
  assert.equal(requestParameters.WFHTTPMethod, "POST");
  assertOutputReference(requestParameters.WFURL, urlAction, "URL Text");

  const headers = dictionaryEntries(request, "WFHTTPHeaders");
  assert.deepEqual(Object.keys(headers), ["Authorization", "Content-Type"]);
  assert.equal(headers["Authorization"].Value.string, "Bearer \ufffc");
  assertOutputReference(headers["Authorization"], tokenAction, "Token", "{7, 1}");
  assert.equal(headers["Content-Type"].Value.string, "application/json");

  const body = dictionaryEntries(request, "WFJSONValues");
  assert.deepEqual(Object.keys(body), [
    ...Object.keys(expectedBody),
    ...Object.keys(expectedLiterals),
  ]);
  for (const [key, [sourceAction, outputName]] of Object.entries(expectedBody)) {
    assertOutputReference(body[key], sourceAction, outputName);
  }
  for (const [key, literal] of Object.entries(expectedLiterals)) {
    assert.equal(body[key].Value.string, literal);
    assert.deepEqual(body[key].Value.attachmentsByRange ?? {}, {});
  }
  assertOutputReference(body.eventId, eventId, "UUID");
};

const testCases = [];
const test = (name, run) => testCases.push({ name, run });

test("metadata and import setup are credential-free and exact", () => {
  const containsNull = (value) =>
    value === null ||
    (Array.isArray(value)
      ? value.some(containsNull)
      : typeof value === "object" && value !== null
        ? Object.values(value).some(containsNull)
        : false);
  assert.equal(containsNull(shortcut), false, "Apple property lists cannot encode null");
  assert.equal(shortcut.WFWorkflowName, "Wafra Capture");
  assert.equal(actions.length, 50, "unexpected action added to the audited graph");
  assert.doesNotMatch(checkerSource, /WafraCapture\.shortcut/);
  assert.match(checkerSource, /Wafra%20Capture\.shortcut/);
  assert.match(checkerSource, /Wafra Capture\.shortcut/);
  assert.match(
    checkerSource,
    /jq --arg name "\$RECORD_NAME" '\.WFWorkflowName = \$name'/,
    "published artifacts must restore Apple's separately stored record name before checking",
  );
  assert.deepEqual(shortcut.WFWorkflowInputContentItemClasses, [
    "WFStringContentItem",
    "WFMessageContentItem",
  ]);
  assert.equal(shortcut.WFWorkflowHasShortcutInputVariables, true);

  assert.equal(shortcut.WFWorkflowImportQuestions.length, 1);
  const question = shortcut.WFWorkflowImportQuestions[0];
  assert.equal(question.Category, "Parameter");
  assert.equal(question.ParameterKey, "WFTextActionText");
  assert.equal(question.ActionIndex, 0);
  assert.equal(question.DefaultValue, "");
  assert.match(question.Text, /setup code/i);

  assert.equal(identifier(actions[0]), "is.workflow.actions.gettext");
  assert.equal(parameters(actions[0]).WFTextActionText, "");
  assert.equal(
    actions.filter(
      (action) =>
        identifier(action) === "is.workflow.actions.gettext" &&
        parameters(action).WFTextActionText === "",
    ).length,
    1,
  );

  const forbiddenIdentifiers = actions
    .map(identifier)
    .filter((value) =>
      /documentpicker|(?:^|\.)(?:file|folder)(?:\.|$)|(?:^|\.)(?:get|save|move|create|delete|append)file(?:\.|$)/i.test(
        value,
      ),
    );
  assert.deepEqual(forbiddenIdentifiers, []);
  assert.doesNotMatch(
    JSON.stringify(shortcut),
    /config\.json|wafra-relay\.|khanjer496|authorization\s*:\s*bearer\s+[a-z0-9_-]{12,}/i,
  );
});

test("setup dictionary values are validated before Shortcut Input is read", () => {
  const setupText = actions[0];
  const dictionary = actions[1];
  assert.equal(identifier(dictionary), "is.workflow.actions.detect.dictionary");
  assertOutputReference(parameters(dictionary).WFInput, setupText, "Text");

  const getters = actions.filter(
    (action) => identifier(action) === "is.workflow.actions.getvalueforkey",
  );
  assert.deepEqual(getters.map((action) => parameters(action).WFDictionaryKey), [
    "v",
    "url",
    "token",
  ]);
  for (const getter of getters) {
    assertOutputReference(parameters(getter).WFInput, dictionary, "Dictionary");
  }
  const [version, url, token] = getters;
  assert.equal(parameters(version).CustomOutputName, "Version");
  assert.equal(parameters(url).CustomOutputName, "URL");
  assert.equal(parameters(token).CustomOutputName, "Token");

  const versionText = actions.find(
    (action) => parameters(action).CustomOutputName === "Version Text",
  );
  const urlText = actions.find(
    (action) => parameters(action).CustomOutputName === "URL Text",
  );
  assert.ok(versionText);
  assert.ok(urlText);
  assert.equal(identifier(versionText), "is.workflow.actions.gettext");
  assert.equal(identifier(urlText), "is.workflow.actions.gettext");
  assertOutputReference(parameters(versionText).WFTextActionText, version, "Version");
  assertOutputReference(parameters(urlText).WFTextActionText, url, "URL");
  assert.ok(actions.indexOf(versionText) > actions.indexOf(token));
  assert.ok(actions.indexOf(urlText) > actions.indexOf(versionText));

  const invalidMessage = "Open Wafra and copy a new setup code";
  const guardIndexes = [
    assertGuard({
      inputAction: versionText,
      condition: 5,
      comparisonKey: "WFConditionalActionString",
      comparisonValue: "1",
      message: invalidMessage,
    }),
    assertGuard({
      inputAction: urlText,
      condition: 8,
      comparisonKey: "WFConditionalActionString",
      comparisonValue: "https://",
      message: invalidMessage,
      failureInElse: true,
    }),
    assertGuard({
      inputAction: urlText,
      condition: 9,
      comparisonKey: "WFConditionalActionString",
      comparisonValue: "/v1/ingest",
      message: invalidMessage,
      failureInElse: true,
    }),
    assertGuard({ inputAction: token, condition: 101, message: invalidMessage }),
  ];
  assert.deepEqual(guardIndexes, [...guardIndexes].sort((a, b) => a - b));

  const firstExtensionInputUse = actions.findIndex((action) =>
    JSON.stringify(action).includes('"Type":"ExtensionInput"'),
  );
  assert.ok(firstExtensionInputUse > guardIndexes.at(-1) + 3);
});

test("no-input setup run stops before UUID generation and payload branching", () => {
  const noInputIndex = actions.findIndex((action) => {
    if (identifier(action) !== "is.workflow.actions.conditional") return false;
    const candidate = parameters(action);
    return (
      candidate.WFControlFlowMode === 0 &&
      candidate.WFCondition === 101 &&
      extensionInputAttachment(inputAttachment(action))?.Type === "ExtensionInput"
    );
  });
  assert.notEqual(noInputIndex, -1);
  const noInputStart = actions[noInputIndex];
  assertExtensionInput(inputAttachment(noInputStart));
  assert.equal(identifier(actions[noInputIndex + 1]), "is.workflow.actions.notification");
  assert.equal(
    parameters(actions[noInputIndex + 1]).WFNotificationActionBody,
    "Wafra Capture is ready",
  );
  assert.equal(identifier(actions[noInputIndex + 2]), "is.workflow.actions.exit");
  assert.equal(identifier(actions[noInputIndex + 3]), "is.workflow.actions.conditional");
  assert.equal(parameters(actions[noInputIndex + 3]).WFControlFlowMode, 2);
  assert.equal(
    parameters(actions[noInputIndex + 3]).GroupingIdentifier,
    parameters(noInputStart).GroupingIdentifier,
  );

  const firstUUIDAction = actions.findIndex((action) =>
    ["is.workflow.actions.number.random", "is.workflow.actions.hash"].includes(
      identifier(action),
    ),
  );
  assert.ok(firstUUIDAction > noInputIndex + 3);
});

test("eventId is a UUID-shaped value rather than a random-number output", () => {
  const randomActions = actions.filter(
    (action) => identifier(action) === "is.workflow.actions.number.random",
  );
  assert.equal(randomActions.length, 2);
  for (const action of randomActions) {
    assert.equal(parameters(action).WFRandomNumberMinimum, 0);
    assert.equal(parameters(action).WFRandomNumberMaximum, 999999999999999);
  }

  const seed = actions.find(
    (action) =>
      identifier(action) === "is.workflow.actions.gettext" &&
      parameters(action).CustomOutputName === "UUID Seed",
  );
  assert.ok(seed);
  const seedText = parameters(seed).WFTextActionText;
  assert.equal(seedText.Value.string, "\ufffc:\ufffc:\ufffc");
  assertOutputReference(seedText, randomActions[0], "Random Number");
  assertOutputReference(seedText, randomActions[1], "Random Number", "{2, 1}");
  assert.equal(tokenAttachment(seedText, "{4, 1}").Type, "CurrentDate");

  const hash = actions.find((action) => identifier(action) === "is.workflow.actions.hash");
  assert.ok(hash);
  assert.equal(parameters(hash).WFHashType, "SHA256");
  assertOutputReference(parameters(hash).WFInput, seed, "UUID Seed");

  const eventId = actions.find(
    (action) =>
      identifier(action) === "is.workflow.actions.text.replace" &&
      parameters(action).CustomOutputName === "UUID",
  );
  assert.ok(eventId);
  assert.equal(
    parameters(eventId).WFInput.WFSerializationType,
    "WFTextTokenString",
  );
  assert.equal(parameters(eventId).WFInput.Value.string, "\ufffc");
  assertOutputReference(parameters(eventId).WFInput, hash, "Hash");
  assert.equal(parameters(eventId).WFReplaceTextRegularExpression, true);
  assert.equal(parameters(eventId).WFReplaceTextCaseSensitive, false);
  assert.equal(
    parameters(eventId).WFReplaceTextFind,
    "^([0-9A-F]{8})([0-9A-F]{4})[0-9A-F]([0-9A-F]{3})[0-9A-F]([0-9A-F]{3})([0-9A-F]{12}).*$",
  );
  assert.equal(parameters(eventId).WFReplaceTextReplace, "$1-$2-4$3-8$4-$5");

  const requests = actions.filter(
    (action) => identifier(action) === "is.workflow.actions.downloadurl",
  );
  assert.equal(requests.length, 2);
  for (const request of requests) {
    const body = dictionaryEntries(request, "WFJSONValues");
    assertOutputReference(body.eventId, eventId, "UUID");
    assert.notEqual(
      referencedUUID(body.eventId),
      parameters(randomActions[0]).UUID,
    );
  }
});

test("Text and Message inputs take distinct, typed payload paths", () => {
  const typeAction = actions.find(
    (action) => identifier(action) === "is.workflow.actions.getitemtype",
  );
  assert.ok(typeAction);
  assertExtensionInput(parameters(typeAction).WFInput);

  const branchIndex = actions.findIndex((action) => {
    if (identifier(action) !== "is.workflow.actions.conditional") return false;
    const candidate = parameters(action);
    return (
      candidate.WFControlFlowMode === 0 &&
      candidate.WFCondition === 4 &&
      candidate.WFConditionalActionString === "Text" &&
      referencedUUID(inputAttachment(action)) === parameters(typeAction).UUID
    );
  });
  assert.notEqual(branchIndex, -1, "missing Text-vs-Message type branch");
  const branch = actions[branchIndex];
  const elseIndex = actions.findIndex(
    (action, index) =>
      index > branchIndex &&
      identifier(action) === "is.workflow.actions.conditional" &&
      parameters(action).GroupingIdentifier === parameters(branch).GroupingIdentifier &&
      parameters(action).WFControlFlowMode === 1,
  );
  const endIndex = actions.findIndex(
    (action, index) =>
      index > elseIndex &&
      identifier(action) === "is.workflow.actions.conditional" &&
      parameters(action).GroupingIdentifier === parameters(branch).GroupingIdentifier &&
      parameters(action).WFControlFlowMode === 2,
  );
  assert.ok(branchIndex < elseIndex && elseIndex < endIndex);

  const manualActions = actions.slice(branchIndex + 1, elseIndex);
  const messageActions = actions.slice(elseIndex + 1, endIndex);
  const manualText = manualActions.find(
    (action) =>
      identifier(action) === "is.workflow.actions.gettext" &&
      parameters(action).CustomOutputName === "Manual Text",
  );
  assert.ok(manualText);
  assertExtensionInput(parameters(manualText).WFTextActionText, [
    {
      Type: "WFCoercionVariableAggrandizement",
      CoercionItemClass: "WFStringContentItem",
    },
  ]);

  const messageText = messageActions.find(
    (action) =>
      identifier(action) === "is.workflow.actions.gettext" &&
      parameters(action).CustomOutputName === "Message Text",
  );
  assert.ok(messageText);
  assertExtensionInput(parameters(messageText).WFTextActionText, [
    { Type: "WFPropertyVariableAggrandizement", PropertyName: "Content" },
    {
      Type: "WFCoercionVariableAggrandizement",
      CoercionItemClass: "WFStringContentItem",
    },
  ]);

  const senderText = messageActions.find(
    (action) =>
      identifier(action) === "is.workflow.actions.gettext" &&
      parameters(action).CustomOutputName === "Sender Text",
  );
  assert.ok(senderText);
  assertExtensionInput(parameters(senderText).WFTextActionText, [
    { Type: "WFPropertyVariableAggrandizement", PropertyName: "Sender" },
    {
      Type: "WFCoercionVariableAggrandizement",
      CoercionItemClass: "WFStringContentItem",
    },
  ]);

  assert.equal(
    actions.some((action) =>
      [
        "is.workflow.actions.format.date",
        "is.workflow.actions.converttimezone",
      ].includes(identifier(action)),
    ),
    false,
    "iOS 26 Message objects expose no Date detail; do not send a fake timestamp",
  );
  assert.equal(
    messageActions.some((action) =>
      JSON.stringify(action).includes('"PropertyName":"Date"'),
    ),
    false,
  );

  const manualRequest = manualActions.find(
    (action) => identifier(action) === "is.workflow.actions.downloadurl",
  );
  const messageRequest = messageActions.find(
    (action) => identifier(action) === "is.workflow.actions.downloadurl",
  );
  assert.ok(manualRequest);
  assert.ok(messageRequest);
  assertEmptyTextGuard(manualText, manualRequest);
  assertEmptyTextGuard(messageText, messageRequest);

  const getters = actions.filter(
    (action) => identifier(action) === "is.workflow.actions.getvalueforkey",
  );
  const urlAction = actions.find(
    (action) => parameters(action).CustomOutputName === "URL Text",
  );
  const tokenAction = getters.find(
    (action) => parameters(action).WFDictionaryKey === "token",
  );
  const eventId = actions.find(
    (action) => parameters(action).CustomOutputName === "UUID",
  );
  assertRequest({
    request: manualRequest,
    expectedBody: {
      text: [manualText, "Manual Text"],
      eventId: [eventId, "UUID"],
    },
    urlAction,
    tokenAction,
    eventId,
  });
  assertRequest({
    request: messageRequest,
    expectedBody: {
      text: [messageText, "Message Text"],
      sender: [senderText, "Sender Text"],
      eventId: [eventId, "UUID"],
    },
    expectedLiterals: { automation: "message" },
    urlAction,
    tokenAction,
    eventId,
  });

  assert.equal(
    manualActions.some((action) =>
      JSON.stringify(action).includes('"PropertyName":"Sender"'),
    ),
    false,
  );
  assert.equal(
    manualActions.some((action) =>
      JSON.stringify(action).includes('"PropertyName":"Date"'),
    ),
    false,
  );
});

test("successful POST responses are discarded before the Shortcut returns", () => {
  const terminalAction = actions.at(-1);
  assert.equal(
    identifier(terminalAction),
    "is.workflow.actions.exit",
    "the top-level type branch must be followed by Stop This Shortcut",
  );
  assert.deepEqual(
    parameters(terminalAction),
    {},
    "the terminal stop must not pass the HTTP response as output",
  );

  const typeAction = actions.find(
    (action) => identifier(action) === "is.workflow.actions.getitemtype",
  );
  const branchIndex = actions.findIndex((action) => {
    const candidate = parameters(action);
    return (
      identifier(action) === "is.workflow.actions.conditional" &&
      candidate.WFControlFlowMode === 0 &&
      candidate.WFCondition === 4 &&
      candidate.WFConditionalActionString === "Text" &&
      referencedUUID(inputAttachment(action)) === parameters(typeAction).UUID
    );
  });
  const branchGroup = parameters(actions[branchIndex]).GroupingIdentifier;
  const endIndex = actions.findIndex(
    (action, index) =>
      index > branchIndex &&
      identifier(action) === "is.workflow.actions.conditional" &&
      parameters(action).GroupingIdentifier === branchGroup &&
      parameters(action).WFControlFlowMode === 2,
  );
  assert.equal(
    endIndex,
    actions.length - 2,
    "Stop This Shortcut must be outside and immediately after the type branch",
  );
  assert.ok(
    actions
      .map((action, index) => ({ action, index }))
      .filter(({ action }) => identifier(action) === "is.workflow.actions.downloadurl")
      .every(({ index }) => index > branchIndex && index < endIndex),
    "both successful POST actions must flow through the terminal stop",
  );
});

test("the local artifact checker follows semantic dataflow", () => {
  const output = execFileSync("bash", [checker, "--json", generatedPath], {
    encoding: "utf8",
  });
  assert.match(output, /^PASS:/m);

  const assertCheckerRejects = (
    mutation,
    filename,
    errorPattern = /semantic action graph/i,
  ) => {
    const mutationPath = join(temporaryDirectory, filename);
    writeFileSync(mutationPath, `${JSON.stringify(mutation)}\n`, "utf8");
    assert.throws(
      () => execFileSync("bash", [checker, "--json", mutationPath], { stdio: "pipe" }),
      (error) => {
        assert.match(error.stderr.toString(), errorPattern);
        return true;
      },
    );
  };

  const wrongSender = structuredClone(shortcut);
  const sender = wrongSender.WFWorkflowActions.find(
    (action) => action.WFWorkflowActionParameters.CustomOutputName === "Sender Text",
  );
  sender.WFWorkflowActionParameters.WFTextActionText.Value.attachmentsByRange[
    "{0, 1}"
  ].Aggrandizements[0].PropertyName = "Content";
  assertCheckerRejects(wrongSender, "bad-sender.json");

  const wrongDiscriminator = structuredClone(shortcut);
  const messageRequest = wrongDiscriminator.WFWorkflowActions.find(
    (action) =>
      action.WFWorkflowActionParameters.UUID ===
      parameters(
        actions.filter(
          (candidate) =>
            identifier(candidate) === "is.workflow.actions.downloadurl",
        ).at(-1),
      ).UUID,
  );
  const automationItem = messageRequest.WFWorkflowActionParameters.WFJSONValues.Value
    .WFDictionaryFieldValueItems.find(
      (item) => item.WFKey.Value.string === "automation",
    );
  automationItem.WFValue.Value.string = "text";
  assertCheckerRejects(wrongDiscriminator, "bad-automation.json");

  const randomEventId = structuredClone(shortcut);
  const randomUUID = randomEventId.WFWorkflowActions.find(
    (action) => action.WFWorkflowActionIdentifier === "is.workflow.actions.number.random",
  ).WFWorkflowActionParameters.UUID;
  for (const request of randomEventId.WFWorkflowActions.filter(
    (action) => action.WFWorkflowActionIdentifier === "is.workflow.actions.downloadurl",
  )) {
    const eventIdItem = request.WFWorkflowActionParameters.WFJSONValues.Value
      .WFDictionaryFieldValueItems.find(
        (item) => item.WFKey.Value.string === "eventId",
      );
    eventIdItem.WFValue.Value.attachmentsByRange["{0, 1}"].OutputUUID = randomUUID;
    eventIdItem.WFValue.Value.attachmentsByRange["{0, 1}"].OutputName = "Random Number";
  }
  assertCheckerRejects(randomEventId, "bad-event-id.json");

  const fileAction = structuredClone(shortcut);
  fileAction.WFWorkflowActions.splice(1, 0, {
    WFWorkflowActionIdentifier: "is.workflow.actions.file.delete",
    WFWorkflowActionParameters: {},
  });
  assertCheckerRejects(
    fileAction,
    "file-action.json",
    /file and folder actions are prohibited/i,
  );

  const leakingResponse = structuredClone(shortcut);
  leakingResponse.WFWorkflowActions.at(-1).WFWorkflowActionIdentifier =
    "is.workflow.actions.notification";
  assertCheckerRejects(leakingResponse, "leaking-response.json");
});

let failures = 0;
for (const { name, run } of testCases) {
  try {
    run();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL: ${name}`);
    console.error(error.stack ?? error);
  }
}

rmSync(temporaryDirectory, { force: true, recursive: true });

if (failures > 0) {
  console.error(`\n${failures} of ${testCases.length} iOS Shortcut artifact tests failed.`);
  process.exit(1);
}

console.log(`\n${testCases.length} iOS Shortcut artifact tests passed.`);
