import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = join(import.meta.dirname, "..", "..");
const builderPath = join(repoRoot, "scripts", "build-ios-history-shortcut.mjs");
const { buildHistoryShortcut, verifyHistoryShortcutGraph } = await import(
  pathToFileURL(builderPath)
);

const FIND = "com.apple.MobileSMS.MessageEntity";
const PREPARE_V3 = "app.wafra.ios.PrepareWafraHistoryMessageV3Intent";
const IMPORT_V2 = "app.wafra.ios.ImportWafraPreparedHistoryV2Intent";
const DISCARD_V2 = "app.wafra.ios.DiscardWafraPreparedHistoryV2Intent";
const REPEAT_EACH = "is.workflow.actions.repeat.each";
const REPEAT_COUNT = "is.workflow.actions.repeat.count";
const GET_ITEM = "is.workflow.actions.getitemfromlist";

const shortcut = buildHistoryShortcut();
const actions = shortcut.WFWorkflowActions;
const identifiers = actions.map((action) => action.WFWorkflowActionIdentifier);
const actionParams = (action) => action.WFWorkflowActionParameters ?? {};
const actionIndex = (action) => actions.indexOf(action);
const attachment = (value) => value?.Value ?? value;
const textAttachment = (value) => {
  assert.equal(value?.WFSerializationType, "WFTextTokenString");
  assert.equal(value?.Value?.string, "\ufffc");
  assert.deepEqual(Object.keys(value?.Value?.attachmentsByRange ?? {}), [
    "{0, 1}",
  ]);
  return value.Value.attachmentsByRange["{0, 1}"];
};
const assertNamedVariable = (value, variableName) => {
  assert.equal(value?.WFSerializationType, "WFTextTokenAttachment");
  assert.deepEqual(value.Value, { Type: "Variable", VariableName: variableName });
};
const assertActionOutput = (value, outputUUID, outputName) => {
  assert.equal(value?.WFSerializationType, "WFTextTokenAttachment");
  assert.deepEqual(value.Value, {
    Type: "ActionOutput",
    OutputUUID: outputUUID,
    OutputName: outputName,
  });
};
const assertDescriptor = (value, identifier) => {
  assert.deepEqual(value, {
    TeamIdentifier: "UV7YN4GQ66",
    BundleIdentifier: "app.wafra.ios",
    Name: "Wafra",
    AppIntentIdentifier: identifier,
  });
};
const uniqueAction = (description, predicate) => {
  const matches = actions.filter(predicate);
  assert.equal(matches.length, 1, `expected one ${description}`);
  return matches[0];
};
const outputAction = (identifier, outputName) =>
  uniqueAction(
    `${outputName} action`,
    (action) =>
      action.WFWorkflowActionIdentifier === identifier &&
      actionParams(action).CustomOutputName === outputName,
  );
const controlBounds = (startAction) => {
  const start = actionParams(startAction);
  const points = actions
    .map((action, index) => ({ action, index }))
    .filter(
      ({ action }) =>
        action.WFWorkflowActionIdentifier ===
          startAction.WFWorkflowActionIdentifier &&
        actionParams(action).GroupingIdentifier === start.GroupingIdentifier,
    );
  assert.deepEqual(
    points.map(({ action }) => actionParams(action).WFControlFlowMode),
    [0, 2],
  );
  return { start: points[0].index, end: points[1].index };
};
const conditionalInput = (action) =>
  attachment(actionParams(action).WFInput?.Variable);
assert.equal(shortcut.WFWorkflowName, "Wafra History Import");
assert.deepEqual(shortcut.WFWorkflowInputContentItemClasses, []);
assert.equal(shortcut.WFWorkflowHasShortcutInputVariables, false);
assert.deepEqual(shortcut.WFWorkflowImportQuestions, []);
assert.equal(shortcut.WFWorkflowHasOutputFallback, false);
assert.deepEqual(shortcut.WFWorkflowOutputContentItemClasses, []);
assert.equal(verifyHistoryShortcutGraph(shortcut), true);
assert.equal(JSON.stringify(shortcut), JSON.stringify(buildHistoryShortcut()));

const findActions = actions.filter(
  (action) => action.WFWorkflowActionIdentifier === FIND,
);
assert.equal(
  findActions.length,
  4,
  "production must use two bounded halves plus two one-item sort probes",
);
const findByOrderAndLimit = (sortOrder, limit) =>
  uniqueAction(
    `${sortOrder} limit-${limit} Find Messages action`,
    (action) =>
      action.WFWorkflowActionIdentifier === FIND &&
      actionParams(action).WFContentItemSortOrder === sortOrder &&
      actionParams(action).WFContentItemLimitNumber === limit,
  );
const latestFind = findByOrderAndLimit("Latest First", 1500);
const oldestFind = findByOrderAndLimit("Oldest First", 1500);
const latestProbeFind = findByOrderAndLimit("Latest First", 1);
const oldestProbeFind = findByOrderAndLimit("Oldest First", 1);
assert.notEqual(actionParams(latestFind).UUID, actionParams(oldestFind).UUID);
const latestCount = outputAction(
  "is.workflow.actions.count",
  "Latest Messages Found",
);
assertActionOutput(
  actionParams(latestCount).WFInput,
  actionParams(latestFind).UUID,
  "Message",
);

for (const findAction of findActions) {
  const find = actionParams(findAction);
  assert.equal(find.WFContentItemLimitEnabled, true);
  assert.equal(
    [1, 1500].includes(find.WFContentItemLimitNumber),
    true,
  );
  assert.equal(find.WFContentItemSortProperty, "date");
  assert.deepEqual(
    find.WFContentItemFilter?.Value?.WFActionParameterFilterTemplates,
    [],
    "two-ended production queries must not contain any filter row",
  );
}

