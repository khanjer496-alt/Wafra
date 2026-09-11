#!/usr/bin/env node

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const repoRoot = resolve(__dirname, "../..");
const builderPath = join(
  repoRoot,
  "scripts",
  "build-ios-local-capture-shortcut.mjs",
);
const checkerPath = join(
  repoRoot,
  "scripts",
  "check-ios-local-capture-shortcut-artifact.sh",
);

assert.equal(
  existsSync(builderPath),
  true,
  "the Wafra Local Capture Shortcut builder must exist",
);
assert.equal(
  existsSync(checkerPath),
  true,
  "the Wafra Local Capture trusted artifact checker must exist",
);

const APP_BUNDLE_ID = "app.wafra.ios";
const SETUP = `${APP_BUNDLE_ID}.RecordWafraCaptureSetupProofIntent`;
const STAGE = `${APP_BUNDLE_ID}.StageWafraLiveMessageIntent`;
const STAGE_TEXT = `${APP_BUNDLE_ID}.StageWafraLiveTextIntent`;
const EXPECTED_DESCRIPTOR = (intent) => ({
  TeamIdentifier: "UV7YN4GQ66",
  BundleIdentifier: APP_BUNDLE_ID,
  Name: "Wafra",
  AppIntentIdentifier: intent,
});

const parameters = (action) => action.WFWorkflowActionParameters;
const identifier = (action) => action.WFWorkflowActionIdentifier;
const tokenAttachment = (value, range = "{0, 1}") => {
  assert.equal(value?.WFSerializationType, "WFTextTokenString");
  assert.equal(value?.Value?.string, "\ufffc");
  assert.deepEqual(Object.keys(value?.Value?.attachmentsByRange ?? {}), [range]);
  return value.Value.attachmentsByRange[range];
};

