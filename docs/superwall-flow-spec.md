# Wafra Superwall Flow specification

This is the app/dashboard contract for Wafra's remotely editable onboarding and
Pro paywall. The identifiers below are API contracts; changing them in Superwall
requires a matching app update.

## Placements

| placement | purpose |
| --- | --- |
| `onboarding` | First-run value journey and non-sensitive personalization |
| `pro_upgrade` | Canonical Wafra Pro subscription paywall |
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

## Localization and country visual packs

Create English and Arabic variants. Keep Arabic conversational and GCC-friendly,
keep “Wafra” as the product name, keep CTAs short, and manually review RTL.

Every placement receives independent localization inputs:

- `language`: `en` or `ar`;
- `market`: Wafra's parser-market preference (currently `AE` / `SA`);
- `country`: actual device/onboarding region when Wafra has a reviewed pack;
- `locale`: `<language>_<country>` such as `en_AE`, `ar_SA`, `en_GB`;
- `currency`: visual country's currency when known;
- `platform`, plus the existing placement-specific parameters.

Country and language are different axes. `AE + en` and `AE + ar` use the same
UAE visual pack with different copy/direction; `SA + en` and `SA + ar` do the
same for Saudi. A device in another reviewed region uses that region even while
the parser remains on its launch fallback.

The shared first-page money scene is driven by `country`, not by language and
not by parser `market`. It must use real reviewed bank domains/logo artwork plus
local merchant/service examples and local currency. Do **not** duplicate the
full Focus/Tracking/Intention flow per country.

Current reviewed onboarding regions are:

```text
AE SA US GB FR DE ES IT NL IN QA KW BH OM EG JO
```

Unsupported countries use a neutral generic-bank/merchant fallback. They must
never silently inherit UAE examples.

Local brands on the value scene are familiarity examples, not a claim that every
displayed institution is supported. Keep the examples-only disclosure unless
the wording is backed by actual parser/capture coverage.

## Failure/fallback rules

Wafra automatically falls back to its native onboarding if Superwall is not
configured, configuration fails, the placement is missing/skipped/errors,
initial configuration takes too long, or an interrupted native iOS setup already
exists. Dismissing the remote Flow before the callback also falls back to native
onboarding so first run can never become a dead end.

## Privacy contract

Allowed Wafra-supplied targeting metadata is limited to language, parser market,
country/currency, onboarding focus/tracking/intention, capture choice and local trial days. Never
send the local first name, ledger rows, balances, amounts, SMS bodies or
card/account identifiers. With Wafra's saved local-only preference enabled,
optional event tracking is disabled and these targeting attributes are withheld.