const modelTwoEndedCoverage = (
  total,
  { latestMode = "correct", oldestMode = "correct" } = {},
) => {
  const source = Array.from({ length: total }, (_, index) => `m${index + 1}`);
  const latest = latestMode === "shifted"
    ? source.slice(1, 1501)
    : source.slice(0, 1500);
  const oldest = oldestMode === "ignored"
    ? [...latest]
    : oldestMode === "limit-then-sort"
      ? [...latest].reverse()
      : oldestMode === "middle-window"
        ? source.slice(500, 2000).reverse()
      : source.slice(-1500).reverse();
  if (latest.length === 0) return { outcome: "empty" };
  if (latest.length !== oldest.length) return { outcome: "count-mismatch" };
  const newestExtreme = latest[0];
  const boundary = latest.at(-1);
  const oldestExtreme = oldest[0];
  if (newestExtreme !== source[0]) return { outcome: "latest-probe-mismatch" };
  if (oldestExtreme !== source.at(-1)) return { outcome: "oldest-probe-mismatch" };
  if (oldestExtreme === newestExtreme && latest.length > 1) {
    return { outcome: "same-extreme" };
  }
  const reversedOldest = [...oldest].reverse();
  if (!reversedOldest.includes(boundary)) return { outcome: "no-overlap" };
  const staged = [...latest, ...reversedOldest];
  const unique = [...new Set(staged)];
  return {
    outcome: "accepted",
    unique,
    duplicates: staged.length - unique.length,
  };
};

for (const total of [1, 2, 1499, 1500, 1501, 2392, 2999]) {
  const modeled = modelTwoEndedCoverage(total);
  assert.equal(modeled.outcome, "accepted", `stable ${total}-Message case rejected`);
  assert.deepEqual(
    modeled.unique,
    Array.from({ length: total }, (_, index) => `m${index + 1}`),
    `stable ${total}-Message case lost or reordered a Message`,
  );
}
assert.deepEqual(modelTwoEndedCoverage(2392), {
  outcome: "accepted",
  unique: Array.from({ length: 2392 }, (_, index) => `m${index + 1}`),
  duplicates: 608,
});
assert.equal(modelTwoEndedCoverage(0).outcome, "empty");
assert.equal(modelTwoEndedCoverage(3000).outcome, "no-overlap");
assert.equal(modelTwoEndedCoverage(5000).outcome, "no-overlap");
assert.equal(
  modelTwoEndedCoverage(2392, { oldestMode: "ignored" }).outcome,
  "oldest-probe-mismatch",
);
assert.equal(
  modelTwoEndedCoverage(2392, { oldestMode: "limit-then-sort" }).outcome,
  "oldest-probe-mismatch",
);
assert.equal(
  modelTwoEndedCoverage(2392, { oldestMode: "middle-window" }).outcome,
  "oldest-probe-mismatch",
);
assert.equal(
  modelTwoEndedCoverage(2392, { latestMode: "shifted" }).outcome,
  "latest-probe-mismatch",
);

assert.equal(
  actions.some((action) =>
    ["is.workflow.actions.date", "is.workflow.actions.adjustdate"].includes(
      action.WFWorkflowActionIdentifier,
    )),
  false,
  "production must not carry external Date-range inputs into the V3 intent",
);
assert.equal(
  actions.some((action) =>
    ["History Start", "History End"].includes(actionParams(action).WFVariableName),
  ),
  false,
  "production must not retain obsolete Date-range variables",
);

const sessionTextAction = outputAction("is.workflow.actions.gettext", "Session ID");
const sessionBinding = {
  Type: "ActionOutput",
  OutputUUID: actionParams(sessionTextAction).UUID,
  OutputName: "Session ID",
};
assert.ok(actionIndex(sessionTextAction) < actionIndex(latestFind));

const initialPosition = outputAction(
  "is.workflow.actions.number",
  "Initial Prepared Position",
);
assert.equal(Number(actionParams(initialPosition).WFNumberActionNumber), 0);
const positionSetters = actions.filter(
  (action) =>
    action.WFWorkflowActionIdentifier === "is.workflow.actions.setvariable" &&
    actionParams(action).WFVariableName === "Prepared Position",
);
assert.equal(positionSetters.length, 3);
const initialPositionSetter = positionSetters.find(
  (action) =>
    attachment(actionParams(action).WFInput)?.OutputUUID ===
    actionParams(initialPosition).UUID,
);
assert.ok(initialPositionSetter);
assert.ok(actionIndex(initialPositionSetter) < actionIndex(latestFind));

