# Turning on billing

The code is done. What is left is account setup, none of which can be done
from the repository — and until the last step the app behaves exactly as it
does today: `isBillingAvailable()` is false and the paywall explains itself.

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

1. **RevenueCat project.** Create one, add both the Android and iOS apps, then
   connect Google Play with a service-account JSON and App Store Connect with
   an in-app-purchase key. RevenueCat's dashboard walks through both.

2. **Play Console → Monetize → Subscriptions.** Create two, with exactly these
   product ids — they are what the app asks for:

   | plan | product id | reference price |
   | --- | --- | --- |
   | monthly | `wafra_pro_monthly` | US$9.99 |
   | yearly | `wafra_pro_yearly` | US$74.99 |

   Do **not** add a storefront introductory trial while Wafra's three-day local
   trial remains enabled. A store trial starts when the user subscribes, so the
   two trials would stack and turn an advertised three days into as many as six.

   Enable every territory where Wafra will be distributed and use each store's
   local price tiers instead of converting one AED amount yourself. The native
   paywall reads the signed-in storefront's localized `priceString` directly;
   the user's ledger currency is never used as a billing price. The USD values
   above are references for web previews only; an unconfigured native build
   says the price is unavailable instead of pretending the reference is live.

3. **App Store Connect → Subscriptions.** Create the same two product ids in a
   subscription group, enable the intended territories, and set localized price
   tiers. Do not add an introductory trial unless the local trial is removed in
   the same release. Product ids are shared for operational simplicity; Apple
   and Google still sell separate purchases.

4. **RevenueCat → Entitlements.** Create one called exactly `pro` and attach
   all four store products. That string is `ENTITLEMENT_ID`; if you name it
   something else, change it there too.

5. **The keys.** RevenueCat → API keys → copy the **public** SDK keys. Put them
   in `app.json`:

   ```json
   "extra": {
     "revenueCatAndroidKey": "goog_xxxxxxxx",
     "revenueCatIosKey": "appl_xxxxxxxx"
   }
   ```

   Public SDK keys are meant to ship in the client. Do not put a *secret* key
   here.

6. **Rebuild.** This adds a native module, so new AAB and iOS archive builds are
   required — an OTA update cannot pick it up.

## Testing it

Do not use a side-loaded APK as billing evidence. A keyed build can initialize
RevenueCat there, but Play may still refuse the purchase because the install did
not come from Play. Upload to an internal testing track and install from there.
Add your account under Play Console → Setup → License testing to buy without
being charged. On iOS, install through TestFlight and test with an App Store
sandbox account.

Before release, switch the device storefront through at least one 0-decimal,
one 2-decimal and one 3-decimal currency territory and verify that the exact
store-formatted price appears unchanged on Wafra's paywall.

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
