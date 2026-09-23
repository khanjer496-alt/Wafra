# Wafra Superwall Flow specification

This is the app/dashboard contract for Wafra's remotely editable onboarding and
Pro paywall. The identifiers below are API contracts; changing them in Superwall
requires a matching app update.

## Placements

| placement | purpose |
| --- | --- |
| `onboarding` | First-run value journey and non-sensitive personalization |
| `pro_upgrade` | Reserved. Wafra's native `/pro` screen owns Pro checkout; the app does not register this placement |
| `post_import_pro` | Reserved post-import conversion experiment |

## `onboarding` Flow

Superwall owns only the part that benefits from remote visual/copy experiments.
Device-state work stays native and recoverable.

### 1. Welcome/value

Show Wafra's real visual language and product-inspired scenes. Do not fabricate
balances, testimonials or bank connectivity. Explain that supported bank
activity can become a clear view of spending, bills and cash flow.

### 2. Focus

Persist Flow variable `focus` as exactly one of:

```text
spending
bills
cashflow
overview
```

### 3. Previous tracking method

Persist Flow variable `tracking` as exactly one of:

```text
none
bank-apps
spreadsheet
finance-app
```

### 4. Intention

Persist Flow variable `intention` as exactly one of:

```text
control
spend-intentionally
stay-ahead
build-buffer
```

### 5. Personalized preview

Branch by `focus`/`intention` and show the benefit the person chose. This is a
value screen, not an OS setup screen. Do not request SMS, notification access or
iOS Shortcut actions here.

### Final action: native handoff

Use a **custom callback** named exactly:

```text
wafra_onboarding_handoff
```

Pass all three variables:

```text
focus = <focus>
tracking = <tracking>
intention = <intention>
```

Wafra validates all values, persists stage `remote-handoff` to encrypted local
storage, then dismisses the remote Flow. If persistence fails, the callback
returns failure and the Flow must stay visible with Retry.

After handoff, Wafra asks the optional first name/nickname **locally on-device**.
Do not collect a name in Superwall: the app intentionally never sends the user's
name to Superwall. Saving or skipping the name then continues directly into the
native capture/setup step without replaying Focus/Tracking/Intention.

## Intentionally native after handoff

- first-name personalization and its device-only storage;
- Android SMS permission and historical scan;
- Android notification access/source admission;
- iPhone Shortcut/App Intent setup and validation;
- iPhone message-history import and recovery;
- statement/import progress;
- storage/hydration recovery;
- final durable `onboarded=true` transition and notification consent.

## Localization

Create English and Arabic variants. Keep Arabic conversational and GCC-friendly,
keep “Wafra” as the product name, keep CTAs short, and manually review RTL.
Every placement receives `language` (`en`/`ar`) and `market`; use `language` in
audience rules so an in-session Wafra language switch is deterministic.

## Failure/fallback rules

Wafra automatically falls back to its native onboarding if Superwall is not
configured, configuration fails, the placement is missing/skipped/errors,
initial configuration takes too long, or an interrupted native iOS setup already
exists. Dismissing the remote Flow before the callback also falls back to native
onboarding so first run can never become a dead end.

## Privacy contract

Allowed Wafra-supplied targeting metadata is limited to language, market,
onboarding focus/tracking/intention, capture choice and local trial days. Never
send the local first name, ledger rows, balances, amounts, SMS bodies or
card/account identifiers. With Wafra's saved local-only preference enabled,
optional event tracking is disabled and these targeting attributes are withheld.