const coverageBoundaryItem = uniqueAction(
  "latest-half coverage boundary item",
  (action) =>
    action.WFWorkflowActionIdentifier === GET_ITEM &&
    actionParams(action).WFItemSpecifier === "Last Item" &&
    attachment(actionParams(action).WFInput)?.OutputUUID ===
      actionParams(latestFind).UUID,
);
assertActionOutput(
  actionParams(coverageBoundaryItem).WFInput,
  actionParams(latestFind).UUID,
  "Message",
);
const coverageBoundaryGuid = outputAction(
  "is.workflow.actions.gettext",
  "Coverage Boundary GUID",
);
assert.deepEqual(textAttachment(actionParams(coverageBoundaryGuid).WFTextActionText), {
  Type: "ActionOutput",
  OutputUUID: actionParams(coverageBoundaryItem).UUID,
  OutputName: "Item from List",
  Aggrandizements: [
    { Type: "WFPropertyVariableAggrandizement", PropertyName: "GUID" },
    {
      Type: "WFCoercionVariableAggrandizement",
      CoercionItemClass: "WFStringContentItem",
    },
  ],
});
assert.ok(actionIndex(coverageBoundaryGuid) < actionIndex(oldestFind));
const newestExtremeItem = uniqueAction(
  "newest extreme item",
  (action) =>
    action.WFWorkflowActionIdentifier === GET_ITEM &&
    actionParams(action).WFItemSpecifier === "First Item" &&
    attachment(actionParams(action).WFInput)?.OutputUUID ===
      actionParams(latestFind).UUID,
);
const newestExtremeGuid = outputAction(
  "is.workflow.actions.gettext",
  "Newest Extreme GUID",
);
assert.deepEqual(textAttachment(actionParams(newestExtremeGuid).WFTextActionText), {
  Type: "ActionOutput",
  OutputUUID: actionParams(newestExtremeItem).UUID,
  OutputName: "Item from List",
  Aggrandizements: [
    { Type: "WFPropertyVariableAggrandizement", PropertyName: "GUID" },
    {
      Type: "WFCoercionVariableAggrandizement",
      CoercionItemClass: "WFStringContentItem",
    },
  ],
});
const newestExtremeEmpty = uniqueAction(
  "empty newest-extreme refusal",
  (action) => {
    const candidate = actionParams(action);
    const input = conditionalInput(action);
    return (
      action.WFWorkflowActionIdentifier === "is.workflow.actions.conditional" &&
      candidate.WFControlFlowMode === 0 &&
      candidate.WFCondition === 101 &&
      input?.Type === "ActionOutput" &&
      input.OutputUUID === actionParams(newestExtremeGuid).UUID
    );
  },
);
const newestExtremeEmptyBounds = controlBounds(newestExtremeEmpty);
assert.ok(newestExtremeEmptyBounds.end < actionIndex(oldestFind));
const emptyBoundaryCondition = uniqueAction(
  "empty coverage-boundary refusal",
  (action) => {
    const candidate = actionParams(action);
    const input = conditionalInput(action);
    return (
      action.WFWorkflowActionIdentifier === "is.workflow.actions.conditional" &&
      candidate.WFControlFlowMode === 0 &&
      candidate.WFCondition === 101 &&
      input?.Type === "ActionOutput" &&
      input.OutputUUID === actionParams(coverageBoundaryGuid).UUID
    );
  },
);
const emptyBoundaryBounds = controlBounds(emptyBoundaryCondition);
const emptyBoundaryActions = actions.slice(
  emptyBoundaryBounds.start + 1,
  emptyBoundaryBounds.end,
);
assert.equal(
  emptyBoundaryActions.some(
    (action) => action.WFWorkflowActionIdentifier === "is.workflow.actions.alert",
  ),
  true,
);
const zeroLatestCondition = uniqueAction(
  "zero-result refusal before boundary access",
  (action) => {
    const candidate = actionParams(action);
    const input = conditionalInput(action);
    return (
      action.WFWorkflowActionIdentifier === "is.workflow.actions.conditional" &&
      candidate.WFControlFlowMode === 0 &&
      candidate.WFCondition === 1 &&
      candidate.WFNumberValue === 0 &&
      input?.Type === "ActionOutput" &&
      input.OutputUUID === actionParams(latestCount).UUID
    );
  },
);
const zeroLatestBounds = controlBounds(zeroLatestCondition);
assert.ok(zeroLatestBounds.end < actionIndex(coverageBoundaryItem));
const zeroLatestActions = actions.slice(
  zeroLatestBounds.start + 1,
  zeroLatestBounds.end,
);
assert.equal(
  zeroLatestActions.some(
    (action) => action.WFWorkflowActionIdentifier === "is.workflow.actions.alert",
  ),
  true,
);
assert.equal(
  zeroLatestActions.some(
    (action) => action.WFWorkflowActionIdentifier === "is.workflow.actions.exit",
  ),
  true,
);
assert.equal(
  emptyBoundaryActions.some(
    (action) => action.WFWorkflowActionIdentifier === "is.workflow.actions.exit",
  ),
  true,
);

const initialOverlap = outputAction(
  "is.workflow.actions.number",
  "Initial Coverage Overlap",
);
assert.equal(Number(actionParams(initialOverlap).WFNumberActionNumber), 0);
const overlapSetters = actions.filter(
  (action) =>
    action.WFWorkflowActionIdentifier === "is.workflow.actions.setvariable" &&
    actionParams(action).WFVariableName === "Coverage Overlap",
);
assert.equal(overlapSetters.length, 2);
const initialOverlapSetter = overlapSetters.find(
  (action) =>
    attachment(actionParams(action).WFInput)?.OutputUUID ===
    actionParams(initialOverlap).UUID,
);
assert.ok(initialOverlapSetter);
assert.ok(actionIndex(initialOverlapSetter) < actionIndex(latestFind));

