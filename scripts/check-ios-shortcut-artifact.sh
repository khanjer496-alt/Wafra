#!/usr/bin/env bash
set -euo pipefail

# Inspect either generated JSON or the exact unsigned action graph behind a
# public iCloud Shortcut. The graph check follows action-output references, so
# merely containing payload field names is not enough to pass.

usage() {
  echo "usage: bash scripts/check-ios-shortcut-artifact.sh [--json <path> | https://www.icloud.com/shortcuts/<id>]" >&2
  exit 2
}

TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/wafra-shortcut-check.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT

if [[ "${1:-}" == "--json" ]]; then
  [[ $# -eq 2 && -f "$2" ]] || usage
  SHORTCUT_JSON=$2
elif [[ $# -eq 1 && "$1" =~ ^https://www\.icloud\.com/shortcuts/([A-Za-z0-9_-]+)/*$ ]]; then
  SHORTCUT_ID=${BASH_REMATCH[1]}
  if [[ "$SHORTCUT_ID" == "85bd1e080e5849b591049eccffb9a3a1" ]]; then
    echo "FAIL: this is the retired Shortcut with the invalid file-path action" >&2
    exit 1
  fi

  curl --fail --silent --show-error --location \
    "https://www.icloud.com/shortcuts/api/records/$SHORTCUT_ID" \
    --output "$TMP_DIR/record.json"

  RECORD_NAME=$(jq -r '.fields.name.value // ""' "$TMP_DIR/record.json")
  DOWNLOAD=$(jq -r \
    '.fields.shortcut.value.downloadURL | gsub("\\$\\{f\\}"; "Wafra%20Capture.shortcut")' \
    "$TMP_DIR/record.json")

  if [[ "$RECORD_NAME" != "Wafra Capture" || -z "$DOWNLOAD" || "$DOWNLOAD" == "null" ]]; then
    echo "FAIL: the public record is not a downloadable Wafra Capture Shortcut" >&2
    exit 1
  fi

  curl --fail --silent --show-error --location "$DOWNLOAD" \
    --output "$TMP_DIR/Wafra Capture.shortcut"
  plutil -convert json -o "$TMP_DIR/shortcut.json" "$TMP_DIR/Wafra Capture.shortcut"
  # Apple stores a shared Shortcut's display name in the iCloud record and
  # removes WFWorkflowName from the downloadable property list. Validate the
  # record name above, then restore that one piece of record metadata in a
  # temporary copy so the same semantic graph checker can cover generated and
  # published artifacts. No action or import-question data is rewritten.
  jq --arg name "$RECORD_NAME" '.WFWorkflowName = $name' \
    "$TMP_DIR/shortcut.json" > "$TMP_DIR/shortcut-with-record-name.json"
  SHORTCUT_JSON="$TMP_DIR/shortcut-with-record-name.json"
else
  usage
fi

node --input-type=module - "$SHORTCUT_JSON" <<'NODE'
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const fail = (message) => {
  throw new Error(message);
};
const expect = (condition, message) => {
  if (!condition) fail(message);
};
const same = (actual, expected) => isDeepStrictEqual(actual, expected);

try {
  const shortcut = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const containsNull = (value) =>
    value === null ||
    (Array.isArray(value)
      ? value.some(containsNull)
      : typeof value === "object" && value !== null
        ? Object.values(value).some(containsNull)
        : false);
  expect(!containsNull(shortcut), "Apple property lists cannot encode null values");
  const actions = shortcut.WFWorkflowActions;
  expect(Array.isArray(actions), "WFWorkflowActions is missing");

  const parameters = (action) => action?.WFWorkflowActionParameters ?? {};
  const identifier = (action) => action?.WFWorkflowActionIdentifier;
  const attachment = (value, range = "{0, 1}") =>
    value?.Value?.attachmentsByRange?.[range];
  const referencedUUID = (value, range = "{0, 1}") =>
    value?.Value?.OutputUUID ?? value?.OutputUUID ?? attachment(value, range)?.OutputUUID;
  const inputValue = (action) => {
    const input = parameters(action).WFInput;
    return input?.Variable ?? input;
  };
  const extensionAttachment = (value) => {
    if (value?.Value?.Type === "ExtensionInput") return value.Value;
    if (value?.Type === "ExtensionInput") return value;
    return attachment(value);
  };
  const named = (name) => {
    const matches = actions.filter(
      (action) => parameters(action).CustomOutputName === name,
    );
    expect(matches.length === 1, `expected one ${name} action`);
    return matches[0];
  };
  const onlyIdentifier = (actionIdentifier) => {
    const matches = actions.filter((action) => identifier(action) === actionIdentifier);
    expect(matches.length === 1, `expected one ${actionIdentifier} action`);
    return matches[0];
  };
  const assertReference = (value, source, outputName, range = "{0, 1}") => {
    expect(
      referencedUUID(value, range) === parameters(source).UUID,
      `expected a reference to ${outputName}`,
    );
    const output = value?.Value?.OutputUUID ? value.Value : attachment(value, range);
    expect(output?.Type === "ActionOutput", `${outputName} reference has the wrong type`);
    expect(output?.OutputName === outputName, `${outputName} reference has the wrong name`);
  };
  const dictionaryItems = (request, field) => {
    const items = parameters(request)[field]?.Value?.WFDictionaryFieldValueItems;
    expect(Array.isArray(items), `${field} is missing`);
    return items;
  };
  const dictionaryEntries = (request, field) => {
    const items = dictionaryItems(request, field);
    const entries = Object.fromEntries(
      items.map((item) => [item.WFKey?.Value?.string, item.WFValue]),
    );
    expect(Object.keys(entries).length === items.length, `${field} contains duplicate keys`);
    return entries;
  };
  const findGuard = ({
    source,
    condition,
    comparisonKey,
    comparisonValue,
    message,
    failureInElse = false,
  }) => {
    const matches = actions
      .map((action, index) => ({ action, index }))
      .filter(({ action }) => {
        const candidate = parameters(action);
        return (
          identifier(action) === "is.workflow.actions.conditional" &&
          candidate.WFControlFlowMode === 0 &&
          candidate.WFCondition === condition &&
          referencedUUID(inputValue(action)) === parameters(source).UUID
        );
      });
    expect(matches.length === 1, `expected one guard for ${comparisonValue ?? "empty value"}`);
    const { action: start, index } = matches[0];
    if (comparisonKey) {
      expect(
        parameters(start)[comparisonKey] === comparisonValue,
        `guard comparison for ${comparisonValue} is wrong`,
      );
    }
    const failureIndex = index + (failureInElse ? 2 : 1);
    if (failureInElse) {
      expect(
        identifier(actions[index + 1]) === "is.workflow.actions.conditional" &&
          parameters(actions[index + 1]).WFControlFlowMode === 1 &&
          parameters(actions[index + 1]).GroupingIdentifier ===
            parameters(start).GroupingIdentifier,
        "positive URL guard must fail only in Otherwise",
      );
    }
    expect(
      identifier(actions[failureIndex]) === "is.workflow.actions.notification" &&
        parameters(actions[failureIndex]).WFNotificationActionBody === message,
      "invalid setup guard must show the recovery message",
    );
    expect(identifier(actions[failureIndex + 1]) === "is.workflow.actions.exit", "guard must stop");
    expect(
      identifier(actions[failureIndex + 2]) === "is.workflow.actions.conditional" &&
        parameters(actions[failureIndex + 2]).WFControlFlowMode === 2 &&
        parameters(actions[failureIndex + 2]).GroupingIdentifier ===
          parameters(start).GroupingIdentifier,
      "guard must have one matching end marker",
    );
    return index;
  };
  const assertEmptyGuard = (source, request, lowerBound, upperBound) => {
    const requestIndex = actions.indexOf(request);
    const matches = actions
      .map((action, index) => ({ action, index }))
      .filter(({ action, index }) => {
        const candidate = parameters(action);
        return (
          index > lowerBound &&
          index < requestIndex &&
          index < upperBound &&
          identifier(action) === "is.workflow.actions.conditional" &&
          candidate.WFControlFlowMode === 0 &&
          candidate.WFCondition === 101 &&
          referencedUUID(inputValue(action)) === parameters(source).UUID
        );
      });
    expect(matches.length === 1, "text path must contain one empty-value guard");
    const { action: start, index } = matches[0];
    expect(identifier(actions[index + 1]) === "is.workflow.actions.exit", "empty text must stop");
    expect(
      identifier(actions[index + 2]) === "is.workflow.actions.conditional" &&
        parameters(actions[index + 2]).WFControlFlowMode === 2 &&
        parameters(actions[index + 2]).GroupingIdentifier ===
          parameters(start).GroupingIdentifier,
      "empty-text guard must close before the request",
    );
  };

  expect(shortcut.WFWorkflowName === "Wafra Capture", "name must be Wafra Capture");
  expect(
    same(shortcut.WFWorkflowInputContentItemClasses, [
      "WFStringContentItem",
      "WFMessageContentItem",
    ]),
    "Shortcut Input must accept only Text and Messages",
  );
  expect(shortcut.WFWorkflowHasShortcutInputVariables === true, "Shortcut Input is disabled");

  const questions = shortcut.WFWorkflowImportQuestions;
  expect(Array.isArray(questions) && questions.length === 1, "expected one import question");
  expect(
    questions[0].Category === "Parameter" &&
      questions[0].ParameterKey === "WFTextActionText" &&
      questions[0].ActionIndex === 0 &&
      questions[0].DefaultValue === "",
    "import question must protect the first Text action",
  );
  const setupText = actions[0];
  expect(
    identifier(setupText) === "is.workflow.actions.gettext" &&
      parameters(setupText).WFTextActionText === "",
    "first action must be the empty setup Text",
  );
  expect(
    actions.filter(
      (action) =>
        identifier(action) === "is.workflow.actions.gettext" &&
        parameters(action).WFTextActionText === "",
    ).length === 1,
    "expected exactly one empty setup Text action",
  );

  const forbiddenAction = actions.find((action) =>
    /documentpicker|(?:^|\.)(?:file|folder)(?:\.|$)|(?:^|\.)(?:get|save|move|create|delete|append)file(?:\.|$)/i.test(
      identifier(action),
    ),
  );
  expect(!forbiddenAction, "file and folder actions are prohibited");
  expect(actions.length === 50, "expected the exact audited 50-action graph");
  const serialized = JSON.stringify(shortcut);
  expect(
    !/config\.json|wafra-relay\.|khanjer496/i.test(serialized),
    "retired paths, relay origins, or user identifiers must not be literal",
  );
  const literalStrings = [];
  const collectStrings = (value) => {
    if (typeof value === "string") literalStrings.push(value);
    else if (Array.isArray(value)) value.forEach(collectStrings);
    else if (value && typeof value === "object") Object.values(value).forEach(collectStrings);
  };
  collectStrings(shortcut);
  expect(
    literalStrings.filter((value) => /^https:\/\//i.test(value)).every((value) => value === "https://"),
    "the shared graph contains a literal HTTPS endpoint",
  );
  expect(
    literalStrings
      .filter((value) => /^Bearer\s/i.test(value))
      .every((value) => value === "Bearer \ufffc"),
    "the shared graph contains a literal bearer credential",
  );

  const dictionary = actions[1];
  expect(identifier(dictionary) === "is.workflow.actions.detect.dictionary", "setup is not parsed");
  assertReference(parameters(dictionary).WFInput, setupText, "Text");
  const getters = actions.filter(
    (action) => identifier(action) === "is.workflow.actions.getvalueforkey",
  );
  expect(
    same(getters.map((action) => parameters(action).WFDictionaryKey), ["v", "url", "token"]),
    "setup must read exactly v, url, and token",
  );
  for (const getter of getters) {
    assertReference(parameters(getter).WFInput, dictionary, "Dictionary");
  }
  const [version, url, token] = getters;
  expect(
    parameters(version).CustomOutputName === "Version" &&
      parameters(url).CustomOutputName === "URL" &&
      parameters(token).CustomOutputName === "Token",
    "setup values need stable typed output names",
  );
  const versionText = named("Version Text");
  const urlText = named("URL Text");
  expect(
    identifier(versionText) === "is.workflow.actions.gettext" &&
      identifier(urlText) === "is.workflow.actions.gettext",
    "generic setup values must be normalized through Text actions",
  );
  assertReference(parameters(versionText).WFTextActionText, version, "Version");
  assertReference(parameters(urlText).WFTextActionText, url, "URL");
  expect(
    actions.indexOf(versionText) > actions.indexOf(token) &&
      actions.indexOf(urlText) > actions.indexOf(versionText),
    "setup Text normalization is out of order",
  );
  const invalidMessage = "Open Wafra and copy a new setup code";
  const validationIndexes = [
    findGuard({
      source: versionText,
      condition: 5,
      comparisonKey: "WFConditionalActionString",
      comparisonValue: "1",
      message: invalidMessage,
    }),
    findGuard({
      source: urlText,
      condition: 8,
      comparisonKey: "WFConditionalActionString",
      comparisonValue: "https://",
      message: invalidMessage,
      failureInElse: true,
    }),
    findGuard({
      source: urlText,
      condition: 9,
      comparisonKey: "WFConditionalActionString",
      comparisonValue: "/v1/ingest",
      message: invalidMessage,
      failureInElse: true,
    }),
    findGuard({ source: token, condition: 101, message: invalidMessage }),
  ];
  expect(
    same(validationIndexes, [...validationIndexes].sort((a, b) => a - b)),
    "setup validation guards are out of order",
  );

  const noInputMatches = actions
    .map((action, index) => ({ action, index }))
    .filter(({ action }) => {
      const candidate = parameters(action);
      return (
        identifier(action) === "is.workflow.actions.conditional" &&
        candidate.WFControlFlowMode === 0 &&
        candidate.WFCondition === 101 &&
        extensionAttachment(inputValue(action))?.Type === "ExtensionInput"
      );
    });
  expect(noInputMatches.length === 1, "expected one no-input setup guard");
  const { action: noInput, index: noInputIndex } = noInputMatches[0];
  expect(noInputIndex > validationIndexes.at(-1) + 3, "Shortcut Input is read before setup validates");
  expect(
    identifier(actions[noInputIndex + 1]) === "is.workflow.actions.notification" &&
      parameters(actions[noInputIndex + 1]).WFNotificationActionBody ===
        "Wafra Capture is ready",
    "no-input run must report readiness",
  );
  expect(identifier(actions[noInputIndex + 2]) === "is.workflow.actions.exit", "no-input run must stop");
  expect(
    identifier(actions[noInputIndex + 3]) === "is.workflow.actions.conditional" &&
      parameters(actions[noInputIndex + 3]).WFControlFlowMode === 2 &&
      parameters(actions[noInputIndex + 3]).GroupingIdentifier ===
        parameters(noInput).GroupingIdentifier,
    "no-input guard must close exactly once",
  );

  const randomActions = actions.filter(
    (action) => identifier(action) === "is.workflow.actions.number.random",
  );
  expect(randomActions.length === 2, "UUID seed must use two independent random values");
  for (const random of randomActions) {
    expect(
      parameters(random).WFRandomNumberMinimum === 0 &&
        parameters(random).WFRandomNumberMaximum === 999999999999999,
      "UUID random seed range is wrong",
    );
  }
  expect(actions.indexOf(randomActions[0]) > noInputIndex + 3, "UUID is generated on the setup run");
  const seed = named("UUID Seed");
  const seedToken = parameters(seed).WFTextActionText;
  expect(seedToken?.Value?.string === "\ufffc:\ufffc:\ufffc", "UUID seed composition is wrong");
  assertReference(seedToken, randomActions[0], "Random Number");
  assertReference(seedToken, randomActions[1], "Random Number", "{2, 1}");
  expect(attachment(seedToken, "{4, 1}")?.Type === "CurrentDate", "UUID seed lacks a date");
  const hash = onlyIdentifier("is.workflow.actions.hash");
  expect(parameters(hash).WFHashType === "SHA256", "UUID seed must use SHA-256");
  assertReference(parameters(hash).WFInput, seed, "UUID Seed");
  const eventId = named("UUID");
  expect(identifier(eventId) === "is.workflow.actions.text.replace", "eventId is not UUID formatted");
  expect(
    parameters(eventId).WFInput?.WFSerializationType === "WFTextTokenString" &&
      parameters(eventId).WFInput?.Value?.string === "\ufffc",
    "Replace Text input must use a token-string attachment",
  );
  assertReference(parameters(eventId).WFInput, hash, "Hash");
  expect(
    parameters(eventId).WFReplaceTextRegularExpression === true &&
      parameters(eventId).WFReplaceTextCaseSensitive === false &&
      parameters(eventId).WFReplaceTextFind ===
        "^([0-9A-F]{8})([0-9A-F]{4})[0-9A-F]([0-9A-F]{3})[0-9A-F]([0-9A-F]{3})([0-9A-F]{12}).*$" &&
      parameters(eventId).WFReplaceTextReplace === "$1-$2-4$3-8$4-$5",
    "eventId formatter is not an RFC 4122 UUID shape",
  );

  const typeAction = onlyIdentifier("is.workflow.actions.getitemtype");
  expect(extensionAttachment(parameters(typeAction).WFInput)?.Type === "ExtensionInput", "Get Type must read Shortcut Input");
  const branchMatches = actions
    .map((action, index) => ({ action, index }))
    .filter(({ action }) => {
      const candidate = parameters(action);
      return (
        identifier(action) === "is.workflow.actions.conditional" &&
        candidate.WFControlFlowMode === 0 &&
        candidate.WFCondition === 4 &&
        candidate.WFConditionalActionString === "Text" &&
        referencedUUID(inputValue(action)) === parameters(typeAction).UUID
      );
    });
  expect(branchMatches.length === 1, "expected one Text-vs-Message type branch");
  const { action: branch, index: branchIndex } = branchMatches[0];
  expect(branchIndex > actions.indexOf(eventId), "type branch occurs before UUID generation completes");
  const branchMarkers = actions
    .map((action, index) => ({ action, index }))
    .filter(
      ({ action, index }) =>
        index > branchIndex &&
        identifier(action) === "is.workflow.actions.conditional" &&
        parameters(action).GroupingIdentifier === parameters(branch).GroupingIdentifier,
    );
  expect(
    branchMarkers.length === 2 &&
      parameters(branchMarkers[0].action).WFControlFlowMode === 1 &&
      parameters(branchMarkers[1].action).WFControlFlowMode === 2,
    "type branch must contain one Otherwise and one End",
  );
  const elseIndex = branchMarkers[0].index;
  const endIndex = branchMarkers[1].index;
  expect(
    endIndex === actions.length - 2,
    "type branch must close immediately before the terminal stop",
  );
  const terminalStop = actions.at(-1);
  expect(
    identifier(terminalStop) === "is.workflow.actions.exit" &&
      same(parameters(terminalStop), {}),
    "successful runs must end with an empty Stop This Shortcut action",
  );

  const manualText = named("Manual Text");
  const messageText = named("Message Text");
  const senderText = named("Sender Text");
  expect(
    actions.indexOf(manualText) > branchIndex && actions.indexOf(manualText) < elseIndex,
    "manual Text extraction is outside the Text branch",
  );
  expect(
    [messageText, senderText].every(
      (action) => actions.indexOf(action) > elseIndex && actions.indexOf(action) < endIndex,
    ),
    "Message details are outside the Message branch",
  );
  expect(
    same(attachment(parameters(manualText).WFTextActionText)?.Aggrandizements, [
      {
        Type: "WFCoercionVariableAggrandizement",
        CoercionItemClass: "WFStringContentItem",
      },
    ]),
    "manual path must coerce Shortcut Input directly to Text",
  );
  expect(
    same(attachment(parameters(messageText).WFTextActionText)?.Aggrandizements, [
      { Type: "WFPropertyVariableAggrandizement", PropertyName: "Content" },
      {
        Type: "WFCoercionVariableAggrandizement",
        CoercionItemClass: "WFStringContentItem",
      },
    ]),
    "Message text must come from Content and be coerced to Text",
  );
  expect(
    same(attachment(parameters(senderText).WFTextActionText)?.Aggrandizements, [
      { Type: "WFPropertyVariableAggrandizement", PropertyName: "Sender" },
      {
        Type: "WFCoercionVariableAggrandizement",
        CoercionItemClass: "WFStringContentItem",
      },
    ]),
    "sender must come from Sender and be explicitly coerced to Text",
  );
  expect(
    !actions.some((action) =>
      [
        "is.workflow.actions.format.date",
        "is.workflow.actions.converttimezone",
      ].includes(identifier(action)),
    ) &&
      !JSON.stringify(actions.slice(elseIndex + 1, endIndex)).includes(
        '"PropertyName":"Date"',
      ),
    "iOS 26 Message objects expose no Date detail; the graph must omit receivedAt",
  );

  const requests = actions.filter(
    (action) => identifier(action) === "is.workflow.actions.downloadurl",
  );
  expect(requests.length === 2, "manual and Message paths need separate requests");
  const manualRequest = requests.find(
    (request) => actions.indexOf(request) > branchIndex && actions.indexOf(request) < elseIndex,
  );
  const messageRequest = requests.find(
    (request) => actions.indexOf(request) > elseIndex && actions.indexOf(request) < endIndex,
  );
  expect(manualRequest && messageRequest, "request actions are outside their input branches");
  assertEmptyGuard(manualText, manualRequest, branchIndex, elseIndex);
  assertEmptyGuard(messageText, messageRequest, elseIndex, endIndex);

  const assertRequest = (request, expectedBody, expectedLiterals = {}) => {
    expect(parameters(request).WFHTTPMethod === "POST", "request method must be POST");
    assertReference(parameters(request).WFURL, urlText, "URL Text");
    const headers = dictionaryEntries(request, "WFHTTPHeaders");
    expect(
      same(Object.keys(headers), ["Authorization", "Content-Type"]),
      "request headers must be Authorization and Content-Type",
    );
    expect(headers.Authorization?.Value?.string === "Bearer \ufffc", "Authorization is not Bearer token dataflow");
    assertReference(headers.Authorization, token, "Token", "{7, 1}");
    expect(headers["Content-Type"]?.Value?.string === "application/json", "request is not JSON");
    const body = dictionaryEntries(request, "WFJSONValues");
    expect(
      same(Object.keys(body), [
        ...Object.keys(expectedBody),
        ...Object.keys(expectedLiterals),
      ]),
      "request JSON keys are wrong",
    );
    for (const [key, [source, outputName]] of Object.entries(expectedBody)) {
      assertReference(body[key], source, outputName);
    }
    for (const [key, literal] of Object.entries(expectedLiterals)) {
      expect(
        body[key]?.Value?.string === literal &&
          !body[key]?.Value?.attachmentsByRange,
        `${key} must be the exact non-secret literal ${literal}`,
      );
    }
    expect(
      referencedUUID(body.eventId) === parameters(eventId).UUID &&
        !randomActions.some((random) => referencedUUID(body.eventId) === parameters(random).UUID),
      "eventId must reference the UUID formatter, not Random Number",
    );
  };
  assertRequest(manualRequest, {
    text: [manualText, "Manual Text"],
    eventId: [eventId, "UUID"],
  });
  assertRequest(
    messageRequest,
    {
      text: [messageText, "Message Text"],
      sender: [senderText, "Sender Text"],
      eventId: [eventId, "UUID"],
    },
    { automation: "message" },
  );

  const manualSerialized = JSON.stringify(actions.slice(branchIndex + 1, elseIndex));
  expect(
    !manualSerialized.includes('"PropertyName":"Sender"') &&
      !manualSerialized.includes('"PropertyName":"Date"'),
    "manual Text path must omit sender and Message-only details",
  );
  const actionOutputReferences = [];
  const collectReferences = (value) => {
    if (Array.isArray(value)) value.forEach(collectReferences);
    else if (value && typeof value === "object") {
      if (value.Type === "ActionOutput" && value.OutputUUID) {
        actionOutputReferences.push(value.OutputUUID);
      }
      Object.values(value).forEach(collectReferences);
    }
  };
  collectReferences(shortcut);
  for (const request of requests) {
    expect(
      !actionOutputReferences.includes(parameters(request).UUID),
      "request response is consumed, displayed, copied, or logged",
    );
  }

  console.log(
    "PASS: Wafra Capture has validated import setup, typed Text/Message dataflow, UUID event IDs, and credential-free POST requests",
  );
} catch (error) {
  console.error(`FAIL: semantic action graph: ${error.message}`);
  process.exit(1);
}
NODE