const main = async () => {
  const {
    buildLocalCaptureShortcut,
    verifyLocalCaptureShortcutGraph,
    IOS_LOCAL_CAPTURE_CATCHUP_LIMIT,
  } =
    await import(pathToFileURL(builderPath));
  const shortcut = buildLocalCaptureShortcut();
  const actions = shortcut.WFWorkflowActions;
  const ids = actions.map(identifier);

  assert.equal(shortcut.WFWorkflowName, "Wafra Local Capture");
  assert.deepEqual(shortcut.WFWorkflowInputContentItemClasses, [
    "WFStringContentItem",
    "WFMessageContentItem",
  ]);
  assert.equal(shortcut.WFWorkflowHasShortcutInputVariables, true);
  assert.equal(shortcut.WFWorkflowHasOutputFallback, false);
  assert.deepEqual(shortcut.WFWorkflowOutputContentItemClasses, []);
  assert.deepEqual(shortcut.WFWorkflowImportQuestions, []);
  assert.equal(actions.length, 26);
  assert.equal(verifyLocalCaptureShortcutGraph(shortcut), true);
  assert.deepEqual(buildLocalCaptureShortcut(), shortcut);

  assert.deepEqual(ids, [
    "is.workflow.actions.conditional",
    SETUP,
    "com.apple.MobileSMS.MessageEntity",
    "is.workflow.actions.repeat.each",
    "is.workflow.actions.gettext",
    "is.workflow.actions.gettext",
    "is.workflow.actions.gettext",
    "is.workflow.actions.hash",
    "is.workflow.actions.text.changecase",
    STAGE,
    "is.workflow.actions.repeat.each",
    "is.workflow.actions.exit",
    "is.workflow.actions.conditional",
    "is.workflow.actions.getitemtype",
    "is.workflow.actions.conditional",
    "is.workflow.actions.gettext",
    STAGE_TEXT,
    "is.workflow.actions.exit",
    "is.workflow.actions.conditional",
    "is.workflow.actions.gettext",
    "is.workflow.actions.gettext",
    "is.workflow.actions.gettext",
    "is.workflow.actions.hash",
    "is.workflow.actions.text.changecase",
    STAGE,
    "is.workflow.actions.exit",
  ]);

  const noInput = parameters(actions[0]);
  const noInputVariable = noInput.WFInput?.Variable;
  const noInputAttachment = noInputVariable?.Value ?? noInputVariable;
  assert.equal(noInput.WFControlFlowMode, 0);
  assert.equal(noInput.WFCondition, 101);
  assert.equal(noInputAttachment?.Type, "ExtensionInput");
  assert.deepEqual(noInputAttachment?.Aggrandizements ?? [], []);
  assert.deepEqual(parameters(actions[1]), {
    UUID: parameters(actions[1]).UUID,
    AppIntentDescriptor: EXPECTED_DESCRIPTOR(
      "RecordWafraCaptureSetupProofIntent",
    ),
  });
  const catchupFind = parameters(actions[2]);
  assert.equal(catchupFind.WFContentItemSortProperty, "date");
  assert.equal(catchupFind.WFContentItemSortOrder, "Latest First");
  assert.equal(catchupFind.WFContentItemLimitEnabled, true);
  assert.equal(catchupFind.WFContentItemLimitNumber, IOS_LOCAL_CAPTURE_CATCHUP_LIMIT);
  assert.equal(IOS_LOCAL_CAPTURE_CATCHUP_LIMIT, 300);
  assert.deepEqual(catchupFind.WFContentItemFilter.Value.WFActionParameterFilterTemplates, []);
  assert.equal(parameters(actions[3]).WFControlFlowMode, 0);
  assert.deepEqual(parameters(actions[3]).WFInput.Value, {
    Type: "ActionOutput",
    OutputUUID: catchupFind.UUID,
    OutputName: "Message",
  });

  for (const [index, outputName, propertyName] of [
    [4, "Sender Text", "Sender"],
    [5, "Message Body", "Content"],
    [6, "Message GUID", "GUID"],
  ]) {
    const extraction = parameters(actions[index]);
    assert.equal(extraction.CustomOutputName, outputName);
    const bound = tokenAttachment(extraction.WFTextActionText);
    assert.equal(bound.Type, "Variable");
    assert.equal(bound.VariableName, "Repeat Item");
    assert.deepEqual(bound.Aggrandizements, [
      { Type: "WFPropertyVariableAggrandizement", PropertyName: propertyName },
      { Type: "WFCoercionVariableAggrandizement", CoercionItemClass: "WFStringContentItem" },
    ]);
  }
  assert.equal(parameters(actions[7]).WFHashType, "SHA256");
  assert.deepEqual(parameters(actions[7]).WFInput.Value, {
    Type: "ActionOutput",
    OutputUUID: parameters(actions[6]).UUID,
    OutputName: "Message GUID",
  });
  assert.equal(parameters(actions[8]).WFCaseType, "lowercase");
  const catchupStage = parameters(actions[9]);
  assert.deepEqual(catchupStage.AppIntentDescriptor, EXPECTED_DESCRIPTOR("StageWafraLiveMessageIntent"));
  assert.deepEqual(tokenAttachment(catchupStage.observedAt), {
    Type: "Variable",
    VariableName: "Repeat Item",
    Aggrandizements: [{ Type: "WFPropertyVariableAggrandizement", PropertyName: "date" }],
  });
  assert.equal(parameters(actions[10]).WFControlFlowMode, 2);
  assert.equal(parameters(actions[10]).GroupingIdentifier, parameters(actions[3]).GroupingIdentifier);
  assert.deepEqual(parameters(actions[11]), {});
  assert.equal(parameters(actions[12]).WFControlFlowMode, 2);
  assert.equal(
    parameters(actions[12]).GroupingIdentifier,
    noInput.GroupingIdentifier,
  );

  for (const [index, outputName, propertyName] of [
    [19, "Sender Text", "Sender"],
    [20, "Message Body", "Content"],
    [21, "Message GUID", "GUID"],
  ]) {
    const extraction = parameters(actions[index]);
    assert.equal(extraction.CustomOutputName, outputName);
    const bound = tokenAttachment(extraction.WFTextActionText);
    assert.equal(bound.Type, "ExtensionInput");
    assert.deepEqual(bound.Aggrandizements, [
      {
        Type: "WFPropertyVariableAggrandizement",
        PropertyName: propertyName,
      },
      {
        Type: "WFCoercionVariableAggrandizement",
        CoercionItemClass: "WFStringContentItem",
      },
    ]);
  }

  assert.equal(ids.includes("is.workflow.actions.number.random"), false);
  assert.equal(/CurrentDate/.test(JSON.stringify(shortcut)), false);

  const inputType = parameters(actions[13]);
  assert.equal(identifier(actions[13]), "is.workflow.actions.getitemtype");
  assert.equal(inputType.WFInput.Value.Type, "ExtensionInput");
  const textBranch = parameters(actions[14]);
  assert.equal(textBranch.WFConditionalActionString, "Text");
  assert.equal(textBranch.WFControlFlowMode, 0);
  const fallbackText = parameters(actions[15]);
  assert.equal(fallbackText.CustomOutputName, "Fallback Message Text");
  assert.deepEqual(tokenAttachment(fallbackText.WFTextActionText), {
    Type: "ExtensionInput",
    Aggrandizements: [
      { Type: "WFCoercionVariableAggrandizement", CoercionItemClass: "WFStringContentItem" },
    ],
  });
  const fallbackStage = parameters(actions[16]);
  assert.deepEqual(fallbackStage.AppIntentDescriptor, EXPECTED_DESCRIPTOR("StageWafraLiveTextIntent"));
  assert.deepEqual(tokenAttachment(fallbackStage.body), {
    Type: "ActionOutput",
    OutputUUID: fallbackText.UUID,
    OutputName: "Fallback Message Text",
  });
  assert.equal(parameters(actions[18]).GroupingIdentifier, textBranch.GroupingIdentifier);
  assert.equal(parameters(actions[18]).WFControlFlowMode, 2);

  const guidHash = parameters(actions[22]);
  assert.equal(guidHash.WFHashType, "SHA256");
  assert.deepEqual(guidHash.WFInput.Value, {
    Type: "ActionOutput",
    OutputUUID: parameters(actions[21]).UUID,
    OutputName: "Message GUID",
  });
  assert.equal(guidHash.WFInput.WFSerializationType, "WFTextTokenAttachment");

  const lowercaseHash = parameters(actions[23]);
  assert.equal(lowercaseHash.CustomOutputName, "Lowercase Message ID");
  assert.equal(lowercaseHash.WFCaseType, "lowercase");
  assert.deepEqual(tokenAttachment(lowercaseHash.text), {
    Type: "ActionOutput",
    OutputUUID: guidHash.UUID,
    OutputName: "Hash",
  });

  const stage = parameters(actions[24]);
  assert.deepEqual(Object.keys(stage).sort(), [
    "AppIntentDescriptor",
    "UUID",
    "body",
    "eventId",
    "observedAt",
    "sender",
  ]);
  assert.deepEqual(
    stage.AppIntentDescriptor,
    EXPECTED_DESCRIPTOR("StageWafraLiveMessageIntent"),
  );
  for (const [key, sourceIndex, outputName] of [
    ["sender", 19, "Sender Text"],
    ["body", 20, "Message Body"],
    ["eventId", 23, "Lowercase Message ID"],
  ]) {
    const bound = tokenAttachment(stage[key]);
    assert.deepEqual(bound, {
      Type: "ActionOutput",
      OutputUUID: parameters(actions[sourceIndex]).UUID,
      OutputName: outputName,
    });
  }
  assert.deepEqual(tokenAttachment(stage.observedAt), {
    Type: "ExtensionInput",
    Aggrandizements: [
      {
        Type: "WFPropertyVariableAggrandizement",
        PropertyName: "date",
      },
    ],
  });
  assert.deepEqual(parameters(actions[25]), {});

  const forbiddenIdentifiers = [
    /downloadurl|openurl|url\.getcontents/i,
    /(?:^|\.)(?:file|folder)(?:\.|$)|(?:get|save|move|create|delete|append)file/i,
    /clipboard/i,
    /notification|showresult|quicklook|speak|alert|log|print/i,
    /runworkflow/i,
  ];
  for (const actionId of ids) {
    assert.equal(
      forbiddenIdentifiers.some((pattern) => pattern.test(actionId)),
      false,
      `forbidden action ${actionId}`,
    );
  }
  assert.equal(/https?:\/\/|Bearer\s|Authorization/i.test(JSON.stringify(shortcut)), false);

  const mutate = (change) => {
    const candidate = structuredClone(shortcut);
    change(candidate, candidate.WFWorkflowActions);
    return candidate;
  };
  const rejects = (name, change) => {
    assert.throws(
      () => verifyLocalCaptureShortcutGraph(mutate(change)),
      /exact Wafra Local Capture graph/,
      `mutation was accepted: ${name}`,
    );
  };

  rejects("Text input removed", (candidate) => {
    candidate.WFWorkflowInputContentItemClasses.shift();
  });
  rejects("import question added", (candidate) => {
    candidate.WFWorkflowImportQuestions.push({ Category: "Parameter" });
  });
  rejects("setup proof removed", (_candidate, candidateActions) => {
    candidateActions.splice(1, 1);
  });
  rejects("wrong no-input condition", (_candidate, candidateActions) => {
    parameters(candidateActions[0]).WFCondition = 100;
  });
  rejects("sender reads body", (_candidate, candidateActions) => {
    tokenAttachment(parameters(candidateActions[19]).WFTextActionText)
      .Aggrandizements[0].PropertyName = "Content";
  });
  rejects("body loses String coercion", (_candidate, candidateActions) => {
    tokenAttachment(parameters(candidateActions[20]).WFTextActionText)
      .Aggrandizements.pop();
  });
  rejects("GUID reads Content", (_candidate, candidateActions) => {
    tokenAttachment(parameters(candidateActions[21]).WFTextActionText)
      .Aggrandizements[0].PropertyName = "Content";
  });
  rejects("GUID loses String coercion", (_candidate, candidateActions) => {
    tokenAttachment(parameters(candidateActions[21]).WFTextActionText)
      .Aggrandizements.pop();
  });
  rejects("GUID hash reads the body", (_candidate, candidateActions) => {
    parameters(candidateActions[22]).WFInput = {
      Value: {
        Type: "ActionOutput",
        OutputUUID: parameters(candidateActions[20]).UUID,
        OutputName: "Message Body",
      },
      WFSerializationType: "WFTextTokenAttachment",
    };
  });
  rejects("Message hash is not normalized to lowercase", (_candidate, candidateActions) => {
    parameters(candidateActions[23]).WFCaseType = "UPPERCASE";
  });
  rejects("event ID bypasses lowercase normalization", (_candidate, candidateActions) => {
    const stageEvent = tokenAttachment(parameters(candidateActions[24]).eventId);
    stageEvent.OutputUUID = parameters(candidateActions[22]).UUID;
    stageEvent.OutputName = "Hash";
  });
  rejects("date uses receipt time", (_candidate, candidateActions) => {
    parameters(candidateActions[24]).observedAt = {
      Value: {
        string: "\ufffc",
        attachmentsByRange: { "{0, 1}": { Type: "CurrentDate" } },
      },
      WFSerializationType: "WFTextTokenString",
    };
  });
  rejects("date uses an untyped attachment", (_candidate, candidateActions) => {
    parameters(candidateActions[24]).observedAt = {
      Value: { Type: "CurrentDate" },
      WFSerializationType: "WFTextTokenAttachment",
    };
  });
  rejects("date uses the wrong property spelling", (_candidate, candidateActions) => {
    tokenAttachment(parameters(candidateActions[24]).observedAt)
      .Aggrandizements[0].PropertyName = "Date";
  });
  rejects("date is coerced to a display String", (_candidate, candidateActions) => {
    tokenAttachment(parameters(candidateActions[24]).observedAt)
      .Aggrandizements.push({
        Type: "WFCoercionVariableAggrandizement",
        CoercionItemClass: "WFStringContentItem",
      });
  });
  rejects("wrong App Intent", (_candidate, candidateActions) => {
    candidateActions[24].WFWorkflowActionIdentifier =
      `${APP_BUNDLE_ID}.ImportWafraMessageHistoryIntent`;
  });
  rejects("network action inserted", (_candidate, candidateActions) => {
    candidateActions.splice(24, 0, {
      WFWorkflowActionIdentifier: "is.workflow.actions.downloadurl",
      WFWorkflowActionParameters: {},
    });
  });
  rejects("Message output shown", (_candidate, candidateActions) => {
    candidateActions[25].WFWorkflowActionIdentifier =
      "is.workflow.actions.showresult";
  });

  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "wafra-local-capture-shortcut-test-"),
  );
  try {
    const generatedPath = join(temporaryDirectory, "local-capture.json");
    execFileSync(process.execPath, [builderPath, generatedPath], { stdio: "pipe" });
    assert.deepEqual(
      JSON.parse(readFileSync(generatedPath, "utf8")),
      shortcut,
    );
    assert.match(
      execFileSync("bash", [checkerPath, "--json", generatedPath], {
        encoding: "utf8",
      }),
      /^PASS: exact Wafra Local Capture graph matches$/m,
    );

    const badPath = join(temporaryDirectory, "bad-local-capture.json");
    const bad = mutate((_candidate, candidateActions) => {
      tokenAttachment(parameters(candidateActions[24]).body).OutputUUID =
        parameters(candidateActions[19]).UUID;
    });
    writeFileSync(badPath, `${JSON.stringify(bad)}\n`, "utf8");
    assert.throws(
      () =>
        execFileSync("bash", [checkerPath, "--json", badPath], {
          stdio: "pipe",
        }),
      (error) => {
        assert.match(
          error.stderr.toString(),
          /exact Wafra Local Capture graph/,
        );
        return true;
      },
    );

    const receiptTimePath = join(
      temporaryDirectory,
      "receipt-time-local-capture.json",
    );
    const receiptTime = mutate((_candidate, candidateActions) => {
      parameters(candidateActions[24]).observedAt = {
        Value: {
          string: "\ufffc",
          attachmentsByRange: { "{0, 1}": { Type: "CurrentDate" } },
        },
        WFSerializationType: "WFTextTokenString",
      };
    });
    writeFileSync(receiptTimePath, `${JSON.stringify(receiptTime)}\n`, "utf8");
    assert.throws(
      () =>
        execFileSync("bash", [checkerPath, "--json", receiptTimePath], {
          stdio: "pipe",
        }),
      (error) => {
        assert.match(error.stderr.toString(), /exact Wafra Local Capture graph/);
        return true;
      },
    );

    const check = (...args) =>
      spawnSync("bash", [checkerPath, ...args], {
        cwd: repoRoot,
        encoding: "utf8",
      });
    const noPlutilBin = join(temporaryDirectory, "no-plutil-bin");
    mkdirSync(noPlutilBin);
    for (const command of ["dirname", "mktemp", "dd", "rm"]) {
      const resolved = spawnSync("sh", ["-c", `command -v ${command}`], {
        encoding: "utf8",
      }).stdout.trim();
      assert.notEqual(resolved, "", `could not resolve ${command}`);
      symlinkSync(resolved, join(noPlutilBin, command));
    }
    symlinkSync(process.execPath, join(noPlutilBin, "node"));
    let result = spawnSync(
      "/bin/bash",
      [checkerPath, "--json", generatedPath],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, PATH: noPlutilBin },
      },
    );
    assert.equal(
      result.status,
      0,
      `JSON verification unexpectedly requires plutil: ${result.stderr}`,
    );

    const hasPlutil =
      spawnSync("plutil", ["-help"], { encoding: "utf8" }).status === 0;
    const binaryPath = join(temporaryDirectory, "local-capture.shortcut");
    if (hasPlutil) {
      result = spawnSync(
        "plutil",
        ["-convert", "binary1", "-o", binaryPath, generatedPath],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      result = check(binaryPath);
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }

    const hasShortcuts =
      spawnSync("shortcuts", ["help"], { encoding: "utf8" }).status === 0;
    if (process.platform === "darwin" && hasPlutil && hasShortcuts) {
      const signedPath = join(
        temporaryDirectory,
        "local-capture.signed.shortcut",
      );
      result = check("--sign", binaryPath, signedPath);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /TRUSTED PIPELINE/);

      result = check(signedPath);
      assert.notEqual(
        result.status,
        0,
        "an opaque signed artifact passed as an audited graph",
      );
      result = check("--signature-only", signedPath);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /SIGNATURE-ONLY/);
      assert.doesNotMatch(result.stdout, /audited.*graph|graph.*matches/i);

      const corruptPath = join(
        temporaryDirectory,
        "corrupt.signed.shortcut",
      );
      const corrupt = readFileSync(signedPath);
      corrupt[Math.floor(corrupt.length / 2)] ^= 0xff;
      writeFileSync(corruptPath, corrupt);
      result = check("--signature-only", corruptPath);
      assert.notEqual(
        result.status,
        0,
        "checker accepted a corrupt signed AEA",
      );
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
};

main()
  .then(() => {
    console.log("iOS local-capture Shortcut artifact: PASS");
  })
  .catch((error) => {
    console.error(error.stack ?? error);
    process.exit(1);
  });