const batches = [latestFind, oldestFind].map((findAction) => {
  const find = actionParams(findAction);
  const isOldestBatch = find.WFContentItemSortOrder === "Oldest First";
  const oldestCount = isOldestBatch
    ? outputAction("is.workflow.actions.count", "Oldest Messages Found")
    : null;
  if (oldestCount) {
    assertActionOutput(actionParams(oldestCount).WFInput, find.UUID, "Message");
  }
  const repeatStart = uniqueAction(
    `${find.WFContentItemSortOrder} repeat`,
    (action) =>
      action.WFWorkflowActionIdentifier ===
        (isOldestBatch ? REPEAT_COUNT : REPEAT_EACH) &&
      actionParams(action).WFControlFlowMode === 0 &&
      (isOldestBatch
        ? attachment(actionParams(action).WFRepeatCount)?.OutputUUID ===
          actionParams(oldestCount).UUID
        : attachment(actionParams(action).WFInput)?.OutputUUID === find.UUID),
  );
  const repeat = controlBounds(repeatStart);
  if (isOldestBatch) {
    assertActionOutput(
      actionParams(repeatStart).WFRepeatCount,
      actionParams(oldestCount).UUID,
      "Oldest Messages Found",
    );
  } else {
    assertActionOutput(actionParams(repeatStart).WFInput, find.UUID, "Message");
  }
  assert.ok(actionIndex(findAction) < repeat.start);
  assert.equal(
    actions[repeat.end + 1]?.WFWorkflowActionIdentifier,
    "is.workflow.actions.nothing",
    `${find.WFContentItemSortOrder} array must be released after preparation`,
  );

  const increment = uniqueAction(
    `${find.WFContentItemSortOrder} position increment`,
    (action) =>
      action.WFWorkflowActionIdentifier === "is.workflow.actions.math" &&
      actionParams(action).CustomOutputName === "Next Prepared Position" &&
      repeat.start < actionIndex(action) &&
      actionIndex(action) < repeat.end,
  );
  assert.equal(actionParams(increment).WFMathOperand, 1);
  assert.equal(actionParams(increment).WFMathOperation, undefined);
  assertNamedVariable(actionParams(increment).WFInput, "Prepared Position");
  const incrementSet = positionSetters.find(
    (action) =>
      attachment(actionParams(action).WFInput)?.OutputUUID ===
      actionParams(increment).UUID,
  );
  assert.ok(incrementSet);
  assertActionOutput(
    actionParams(incrementSet).WFInput,
    actionParams(increment).UUID,
    "Next Prepared Position",
  );
  assert.ok(actionIndex(increment) < actionIndex(incrementSet));

  let messageBinding = { Type: "Variable", VariableName: "Repeat Item" };
  if (isOldestBatch) {
    assert.ok(actionIndex(oldestCount) < repeat.start);

    const reverseBase = outputAction(
      "is.workflow.actions.math",
      "Oldest Reverse Base",
    );
    assertActionOutput(
      actionParams(reverseBase).WFInput,
      actionParams(oldestCount).UUID,
      "Oldest Messages Found",
    );
    assert.equal(actionParams(reverseBase).WFMathOperation, undefined);
    assert.equal(actionParams(reverseBase).WFMathOperand, 1);
    assert.ok(actionIndex(reverseBase) < repeat.start);

    const reverseIndex = outputAction(
      "is.workflow.actions.math",
      "Oldest Reverse Index",
    );
    assertActionOutput(
      actionParams(reverseIndex).WFInput,
      actionParams(reverseBase).UUID,
      "Oldest Reverse Base",
    );
    assert.equal(actionParams(reverseIndex).WFMathOperation, "-");
    assertNamedVariable(actionParams(reverseIndex).WFMathOperand, "Repeat Index");

    const reversedItem = uniqueAction(
      "reversed oldest-half Message",
      (action) =>
        action.WFWorkflowActionIdentifier === GET_ITEM &&
        actionParams(action).WFItemSpecifier === "Item At Index" &&
        repeat.start < actionIndex(action) &&
        actionIndex(action) < repeat.end,
    );
    assertActionOutput(actionParams(reversedItem).WFInput, find.UUID, "Message");
    assertActionOutput(
      actionParams(reversedItem).WFItemIndex,
      actionParams(reverseIndex).UUID,
      "Oldest Reverse Index",
    );
    assert.ok(actionIndex(reverseIndex) < actionIndex(reversedItem));
    messageBinding = {
      Type: "ActionOutput",
      OutputUUID: actionParams(reversedItem).UUID,
      OutputName: "Item from List",
    };
  }

  const overflow = uniqueAction(
    `${find.WFContentItemSortOrder} total-cap condition`,
    (action) => {
      const candidate = actionParams(action);
      const input = conditionalInput(action);
      return (
        action.WFWorkflowActionIdentifier === "is.workflow.actions.conditional" &&
        candidate.WFControlFlowMode === 0 &&
        candidate.WFCondition === 2 &&
        candidate.WFNumberValue === 10000 &&
        input?.Type === "Variable" &&
        input.VariableName === "Prepared Position" &&
        repeat.start < actionIndex(action) &&
        actionIndex(action) < repeat.end
      );
    },
  );
  const overflowBounds = controlBounds(overflow);
  const overflowActions = actions.slice(
    overflowBounds.start + 1,
    overflowBounds.end,
  );
  assert.equal(
    overflowActions.filter(
      (action) => action.WFWorkflowActionIdentifier === DISCARD_V2,
    ).length,
    1,
  );
  assert.equal(
    overflowActions.some(
      (action) => action.WFWorkflowActionIdentifier === "is.workflow.actions.exit",
    ),
    true,
  );

  const prepareAction = uniqueAction(
    `${find.WFContentItemSortOrder} Prepare V2`,
    (action) =>
      action.WFWorkflowActionIdentifier === PREPARE_V3 &&
      repeat.start < actionIndex(action) &&
      actionIndex(action) < repeat.end,
  );
  const prepare = actionParams(prepareAction);
  assert.deepEqual(
    Object.keys(prepare).sort(),
    [
      "AppIntentDescriptor",
      "UUID",
      "body",
      "date",
      "messageGUID",
      "position",
      "sender",
      "sessionId",
    ].sort(),
  );
  assertDescriptor(prepare.AppIntentDescriptor, "PrepareWafraHistoryMessageV3Intent");
  assert.deepEqual(textAttachment(prepare.sessionId), sessionBinding);
  assertNamedVariable(prepare.position, "Prepared Position");
  assert.equal("rangeStart" in prepare, false);
  assert.equal("rangeEnd" in prepare, false);

  const extractors = new Map(
    actions
      .slice(repeat.start + 1, repeat.end)
      .filter(
        (action) =>
          action.WFWorkflowActionIdentifier === "is.workflow.actions.gettext",
      )
      .map((action) => [actionParams(action).CustomOutputName, action]),
  );
  for (const [parameterName, outputName, propertyName] of [
    ["messageGUID", "Message GUID", "GUID"],
    ["body", "Message Body", "Body"],
    ["sender", "Message Sender", "Sender"],
  ]) {
    const extractor = extractors.get(outputName);
    assert.ok(extractor);
    const extraction = actionParams(extractor);
    const bound = textAttachment(extraction.WFTextActionText);
    assert.deepEqual({ ...bound, Aggrandizements: undefined }, {
      ...messageBinding,
      Aggrandizements: undefined,
    });
    assert.deepEqual(bound.Aggrandizements, [
      { Type: "WFPropertyVariableAggrandizement", PropertyName: propertyName },
      {
        Type: "WFCoercionVariableAggrandizement",
        CoercionItemClass: "WFStringContentItem",
      },
    ]);
    assert.deepEqual(textAttachment(prepare[parameterName]), {
      Type: "ActionOutput",
      OutputUUID: extraction.UUID,
      OutputName: outputName,
    });
  }
  const date = textAttachment(prepare.date);
  assert.deepEqual({ ...date, Aggrandizements: undefined }, {
    ...messageBinding,
    Aggrandizements: undefined,
  });
  assert.deepEqual(date.Aggrandizements, [
    { Type: "WFPropertyVariableAggrandizement", PropertyName: "date" },
  ]);

  return { repeat, increment, prepare, extractors };
});

