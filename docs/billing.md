# Turning on billing

The code is done. What is left is account setup, none of which can be done
from the repository — and until the last step the app behaves exactly as it
does today: `isBillingAvailable()` is false, the paywall explains itself, and
the founder unlock still works.

## Why RevenueCat

iOS and Android feed the same named entitlement, which keeps each platform's
purchase logic consistent. That does **not** by itself transfer a subscription
between a person's Android phone and iPhone: Wafra currently has no account or
cross-platform identity, so RevenueCat's anonymous customer IDs are normally
different on the two installs. Do not market cross-platform entitlement
continuity unless a safe linking design is implemented and tested.

It costs 1% of tracked revenue above roughly $2.5k/month.

**What it sees:** a purchase and an anonymous customer id. It never sees a
transaction, a balance, an account number or an SMS — those never leave the
phone, and no code path sends them anywhere. Worth stating plainly, because
onboarding promises there is no server.

## Setup

1. **RevenueCat project.** Create one, add the Android app, and connect it to
   Play with a service-account JSON from Google Cloud (Play Console → Setup →
   API access). RevenueCat's dashboard walks this through.

2. **Play Console → Monetize → Subscriptions.** Create two, with exactly these
   product ids — they are what the app asks for:

   | plan | product id | price |
   | --- | --- | --- |
   | monthly | `wafra_pro_monthly` | AED 9.99 |
   | yearly | `wafra_pro_yearly` | AED 74.99 |

   Add a **3-day free trial** to both, so the store shows it natively and the
   in-app trial and the store trial say the same thing.

   Prices live in `PRO_PRICES` in `src/lib/purchases.ts` and must match what
   you set here. The "months free" line on the paywall is derived from them,
   so it cannot drift on its own — but it will happily be derived from the
   wrong numbers if these two disagree.

3. **RevenueCat → Entitlements.** Create one called exactly `pro` and attach
   both products. That string is `ENTITLEMENT_ID`; if you name it something
   else, change it there too.

4. **The key.** RevenueCat → API keys → the **public** Android SDK key. Put it
   in `app.json`:

   ```json
   "extra": { "revenueCatAndroidKey": "goog_xxxxxxxx" }
   ```

   Public SDK keys are meant to ship in the client. Do not put a *secret* key
   here.

5. **Rebuild.** This adds a native module, so a new APK/AAB is required — an
   OTA update cannot pick it up.

## Testing it

Play Billing only works for an app installed **from Play**, so a side-loaded
APK cannot complete a purchase however well configured. Upload to an internal
testing track and install from there. Add your account under Play Console →
Setup → License testing to buy without being charged.

## How entitlement is decided

RevenueCat is the only source of truth. It is asked once per launch, and
`state.pro` is a cache of that answer.

That matters because before this, `pro` was a local boolean nothing ever
re-checked: once true it stayed true through a lapsed subscription, a refund
or a cancellation, and a reinstall left a paying customer to find the Restore
button by themselves.

One rule in that path is deliberate and easy to get wrong later:
`refreshEntitlement()` returns `true`, `false`, or **`null` meaning the store
could not be reached** — and null is not false. Losing signal on a flight is
not the same as never having paid. On null the cached flag stands.

## For iOS, later

Add the iOS app in RevenueCat, create the same two product ids in App Store
Connect, attach them to the same `pro` entitlement, and put the public iOS
key in `extra.revenueCatIosKey`. No application code changes: `apiKey()`
already picks the key by platform.