const [latestBatch, oldestBatch] = batches;
assert.ok(
  latestBatch.repeat.end + 1 < actionIndex(oldestFind),
  "the latest-first array must be released before the oldest query starts",
);
assert.ok(
  actionIndex(coverageBoundaryGuid) < latestBatch.repeat.end + 1,
  "coverage boundary must be reduced to scalar text before releasing the latest array",
);
assert.ok(
  actionIndex(newestExtremeGuid) < latestBatch.repeat.end + 1,
  "newest extreme must be reduced to scalar text before releasing the latest array",
);
assert.equal(identifiers.filter((identifier) => identifier === PREPARE_V3).length, 2);
assert.equal(identifiers.filter((identifier) => identifier === DISCARD_V2).length, 8);

const oldestCount = outputAction(
  "is.workflow.actions.count",
  "Oldest Messages Found",
);
const oldestExtremeItem = uniqueAction(
  "oldest extreme item",
  (action) =>
    action.WFWorkflowActionIdentifier === GET_ITEM &&
    actionParams(action).WFItemSpecifier === "First Item" &&
    attachment(actionParams(action).WFInput)?.OutputUUID ===
      actionParams(oldestFind).UUID,
);
const oldestExtremeGuid = outputAction(
  "is.workflow.actions.gettext",
  "Oldest Extreme GUID",
);
assert.deepEqual(textAttachment(actionParams(oldestExtremeGuid).WFTextActionText), {
  Type: "ActionOutput",
  OutputUUID: actionParams(oldestExtremeItem).UUID,
  OutputName: "Item from List",
  Aggrandizements: [
    { Type: "WFPropertyVariableAggrandizement", PropertyName: "GUID" },
    {
      Type: "WFCoercionVariableAggrandizement",
      CoercionItemClass: "WFStringContentItem",
    },
  ],
});
const assertExtremeProbe = ({ findAction, outputName, expectedGuid }) => {
  const find = actionParams(findAction);
  const item = uniqueAction(
    `${outputName} item`,
    (action) =>
      action.WFWorkflowActionIdentifier === GET_ITEM &&
      actionParams(action).WFItemSpecifier === "First Item" &&
      attachment(actionParams(action).WFInput)?.OutputUUID === find.UUID,
  );
  const guid = outputAction("is.workflow.actions.gettext", outputName);
  assert.deepEqual(textAttachment(actionParams(guid).WFTextActionText), {
    Type: "ActionOutput",
    OutputUUID: actionParams(item).UUID,
    OutputName: "Item from List",
    Aggrandizements: [
      { Type: "WFPropertyVariableAggrandizement", PropertyName: "GUID" },
      {
        Type: "WFCoercionVariableAggrandizement",
        CoercionItemClass: "WFStringContentItem",
      },
    ],
  });
  const mismatch = uniqueAction(
    `${outputName} mismatch refusal`,
    (action) => {
      const candidate = actionParams(action);
      const input = conditionalInput(action);
      const comparison =
        candidate.WFConditionalActionString?.Value?.attachmentsByRange?.[
          "{0, 1}"
        ];
      return (
        action.WFWorkflowActionIdentifier === "is.workflow.actions.conditional" &&
        candidate.WFControlFlowMode === 0 &&
        candidate.WFCondition === 5 &&
        input?.Type === "ActionOutput" &&
        input.OutputUUID === actionParams(guid).UUID &&
        comparison?.Type === "ActionOutput" &&
        comparison.OutputUUID === actionParams(expectedGuid).UUID
      );
    },
  );
  const bounds = controlBounds(mismatch);
  const failureActions = actions.slice(bounds.start + 1, bounds.end);
  assert.equal(
    failureActions.filter(
      (action) => action.WFWorkflowActionIdentifier === DISCARD_V2,
    ).length,
    1,
  );
  assert.equal(
    failureActions.some(
      (action) => action.WFWorkflowActionIdentifier === "is.workflow.actions.exit",
    ),
    true,
  );
  return { item, guid, bounds };
};
const latestExtremeProbe = assertExtremeProbe({
  findAction: latestProbeFind,
  outputName: "Latest Probe GUID",
  expectedGuid: newestExtremeGuid,
});
const oldestExtremeProbe = assertExtremeProbe({
  findAction: oldestProbeFind,
  outputName: "Oldest Probe GUID",
  expectedGuid: oldestExtremeGuid,
});
assert.ok(actionIndex(oldestExtremeGuid) < actionIndex(latestProbeFind));
assert.ok(latestExtremeProbe.bounds.end < actionIndex(oldestProbeFind));
assert.ok(oldestExtremeProbe.bounds.end < oldestBatch.repeat.start);
const oldestExtremeEmpty = uniqueAction(
  "empty oldest-extreme refusal",
  (action) => {
    const candidate = actionParams(action);
    const input = conditionalInput(action);
    return (
      action.WFWorkflowActionIdentifier === "is.workflow.actions.conditional" &&
      candidate.WFControlFlowMode === 0 &&
      candidate.WFCondition === 101 &&
      input?.Type === "ActionOutput" &&
      input.OutputUUID === actionParams(oldestExtremeGuid).UUID
    );
  },
);
const oldestExtremeEmptyBounds = controlBounds(oldestExtremeEmpty);
const oldestExtremeEmptyActions = actions.slice(
  oldestExtremeEmptyBounds.start + 1,
  oldestExtremeEmptyBounds.end,
);
assert.equal(
  oldestExtremeEmptyActions.filter(
    (action) => action.WFWorkflowActionIdentifier === DISCARD_V2,
  ).length,
  1,
);
assert.equal(
  oldestExtremeEmptyActions.some(
    (action) => action.WFWorkflowActionIdentifier === "is.workflow.actions.exit",
  ),
  true,
);

const assertDirectionGuard = ({ comparisonGuid, minimumCount }) => {
  const outer = uniqueAction(
    `sort-direction equality guard at ${minimumCount}`,
    (action) => {
      const candidate = actionParams(action);
      const input = conditionalInput(action);
      const comparison =
        candidate.WFConditionalActionString?.Value?.attachmentsByRange?.[
          "{0, 1}"
        ];
      return (
        action.WFWorkflowActionIdentifier === "is.workflow.actions.conditional" &&
        candidate.WFControlFlowMode === 0 &&
        candidate.WFCondition === 4 &&
        input?.Type === "ActionOutput" &&
        input.OutputUUID === actionParams(oldestExtremeGuid).UUID &&
        comparison?.Type === "ActionOutput" &&
        comparison.OutputUUID === actionParams(comparisonGuid).UUID
      );
    },
  );
  const outerBounds = controlBounds(outer);
  const countGuard = uniqueAction(
    `sort-direction count guard above ${minimumCount}`,
    (action) => {
      const candidate = actionParams(action);
      const input = conditionalInput(action);
      return (
        action.WFWorkflowActionIdentifier === "is.workflow.actions.conditional" &&
        candidate.WFControlFlowMode === 0 &&
        candidate.WFCondition === 2 &&
        candidate.WFNumberValue === minimumCount &&
        input?.Type === "ActionOutput" &&
        input.OutputUUID === actionParams(latestCount).UUID &&
        outerBounds.start < actionIndex(action) &&
        actionIndex(action) < outerBounds.end
      );
    },
  );
  const countBounds = controlBounds(countGuard);
  const failureActions = actions.slice(countBounds.start + 1, countBounds.end);
  assert.equal(
    failureActions.filter(
      (action) => action.WFWorkflowActionIdentifier === DISCARD_V2,
    ).length,
    1,
  );
  assert.equal(
    failureActions.some(
      (action) => action.WFWorkflowActionIdentifier === "is.workflow.actions.exit",
    ),
    true,
  );
  return outerBounds;
};
const sameExtremeGuard = assertDirectionGuard({
  comparisonGuid: newestExtremeGuid,
  minimumCount: 1,
});
assert.ok(actionIndex(oldestExtremeGuid) < sameExtremeGuard.start);
assert.ok(oldestExtremeEmptyBounds.end < sameExtremeGuard.start);
const countDifference = outputAction(
  "is.workflow.actions.math",
  "Query Count Difference",
);
assertActionOutput(
  actionParams(countDifference).WFInput,
  actionParams(oldestCount).UUID,
  "Oldest Messages Found",
);
assert.equal(actionParams(countDifference).WFMathOperation, "-");
assertActionOutput(
  actionParams(countDifference).WFMathOperand,
  actionParams(latestCount).UUID,
  "Latest Messages Found",
);
const countDifferenceSquared = outputAction(
  "is.workflow.actions.math",
  "Squared Query Count Difference",
);
assertActionOutput(
  actionParams(countDifferenceSquared).WFInput,
  actionParams(countDifference).UUID,
  "Query Count Difference",
);
assert.equal(actionParams(countDifferenceSquared).WFMathOperation, "×");
assertActionOutput(
  actionParams(countDifferenceSquared).WFMathOperand,
  actionParams(countDifference).UUID,
  "Query Count Difference",
);
const countMismatchCondition = uniqueAction(
  "query-count mismatch refusal",
  (action) => {
    const candidate = actionParams(action);
    const input = conditionalInput(action);
    return (
      action.WFWorkflowActionIdentifier === "is.workflow.actions.conditional" &&
      candidate.WFControlFlowMode === 0 &&
      candidate.WFCondition === 2 &&
      candidate.WFNumberValue === 0 &&
      input?.Type === "ActionOutput" &&
      input.OutputUUID === actionParams(countDifferenceSquared).UUID
    );
  },
);
const countMismatchBounds = controlBounds(countMismatchCondition);
assert.ok(countMismatchBounds.end < oldestBatch.repeat.start);
const countMismatchActions = actions.slice(
  countMismatchBounds.start + 1,
  countMismatchBounds.end,
);
assert.equal(
  countMismatchActions.filter(
    (action) => action.WFWorkflowActionIdentifier === DISCARD_V2,
  ).length,
  1,
);
assert.equal(
  countMismatchActions.some(
    (action) => action.WFWorkflowActionIdentifier === "is.workflow.actions.exit",
  ),
  true,
);

const oldestGuidExtractor = oldestBatch.extractors.get("Message GUID");
assert.ok(oldestGuidExtractor);
const overlapCondition = uniqueAction(
  "coverage-overlap comparison",
  (action) => {
    const candidate = actionParams(action);
    const input = conditionalInput(action);
    const comparison =
      candidate.WFConditionalActionString?.Value?.attachmentsByRange?.[
        "{0, 1}"
      ];
    return (
      action.WFWorkflowActionIdentifier === "is.workflow.actions.conditional" &&
      candidate.WFControlFlowMode === 0 &&
      candidate.WFCondition === 4 &&
      input?.Type === "ActionOutput" &&
      input.OutputUUID === actionParams(oldestGuidExtractor).UUID &&
      comparison?.Type === "ActionOutput" &&
      comparison.OutputUUID === actionParams(coverageBoundaryGuid).UUID
    );
  },
);
const overlapBounds = controlBounds(overlapCondition);
assert.ok(oldestBatch.repeat.start < overlapBounds.start);
assert.ok(overlapBounds.end < oldestBatch.repeat.end);
const overlapOne = uniqueAction(
  "coverage-overlap marker value",
  (action) =>
    action.WFWorkflowActionIdentifier === "is.workflow.actions.number" &&
    actionParams(action).CustomOutputName === "Coverage Confirmed" &&
    overlapBounds.start < actionIndex(action) &&
    actionIndex(action) < overlapBounds.end,
);
assert.equal(Number(actionParams(overlapOne).WFNumberActionNumber), 1);
const confirmedOverlapSetter = overlapSetters.find(
  (action) =>
    attachment(actionParams(action).WFInput)?.OutputUUID ===
    actionParams(overlapOne).UUID,
);
assert.ok(confirmedOverlapSetter);
assert.ok(actionIndex(confirmedOverlapSetter) < overlapBounds.end);

const noCoverageCondition = uniqueAction(
  "unproven-completeness refusal",
  (action) => {
    const candidate = actionParams(action);
    const input = conditionalInput(action);
    return (
      action.WFWorkflowActionIdentifier === "is.workflow.actions.conditional" &&
      candidate.WFControlFlowMode === 0 &&
      candidate.WFCondition === 1 &&
      candidate.WFNumberValue === 0 &&
      input?.Type === "Variable" &&
      input.VariableName === "Coverage Overlap" &&
      oldestBatch.repeat.end < actionIndex(action)
    );
  },
);
const noCoverageBounds = controlBounds(noCoverageCondition);
const noCoverageActions = actions.slice(
  noCoverageBounds.start + 1,
  noCoverageBounds.end,
);
assert.equal(
  noCoverageActions.filter(
    (action) => action.WFWorkflowActionIdentifier === DISCARD_V2,
  ).length,
  1,
);
assert.equal(
  noCoverageActions.some(
    (action) => action.WFWorkflowActionIdentifier === "is.workflow.actions.alert",
  ),
  true,
);
assert.equal(
  noCoverageActions.some(
    (action) => action.WFWorkflowActionIdentifier === "is.workflow.actions.exit",
  ),
  true,
);
for (const action of actions.filter(
  (candidate) => candidate.WFWorkflowActionIdentifier === "is.workflow.actions.setvariable",
)) {
  const bound = attachment(actionParams(action).WFInput);
  assert.equal(
    findActions.some(
      (findAction) => bound?.OutputUUID === actionParams(findAction).UUID,
    ),
    false,
    "a Message array must not be retained in a variable",
  );
}

const finalImportAction = uniqueAction(
  "final V2 import",
  (action) => action.WFWorkflowActionIdentifier === IMPORT_V2,
);
const finalImport = actionParams(finalImportAction);
assert.ok(oldestBatch.repeat.end + 1 < actionIndex(finalImportAction));
assert.ok(noCoverageBounds.end < actionIndex(finalImportAction));
assert.deepEqual(
  Object.keys(finalImport).sort(),
  ["AppIntentDescriptor", "UUID", "sessionId"].sort(),
);
assertDescriptor(finalImport.AppIntentDescriptor, "ImportWafraPreparedHistoryV2Intent");
assert.deepEqual(textAttachment(finalImport.sessionId), sessionBinding);
const urlEncodeAction = uniqueAction(
  "session URL encoder",
  (action) => action.WFWorkflowActionIdentifier === "is.workflow.actions.urlencode",
);
const deepLinkAction = uniqueAction(
  "Wafra deep link",
  (action) => action.WFWorkflowActionIdentifier === "is.workflow.actions.url",
);
const openURLAction = uniqueAction(
  "Wafra deep-link opener",
  (action) => action.WFWorkflowActionIdentifier === "is.workflow.actions.openurl",
);
assert.ok(actionIndex(finalImportAction) < actionIndex(urlEncodeAction));
assert.ok(actionIndex(urlEncodeAction) < actionIndex(deepLinkAction));
assert.ok(actionIndex(deepLinkAction) < actionIndex(openURLAction));
assert.doesNotMatch(
  actionParams(deepLinkAction).WFURLActionURL.Value.string,
  /body|sender|guid|message/i,
);

for (const forbidden of [
  "app.wafra.ios.BeginWafraHistoryImportIntent",
  "app.wafra.ios.StageWafraMessageHistoryIntent",
  "app.wafra.ios.FinishWafraHistoryImportIntent",
  "app.wafra.ios.ImportWafraMessageHistoryIntent",
  "app.wafra.ios.PrepareWafraHistoryMessageIntent",
  "app.wafra.ios.PrepareWafraHistoryMessageV2Intent",
  "app.wafra.ios.ImportWafraPreparedHistoryIntent",
  "is.workflow.actions.downloadurl",
  "is.workflow.actions.runworkflow",
  "is.workflow.actions.file.save",
  "is.workflow.actions.file.append",
  "is.workflow.actions.copytoclipboard",
  "is.workflow.actions.notification",
  "is.workflow.actions.showresult",
]) {
  assert.equal(identifiers.includes(forbidden), false, `forbidden action ${forbidden}`);
}

const smoke = buildHistoryShortcut({ messageLimit: 50, smoke: true });
assert.equal(verifyHistoryShortcutGraph(smoke), true);
const smokeFind = smoke.WFWorkflowActions.find(
  (action) => action.WFWorkflowActionIdentifier === FIND,
).WFWorkflowActionParameters;
assert.equal(smokeFind.WFContentItemLimitEnabled, true);
assert.equal(smokeFind.WFContentItemLimitNumber, 50);
assert.notEqual(
  smoke.WFWorkflowActions[0].WFWorkflowActionParameters.WFAlertActionMessage,
  shortcut.WFWorkflowActions[0].WFWorkflowActionParameters.WFAlertActionMessage,
);
assert.throws(() => buildHistoryShortcut({ messageLimit: 0 }), /1500/);
assert.throws(() => buildHistoryShortcut({ messageLimit: 50 }), /1500/);
assert.throws(
  () => buildHistoryShortcut({ messageLimit: 1, smoke: true }),
  /exactly 50/,
);

const mutate = (change) => {
  const candidate = structuredClone(shortcut);
  change(candidate, candidate.WFWorkflowActions);
  return candidate;
};
const rejects = (name, change) => {
  assert.throws(
    () => verifyHistoryShortcutGraph(mutate(change)),
    /exact production graph/,
    `mutation was accepted: ${name}`,
  );
};
const candidateByUUID = (candidateActions, sourceAction) => {
  const uuid = actionParams(sourceAction).UUID;
  const candidate = candidateActions.find(
    (action) => actionParams(action).UUID === uuid,
  );
  assert.ok(candidate, `mutation target ${uuid} is missing`);
  return candidate;
};

rejects("date filter reintroduced", (_candidate, candidateActions) => {
  actionParams(candidateByUUID(candidateActions, latestFind))
    .WFContentItemFilter.Value.WFActionParameterFilterTemplates.push({
      Property: "date",
      Operator: 2,
      Values: {},
    });
});
rejects("latest query limit changed", (_candidate, candidateActions) => {
  actionParams(candidateByUUID(candidateActions, latestFind)).WFContentItemLimitNumber =
    1499;
});
rejects("oldest query limit changed", (_candidate, candidateActions) => {
  actionParams(candidateByUUID(candidateActions, oldestFind)).WFContentItemLimitNumber =
    1501;
});
rejects("latest query order changed", (_candidate, candidateActions) => {
  actionParams(candidateByUUID(candidateActions, latestFind)).WFContentItemSortOrder =
    "Oldest First";
});
rejects("oldest query order changed", (_candidate, candidateActions) => {
  actionParams(candidateByUUID(candidateActions, oldestFind)).WFContentItemSortOrder =
    "Latest First";
});
rejects("first array release removed", (_candidate, candidateActions) => {
  const release = actions[latestBatch.repeat.end + 1];
  const candidateRelease = candidateByUUID(candidateActions, release);
  candidateActions.splice(candidateActions.indexOf(candidateRelease), 1);
});
rejects("position resets before oldest batch", (_candidate, candidateActions) => {
  actionParams(candidateByUUID(candidateActions, oldestBatch.increment))
    .WFInput.Value.VariableName = "Initial Prepared Position";
});
rejects("Find UUIDs collide", (_candidate, candidateActions) => {
  actionParams(candidateByUUID(candidateActions, oldestFind)).UUID =
    actionParams(latestFind).UUID;
});
rejects("duplicate final import", (_candidate, candidateActions) => {
  const candidateImport = candidateByUUID(candidateActions, finalImportAction);
  candidateActions.splice(
    candidateActions.indexOf(candidateImport),
    0,
    structuredClone(candidateImport),
  );
});
rejects("network action added", (_candidate, candidateActions) => {
  const candidateImport = candidateByUUID(candidateActions, finalImportAction);
  candidateActions.splice(candidateActions.indexOf(candidateImport), 0, {
    WFWorkflowActionIdentifier: "is.workflow.actions.downloadurl",
    WFWorkflowActionParameters: {},
  });
});

const checkerPath = join(
  repoRoot,
  "scripts",
  "check-ios-history-shortcut-artifact.sh",
);
const artifactDirectory = mkdtempSync(
  join(tmpdir(), "wafra-history-artifact-test."),
);
try {
  const jsonPath = join(artifactDirectory, "WafraHistoryImport.json");
  const binaryPath = join(artifactDirectory, "WafraHistoryImport.shortcut");
  const smokeJSONPath = join(artifactDirectory, "WafraHistoryImport-smoke.json");
  const smokeBinaryPath = join(
    artifactDirectory,
    "WafraHistoryImport-smoke.shortcut",
  );
  const signedPath = join(
    artifactDirectory,
    "WafraHistoryImport-smoke.signed.shortcut",
  );
  writeFileSync(jsonPath, `${JSON.stringify(shortcut, null, 2)}\n`);
  writeFileSync(smokeJSONPath, `${JSON.stringify(smoke, null, 2)}\n`);

  const check = (...args) =>
    spawnSync("bash", [checkerPath, ...args], {
      encoding: "utf8",
      cwd: repoRoot,
    });
  const invalidLimit = spawnSync(
    process.execPath,
    [
      builderPath,
      join(artifactDirectory, "invalid-limit.json"),
      "--limit",
      "50oops",
    ],
    { encoding: "utf8", cwd: repoRoot },
  );
  assert.notEqual(invalidLimit.status, 0, "CLI accepted a partially numeric limit");

  let result = check(jsonPath);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const noPlutilBin = join(artifactDirectory, "no-plutil-bin");
  mkdirSync(noPlutilBin);
  for (const command of ["dirname", "mktemp", "dd", "rm"]) {
    const resolved = spawnSync("sh", ["-c", `command -v ${command}`], {
      encoding: "utf8",
    }).stdout.trim();
    assert.notEqual(resolved, "", `could not resolve ${command}`);
    symlinkSync(resolved, join(noPlutilBin, command));
  }
  symlinkSync(process.execPath, join(noPlutilBin, "node"));
  result = spawnSync("/bin/bash", [checkerPath, "--production", jsonPath], {
    encoding: "utf8",
    cwd: repoRoot,
    env: { ...process.env, PATH: noPlutilBin },
  });
  assert.equal(
    result.status,
    0,
    `JSON checker requires Apple plutil: ${result.stderr || result.stdout}`,
  );

  const hasPlutil =
    spawnSync("plutil", ["-help"], { encoding: "utf8" }).status === 0;
  if (hasPlutil) {
    result = spawnSync(
      "plutil",
      ["-convert", "binary1", "-o", binaryPath, jsonPath],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    result = check(binaryPath);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = spawnSync(
      "plutil",
      ["-convert", "binary1", "-o", smokeBinaryPath, smokeJSONPath],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  }
  result = check(smokeJSONPath);
  assert.notEqual(result.status, 0, "production mode accepted the smoke graph");
  result = check("--smoke", smokeJSONPath);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = check("--smoke", jsonPath);
  assert.notEqual(result.status, 0, "smoke mode accepted a production graph");

  const limitOnePath = join(artifactDirectory, "limit-one.json");
  const limitOne = structuredClone(smoke);
  const limitOneFind = limitOne.WFWorkflowActions.find(
    (action) => action.WFWorkflowActionIdentifier === FIND,
  );
  limitOneFind.WFWorkflowActionParameters.WFContentItemLimitNumber = 1;
  writeFileSync(limitOnePath, JSON.stringify(limitOne));
  result = check("--smoke", limitOnePath);
  assert.notEqual(result.status, 0, "smoke mode accepted a limit other than 50");

  if (process.platform === "darwin" && hasPlutil) {
    result = check("--sign-smoke", smokeBinaryPath, signedPath);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /TRUSTED PIPELINE/);
    result = check(signedPath);
    assert.notEqual(
      result.status,
      0,
      "an opaque signed artifact passed without explicit signature-only mode",
    );
    result = check("--signature-only", signedPath);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /SIGNATURE-ONLY/);
    assert.doesNotMatch(result.stdout, /audited.*graph|graph.*matches/i);

    const corruptPath = join(artifactDirectory, "corrupt.signed.shortcut");
    const corrupt = readFileSync(signedPath);
    corrupt[Math.floor(corrupt.length / 2)] ^= 0xff;
    writeFileSync(corruptPath, corrupt);
    result = check("--signature-only", corruptPath);
    assert.notEqual(result.status, 0, "checker accepted a corrupt signed AEA");
  }
} finally {
  rmSync(artifactDirectory, { recursive: true, force: true });
}

console.log("ios-history-shortcut-artifact.test.js: two-ended contract passed");
